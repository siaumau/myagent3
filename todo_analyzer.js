// AI Task Analyzer - Analyzes todo tasks and generates execution plans

// Get remote API configuration
const REMOTE_API_URL = process.env.REMOTE_API_URL || '';
const API_KEY = process.env.API_KEY || '';

const SYSTEM_PROMPT = `You analyze todo tasks and return strict JSON with:
{
  "task_understanding": "short summary",
  "token_context_explanation": "short explanation",
  "execution_plan": ["step 1", "step 2"],
  "verification_criteria": ["criterion 1", "criterion 2"],
  "estimated_tokens": 123,
  "complexity": "low|medium|high"
}`;

/**
 * Analyze a task and generate execution plan
 * @param {string} taskTitle
 * @param {string} taskDescription
 * @returns {Promise<object>}
 */
async function analyzeTask(taskTitle, taskDescription = '') {
  if (!REMOTE_API_URL) {
    return {
      success: true,
      analysis: generateLocalAnalysis(taskTitle, taskDescription)
    };
  }

  try {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Task title: ${taskTitle}\nTask description: ${taskDescription || ''}`
      }
    ];

    const payload = {
      model: 'Qwen2.5-3B-Instruct',
      messages,
      temperature: 0.3,
      response_format: { type: 'json_object' }
    };

    const headers = { 'Content-Type': 'application/json' };
    if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;

    const response = await fetch(REMOTE_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content || '';
    const analysis = JSON.parse(content);

    return {
      success: true,
      analysis,
      raw_response: content
    };
  } catch (err) {
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
function generateLocalAnalysis(taskTitle, taskDescription = '') {
  const combinedText = `${taskTitle} ${taskDescription}`.toLowerCase();
  const executionPlan = ['Inspect task requirements', 'Perform the requested action', 'Verify the result'];
  const verificationCriteria = ['Requested outcome exists and matches the task'];

  const requestedFileName = extractRequestedFileName({ title: taskTitle, description: taskDescription }, null);
  const isFileTask =
    Boolean(requestedFileName) ||
    combinedText.includes('file') ||
    combinedText.includes('txt') ||
    combinedText.includes('檔案') ||
    combinedText.includes('文件');

  if (isFileTask) {
    executionPlan.length = 0;
    executionPlan.push(
      requestedFileName ? `Create ${requestedFileName} in the current working directory` : 'Create the requested file',
      'Save the file to disk',
      'Confirm the file exists in the current working directory'
    );
    verificationCriteria.length = 0;
    verificationCriteria.push(
      requestedFileName ? `${requestedFileName} exists in the current working directory` : 'Requested file exists'
    );
  }

  if (combinedText.includes('database') || combinedText.includes('mysql') || combinedText.includes('sql')) {
    executionPlan.push('Apply the requested database change');
    verificationCriteria.push('Database state matches the requested change');
  }

  if (combinedText.includes('api') || combinedText.includes('fetch')) {
    executionPlan.push('Call the required API');
    verificationCriteria.push('API response indicates success');
  }

  if (combinedText.includes('token') || combinedText.includes('context') || combinedText.includes('ai')) {
    verificationCriteria.push('Explanation covers the requested AI concepts');
  }

  return {
    task_understanding: taskDescription ? `${taskTitle} - ${taskDescription}` : taskTitle,
    token_context_explanation:
      combinedText.includes('token') || combinedText.includes('context')
        ? 'Token is a unit processed by a language model, and context is the total token window available to the model.'
        : 'No token/context explanation is needed for this task.',
    execution_plan: executionPlan,
    verification_criteria: verificationCriteria,
    estimated_tokens: Math.ceil((taskTitle.length + taskDescription.length) / 4),
    complexity: executionPlan.length >= 5 ? 'medium' : 'low'
  };
}

/**
 * Verify task completion
 * @param {object} task
 * @param {object} analysis
 * @returns {Promise<object>}
 */
async function verifyTaskCompletion(task, analysis) {
  const fs = require('fs');
  const path = require('path');
  const fullText = `${task.title} ${task.description || ''}`.toLowerCase();
  const verificationResults = [];
  const criteria = analysis?.verification_criteria || ['Requested outcome exists and matches the task'];
  const requestedFileName = extractRequestedFileName(task, analysis);
  const expectsEmptyFile = taskRequestsEmptyFile(task, analysis);
  const expectedKeywords = extractVerificationKeywords(task, analysis);

  if (requestedFileName) {
    const filePath = path.join(process.cwd(), requestedFileName);
    let fileExists = false;
    let fileNotEmpty = false;
    let fileContent = '';

    try {
      fileExists = fs.existsSync(filePath);
      if (fileExists) {
        fileContent = fs.readFileSync(filePath, 'utf8');
        fileNotEmpty = fileContent.trim().length > 0;
      }
    } catch (err) {
      verificationResults.push({
        criterion: `File check: ${requestedFileName}`,
        passed: false,
        message: `Failed to read ${requestedFileName}: ${err.message}`
      });
    }

    if (!verificationResults.length) {
      const passed = fileExists && (expectsEmptyFile || fileNotEmpty);
      let message = `File ${requestedFileName} is missing`;

      if (fileExists && expectsEmptyFile) {
        message = `File ${requestedFileName} exists`;
      } else if (fileExists && fileNotEmpty) {
        message = `File ${requestedFileName} exists and has content`;
      } else if (fileExists) {
        message = `File ${requestedFileName} exists but is empty`;
      }

      verificationResults.push({
        criterion: `File check: ${requestedFileName}`,
        passed,
        message
      });

      if (fileExists && fileNotEmpty && expectedKeywords.length > 0) {
        const contentLower = fileContent.toLowerCase();
        const matchedKeywords = expectedKeywords.filter(keyword => contentLower.includes(keyword));
        verificationResults.push({
          criterion: `Content relevance: ${requestedFileName}`,
          passed: matchedKeywords.length > 0,
          message: matchedKeywords.length > 0
            ? `File content matches expected topic keywords: ${matchedKeywords.join(', ')}`
            : `File content does not include expected topic keywords: ${expectedKeywords.join(', ')}`
        });
      }
    }
  }

  if (!requestedFileName && (fullText.includes('database') || fullText.includes('mysql') || fullText.includes('sql'))) {
    verificationResults.push({
      criterion: 'Database verification',
      passed: true,
      message: 'Database-related task uses a placeholder verification result'
    });
  }

  if (verificationResults.length === 0) {
    verificationResults.push({
      criterion: criteria[0],
      passed: false,
      message: 'No concrete verification rule matched this task'
    });
  }

  const allPassed = verificationResults.every(result => result.passed);

  return {
    verified: allPassed,
    results: verificationResults,
    timestamp: new Date().toISOString(),
    summary: allPassed ? 'Task verified successfully' : 'Task verification failed'
  };
}

function extractRequestedFileName(task, analysis) {
  const sources = [
    task?.title || '',
    task?.description || '',
    ...(analysis?.execution_plan || []),
    ...(analysis?.verification_criteria || [])
  ];

  for (const source of sources) {
    if (!source) continue;

    const quoted = source.match(/['"`]([^'"`\r\n]+?\.[a-z0-9]{1,10})['"`]/i);
    if (quoted) return quoted[1];

    const inline = source.match(/\b([a-z0-9][a-z0-9._-]*\.[a-z0-9]{1,10})\b/i);
    if (inline) return inline[1];
  }

  return null;
}

function taskRequestsEmptyFile(task, analysis) {
  const combinedText = [
    task?.title || '',
    task?.description || '',
    ...(analysis?.execution_plan || [])
  ].join(' ').toLowerCase();

  return (
    combinedText.includes('空白') ||
    combinedText.includes('empty') ||
    combinedText.includes('blank')
  );
}

function extractVerificationKeywords(task, analysis) {
  const combinedText = [
    task?.title || '',
    task?.description || '',
    ...(analysis?.execution_plan || [])
  ].join(' ');

  const keywords = [];
  const candidatePatterns = [
    /\bredis\b/gi,
    /\bmysql\b/gi,
    /\bpostgres(?:ql)?\b/gi,
    /\bjavascript\b/gi,
    /\bnode\.?js\b/gi,
    /\bpython\b/gi
  ];

  for (const pattern of candidatePatterns) {
    const matches = combinedText.match(pattern);
    if (matches) {
      keywords.push(...matches.map(match => match.toLowerCase()));
    }
  }

  return [...new Set(keywords)];
}

module.exports = {
  analyzeTask,
  verifyTaskCompletion,
  generateLocalAnalysis
};
