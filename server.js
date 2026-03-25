const express = require('express');
const path = require('path');
const fs = require('fs');
const ai = require('./ai');
const axios = require('axios');
const os = require('os');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// logs directory for optional context persistence
const LOGS_DIR = path.join(__dirname, 'logs');
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
const INFOR_PATH = path.join(__dirname, 'infor.txt');
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

      // Build payload using INFOR_JSON defaults if available
      const payload = {
        model: (INFOR_JSON && INFOR_JSON.model) || 'Qwen2.5-3B-Instruct',
        messages,
        tool_choice: (INFOR_JSON && INFOR_JSON.tool_choice) || 'auto',
        temperature: (INFOR_JSON && INFOR_JSON.temperature) || 0.2
      };
      if (INFOR_JSON && INFOR_JSON.tools) payload.tools = INFOR_JSON.tools;

      const headers = { 'Content-Type': 'application/json' };
      if (process.env.API_KEY) headers['Authorization'] = `Bearer ${process.env.API_KEY}`;

      const fetchResp = await fetch(REMOTE_API_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
      const json = await fetchResp.json();

      // Expecting structure similar to OpenAI-like responses: choices[0].message
      const choice = Array.isArray(json.choices) ? json.choices[0] : null;
      const messageOut = choice && choice.message ? choice.message : null;

      if (messageOut && messageOut.function_call) {
        // Remote asked to call a function
        // Update context with the assistant message (without content but with function_call) if present
        messages.push({ role: 'assistant', content: messageOut.content || '', function_call: messageOut.function_call });
        return res.json({ type: 'function_call', function_call: messageOut.function_call, context: messages });
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

    } else if (name === 'translate_text') {
      const text = args.text || '';
      const target = args.target_lang || args.target || 'en';
      // Simple simulated translation (placeholder)
      functionResult = { translated: `[${target}] ${text}` };

    } else if (name === 'write_file') {
      const p = args.path;
      const content = args.content || '';
      const resolved = safeResolve(p);
      if (!resolved) {
        functionResult = { error: `Invalid write path: ${p}` };
      } else {
        fs.writeFileSync(resolved, content, 'utf8');
        functionResult = { ok: true, path: resolved };
      }

    } else if (name === 'append_file') {
      const p = args.path;
      const content = args.content || '';
      const resolved = safeResolve(p);
      if (!resolved) {
        functionResult = { error: `Invalid append path: ${p}` };
      } else {
        fs.appendFileSync(resolved, content, 'utf8');
        functionResult = { ok: true, path: resolved };
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

    } else if (name === 'read_infor') {
      // Preserve previous convenience function: search in infor.txt
      const q = (args.query || '').toLowerCase();
      if (!q) {
        functionResult = { found: inforContent };
      } else {
        const matched = inforContent.split('\n').filter(line => line.toLowerCase().includes(q));
        functionResult = { found: matched.slice(0, 20) };
      }

    } else {
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
  // If REMOTE_API_URL is set, send the function result back to remote API to continue the conversation
  const ctx = Array.isArray(context) ? context.slice() : [];
  if (REMOTE_API_URL) {
    try {
      // Append the function message to context
      const messages = ctx.slice();
      messages.push({ role: 'function', name, content: JSON.stringify(functionResult) });

      const payload = {
        model: (INFOR_JSON && INFOR_JSON.model) || 'Qwen2.5-3B-Instruct',
        messages,
        tool_choice: (INFOR_JSON && INFOR_JSON.tool_choice) || 'auto',
        temperature: (INFOR_JSON && INFOR_JSON.temperature) || 0.2
      };
      if (INFOR_JSON && INFOR_JSON.tools) payload.tools = INFOR_JSON.tools;

      const headers = { 'Content-Type': 'application/json' };
      if (process.env.API_KEY) headers['Authorization'] = `Bearer ${process.env.API_KEY}`;

      const fetchResp = await fetch(REMOTE_API_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
      const json = await fetchResp.json();

      const choice = Array.isArray(json.choices) ? json.choices[0] : null;
      const messageOut = choice && choice.message ? choice.message : null;
      const assistantContent = messageOut ? (messageOut.content || '') : (json.message && json.message.content) || '';
      messages.push({ role: 'assistant', content: assistantContent });

      return res.json({ type: 'reply', reply: assistantContent, context: messages, function_result: functionResult });
    } catch (err) {
      console.error('Remote resume error:', err);
      // fallback to local resume
      const final = ai.resumeWithFunctionResult(ctx, name, functionResult);
      return res.json({ type: 'reply', reply: final.reply, context: final.context, function_result: functionResult });
    }
  }

  // Let the local AI module resume the conversation with function result
  const final = ai.resumeWithFunctionResult(ctx, name, functionResult);
  return res.json({ type: 'reply', reply: final.reply, context: final.context, function_result: functionResult });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
