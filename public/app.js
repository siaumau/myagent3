const input = document.getElementById('input');
const messages = document.getElementById('messages');
const sendBtn = document.getElementById('send');
const contextJson = document.getElementById('contextJson');
const openContextBtn = document.getElementById('open-context');
const closeContextBtn = document.getElementById('close-context');
const contextModal = document.getElementById('context-modal');

// Todo elements
const todoTitleInput = document.getElementById('todo-title');
const todoAddBtn = document.getElementById('todo-add');
const todoListEl = document.getElementById('todo-list');
const todoCountEl = document.getElementById('todo-count');
const todoRefreshBtn = document.getElementById('todo-refresh');
const todoHistoryToggleBtn = document.getElementById('todo-history-toggle');
const todoSchedulerBtn = document.getElementById('todo-scheduler-status');
const todoModal = document.getElementById('todo-modal');
const todoDetailEl = document.getElementById('todoDetail');
const closeTodoModalBtn = document.getElementById('close-todo-modal');
const schedulerModal = document.getElementById('scheduler-modal');
const schedulerStatusEl = document.getElementById('schedulerStatus');
const closeSchedulerModalBtn = document.getElementById('close-scheduler-modal');
const schedulerStartBtn = document.getElementById('scheduler-start');
const schedulerStopBtn = document.getElementById('scheduler-stop');

let context = [];
let todos = [];
let showTodoHistory = false;

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

// ==================== Todo List Functions ====================

async function fetchTodos() {
  try {
    const resp = await fetch('/api/todos');
    const data = await resp.json();
    if (data.success) {
      todos = data.tasks;
      renderTodoList();
    }
  } catch (err) {
    console.error('Failed to fetch todos:', err);
  }
}

function renderTodoList() {
  if (!todoListEl) return;

  const pendingTodos = showTodoHistory
    ? todos.filter(t => t.status === 'completed' || t.status === 'failed')
    : todos.filter(t => t.status !== 'completed' && t.status !== 'failed');
  todoCountEl.textContent = pendingTodos.length;

  if (todoHistoryToggleBtn) {
    todoHistoryToggleBtn.classList.toggle('active', showTodoHistory);
    todoHistoryToggleBtn.textContent = showTodoHistory ? '待辦任務' : '歷史任務';
  }

  if (pendingTodos.length === 0) {
    todoListEl.innerHTML = '<div class="todo-empty">暫無待辦事項</div>';
    return;
  }

  todoListEl.innerHTML = pendingTodos.map(todo => `
    <div class="todo-item todo-item-${todo.status}" data-id="${todo.id}">
      <div class="todo-item-header">
        <span class="todo-item-title">${escapeHtml(todo.title)}</span>
        <span class="todo-item-status status-${todo.status}">${getStatusText(todo.status)}</span>
      </div>
      <div class="todo-item-meta">
        <span class="priority-${todo.priority}">🏷️ ${getPriorityText(todo.priority)}</span>
        <span>🕐 ${formatTime(todo.created_at)}</span>
      </div>
      <div class="todo-item-actions">
        <button class="btn-view" data-id="${todo.id}">👁️ 查看</button>
        ${todo.status === 'pending' ? `<button class="btn-delete" data-id="${todo.id}">🗑️ 刪除</button>` : ''}
      </div>
    </div>
  `).join('');

  // Bind events
  todoListEl.querySelectorAll('.btn-view').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt(e.target.dataset.id);
      viewTodoDetail(id);
    });
  });

  todoListEl.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt(e.target.dataset.id);
      deleteTodo(id);
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getStatusText(status) {
  const map = {
    'pending': '⏳ 待處理',
    'in_progress': '🔄 進行中',
    'completed': '✅ 已完成',
    'failed': '❌ 失敗'
  };
  return map[status] || status;
}

function getPriorityText(priority) {
  const map = {
    'low': '低優先級',
    'medium': '中優先級',
    'high': '高優先級'
  };
  return map[priority] || priority;
}

function formatTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function addTodo() {
  const title = todoTitleInput.value.trim();
  if (!title) return;

  try {
    const resp = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description: '由用戶新增的待辦事項' })
    });
    const data = await resp.json();
    if (data.success) {
      todoTitleInput.value = '';
      await fetchTodos();
      renderSystem(`✅ 已新增任務：${title}`);
    } else {
      renderSystem(`❌ 新增失敗：${data.error}`);
    }
  } catch (err) {
    renderSystem(`❌ 錯誤：${err.message}`);
  }
}

async function deleteTodo(id) {
  if (!confirm('確定要刪除此任務嗎？')) return;

  try {
    const resp = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
    const data = await resp.json();
    if (data.success) {
      await fetchTodos();
      renderSystem('✅ 已刪除任務');
    } else {
      renderSystem(`❌ 刪除失敗：${data.error}`);
    }
  } catch (err) {
    renderSystem(`❌ 錯誤：${err.message}`);
  }
}

async function viewTodoDetail(id) {
  const task = todos.find(t => t.id === id);
  if (!task) return;

  let analysisHtml = '';
  if (task.ai_analysis) {
    try {
      const analysis = typeof task.ai_analysis === 'string' ? JSON.parse(task.ai_analysis) : task.ai_analysis;
      analysisHtml = `
        <div class="detail-section">
          <h4>🤖 AI 分析</h4>
          <p><strong>任務理解：</strong>${escapeHtml(analysis.task_understanding || '無')}</p>
          <h5>Token 與 Context 說明：</h5>
          <div class="token-explanation">${marked.parse(analysis.token_context_explanation || '無')}</div>
          <h5>執行計劃：</h5>
          <ul>${(analysis.execution_plan || []).map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ul>
          <h5>驗證標準：</h5>
          <ul>${(analysis.verification_criteria || []).map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ul>
          <p><strong>預估 Token：</strong>${analysis.estimated_tokens || '?'} | <strong>複雜度：</strong>${analysis.complexity || '?'}</p>
        </div>
      `;
    } catch (e) {
      analysisHtml = '<div class="detail-section"><h4>🤖 AI 分析</h4><p>解析失敗</p></div>';
    }
  }

  let verificationHtml = '';
  if (task.verification_result) {
    try {
      const verification = typeof task.verification_result === 'string' ? JSON.parse(task.verification_result) : task.verification_result;
      verificationHtml = `
        <div class="detail-section">
          <h4>✅ 驗證結果</h4>
          <p><strong>狀態：</strong>${verification.verified ? '✅ 通過' : '❌ 失敗'}</p>
          <p><strong>時間：</strong>${formatTime(verification.timestamp)}</p>
          <p><strong>摘要：</strong>${escapeHtml(verification.summary)}</p>
        </div>
      `;
    } catch (e) {
      verificationHtml = '<div class="detail-section"><h4>✅ 驗證結果</h4><p>解析失敗</p></div>';
    }
  }

  todoDetailEl.innerHTML = `
    <div class="detail-section">
      <h4>📝 任務資訊</h4>
      <p><strong>ID：</strong>${task.id}</p>
      <p><strong>標題：</strong>${escapeHtml(task.title)}</p>
      <p><strong>描述：</strong>${escapeHtml(task.description || '無')}</p>
      <p><strong>狀態：</strong>${getStatusText(task.status)}</p>
      <p><strong>優先級：</strong>${getPriorityText(task.priority)}</p>
      <p><strong>建立時間：</strong>${formatTime(task.created_at)}</p>
      <p><strong>更新時間：</strong>${formatTime(task.updated_at)}</p>
      ${task.completed_at ? `<p><strong>完成時間：</strong>${formatTime(task.completed_at)}</p>` : ''}
      ${task.error_message ? `<p class="error-text"><strong>錯誤訊息：</strong>${escapeHtml(task.error_message)}</p>` : ''}
    </div>
    ${analysisHtml}
    ${verificationHtml}
  `;

  todoModal.classList.add('show');
}

async function fetchSchedulerStatus() {
  try {
    const resp = await fetch('/api/todos/scheduler/status');
    const data = await resp.json();
    if (data.success) {
      const status = data.status;
      schedulerStatusEl.innerHTML = `
        <p><strong>運行狀態：</strong>${status.isRunning ? '✅ 運行中' : '⏸️ 已暫停'}</p>
        <p><strong>檢查間隔：</strong>${status.intervalMinutes} 分鐘</p>
        <p><strong>處理中任務：</strong>${status.processedTasksCount}</p>
      `;
    }
  } catch (err) {
    schedulerStatusEl.innerHTML = `<p class="error-text">錯誤：${err.message}</p>`;
  }
}

async function controlScheduler(action) {
  try {
    const resp = await fetch(`/api/todos/scheduler/${action}`, { method: 'POST' });
    const data = await resp.json();
    if (data.success) {
      await fetchSchedulerStatus();
      renderSystem(`✅ 排程器已${action === 'start' ? '啟動' : '暫停'}`);
    } else {
      renderSystem(`❌ 操作失敗：${data.error}`);
    }
  } catch (err) {
    renderSystem(`❌ 錯誤：${err.message}`);
  }
}

// Todo event listeners
if (todoAddBtn) {
  todoAddBtn.addEventListener('click', addTodo);
}

if (todoTitleInput) {
  todoTitleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTodo();
    }
  });
}

if (todoRefreshBtn) {
  todoRefreshBtn.addEventListener('click', fetchTodos);
}

if (todoHistoryToggleBtn) {
  todoHistoryToggleBtn.addEventListener('click', () => {
    showTodoHistory = !showTodoHistory;
    renderTodoList();
  });
}

if (todoSchedulerBtn) {
  todoSchedulerBtn.addEventListener('click', () => {
    fetchSchedulerStatus();
    schedulerModal.classList.add('show');
  });
}

// Modal controls
if (closeTodoModalBtn) {
  closeTodoModalBtn.addEventListener('click', () => {
    todoModal.classList.remove('show');
  });
}

if (closeSchedulerModalBtn) {
  closeSchedulerModalBtn.addEventListener('click', () => {
    schedulerModal.classList.remove('show');
  });
}

if (schedulerStartBtn) {
  schedulerStartBtn.addEventListener('click', () => controlScheduler('start'));
}

if (schedulerStopBtn) {
  schedulerStopBtn.addEventListener('click', () => controlScheduler('stop'));
}

// Close modals on outside click
todoModal.addEventListener('click', (e) => {
  if (e.target === todoModal) {
    todoModal.classList.remove('show');
  }
});

schedulerModal.addEventListener('click', (e) => {
  if (e.target === schedulerModal) {
    schedulerModal.classList.remove('show');
  }
});

function renderTodoList() {
  if (!todoListEl) return;

  const visibleTodos = showTodoHistory
    ? todos.filter(t => t.status === 'completed' || t.status === 'failed')
    : todos.filter(t => t.status !== 'completed' && t.status !== 'failed');

  todoCountEl.textContent = visibleTodos.length;

  if (todoHistoryToggleBtn) {
    todoHistoryToggleBtn.classList.toggle('active', showTodoHistory);
    todoHistoryToggleBtn.textContent = showTodoHistory ? '待辦任務' : '歷史任務';
  }

  if (visibleTodos.length === 0) {
    todoListEl.innerHTML = showTodoHistory
      ? '<div class="todo-empty">暫無歷史任務</div>'
      : '<div class="todo-empty">暫無待辦事項</div>';
    return;
  }

  todoListEl.innerHTML = visibleTodos.map(todo => `
    <div class="todo-item todo-item-${todo.status}" data-id="${todo.id}">
      <div class="todo-item-header">
        <span class="todo-item-title">${escapeHtml(todo.title)}</span>
        <span class="todo-item-status status-${todo.status}">${getStatusText(todo.status)}</span>
      </div>
      <div class="todo-item-meta">
        <span class="priority-${todo.priority}">🏷️ ${getPriorityText(todo.priority)}</span>
        <span>🕐 ${formatTime(todo.created_at)}</span>
      </div>
      <div class="todo-item-actions">
        <button class="btn-view" data-id="${todo.id}">查看</button>
        ${todo.status === 'pending' ? `<button class="btn-delete" data-id="${todo.id}">刪除</button>` : ''}
      </div>
    </div>
  `).join('');

  todoListEl.querySelectorAll('.btn-view').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt(e.target.dataset.id);
      viewTodoDetail(id);
    });
  });

  todoListEl.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt(e.target.dataset.id);
      deleteTodo(id);
    });
  });
}

// Initial load
fetchTodos();

// initial
renderSystem('歡迎！輸入「現在時間」或「查詢 台中 天氣」來測試 function-calling 與上下文流。');
updateContextView();
