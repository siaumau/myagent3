// Simple AI simulator showing context passing and function-calling decisions

function containsAny(text, words) {
  if (!text) return false;
  const t = text.toLowerCase();
  return words.some(w => t.includes(w));
}

// Handle an incoming user message. Returns either a direct reply or a function_call instruction.
function handleMessage(message, context) {
  context.push({ role: 'user', content: message });

  // Decide whether to call a function based on keywords
  if (containsAny(message, ['時間', 'time'])) {
    // Request the get_time function
    return {
      context,
      function_call: {
        name: 'get_time',
        arguments: {}
      }
    };
  }

  if (containsAny(message, ['資料庫', '數據庫', '表', '查詢表'])) {
    // Database query
    if (containsAny(message, ['有哪些表', '所有表', '列出表', '什麼表'])) {
      return {
        context,
        function_call: {
          name: 'list_tables',
          arguments: {}
        }
      };
    } else {
      // Try to extract table name and search value
      const tableMatch = message.match(/(?:表 | 表名 | 從)\s*["']?(\w+)["']?/i);
      const searchMatch = message.match(/(?:有 | 包含 | 搜尋 | 找)\s*["']?([^"'\u3000-\u303f\u4e00-\u9fff\s]+)["']?/);
      
      // 如果用戶沒有指定表名，但提到資料庫查詢，自動使用 ai_qa 表（主要問答表）
      let tableName = tableMatch ? tableMatch[1] : 'ai_qa';
      
      // 如果表名是無效的（如 "資料庫"、"數據庫" 等），使用預設表
      if (['資料庫', '數據庫', '庫', 'test', 'users'].includes(tableName)) {
        tableName = 'ai_qa';
      }
      
      return {
        context,
        function_call: {
          name: 'query_database',
          arguments: {
            table: tableName,
            search_value: searchMatch ? searchMatch[1] : null
          }
        }
      };
    }
  }

  if (containsAny(message, ['infor', '資訊', '資料', '查詢', '天氣'])) {
    // Ask to read the infor file or search it
    return {
      context,
      function_call: {
        name: 'read_infor',
        arguments: { query: message }
      }
    };
  }

  // Default: simple echo reply that demonstrates context is kept
  const reply = `AI 回覆（簡單示範）：我看到你說「${message}」。上下文長度：${context.length}`;
  context.push({ role: 'assistant', content: reply });
  return { context, reply };
}

// Resume after a function result was executed. The function result is included in context
function resumeWithFunctionResult(context, functionName, functionResult) {
  context.push({ role: 'function', name: functionName, content: JSON.stringify(functionResult) });

  // Build a human-friendly reply based on the function result
  let reply = '';
  if (functionName === 'get_time') {
    reply = `現在時間是：${functionResult.time}`;
  } else if (functionName === 'get_weather') {
    if (functionResult.error) {
      reply = `查詢天氣失敗：${functionResult.error}`;
    } else if (functionResult.weather) {
      const w = functionResult.weather;
      reply = `${w.city || '當地'}天氣：${w.summary || '多雲'}，氣溫 ${w.temperature_c || '?'}°C（體感 ${w.feels_like_c || '?'}°C），濕度 ${w.humidity || '?'}%`;
    } else {
      reply = `函式 ${functionName} 執行完成，回傳：${JSON.stringify(functionResult)}`;
    }
  } else if (functionName === 'list_files') {
    if (functionResult.error) {
      reply = `讀取目錄失敗：${functionResult.error}`;
    } else {
      const { path, files, directories, total } = functionResult;
      reply = `目錄：${path}\n`;
      reply += `共 ${total} 個項目（${directories.length} 個資料夾，${files.length} 個檔案）\n`;
      if (directories.length > 0) {
        reply += `資料夾：${directories.slice(0, 20).join(', ')}\n`;
      }
      if (files.length > 0) {
        reply += `檔案：${files.slice(0, 20).join(', ')}`;
      }
    }
  } else if (functionName === 'list_tables') {
    if (functionResult.error) {
      reply = `查詢資料庫失敗：${functionResult.error}`;
    } else {
      const { database, tables, count } = functionResult;
      reply = `資料庫 "${database}" 共有 ${count} 個表：\n${tables.join(', ') || '無表'}`;
    }
  } else if (functionName === 'query_database') {
    if (functionResult.error) {
      reply = `查詢失敗：${functionResult.error}`;
    } else {
      const { table, search_value, rows, count } = functionResult;
      if (rows && rows.length > 0) {
        reply = `查詢完成，找到 ${count} 筆資料。`;
      } else {
        reply = `在 ${table} 表中找不到與 "${search_value}" 相關的資料。`;
      }
    }
  } else if (functionName === 'read_infor') {
    if (functionResult.error) {
      reply = `讀取失敗：${functionResult.error}`;
    } else if (Array.isArray(functionResult.found)) {
      reply = `找到 ${functionResult.found.length} 行相關內容，示例：\n` + functionResult.found.slice(0,5).join('\n');
    } else {
      reply = `檔案內容：\n${functionResult.found}`;
    }
  }  else {
    reply = `函式 ${functionName} 執行完成，回傳：${JSON.stringify(functionResult)}`;
  }

  context.push({ role: 'assistant', content: reply });
  return { context, reply };
}

module.exports = { handleMessage, resumeWithFunctionResult };
