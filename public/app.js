const input = document.getElementById('input');
const messages = document.getElementById('messages');
const sendBtn = document.getElementById('send');
const contextJson = document.getElementById('contextJson');
const openContextBtn = document.getElementById('open-context');
const closeContextBtn = document.getElementById('close-context');
const contextModal = document.getElementById('context-modal');

let context = [];

function timeNow() {
  return new Date().toLocaleTimeString();
}

function renderMessage(msg) {
  const wrapper = document.createElement('div');
  const bubble = document.createElement('div');
  bubble.className = 'bubble ' + (msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : '');
  
  // 使用 marked.js 渲染 Markdown（如果是 assistant 訊息）
  if (msg.role === 'assistant' && msg.content) {
    bubble.innerHTML = marked.parse(msg.content);
  } else {
    bubble.textContent = msg.content || (msg.name ? `[function ${msg.name}] ${JSON.stringify(msg)}` : JSON.stringify(msg));
  }
  
  wrapper.appendChild(bubble);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${msg.role}${msg.name ? ' • ' + msg.name : ''} • ${msg.ts || timeNow()}`;
  wrapper.appendChild(meta);

  messages.appendChild(wrapper);
  messages.scrollTop = messages.scrollHeight;
}

function renderSystem(note) {
  const el = document.createElement('div');
  el.className = 'system-note';
  el.textContent = note;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

function updateContextView() {
  // 只在 modal 開啟時更新內容
  if (contextModal.classList.contains('show')) {
    contextJson.textContent = JSON.stringify(context, null, 2);
  }
}

// Modal 控制
function openContextModal() {
  contextJson.textContent = JSON.stringify(context, null, 2);
  contextModal.classList.add('show');
}

function closeContextModal() {
  contextModal.classList.remove('show');
}

openContextBtn.addEventListener('click', openContextModal);
closeContextBtn.addEventListener('click', closeContextModal);

// 點擊 modal 外部關閉
contextModal.addEventListener('click', (e) => {
  if (e.target === contextModal) {
    closeContextModal();
  }
});

// ESC 關閉
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && contextModal.classList.contains('show')) {
    closeContextModal();
  }
});

async function sendMessage(text) {
  renderMessage({ role: 'user', content: text, ts: timeNow() });

  // 顯示「系統思考中」訊息
  const thinkingEl = document.createElement('div');
  thinkingEl.className = 'system-note thinking';
  thinkingEl.textContent = '系統思考中...';
  thinkingEl.id = 'thinking-indicator';
  messages.appendChild(thinkingEl);
  messages.scrollTop = messages.scrollHeight;

  let resp;
  try {
    resp = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, context })
    }).then(r => r.json());
  } catch (err) {
    // 移除思考中訊息
    const thinkingIndicator = document.getElementById('thinking-indicator');
    if (thinkingIndicator) thinkingIndicator.remove();
    renderSystem(`請求錯誤：${err.message}`);
    return;
  }

  // 移除思考中訊息
  const thinkingIndicator = document.getElementById('thinking-indicator');
  if (thinkingIndicator) thinkingIndicator.remove();

  console.log('/chat response:', resp);

  if (resp.type === 'function_call') {
    renderSystem(`AI 請求調用函數：${resp.function_call.name}`);
    context = resp.context || context;
    updateContextView();

    let callResp;
    try {
      callResp = await fetch('/call_function', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ function_call: resp.function_call, context })
      }).then(r => r.json());
    } catch (err) {
      renderSystem(`函數調用錯誤：${err.message}`);
      return;
    }

    console.log('/call_function response:', callResp);
    
    if (callResp.type === 'reply') {
      renderMessage({ role: 'assistant', content: callResp.reply || '(無內容1)', ts: timeNow() });
      context = callResp.context || context;
    } else {
      renderMessage({ role: 'assistant', content: JSON.stringify(callResp), ts: timeNow() });
      context = callResp.context || context;
    }
    updateContextView();
    return;
  }

  if (resp.type === 'reply') {
    renderMessage({ role: 'assistant', content: resp.reply || '(無內容2)', ts: timeNow() });
  } else {
    renderMessage({ role: 'assistant', content: JSON.stringify(resp), ts: timeNow() });
  }
  context = resp.context || context;
  updateContextView();
}

sendBtn.addEventListener('click', (e) => {
  e.preventDefault();
  const v = input.value.trim();
  if (!v) return;
  sendMessage(v).catch(err => renderSystem('錯誤：' + err.message));
  input.value = '';
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

// 快速提交按鈕事件
document.querySelectorAll('.quick-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const message = e.target.dataset.message;
    if (message) {
      sendMessage(message).catch(err => renderSystem('錯誤：' + err.message));
    }
  });
});

// initial
renderSystem('歡迎！輸入「現在時間」或「查詢 台中 天氣」來測試 function-calling 與上下文流。');
updateContextView();
