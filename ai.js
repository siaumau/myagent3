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
  } else if (functionName === 'read_infor') {
    if (functionResult.error) {
      reply = `讀取失敗：${functionResult.error}`;
    } else if (Array.isArray(functionResult.found)) {
      reply = `找到 ${functionResult.found.length} 行相關內容，示例：\n` + functionResult.found.slice(0,5).join('\n');
    } else {
      reply = `檔案內容：\n${functionResult.found}`;
    }
  } else {
    reply = `函式 ${functionName} 執行完成，回傳：${JSON.stringify(functionResult)}`;
  }

  context.push({ role: 'assistant', content: reply });
  return { context, reply };
}

module.exports = { handleMessage, resumeWithFunctionResult };
