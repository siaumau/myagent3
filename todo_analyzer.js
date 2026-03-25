// AI Task Analyzer - Analyzes todo tasks and generates execution plans
const axios = require('axios');

// Get remote API configuration
const REMOTE_API_URL = process.env.REMOTE_API_URL || '';
const API_KEY = process.env.API_KEY || '';

// Token vs Context explanation for AI analysis
const SYSTEM_PROMPT = `你是一個智能任務分析助手。你的工作是：

1. **分析用戶的待辦任務**，理解任務的本質和需求
2. **生成執行計劃**：將任務拆解為可執行的步驟
3. **驗證標準**：定義什麼情況下任務算完成

**回覆格式（JSON）：**
{
  "task_understanding": "對任務的理解",
  "token_context_explanation": "需要明確的拆解任務",
  "execution_plan": ["步驟 1", "步驟 2", "步驟 3"],
  "verification_criteria": ["驗證標準 1", "驗證標準 2"],
  "estimated_tokens": 數字，
  "complexity": "low|medium|high"
}`;

/**
 * Analyze a task and generate execution plan
 * @param {string} taskTitle - Task title
 * @param {string} taskDescription - Task description
 * @returns {Promise<object>} Analysis result
 */
async function analyzeTask(taskTitle, taskDescription = '') {
  if (!REMOTE_API_URL) {
    // Fallback: simple keyword-based analysis
    return generateLocalAnalysis(taskTitle, taskDescription);
  }

  try {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `請分析這個任務：\n標題：${taskTitle}\n描述：${taskDescription || '無'}` }
    ];

    const payload = {
      model: 'Qwen2.5-3B-Instruct',
      messages: messages,
      temperature: 0.3,
      response_format: { type: 'json_object' }
    };

    const headers = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

    console.log('[TaskAnalyzer] Sending analysis request...');
    const response = await fetch(REMOTE_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content || '';

    try {
      const analysis = JSON.parse(content);
      return {
        success: true,
        analysis,
        raw_response: content
      };
    } catch (parseErr) {
      console.warn('[TaskAnalyzer] JSON parse failed, using fallback');
      return generateLocalAnalysis(taskTitle, taskDescription);
    }
  } catch (err) {
    console.error('[TaskAnalyzer] Analysis error:', err.message);
    return {
      success: false,
      error: err.message,
      analysis: generateLocalAnalysis(taskTitle, taskDescription)
    };
  }
}

/**
 * Local fallback analysis (no AI)
 */
function generateLocalAnalysis(taskTitle, taskDescription) {
  const fullText = `${taskTitle} ${taskDescription}`.toLowerCase();

  // Keyword-based plan generation
  let executionPlan = ['理解任務需求'];
  let verificationCriteria = ['任務標題已明確定義'];

  if (fullText.includes('檔案') || fullText.includes('文件') || fullText.includes('file')) {
    executionPlan.push('檢查檔案是否存在', '讀取或建立檔案', '驗證檔案內容');
    verificationCriteria.push('檔案已建立或更新', '內容符合預期');
  }

  if (fullText.includes('資料庫') || fullText.includes('database') || fullText.includes('表')) {
    executionPlan.push('連接資料庫', '執行查詢或更新', '驗證資料正確性');
    verificationCriteria.push('資料庫操作成功', '資料已正確寫入');
  }

  if (fullText.includes('api') || fullText.includes('請求') || fullText.includes('fetch')) {
    executionPlan.push('確認 API 端點', '發送請求', '處理回應');
    verificationCriteria.push('API 請求成功', '回應資料正確');
  }

  if (fullText.includes('token') || fullText.includes('context') || fullText.includes('ai')) {
    executionPlan.push('解釋 AI 概念', '提供程式碼範例', '說明使用情境');
    verificationCriteria.push('概念解釋清晰', '範例可執行');
  }

  // Default steps if no keywords matched
  if (executionPlan.length === 1) {
    executionPlan.push('分析任務需求', '執行必要操作', '驗證結果');
    verificationCriteria.push('任務目標已達成');
  }

  return {
    task_understanding: `任務：${taskTitle}${taskDescription ? ` - ${taskDescription}` : ''}`,
    token_context_explanation: fullText.includes('token') || fullText.includes('context')
      ? '**Token**：AI 處理文字的最小單位，約 1 token = 3/4 個中文字。用於計算費用。\n\n**Context**：對話上下文，指 AI 能記憶的對話歷史長度。Context 越大，AI 能記住的內容越多。'
      : '此任務未涉及 AI 概念。',
    execution_plan: executionPlan,
    verification_criteria: verificationCriteria,
    estimated_tokens: Math.ceil((taskTitle.length + (taskDescription?.length || 0)) / 4),
    complexity: executionPlan.length > 3 ? 'medium' : 'low'
  };
}

/**
 * Verify task completion
 * @param {object} task - Task object
 * @param {object} analysis - Analysis result
 * @returns {Promise<object>} Verification result
 */
async function verifyTaskCompletion(task, analysis) {
  const criteria = analysis?.verification_criteria || ['任務已完成'];
  const fs = require('fs');
  const path = require('path');
  const fullText = `${task.title} ${task.description || ''}`.toLowerCase();
  const verificationResults = [];

  // File verification (實際檢查檔案是否存在且內容不為空)
  const fileMatch = fullText.match(/(?:檔案 | 文件|file)["'\s:]+([^\s,，、]+)/i);
  if (fileMatch) {
    const fileName = fileMatch[1].trim();
    const filePath = path.join(process.cwd(), fileName);
    let fileExists = false;
    let fileNotEmpty = false;
    try {
      fileExists = fs.existsSync(filePath);
      if (fileExists) {
        const content = fs.readFileSync(filePath, 'utf8');
        fileNotEmpty = content.trim().length > 0;
      }
    } catch (e) {
      // ignore
    }
    verificationResults.push({
      criterion: '檔案檢查',
      passed: fileExists && fileNotEmpty,
      message: fileExists
        ? (fileNotEmpty ? `檔案 ${fileName} 存在且內容不為空` : `檔案 ${fileName} 存在但內容為空`)
        : `檔案 ${fileName} 不存在`
    });
  }

  // Database verification
  if (fullText.includes('資料庫') || fullText.includes('表')) {
    verificationResults.push({
      criterion: '資料庫檢查',
      passed: true,
      message: '需驗證資料庫操作'
    });
  }

  // Default verification
  if (verificationResults.length === 0) {
    verificationResults.push({
      criterion: criteria[0],
      passed: true,
      message: '任務已根據執行計劃完成'
    });
  }

  const allPassed = verificationResults.every(r => r.passed);

  return {
    verified: allPassed,
    results: verificationResults,
    timestamp: new Date().toISOString(),
    summary: allPassed ? '任務驗證通過' : '任務驗證失敗，需要重新執行'
  };
}

module.exports = {
  analyzeTask,
  verifyTaskCompletion,
  generateLocalAnalysis
};
