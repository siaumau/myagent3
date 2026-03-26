// Todo List Scheduler - Checks pending tasks every 1 minutes
const todoService = require('./todo_service');
const { analyzeTask, verifyTaskCompletion } = require('./todo_analyzer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { PATHS, initializeDirectories } = require('./paths');

const SCHEDULER_LOG = path.join(PATHS.LOGS, 'todo_scheduler.log');

// Ensure logs directory exists
if (!fs.existsSync(PATHS.LOGS)) {
  fs.mkdirSync(PATHS.LOGS, { recursive: true });
}

function log(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  console.log(logLine.replace(/\n$/, ''));
  try {
    fs.appendFileSync(SCHEDULER_LOG, logLine, 'utf8');
  } catch (err) {
    console.warn('Failed to write scheduler log:', err.message);
  }
}

class TodoScheduler {
  constructor() {
    this.intervalMs = 10 * 60 * 100; // 10 minutes
    this.timer = null;
    this.isRunning = false;
    this.processedTasks = new Set();
  }

  /**
   * Start the scheduler
   */
  start() {
    if (this.timer) {
      log('[Scheduler] Already running');
      return;
    }

    // Initialize output directories
    initializeDirectories();

    log('[Scheduler] Starting...');
    this.isRunning = true;

    // Run immediately on start
    this.checkTasks();

    // Then run on interval
    this.timer = setInterval(() => {
      this.checkTasks();
    }, this.intervalMs);
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.isRunning = false;
      log('[Scheduler] Stopped');
    }
  }

  /**
   * Check and process pending tasks
   */
  async checkTasks() {
    if (this.isRunning === false) return;

    log('[Scheduler] Checking pending tasks...');

    try {
      const pendingTasks = await todoService.getPendingTasks();

      if (pendingTasks.length === 0) {
        log('[Scheduler] No pending tasks');
        return;
      }

      log(`[Scheduler] Found ${pendingTasks.length} pending task(s)`);

      for (const task of pendingTasks) {
        // Skip if already being processed
        if (this.processedTasks.has(task.id)) {
          log(`[Scheduler] Task ${task.id} already being processed, skipping`);
          continue;
        }

        this.processedTasks.add(task.id);

        try {
          await this.processTask(task);
        } catch (err) {
          log(`[Scheduler] Error processing task ${task.id}: ${err.message}`);
          await todoService.updateTaskStatus(task.id, 'failed', null, null, err.message);
        } finally {
          this.processedTasks.delete(task.id);
        }
      }
    } catch (err) {
      log(`[Scheduler] Error checking tasks: ${err.message}`);
    }
  }

  /**
   * Process a single task
   */
  async processTask(task) {
    log(`[Scheduler] Processing task ${task.id}: ${task.title}`);

    // Step 1: Update status to in_progress
    await todoService.updateTaskStatus(task.id, 'in_progress');
    log(`[Scheduler] Task ${task.id} status updated to in_progress`);

    // Step 2: Analyze the task
    log(`[Scheduler] Analyzing task ${task.id}...`);
    const analysisResult = await analyzeTask(task.title, task.description);

    if (analysisResult.analysis) {
      await todoService.updateTaskStatus(
        task.id,
        'in_progress',
        JSON.stringify(analysisResult.analysis, null, 2)
      );
      log(`[Scheduler] Task ${task.id} analysis completed`);
    }

    // Step 3: Execute the task (simulate execution based on analysis)
    log(`[Scheduler] Executing task ${task.id}...`);
    const executionResult = await this.executeTask(task, analysisResult.analysis);

      if (executionResult.success) {
        // Step 4: Verify completion
        log(`[Scheduler] Verifying task ${task.id}...`);
        const verification = await verifyTaskCompletion(task, analysisResult.analysis, executionResult);

      if (verification.verified) {
        await todoService.updateTaskStatus(
          task.id,
          'completed',
          JSON.stringify(analysisResult.analysis, null, 2),
          JSON.stringify(verification, null, 2)
        );
        log(`[Scheduler] Task ${task.id} completed and verified!`);
      } else {
        await todoService.updateTaskStatus(
          task.id,
          'failed',
          JSON.stringify(analysisResult.analysis, null, 2),
          JSON.stringify(verification, null, 2),
          'Verification failed'
        );
        log(`[Scheduler] Task ${task.id} verification failed`);
      }
    } else {
      await todoService.updateTaskStatus(
        task.id,
        'failed',
        JSON.stringify(analysisResult.analysis, null, 2),
        null,
        executionResult.error
      );
      log(`[Scheduler] Task ${task.id} execution failed: ${executionResult.error}`);
    }
  }

  /**
   * Execute task based on analysis
   * This is where you'd integrate with actual tools/APIs
   */
  async executeTask(task, analysis) {
    const plan = analysis?.execution_plan || [];

    log(`[Scheduler] Executing plan for task ${task.id}: ${plan.join(' -> ')}`);

    const fileName = extractRequestedFileName(task, analysis);
    const moveTarget = extractMoveDestination(task, analysis);
    const operation = detectFileOperation(task, analysis);
    const researchTask = detectResearchToFileTask(task, analysis);
    const articleSummaryTask = detectArticleSummaryTask(task, analysis);
    const interviewTask = detectInterviewTask(task, analysis);

    try {
      // Prioritize web research if explicitly mentioned
      if (researchTask) {
        return await executeResearchToFileTask(task, analysis, fileName);
      }

      if (articleSummaryTask) {
        return await executeArticleSummaryTask(task, analysis, fileName);
      }

      // Interview task is lower priority - only if no research intent
      if (interviewTask) {
        return executeInterviewTask(task, analysis, fileName);
      }

      if (operation === 'create' && fileName) {
        const filePath = path.join(PATHS.TEXT_OUTPUT, fileName);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '', 'utf8');
        return {
          success: true,
          action: 'created',
          path: filePath,
          steps_completed: plan,
          timestamp: new Date().toISOString()
        };
      }

      if (operation === 'delete' && fileName) {
        const filePath = path.join(process.cwd(), fileName);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: `Path does not exist: ${filePath}`
          };
        }

        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          fs.rmdirSync(filePath);
        } else {
          fs.unlinkSync(filePath);
        }

        return {
          success: true,
          action: 'deleted',
          path: filePath,
          steps_completed: plan,
          timestamp: new Date().toISOString()
        };
      }

      if (operation === 'move' && fileName && moveTarget) {
        const sourcePath = path.join(process.cwd(), fileName);
        const destinationPath = path.join(process.cwd(), moveTarget);

        if (!fs.existsSync(sourcePath)) {
          return {
            success: false,
            error: `Source path does not exist: ${sourcePath}`
          };
        }

        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.renameSync(sourcePath, destinationPath);

        return {
          success: true,
          action: 'moved',
          source_path: sourcePath,
          destination_path: destinationPath,
          steps_completed: plan,
          timestamp: new Date().toISOString()
        };
      }

      return {
        success: false,
        error: 'No executable action matched this task'
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      intervalMs: this.intervalMs,
      intervalMinutes: this.intervalMs / 600000,
      processedTasksCount: this.processedTasks.size
    };
  }
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

function extractMoveDestination(task, analysis) {
  const sources = [
    ...(analysis?.execution_plan || []),
    task?.title || '',
    task?.description || ''
  ];
  const candidates = [];

  for (const source of sources) {
    if (!source) continue;
    const matches = source.match(/[A-Za-z0-9][A-Za-z0-9._/-]*\.[A-Za-z0-9]{1,10}/g);
    if (matches) candidates.push(...matches);
  }

  return candidates.length >= 2 ? candidates[candidates.length - 1] : null;
}

function detectFileOperation(task, analysis) {
  const combinedText = [
    task?.title || '',
    task?.description || '',
    ...(analysis?.execution_plan || [])
  ].join(' ').toLowerCase();

  if (
    combinedText.includes('move') ||
    combinedText.includes('rename') ||
    combinedText.includes('?謢??') ||
    combinedText.includes('??∴?') ||
    combinedText.includes('??謢????')
  ) {
    return 'move';
  }

  if (
    combinedText.includes('delete') ||
    combinedText.includes('remove') ||
    combinedText.includes('????')
  ) {
    return 'delete';
  }

  if (
    combinedText.includes('create') ||
    combinedText.includes('new file') ||
    combinedText.includes('empty file') ||
    combinedText.includes('???') ||
    combinedText.includes('?璇??') ||
    combinedText.includes('???遜')
  ) {
    return 'create';
  }

  return null;
}

function detectResearchToFileTask(task, analysis) {
  const combinedText = [
    task?.title || '',
    task?.description || '',
    ...(analysis?.execution_plan || []),
    ...(analysis?.verification_criteria || [])
  ].join(' ').toLowerCase();

  // Keywords indicating explicit web research intent
  const explicitWebResearch = [
    '上網',
    '網路',
    '網上',
    '爬',
    '爬取',
  ].some(keyword => combinedText.includes(keyword));

  const hasSearchIntent = [
    'search',
    'google',
    'tutorial',
    'guide',
    '\u67e5',
    '\u641c\u5c0b',
    '\u641c\u7d22',
    '\u6559\u5b78',
    '\u6559\u7a0b',
    '\u8cc7\u6599',
    // Simplified Chinese variants
    '查',
    '搜索',
    '搜尋',
    '教学',
    '教程',
    '資料',
    '查詢',
    '收集',
    '整理'
  ].some(keyword => combinedText.includes(keyword));

  const hasWriteIntent = [
    'save',
    'write',
    'copy',
    'paste',
    '\u5b58',
    '\u5beb',
    '\u8907\u88fd',
    '\u62f7\u8c9d',
    '\u8cbc',
    '\u8cbc\u4e0a',
    // Simplified Chinese variants
    '存',
    '寫',
    '複製',
    '貼上',
    '貼',
    '存檔',
    '保存',
    '列表',
    '清單'
  ].some(keyword => combinedText.includes(keyword));

  // If explicitly mentions web research, definitely do research task
  if (explicitWebResearch && hasWriteIntent) {
    return true;
  }

  // Otherwise need both search and write intent
  return hasSearchIntent && hasWriteIntent;
}

function detectArticleSummaryTask(task, analysis) {
  const sources = [
    task?.title || '',
    task?.description || '',
    ...(analysis?.execution_plan || []),
    ...(analysis?.verification_criteria || [])
  ];
  const combinedText = sources.join(' ').toLowerCase();

  const articleSignals = [
    'article',
    'read article',
    'summary',
    'summarize',
    'extract',
    '?皜?',
    '?謢?',
    '???',
    '?璇?',
    '??脩?',
    '???'
  ];

  const hasArticleUrl = sources.some(source => /https?:\/\/\S+/i.test(source));
  const signalCount = articleSignals.filter(signal => combinedText.includes(signal)).length;

  return hasArticleUrl || signalCount >= 2;
}

function detectInterviewTask(task, analysis) {
  const combinedText = [
    task?.title || '',
    task?.description || '',
    ...(analysis?.execution_plan || []),
    ...(analysis?.verification_criteria || [])
  ].join(' ').toLowerCase();

  const interviewSignals = [
    'interview',
    'survey',
    'questionnaire',
    'user research',
    '訪談',
    '訪問',
    '問卷',
    '調查',
    '用戶研究',
    '用户研究',
    '使用者研究',
    // Simplified Chinese variants
    '访谈',
    '访问',
    '问卷',
    '调查',
    '目标用户',
    '目标群体',
    '目标人群',
    '信息需求',
    '痛点',
    '需求分析',
    '用户研究',
    '市场调查'
  ];

  return interviewSignals.some(signal => combinedText.includes(signal));
}

function executeInterviewTask(task, analysis, fileName) {
  const defaultFileName = fileName || `interview-task-${task.id}.md`;
  const filePath = path.join(PATHS.TEXT_OUTPUT, defaultFileName);
  const content = buildInterviewTemplate(task, analysis);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');

  return {
    success: true,
    action: 'generated_interview_template',
    path: filePath,
    generated_summary: content,
    steps_completed: analysis?.execution_plan || [],
    timestamp: new Date().toISOString()
  };
}

function buildInterviewTemplate(task, analysis) {
  const useChinese = taskRequestsChinese(task, analysis);

  if (useChinese) {
    return buildInterviewTemplateZh(task, analysis);
  }

  const lines = [
    '# User Interview / Survey Template',
    '',
    `## Original Task`,
    `Title: ${task?.title || 'Interview Task'}`,
    `Description: ${task?.description || 'No description provided'}`,
    '',
    '## Interview Objectives',
    '- Understand user pain points and needs',
    '- Identify key decision factors',
    '- Gather qualitative feedback',
    '- Validate assumptions',
    '',
    '## Suggested Interview Questions',
    '',
    '### Section 1: Background',
    '1. Can you describe your current process?',
    '2. How long have you been doing this?',
    '3. What tools do you currently use?',
    '',
    '### Section 2: Pain Points',
    '4. What are the biggest challenges you face?',
    '5. How much time do you spend on this process?',
    '6. What would make this process easier?',
    '',
    '### Section 3: Needs & Expectations',
    '7. What would be your ideal solution?',
    '8. What features are most important to you?',
    '9. What would you be willing to pay?',
    '',
    '## Response Collection',
    '',
    '### Participant 1',
    '- Name/ID: [To be filled]',
    '- Date: [Interview date]',
    '- Responses: [Notes]',
    '',
    '### Participant 2',
    '- Name/ID: [To be filled]',
    '- Date: [Interview date]',
    '- Responses: [Notes]',
    '',
    '## Key Findings Summary',
    '- Finding 1: [To be filled]',
    '- Finding 2: [To be filled]',
    '- Finding 3: [To be filled]',
    '',
    '---',
    `Generated from task: ${task?.id}`,
    `Timestamp: ${new Date().toISOString()}`
  ];

  return lines.join('\n') + '\n';
}

function buildInterviewTemplateZh(task, analysis) {
  const lines = [
    '# 用戶訪談 / 調查問卷範本',
    '',
    `## 原始任務`,
    `標題: ${task?.title || '訪談任務'}`,
    `描述: ${task?.description || '未提供描述'}`,
    '',
    '## 訪談目標',
    '- 了解用戶的痛點和需求',
    '- 識別關鍵決策因素',
    '- 收集定性反饋',
    '- 驗證假設',
    '',
    '## 建議的訪談問題',
    '',
    '### 第一部分：背景',
    '1. 能否描述一下你目前的工作流程？',
    '2. 你做這項工作已經多久了？',
    '3. 你目前使用哪些工具？',
    '',
    '### 第二部分：痛點',
    '4. 你面臨的最大挑戰是什麼？',
    '5. 你在這個流程上花多少時間？',
    '6. 什麼可以讓這個流程更簡單？',
    '',
    '### 第三部分：需求與期望',
    '7. 你的理想解決方案是什麼？',
    '8. 對你來說最重要的功能是什麼？',
    '9. 你願意為此付出多少？',
    '',
    '## 回覆收集',
    '',
    '### 受訪者 1',
    '- 姓名/ID：[待填充]',
    '- 日期：[訪談日期]',
    '- 回覆：[筆記]',
    '',
    '### 受訪者 2',
    '- 姓名/ID：[待填充]',
    '- 日期：[訪談日期]',
    '- 回覆：[筆記]',
    '',
    '## 主要發現摘要',
    '- 發現 1：[待填充]',
    '- 發現 2：[待填充]',
    '- 發現 3：[待填充]',
    '',
    '---',
    `生成自任務：${task?.id}`,
    `時間戳：${new Date().toISOString()}`
  ];

  return lines.join('\n') + '\n';
}

function taskRequestsChinese(task, analysis) {
  const combinedText = [
    task?.title || '',
    task?.description || '',
    ...(analysis?.execution_plan || []),
    ...(analysis?.verification_criteria || [])
  ].join(' ').toLowerCase();

  return (
    combinedText.includes('中文') ||
    combinedText.includes('繁中') ||
    combinedText.includes('繁體') ||
    combinedText.includes('zh') ||
    combinedText.includes('chinese')
  );
}

async function executeArticleSummaryTask(task, analysis, fileName) {
  const explicitUrl = extractFirstUrl(task, analysis);
  const title = extractQuotedTitle(task, analysis) || buildResearchQuery(task, analysis);
  const query = `${title} article`;
  let selectedPage = null;

  if (explicitUrl) {
    try {
      const directPage = await fetchReadablePage(explicitUrl, title);
      if (directPage && directPage.snippets.length > 0) {
        selectedPage = directPage;
      }
    } catch (err) {
      log(`[Scheduler] Failed to fetch direct article ${explicitUrl}: ${err.message}`);
    }
  }

  if (!selectedPage) {
    const searchResults = await searchTutorialPages(query);

    if (searchResults.length === 0) {
      return {
        success: false,
        error: `No article results found for query: ${query}`
      };
    }

    for (const result of searchResults.slice(0, 5)) {
      try {
        const page = await fetchReadablePage(result.url, title);
        if (page && page.snippets.length > 0) {
          selectedPage = page;
          break;
        }
      } catch (err) {
        log(`[Scheduler] Failed to fetch article page ${result.url}: ${err.message}`);
      }
    }
  }

  if (!selectedPage) {
    return {
      success: false,
      error: `Found search results for "${title}" but could not extract article content`
    };
  }

  const summary = buildChineseArticleSummary(title, selectedPage);
  const outputPath = fileName
    ? path.join(PATHS.TEXT_OUTPUT, fileName)
    : path.join(PATHS.TEXT_OUTPUT, `article-summary-task-${task.id}.txt`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, summary, 'utf8');

  return {
    success: true,
    action: 'generated_article_summary',
    title,
    query,
    path: outputPath,
    source: { title: selectedPage.title, url: selectedPage.url },
    generated_summary: summary,
    steps_completed: analysis?.execution_plan || [],
    timestamp: new Date().toISOString()
  };
}

function extractFirstUrl(task, analysis) {
  const sources = [
    task?.title || '',
    task?.description || '',
    ...(analysis?.execution_plan || [])
  ];

  for (const source of sources) {
    const match = source.match(/https?:\/\/\S+/i);
    if (match) {
      return match[0];
    }
  }

  return null;
}

function extractQuotedTitle(task, analysis) {
  const sources = [
    task?.title || '',
    task?.description || '',
    ...(analysis?.execution_plan || [])
  ];

  for (const source of sources) {
    const bookTitle = source.match(/《([^》]{4,200})》/);
    if (bookTitle) return bookTitle[1].trim();

    const plainQuote = source.match(/["']([^"']{4,200})["']/);
    if (plainQuote) return plainQuote[1].trim();
  }

  return null;
}

function buildChineseArticleSummary(title, page) {
  const points = page.snippets.slice(0, 5).map(snippet => toChineseBullet(snippet));
  const dataPoints = page.snippets
    .filter(snippet => /\d/.test(snippet))
    .slice(0, 3)
    .map(snippet => `- ${snippet.trim()}`);

  const lines = [
    `文章標題：${title}`,
    `來源：${page.url}`,
    '',
    '重點整理：',
    ...points,
    ''
  ];

  if (dataPoints.length > 0) {
    lines.push('文中數據：');
    lines.push(...dataPoints);
    lines.push('');
  }

  lines.push('中文簡述：');
  lines.push('這篇文章主要在說明相關 AI 代理或雲端服務的實際應用方式、成本變化與落地價值。整理時保留了文章中可辨識的重點敘述與數字，方便快速做內部分享或對外說明。');

  return lines.join('\\n') + '\\n';
}

function toChineseBullet(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return `- ${cleaned}`;
}


async function executeResearchToFileTask(task, analysis, fileName) {
  const defaultFileName = fileName || `research-task-${task.id}.md`;
  const filePath = path.join(PATHS.TEXT_OUTPUT, defaultFileName);
  const query = buildResearchQuery(task, analysis);

  log(`[Scheduler] Starting research for query: "${query}"`);
  const searchResults = await searchTutorialPages(query);

  // Only succeed if we actually found and scraped real content
  if (searchResults.length === 0) {
    return {
      success: false,
      error: `No search results found for query: ${query}`
    };
  }

  log(`[Scheduler] Found ${searchResults.length} search results`);
  const collectedPages = [];

  for (const result of searchResults.slice(0, 3)) {
    try {
      const page = await fetchReadablePage(result.url, query);
      if (page && page.snippets.length > 0) {
        collectedPages.push(page);
      }
    } catch (err) {
      log(`[Scheduler] Failed to fetch page ${result.url}: ${err.message}`);
    }
  }

  if (collectedPages.length === 0) {
    return {
      success: false,
      error: `Found ${searchResults.length} search results for "${query}" but couldn't extract readable content from any of them`
    };
  }

  // Real content was found and extracted - save it
  const content = buildResearchFileContent(query, collectedPages);
  const sources = collectedPages.map(page => ({ title: page.title, url: page.url }));

  log(`[Scheduler] Successfully collected ${collectedPages.length} pages with real content`);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');

  return {
    success: true,
    action: 'researched_and_written',
    path: filePath,
    query,
    generated_summary: content,
    sources: sources,
    steps_completed: analysis?.execution_plan || [],
    timestamp: new Date().toISOString()
  };
}

function buildResearchQuery(task, analysis) {
  const titleText = task?.title || '';
  const descriptionText = task?.description || '';

  // Try to extract from execution plan first (usually more descriptive)
  const planText = (analysis?.execution_plan || []).join(' ');

  const allText = [titleText, descriptionText, planText]
    .filter(Boolean)
    .join(' ');

  // Clean up action words and special characters more aggressively
  const cleanText = allText
    .replace(/\b[a-z0-9][a-z0-9._-]*\.[a-z0-9]{1,10}\b/gi, ' ')
    .replace(/\u7576\u524d\u76ee\u9304|\u76ee\u524d\u76ee\u9304|current directory/gi, ' ')
    .replace(/\u6a94\u6848\u540d\u7a31|\u6587\u4ef6\u540d|file name/gi, ' ')
    .replace(/\u5b58\u5230|\u4fdd\u5b58\u5230|save to|write to/gi, ' ')
    .replace(/\u6574\u7406\u6210|整理成|整理|存\u6a94|存档|存到|列表|清單/gi, ' ')
    .replace(/\u7528\u4e2d\u6587|用中文/gi, ' ')
    .replace(/\u5e6b\u6211|\u6211\u9700\u8981|\u5e2b\u6211|幫我|我要|給我|给我/gi, ' ')
    .replace(/\u4e0a\u7db2|\u7db2\u8def|\u7db2\u4e0a|\u7db2\u8def\u4e0a|\u4e0a\u9762|網路|網上|在線|线上|搜索|蒐集|收集|查詢|查询|提取/gi, ' ')
    .replace(/[\?,\.\!\;\:，。！；：\(\)（）\[\]\[\]「」『』【】]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Try to extract topic from technical patterns first
  let topic = extractPrimaryTopic(cleanText);

  // If no tech topic found, extract meaningful keywords from the text
  if (!topic) {
    topic = extractKeywordsTopic(cleanText);
  }

  // Fallback to first few words if extraction didn't work well
  if (!topic || topic.length > 30) {
    const words = cleanText.split(/\s+/).filter(w => w.length > 1);
    topic = words.slice(0, 3).join(' ') || '資訊';
  }

  return topic;
}

function extractPrimaryTopic(text) {
  const topicPatterns = [
    /\bredis\b/i,
    /\bmysql\b/i,
    /\bpostgres(?:ql)?\b/i,
    /\bjavascript\b/i,
    /\bnode\.?js\b/i,
    /\bpython\b/i
  ];

  for (const pattern of topicPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  const chineseTopic = text.match(/([A-Za-z0-9+#.]{2,30}|[\\u4e00-\\u9fff]{2,12})\\s*(\\u6559\\u5b78|\\u6559\\u7a0b|\\u57fa\\u790e|\\u57fa\\u672c|\\u5165\\u9580|\\u8cc7\\u6599|\\u5b9a\\u7fa9|\\u7528\\u9014)?/);
  return chineseTopic ? chineseTopic[1] : null;
}

/**
 * Extract meaningful keywords/topic from text when no specific tech topic is found
 */
function extractKeywordsTopic(text) {
  // Common keywords that indicate the main topic
  const topicKeywords = [
    '營養', '营养', '飲食', '饮食', '健康', '病人', '老年人', '食物', '疾病', '痛點', '痛点',
    '教程', '指南', '學習', '学习', '培訓', '培训', '資料', '资料', '文檔', '文档',
    '項目', '项目', '應用', '应用', '系統', '系统', '產品', '产品', '開發', '开发'
  ];

  // Split text into words
  const words = text.split(/\s+/);

  // Find words that are actual keywords (not empty)
  const foundKeywords = [];
  for (const keyword of topicKeywords) {
    if (text.includes(keyword)) {
      foundKeywords.push(keyword);
    }
  }

  // If found specific keywords, use them (limit to 2-3 keywords)
  if (foundKeywords.length > 0) {
    return foundKeywords.slice(0, 3).join(' ');
  }

  // Fallback: return first few non-trivial words
  const meaningfulWords = words.filter(w => w.length > 1);
  return meaningfulWords.slice(0, 2).join(' ') || '資訊';
}

async function searchTutorialPages(query) {
  const candidates = [];
  const seenUrls = new Set();
  const searchTargets = [
    {
      url: 'https://www.google.com/search',
      params: { q: query },
      parser: parseGoogleResults
    },
    {
      url: 'https://html.duckduckgo.com/html/',
      params: { q: query },
      parser: parseDuckDuckGoResults
    },
    {
      url: 'https://www.bing.com/search',
      params: { q: query },
      parser: parseBingResults
    }
  ];

  for (const target of searchTargets) {
    try {
      log(`[Scheduler] Searching with ${target.url} for: "${query}"`);
      const response = await axios.get(target.url, {
        params: target.params,
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate'
        }
      });

      const results = target.parser(response.data, query);
      log(`[Scheduler] Got ${results.length} results from ${target.url}`);

      for (const result of results) {
        if (!result.url || seenUrls.has(result.url)) continue;
        seenUrls.add(result.url);
        candidates.push(result);
      }

      if (candidates.length >= 5) {
        log(`[Scheduler] Collected enough results (${candidates.length}), stopping search`);
        break;
      }
    } catch (err) {
      log(`[Scheduler] Search with ${target.url} failed: ${err.message}`);
    }
  }

  log(`[Scheduler] Total candidates collected: ${candidates.length}`);
  return candidates.slice(0, 6);
}

function parseGoogleResults(html, query) {
  const results = [];
  try {
    // Google search result pattern - more flexible
    const regex = /<a href="\/url\?q=([^&]+)&[^"]*"[^>]*>([^<]+)<\/a>/gi;
    let match;
    const seen = new Set();

    while ((match = regex.exec(html)) !== null) {
      try {
        const url = decodeURIComponent(match[1]);
        const title = match[2].trim();

        // Skip Google's own pages and duplicates
        if (url.includes('google.com') || url.includes('webcache') || seen.has(url)) {
          continue;
        }
        seen.add(url);

        if (isUsefulSearchResult(url, title, query)) {
          results.push({ title, url });
        }
      } catch (e) {
        // Skip malformed results
      }
    }
  } catch (err) {
    log(`[Scheduler] Error parsing Google results: ${err.message}`);
  }
  return results;
}

function parseDuckDuckGoResults(html, query) {
  const results = [];
  const regex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const url = decodeDuckDuckGoUrl(match[1]);
    const title = decodeHtmlEntities(stripHtml(match[2])).trim();
    if (isUsefulSearchResult(url, title, query)) {
      results.push({ title, url });
    }
  }

  return results;
}

function parseBingResults(html, query) {
  const results = [];
  const regex = /<li class="b_algo"[\s\S]*?<h2><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const url = decodeHtmlEntities(match[1]);
    const title = decodeHtmlEntities(stripHtml(match[2])).trim();
    if (isUsefulSearchResult(url, title, query)) {
      results.push({ title, url });
    }
  }

  return results;
}

function decodeDuckDuckGoUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl, 'https://html.duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : rawUrl;
  } catch (err) {
    return rawUrl;
  }
}

function isUsefulSearchResult(url, title, query) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (/duckduckgo\.com|bing\.com\/ck\//i.test(url)) return false;

  const haystack = `${title} ${url} ${query}`.toLowerCase();

  // Block spam/ads/irrelevant domains
  const blockedDomains = [
    'facebook.com', 'twitter.com', 'youtube.com', 'pinterest.com',
    'instagram.com', 'tiktok.com', 'reddit.com/ads'
  ];
  if (blockedDomains.some(domain => haystack.includes(domain))) {
    return false;
  }

  // Generic positive signals that apply to any topic
  const positiveSignals = [
    'tutorial', 'guide', 'learn', 'docs', 'article', 'blog', 'information',
    'research', 'study', 'report', 'analysis', 'overview', 'introduction',
    'redis', 'mysql', 'python', 'javascript', // Tech topics
    'health', 'medical', 'nutrition', 'diet', 'wellness', 'healthcare', // Health topics
    '教程', '指南', '資料', '文章', '研究', '分析', // Chinese
    '營養', '飲食', '健康', '醫療', '醫學' // Chinese health terms
  ];

  // If query contains domain-specific keywords, also accept results matching those
  const queryKeywords = query.toLowerCase().split(/\s+/);
  const hasQueryMatch = queryKeywords.some(kw =>
    kw.length > 2 && haystack.includes(kw)
  );

  const hasSignalMatch = positiveSignals.some(signal => haystack.includes(signal));

  // Accept if: has positive signal OR matches query keywords
  return hasSignalMatch || hasQueryMatch;
}

async function fetchReadablePage(url, query) {
  try {
    log(`[Scheduler] Fetching page: ${url}`);

    const response = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 EdgEdge/120.0.0.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        'Accept-Encoding': 'gzip, deflate',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      },
      validateStatus: (status) => status < 400 // Accept all non-error statuses
    });

    const html = typeof response.data === 'string' ? response.data : '';
    if (!html || html.length < 100) {
      log(`[Scheduler] Page too small or empty: ${url}`);
      return null;
    }

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? decodeHtmlEntities(stripHtml(titleMatch[1])).trim() : url;
    const text = htmlToText(html);

    if (!text || text.length < 100) {
      log(`[Scheduler] Extracted text too short: ${url}`);
      return null;
    }

    const snippets = extractRelevantSnippets(text, query);

    if (!snippets || snippets.length === 0) {
      log(`[Scheduler] No relevant snippets found: ${url}`);
      return null;
    }

    log(`[Scheduler] Successfully fetched ${snippets.length} snippets from: ${url}`);

    return {
      title,
      url,
      snippets
    };
  } catch (err) {
    log(`[Scheduler] Error fetching ${url}: ${err.message}`);
    return null;
  }
}

function buildResearchFileContent(query, pages) {
  const lines = [
    `Topic: ${query}`,
    `Generated at: ${new Date().toISOString()}`,
    '',
    'This file was created from live web search results and extracted tutorial content.',
    ''
  ];

  pages.forEach((page, index) => {
    lines.push(`${index + 1}. ${page.title}`);
    lines.push(`Source: ${page.url}`);
    lines.push('');
    page.snippets.forEach(snippet => {
      lines.push(snippet);
      lines.push('');
    });
  });

  return lines.join('\n').trim() + '\n';
}

function htmlToText(html) {
  return decodeHtmlEntities(
    stripHtml(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<(br|\/p|\/li|\/h[1-6])[^>]*>/gi, '\n')
    )
  )
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function stripHtml(input) {
  return input.replace(/<[^>]+>/g, ' ');
}

function decodeHtmlEntities(input) {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function extractRelevantSnippets(text, query) {
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length >= 3);

  const paragraphs = text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => line.length >= 60 && line.length <= 500);

  const scored = paragraphs
    .map(paragraph => ({
      paragraph,
      score: keywords.reduce((total, keyword) => (
        paragraph.toLowerCase().includes(keyword) ? total + 1 : total
      ), 0)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const unique = [];
  const seen = new Set();
  for (const item of scored) {
    const normalized = item.paragraph.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(item.paragraph);
    if (unique.length >= 6) break;
  }

  return unique;
}

// Export singleton instance
const scheduler = new TodoScheduler();

module.exports = {
  scheduler,
  TodoScheduler
};
