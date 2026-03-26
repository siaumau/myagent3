// Load .env into process.env (if present)
try { require('dotenv').config(); } catch (e) { /* ignore if not installed */ }
const express = require('express');
const path = require('path');
const fs = require('fs');
const ai = require('./ai');
const axios = require('axios');
const os = require('os');
const mysql = require('mysql2/promise');
const { fetchNews } = require('./news_fetcher');
const todoService = require('./todo_service');
const { scheduler } = require('./todo_scheduler');
const { processor } = require('./image_processor');
const { PATHS, initializeDirectories } = require('./paths');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize output directories
initializeDirectories();

// logs directory for optional context persistence
const LOGS_DIR = PATHS.LOGS;
if (!fs.existsSync(LOGS_DIR)) {
  try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch (e) { /* ignore */ }
}

function appendContextLog(entry) {
  try {
    const file = path.join(LOGS_DIR, 'contexts.jsonl');
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.warn('Failed to append context log:', err && err.message);
  }
}

// Read infor.txt once (used by functions)
const INFOR_PATH = path.join(__dirname, 'data', 'output', 'text', 'infor.txt');
let inforContent = '';
try {
  inforContent = fs.readFileSync(INFOR_PATH, 'utf8');
} catch (err) {
  console.warn('Could not read infor.txt:', err.message);
}

// Try to extract a default remote URL (first non-empty line) and optional JSON payload
let DEFAULT_REMOTE_URL = process.env.REMOTE_API_URL || '';
let INFOR_JSON = null;
if (!DEFAULT_REMOTE_URL) {
  const lines = inforContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length > 0 && lines[0].startsWith('http')) {
    DEFAULT_REMOTE_URL = lines[0];
  }
}

// Try to parse JSON block in infor.txt (if present)
try {
  const firstBrace = inforContent.indexOf('{');
  const lastBrace = inforContent.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const raw = inforContent.slice(firstBrace, lastBrace + 1);
    INFOR_JSON = JSON.parse(raw);
  }
} catch (err) {
  // ignore parse errors, INFOR_JSON stays null
  console.warn('Could not parse JSON from infor.txt:', err.message);
}

const REMOTE_API_URL = DEFAULT_REMOTE_URL; // may be empty

// Database configuration from .env
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'testdb'
};

// Define tool descriptions to send to remote LLM when requesting function-calling
const TOOL_DEFS = (INFOR_JSON && INFOR_JSON.tools) ? INFOR_JSON.tools : [
  { type: 'function', function: { name: 'get_weather', description: '查詢指定城市的天氣', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } },
  { type: 'function', function: { name: 'get_time', description: '取得當前時間', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'list_files', description: '列出指定目錄中的檔案和資料夾', parameters: { type: 'object', properties: { path: { type: 'string', description: '目錄路徑，預設為當前目錄' } } } } },
  { type: 'function', function: { name: 'query_database', description: '查詢資料庫中的資料，可以查詢表內容或搜尋特定資料', parameters: { type: 'object', properties: { table: { type: 'string', description: '要查詢的表名' }, search_value: { type: 'string', description: '要搜尋的值（可選）' }, columns: { type: 'string', description: '要查詢的欄位，預設為 *（可選）' } }, required: ['table'] } } },
  { type: 'function', function: { name: 'list_tables', description: '列出資料庫中所有的表', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'translate_text', description: '翻譯文字', parameters: { type: 'object', properties: { text: { type: 'string' }, target_lang: { type: 'string' } }, required: ['text','target_lang'] } } },
  { type: 'function', function: { name: 'write_file', description: '寫入檔案內容', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path','content'] } } },
  { type: 'function', function: { name: 'append_file', description: '追加內容到檔案', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path','content'] } } },
  { type: 'function', function: { name: 'read_file', description: '讀取檔案內容', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }
];

const ACTIVE_TOOL_DEFS = [
  { type: 'function', function: { name: 'get_weather', description: '查詢指定城市的天氣', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } },
  { type: 'function', function: { name: 'get_time', description: '取得目前時間', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'list_files', description: '列出指定目錄中的檔案與資料夾', parameters: { type: 'object', properties: { path: { type: 'string', description: '目錄路徑，例如 . 或 logs' } } } } },
  { type: 'function', function: { name: 'query_database', description: '查詢資料庫內容', parameters: { type: 'object', properties: { table: { type: 'string' }, search_value: { type: 'string' }, columns: { type: 'string' } }, required: ['table', 'search_value'] } } },
  { type: 'function', function: { name: 'list_tables', description: '列出資料庫中的資料表', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'translate_text', description: '翻譯文字', parameters: { type: 'object', properties: { text: { type: 'string' }, target_lang: { type: 'string' } }, required: ['text', 'target_lang'] } } },
  { type: 'function', function: { name: 'create_file', description: '建立新檔案。若 content 省略則建立空白檔案。', parameters: { type: 'object', properties: { path: { type: 'string', description: '檔案路徑，例如 999.txt 或 notes/999.txt' }, content: { type: 'string', description: '可選，檔案內容' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write_file', description: '覆寫檔案內容。path 必須是檔案路徑，不是資料夾。', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'append_file', description: '追加內容到檔案尾端。', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'read_file', description: '讀取檔案內容', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'delete_path', description: '刪除檔案或空資料夾', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'move_path', description: '移動或重新命名檔案或資料夾', parameters: { type: 'object', properties: { source_path: { type: 'string' }, destination_path: { type: 'string' } }, required: ['source_path', 'destination_path'] } } }
];


app.post('/chat', async (req, res) => {
  const { message, context } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const ctx = Array.isArray(context) ? context.slice() : [];

  // If a remote API URL is configured, forward the conversation for verification
  if (REMOTE_API_URL) {
    try {
      // Build messages: use provided context (array of messages) and append the new user message
      const messages = ctx.slice();
      messages.push({ role: 'user', content: message });

      // Optionally record incoming chat requests (whole messages array)
      if (process.env.RECORD_CONTEXT === 'true') {
        appendContextLog({ ts: new Date().toISOString(), event: 'chat_request', remote: !!REMOTE_API_URL, messages });
      }

      // Build system message to guide the model
      const systemMessage = {
        role: 'system',
        content: '你是一個智能助手。當用戶查詢天氣或時間時，請使用對應的工具函數。當工具返回結果後，請用簡潔的中文回覆用戶，直接顯示天氣資訊（溫度、濕度、天氣狀況），不要說 "Fetching" 或 "Waiting" 等無意義內容。'
      };
      
      // Insert system message at the beginning
      const messagesWithSystem = [systemMessage, ...messages];

      // Build payload using INFOR_JSON defaults if available; always include tools definitions
      const payload = {
        model: (INFOR_JSON && INFOR_JSON.model) || 'Qwen2.5-3B-Instruct',
        messages: messagesWithSystem,
        tools: ACTIVE_TOOL_DEFS,
        tool_choice: (INFOR_JSON && INFOR_JSON.tool_choice) || 'auto',
        temperature: (INFOR_JSON && INFOR_JSON.temperature) || 0.2
      };

      const headers = { 'Content-Type': 'application/json' };
      if (process.env.API_KEY) headers['Authorization'] = `Bearer ${process.env.API_KEY}`;

      // 記錄發送給大語言模型的請求
      const requestLog = {
        ts: new Date().toISOString(),
        event: 'llm_request',
        url: REMOTE_API_URL,
        request: payload
      };
      appendContextLog(requestLog);

      console.log('[remote] POST', REMOTE_API_URL);
      console.log('[remote] Full payload:', JSON.stringify(payload, null, 2));
      const fetchResp = await fetch(REMOTE_API_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
      console.log('[remote] Response status:', fetchResp.status);
      const json = await fetchResp.json();
      console.log('[remote] Full response:', JSON.stringify(json, null, 2));

      // 記錄大語言模型的回應
      const responseLog = {
        ts: new Date().toISOString(),
        event: 'llm_response',
        url: REMOTE_API_URL,
        status: fetchResp.status,
        response: json
      };
      appendContextLog(responseLog);

      // Expecting structure similar to OpenAI-like responses: choices[0].message
      const choice = Array.isArray(json.choices) ? json.choices[0] : null;
      const messageOut = choice && choice.message ? choice.message : null;

      // Handle both OpenAI-style tool_calls and function_call formats
      const toolCalls = messageOut && (messageOut.tool_calls || messageOut.function_call);

      // Check if there are actual tool calls to handle (not empty array)
      const hasToolCalls = toolCalls && (Array.isArray(toolCalls) ? toolCalls.length > 0 : true);

      if (messageOut && hasToolCalls) {
        // Remote asked to call a function
        let functionCall;
        if (Array.isArray(toolCalls)) {
          // OpenAI-style tool_calls array
          const tc = toolCalls[0];
          functionCall = {
            name: tc.function && tc.function.name,
            arguments: tc.function && tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
          };
        } else {
          // Direct function_call format
          functionCall = {
            name: toolCalls.name,
            arguments: typeof toolCalls.arguments === 'string' ? JSON.parse(toolCalls.arguments) : toolCalls.arguments
          };
        }

        // Update context with the assistant message
        messages.push({ role: 'assistant', content: messageOut.content || '', tool_calls: toolCalls });
        return res.json({ type: 'function_call', function_call: functionCall, context: messages });
      }

      // Otherwise, return assistant content as reply and updated context
      const assistantContent = messageOut ? (messageOut.content || '') : (json.message && json.message.content) || '';
      messages.push({ role: 'assistant', content: assistantContent });

      if (process.env.RECORD_CONTEXT === 'true') {
        appendContextLog({ ts: new Date().toISOString(), event: 'chat_reply', remote: !!REMOTE_API_URL, reply: assistantContent, context: messages });
      }

      return res.json({ type: 'reply', reply: assistantContent, context: messages });
    } catch (err) {
      console.error('Remote API error:', err);
      // Fall back to local AI module
    }
  }

  // Fallback local AI module
  const result = ai.handleMessage(message, ctx);
  if (result.function_call) {
    return res.json({ type: 'function_call', function_call: result.function_call, context: result.context });
  }
  return res.json({ type: 'reply', reply: result.reply, context: result.context });
});

// Client asks server to actually run the function (this simulates function-calling execution)
app.post('/call_function', async (req, res) => {
  const { function_call, context } = req.body || {};
  if (!function_call || !function_call.name) return res.status(400).json({ error: 'function_call required' });

  // Simulated available functions
  const name = function_call.name;
  const args = function_call.arguments || {};

  // Initialize context array
  const ctx = Array.isArray(context) ? context.slice() : [];

  let functionResult = null;
  // helper to safely resolve paths (allow project dir and system temp dir)
  function safeResolve(p) {
    if (!p) return null;
    // if p is absolute or contains .., normalize relative to project dir
    const candidate = path.isAbsolute(p) ? path.resolve(p) : path.resolve(__dirname, p);
    const tmpdir = path.resolve(os.tmpdir());
    const projdir = path.resolve(__dirname);
    if (candidate.startsWith(projdir) || candidate.startsWith(tmpdir)) return candidate;
    // otherwise reject for safety
    return null;
  }

  function looksLikeFileName(value) {
    return typeof value === 'string'
      && value.trim().length > 0
      && !/[\\\/]/.test(value.trim())
      && /\.[A-Za-z0-9]{1,10}$/.test(value.trim());
  }

  function ensureParentDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  try {
    if (name === 'get_time') {
      functionResult = { time: new Date().toString() };

    } else if (name === 'get_weather') {
      // Web-scrape wttr.in for a quick weather summary (no API key required).
      const city = (args.city || args.city_name || 'Taichung').toString();
      try {
        const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
        const r = await axios.get(url, { timeout: 5000 });
        const data = r.data;
        const cc = (data && data.current_condition && data.current_condition[0]) || {};
        const weather = {
          city,
          summary: (cc.weatherDesc && cc.weatherDesc[0] && cc.weatherDesc[0].value) || '',
          temperature_c: cc.temp_C || null,
          feels_like_c: cc.FeelsLikeC || null,
          humidity: cc.humidity || null,
          observed_at: new Date().toISOString(),
          raw: cc
        };
        functionResult = { weather };
      } catch (err) {
        // fallback to simple deterministic fake weather if scraping fails
        const weather = {
          city,
          summary: city.includes('台') || city.includes('台中') ? '晴時多雲' : '多雲',
          temperature_c: 22 + (city.length % 8),
          observed_at: new Date().toISOString(),
          error: err.message
        };
        functionResult = { weather };
      }

    } else if (name === 'list_files') {
      // List files in the specified directory (default to current directory)
      const dirPath = args.path ? path.resolve(args.path) : __dirname;
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const files = entries.filter(e => e.isFile()).map(e => e.name);
        const directories = entries.filter(e => e.isDirectory()).map(e => e.name);
        functionResult = {
          path: dirPath,
          files,
          directories,
          total: files.length + directories.length
        };
      } catch (err) {
        functionResult = { error: `讀取目錄失敗：${err.message}` };
      }

    } else if (name === 'list_tables') {
      // List all tables in the database
      let connection;
      try {
        connection = await mysql.createConnection(DB_CONFIG);
        const [tables] = await connection.query('SHOW TABLES');
        const tableNames = tables.map(row => Object.values(row)[0]);
        functionResult = { 
          database: DB_CONFIG.database,
          tables: tableNames,
          count: tableNames.length
        };
      } catch (err) {
        functionResult = { error: `查詢資料庫表失敗：${err.message}` };
      } finally {
        if (connection) await connection.end();
      }

    } else if (name === 'query_database') {
      // Query data from a specific table
      const { table, search_value, columns = '*' } = args;
      let connection;
      try {
        connection = await mysql.createConnection(DB_CONFIG);

        // Validate table name (prevent SQL injection)
        const [tables] = await connection.query('SHOW TABLES');
        const tableNames = tables.map(row => Object.values(row)[0]);
        
        let targetTable = table;
        
        // 如果指定的表不存在，自動使用 ai_qa 表（主要問答表）
        if (!tableNames.includes(table)) {
          if (tableNames.includes('ai_qa')) {
            targetTable = 'ai_qa';
          } else if (tableNames.length > 0) {
            // 如果沒有 ai_qa，使用第一個表
            targetTable = tableNames[0];
          } else {
            functionResult = { error: `資料庫中沒有表。` };
            return res.json({ type: 'reply', reply: functionResult.error, context: ctx, function_result: functionResult });
          }
        }
        
        // 驗證 columns 參數，如果無效則使用 *
        let validColumns = columns;
        if (columns && columns !== '*') {
          try {
            const [columnsInfo] = await connection.query(`SHOW COLUMNS FROM ${targetTable}`);
            const validColumnNames = columnsInfo.map(col => col.Field);
            // 檢查指定的欄位是否存在
            const requestedColumns = columns.split(',').map(c => c.trim());
            const invalidColumns = requestedColumns.filter(c => !validColumnNames.includes(c));
            if (invalidColumns.length > 0) {
              // 如果有無效欄位，改用 * 查詢所有欄位
              validColumns = '*';
            }
          } catch (e) {
            validColumns = '*';
          }
        } else {
          validColumns = '*';
        }

        // Build query
        let query = `SELECT ${validColumns} FROM ${targetTable} LIMIT 50`;
        let params = [];

        if (search_value) {
          // Search in all text columns
          const [columnsInfo] = await connection.query(`SHOW COLUMNS FROM ${targetTable}`);
          // 找出所有 text 類型的欄位
          const textColumns = columnsInfo.filter(col =>
            col.Type.includes('text') || col.Type.includes('varchar')
          ).map(col => col.Field);

          // 分割關鍵字：支援空格、頓號、逗號，或自動分割長關鍵字（超過 4 個中文字）
          let keywords = search_value.split(/[\s,，、]+/).filter(k => k.length > 0);
          
          // 如果只有一個關鍵字但很長（如「柳工挖土機型號」），嘗試分割成更小的詞
          if (keywords.length === 1 && keywords[0].length > 4) {
            const longKeyword = keywords[0];
            // 嘗試常見的词組分割（例如：柳工 + 挖土機 + 型號）
            const commonTerms = ['柳工', '挖土機', '機型', '型號', '維修', '保養', '液壓', '引擎', '履帶'];
            const foundTerms = commonTerms.filter(term => longKeyword.includes(term));
            if (foundTerms.length > 0) {
              keywords = foundTerms;
            }
          }

          if (keywords.length > 1) {
            // 多個關鍵字：使用 OR 連接，每個關鍵字分別搜尋
            const whereClauses = keywords.map(() =>
              textColumns.map(col => `${col} LIKE ?`).join(' OR ')
            );
            query = `SELECT ${validColumns} FROM ${targetTable} WHERE (${whereClauses.join(' OR ')}) LIMIT 50`;
            params = textColumns.flatMap(() => keywords.map(k => `%${k}%`));
          } else {
            // 單一關鍵字
            const whereClause = textColumns.map(col => `${col} LIKE ?`).join(' OR ');
            query = `SELECT ${validColumns} FROM ${targetTable} WHERE ${whereClause} LIMIT 50`;
            params = textColumns.map(() => `%${search_value}%`);
          }
        }

        const [rows] = await connection.query(query, params);
        functionResult = {
          database: DB_CONFIG.database,
          table: targetTable,
          original_table: table,
          columns,
          search_value,
          rows,
          count: rows.length
        };
      } catch (err) {
        functionResult = { error: `查詢資料庫失敗：${err.message}` };
      } finally {
        if (connection) await connection.end();
      }

    } else if (name === 'translate_text') {
      const text = args.text || '';
      const target = args.target_lang || args.target || 'en';
      // Simple simulated translation (placeholder)
      functionResult = { translated: `[${target}] ${text}` };

    } else if (name === 'create_file') {
      const p = args.path;
      const content = args.content || '';
      const resolved = safeResolve(p);
      if (!resolved) {
        functionResult = { error: `Invalid create path: ${p}` };
      } else {
        ensureParentDir(resolved);
        fs.writeFileSync(resolved, content, 'utf8');
        functionResult = { ok: true, action: 'created', path: resolved, bytes: Buffer.byteLength(content, 'utf8') };
      }

    } else if (name === 'write_file') {
      const p = args.path;
      const content = args.content || '';
      const resolved = safeResolve(p);
      if (!resolved) {
        functionResult = { error: `Invalid write path: ${p}` };
      } else {
        let targetPath = resolved;
        let payload = content;
        let action = 'written';

        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() && looksLikeFileName(content)) {
          targetPath = path.join(resolved, content.trim());
          payload = '';
          action = 'created';
        }

        ensureParentDir(targetPath);
        fs.writeFileSync(targetPath, payload, 'utf8');
        functionResult = { ok: true, action, path: targetPath, bytes: Buffer.byteLength(payload, 'utf8') };
      }

    } else if (name === 'append_file') {
      const p = args.path;
      const content = args.content || '';
      const resolved = safeResolve(p);
      if (!resolved) {
        functionResult = { error: `Invalid append path: ${p}` };
      } else {
        ensureParentDir(resolved);
        fs.appendFileSync(resolved, content, 'utf8');
        functionResult = { ok: true, action: 'appended', path: resolved, bytes: Buffer.byteLength(content, 'utf8') };
      }

    } else if (name === 'read_file') {
      const p = args.path;
      const resolved = safeResolve(p);
      if (!resolved) {
        functionResult = { error: `Invalid read path: ${p}` };
      } else {
        try {
          const data = fs.readFileSync(resolved, 'utf8');
          functionResult = { content: data, path: resolved };
        } catch (err) {
          functionResult = { error: `Read failed: ${err.message}` };
        }
      }

    } else if (name === 'delete_path') {
      const p = args.path;
      const resolved = safeResolve(p);
      if (!resolved) {
        functionResult = { error: `Invalid delete path: ${p}` };
      } else if (!fs.existsSync(resolved)) {
        functionResult = { error: `Path does not exist: ${resolved}` };
      } else {
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          fs.rmdirSync(resolved);
          functionResult = { ok: true, action: 'deleted_directory', path: resolved };
        } else {
          fs.unlinkSync(resolved);
          functionResult = { ok: true, action: 'deleted_file', path: resolved };
        }
      }

    } else if (name === 'move_path') {
      const sourcePath = args.source_path;
      const destinationPath = args.destination_path;
      const sourceResolved = safeResolve(sourcePath);
      const destinationResolved = safeResolve(destinationPath);
      if (!sourceResolved || !destinationResolved) {
        functionResult = { error: `Invalid move paths: ${sourcePath} -> ${destinationPath}` };
      } else if (!fs.existsSync(sourceResolved)) {
        functionResult = { error: `Source path does not exist: ${sourceResolved}` };
      } else {
        ensureParentDir(destinationResolved);
        fs.renameSync(sourceResolved, destinationResolved);
        functionResult = { ok: true, action: 'moved', source_path: sourceResolved, destination_path: destinationResolved };
      }

    } else if (name === 'read_infor') {
      // Preserve previous convenience function: search in infor.txt
      const q = (args.query || '').toLowerCase();
      if (!q) {
        functionResult = { found: inforContent };
      } else {
        const matched = inforContent.split('\n').filter(line => line.toLowerCase().includes(q));
        functionResult = { found: matched.slice(0, 20) };
      }

    }   else {
      functionResult = { error: `Unknown function ${name}` };
    }
  } catch (err) {
    functionResult = { error: err.message };
  }
  // Optionally record function call and result
  try {
    if (process.env.RECORD_CONTEXT === 'true') {
      appendContextLog({ ts: new Date().toISOString(), event: 'function_executed', name, args, functionResult, context: ctx });
    }
  } catch (e) {
    /* ignore logging errors */
  }

  // 如果有遠端 API，請求大語言模型生成格式化回覆
  if (REMOTE_API_URL && functionResult.error === undefined) {
    try {
      // 將 function 結果加入 context
      ctx.push({ role: 'function', name: name, content: JSON.stringify(functionResult) });

      // 格式化原始資料區塊（使用可折疊的 details 標籤）
      let rawDataText = '';
      if (functionResult.rows && functionResult.rows.length > 0) {
        rawDataText = '<details>\n<summary>📄 查看原始資料</summary>\n\n';
        functionResult.rows.forEach((row, i) => {
          rawDataText += `- 第${i + 1}筆：id=${row.id}, 問題：${row.question}, 答案：${row.answer}, 類別：${row.category}\n`;
        });
        rawDataText += '\n</details>';
      }

      // 請求大語言模型生成格式化回覆
      const messages = [
        {
          role: 'system',
          content: '你是一個智能助手。請根據提供的資料庫查詢結果，用清晰、專業的 Markdown 格式回覆用戶。\n\n**回覆規範：**\n1. **必須使用繁體中文**\n2. **必須嚴格根據提供的查詢結果回覆，不能編造資料**\n3. **每個資訊項目必須獨立一行**（使用換行分隔）\n4. 使用 emoji 圖示增強可讀性\n5. 使用分隔線區隔內容區塊\n6. 必須標註資料來源\n7. 在回覆末尾加上可折疊的原始資料區塊（使用 `<details>` 標籤）\n\n**格式範例：**\n```\n📊 **資料庫查詢結果**\n━━━━━━━━━━━━━━━━━━━━━━\n\n❓ **問題：** [從查詢結果中取出 question 欄位]\n\n✅ **答案：** [從查詢結果中取出 answer 欄位]\n\n🏷️ **類別：** [從查詢結果中取出 category 欄位]\n\n📁 **資料來源：** ai_qa 資料表\n\n<details>\n<summary>📄 查看原始資料</summary>\n\n' + rawDataText.replace(/<details>|<\/details>|<summary>.*<\/summary>/g, '') + '\n</details>\n```'
        },
        // 加入明確的資料提示
        {
          role: 'user',
          content: '請根據以下資料庫查詢結果回覆：\n\n查詢結果：' + JSON.stringify(functionResult, null, 2)
        },
        ...ctx.filter(m => m.role === 'user') // 只保留用戶的原始問題
      ];

      const payload = {
        model: (INFOR_JSON && INFOR_JSON.model) || 'Qwen2.5-3B-Instruct',
        messages: messages,
        temperature: (INFOR_JSON && INFOR_JSON.temperature) || 0.2
      };

      const headers = { 'Content-Type': 'application/json' };
      if (process.env.API_KEY) headers['Authorization'] = `Bearer ${process.env.API_KEY}`;

      const fetchResp = await fetch(REMOTE_API_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
      const json = await fetchResp.json();
      const assistantContent = json.choices?.[0]?.message?.content || '';

      ctx.push({ role: 'assistant', content: assistantContent });

      if (process.env.RECORD_CONTEXT === 'true') {
        appendContextLog({ ts: new Date().toISOString(), event: 'function_reply', name, functionResult, reply: assistantContent });
      }

      return res.json({ type: 'reply', reply: assistantContent, context: ctx, function_result: functionResult });
    } catch (err) {
      console.error('Remote API error for function reply:', err);
      // Fall back to local AI module
    }
  }

  // Use local AI module to generate reply based on function result
  const final = ai.resumeWithFunctionResult(ctx, name, functionResult);
  return res.json({ type: 'reply', reply: final.reply, context: final.context, function_result: functionResult });
});

// ==================== Todo List API Endpoints ====================

// Initialize todo table and start scheduler
async function initTodoSystem() {
  await todoService.initTable();
  scheduler.start();

  // Start image processor if enabled
  if (process.env.IMAGE_PROCESSOR_ENABLED === 'true') {
    processor.start();
  }
}

// Get all tasks
app.get('/api/todos', async (req, res) => {
  try {
    const tasks = await todoService.getAllTasks();
    res.json({ success: true, tasks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get pending tasks
app.get('/api/todos/pending', async (req, res) => {
  try {
    const tasks = await todoService.getPendingTasks();
    res.json({ success: true, tasks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create a new task
app.post('/api/todos', async (req, res) => {
  const { title, description, priority } = req.body || {};
  if (!title) {
    return res.status(400).json({ success: false, error: 'title is required' });
  }
  try {
    const task = await todoService.createTask(title, description, priority || 'medium');
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get task by ID
app.get('/api/todos/:id', async (req, res) => {
  try {
    const task = await todoService.getTaskById(parseInt(req.params.id));
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update task status
app.patch('/api/todos/:id/status', async (req, res) => {
  const { status, ai_analysis, verification_result, error_message } = req.body || {};
  if (!status) {
    return res.status(400).json({ success: false, error: 'status is required' });
  }
  try {
    await todoService.updateTaskStatus(
      parseInt(req.params.id),
      status,
      ai_analysis ? JSON.stringify(ai_analysis) : null,
      verification_result ? JSON.stringify(verification_result) : null,
      error_message
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete task
app.delete('/api/todos/:id', async (req, res) => {
  try {
    await todoService.deleteTask(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get scheduler status
app.get('/api/todos/scheduler/status', (req, res) => {
  res.json({ success: true, status: scheduler.getStatus() });
});

// Start scheduler manually
app.post('/api/todos/scheduler/start', (req, res) => {
  scheduler.start();
  res.json({ success: true, status: scheduler.getStatus() });
});

// Stop scheduler manually
app.post('/api/todos/scheduler/stop', (req, res) => {
  scheduler.stop();
  res.json({ success: true, status: scheduler.getStatus() });
});

// ==================== Image Processor API Endpoints ====================

// Get image processor status
app.get('/api/image-processor/status', (req, res) => {
  res.json({ success: true, status: processor.getStatus() });
});

// Start image processor manually
app.post('/api/image-processor/start', (req, res) => {
  processor.start();
  res.json({ success: true, status: processor.getStatus() });
});

// Stop image processor manually
app.post('/api/image-processor/stop', (req, res) => {
  processor.stop();
  res.json({ success: true, status: processor.getStatus() });
});

// ==================== Server Startup ====================

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Initialize todo system
  await initTodoSystem();
  console.log('[Todo] Scheduler started, checking tasks every 1 minutes');
});
