const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');

let context = [];

function addMessage(role, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + (role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system');
  d.textContent = `${role}: ${text}`;
  messages.appendChild(d);
  messages.scrollTop = messages.scrollHeight;
}

async function sendMessage(text) {
  addMessage('user', text);
  const resp = await fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text, context })
  }).then(r => r.json());

  if (resp.type === 'function_call') {
    addMessage('system', `AI 請求執行函式：${resp.function_call.name}，會自動執行`);
    // Update context from server
    context = resp.context || context;

    // Auto-call the function on the server-side
    const callResp = await fetch('/call_function', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ function_call: resp.function_call, context })
    }).then(r => r.json());

    addMessage('assistant', callResp.reply);
    context = callResp.context || context;
    return;
  }

  // Normal reply
  addMessage('assistant', resp.reply || JSON.stringify(resp));
  context = resp.context || context;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = input.value.trim();
  if (!v) return;
  sendMessage(v).catch(err => addMessage('system', '錯誤：' + err.message));
  input.value = '';
});

// Initial system message showing how to try
addMessage('system', '範例：輸入「現在時間」或「查詢 infor.txt」來觸發 function-calling。');
