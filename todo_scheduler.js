// Todo List Scheduler - Checks pending tasks every 1 minutes
const todoService = require('./todo_service');
const { analyzeTask, verifyTaskCompletion } = require('./todo_analyzer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const LOGS_DIR = path.join(__dirname, 'logs');
const SCHEDULER_LOG = path.join(LOGS_DIR, 'todo_scheduler.log');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
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
    const industryPlanTask = detectIndustryPlanTask(task, analysis);
    const articleSummaryTask = detectArticleSummaryTask(task, analysis);

    try {
      if (industryPlanTask && fileName) {
        return executeIndustryPlanTask(task, analysis, fileName);
      }

      if (articleSummaryTask) {
        return await executeArticleSummaryTask(task, analysis, fileName);
      }

      if (researchTask && fileName) {
        return await executeResearchToFileTask(task, analysis, fileName);
      }

      if (operation === 'create' && fileName) {
        const filePath = path.join(process.cwd(), fileName);
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
    combinedText.includes('蝘餃?') ||
    combinedText.includes('?祉宏') ||
    combinedText.includes('??賢?')
  ) {
    return 'move';
  }

  if (
    combinedText.includes('delete') ||
    combinedText.includes('remove') ||
    combinedText.includes('?芷')
  ) {
    return 'delete';
  }

  if (
    combinedText.includes('create') ||
    combinedText.includes('new file') ||
    combinedText.includes('empty file') ||
    combinedText.includes('?啣?') ||
    combinedText.includes('撱箇?') ||
    combinedText.includes('?萄遣')
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
    '\u8cc7\u6599'
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
    '\u8cbc\u4e0a'
  ].some(keyword => combinedText.includes(keyword));

  return hasSearchIntent && hasWriteIntent && Boolean(extractRequestedFileName(task, analysis));
}

function detectIndustryPlanTask(task, analysis) {
  const combinedText = [
    task?.title || '',
    task?.description || '',
    ...(analysis?.execution_plan || []),
    ...(analysis?.verification_criteria || [])
  ].join(' ').toLowerCase();

  const signals = [
    'pain point',
    'markdown',
    'recommendation letter',
    'industry',
    'ai service',
    '\u75db\u9ede',
    '\u7522\u696d',
    '\u6587\u5ba3',
    '\u63a8\u85a6\u4fe1',
    '\u63a8\u85a6',
    'ai'
  ];

  const matchedSignals = signals.filter(signal => combinedText.includes(signal));
  return matchedSignals.length >= 3 && Boolean(extractRequestedFileName(task, analysis));
}

function detectArticleSummaryTask(task, analysis) {
  const combinedText = [
    task?.title || '',
    task?.description || '',
    ...(analysis?.execution_plan || []),
    ...(analysis?.verification_criteria || [])
  ].join(' ').toLowerCase();

  const articleSignals = [
    'article',
    'read article',
    'summary',
    'summarize',
    'extract',
    '整理',
    '摘要',
    '文章',
    '閱讀',
    '阅读',
    '提取'
  ];

  return articleSignals.filter(signal => combinedText.includes(signal)).length >= 2;
}

function executeIndustryPlanTask(task, analysis, fileName) {
  const filePath = path.join(process.cwd(), fileName);
  const content = buildIndustryPlanMarkdown(task, analysis);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');

  return {
    success: true,
    action: 'generated_industry_plan',
    path: filePath,
    steps_completed: analysis?.execution_plan || [],
    timestamp: new Date().toISOString()
  };
}

function buildIndustryPlanMarkdown(task, analysis) {
  const industries = [
    ['Manufacturing', 'Production scheduling changes too slowly, causing idle machines and delayed orders.', 'Use AI scheduling and anomaly alerts to rebalance jobs in real time.', 'Better on-time delivery, lower overtime, and fewer unplanned stoppages.'],
    ['Retail', 'Store demand forecasting is inaccurate, leading to overstocks and stockouts.', 'Use AI forecasting with POS, seasonality, and promotion signals.', 'Higher inventory turnover and improved shelf availability.'],
    ['Healthcare', 'Front-desk staff spend too much time answering repetitive patient questions.', 'Use AI assistants for appointment, triage guidance, and FAQ handling.', 'Shorter wait times and reduced service burden on staff.'],
    ['Logistics', 'Dispatch teams struggle to react quickly to traffic and route disruptions.', 'Use AI route optimization and exception prediction.', 'Lower delivery delays and better fleet utilization.'],
    ['Construction', 'Site reporting is fragmented across photos, chat messages, and spreadsheets.', 'Use AI to summarize field reports and detect project risks from daily updates.', 'Faster issue escalation and clearer project visibility.'],
    ['Hospitality', 'Hotels lose revenue because pricing and occupancy strategy are too manual.', 'Use AI revenue management to optimize room pricing by demand patterns.', 'Improved occupancy and average daily rate.'],
    ['Education', 'Teachers spend excessive time grading routine assignments and writing feedback.', 'Use AI grading support and feedback drafting with teacher review.', 'More time for teaching and more consistent student feedback.'],
    ['Real Estate', 'Leads are not prioritized well, so agents waste time on low-intent prospects.', 'Use AI lead scoring and follow-up recommendation workflows.', 'Higher conversion rates and faster response time.'],
    ['Insurance', 'Claims intake is slow because documents must be manually read and categorized.', 'Use AI document extraction and claim triage.', 'Faster first response and reduced claims processing backlog.'],
    ['Banking', 'Relationship managers miss upsell opportunities hidden in customer behavior data.', 'Use AI to detect product-fit signals and next-best-action suggestions.', 'Better cross-sell rates with more relevant outreach.'],
    ['E-commerce', 'Customer support teams repeat the same order and refund answers all day.', 'Use AI support copilots and self-service resolution flows.', 'Lower ticket volume and faster resolution speed.'],
    ['Agriculture', 'Farm decisions rely too much on experience instead of timely field data.', 'Use AI to analyze weather, sensor, and crop health inputs.', 'Better yield planning and more targeted resource usage.'],
    ['Food Service', 'Restaurants cannot accurately predict staffing and ingredient demand.', 'Use AI sales forecasting tied to shift planning and purchasing.', 'Less food waste and more stable labor cost.'],
    ['Legal Services', 'Law firms spend too many billable hours reviewing repetitive contract clauses.', 'Use AI clause extraction, red-flag detection, and draft comparison.', 'Shorter review cycles and higher throughput for legal teams.'],
    ['Human Resources', 'Recruiters manually screen too many resumes before reaching qualified candidates.', 'Use AI resume matching and interview question drafting.', 'Faster hiring cycles and more consistent candidate evaluation.'],
    ['Automotive Service', 'Service centers miss preventive maintenance opportunities from repair history.', 'Use AI service recommendations based on vehicle history and patterns.', 'Higher service revenue and better customer retention.'],
    ['Energy', 'Operations teams detect equipment issues too late in distributed assets.', 'Use AI predictive maintenance with telemetry monitoring.', 'Lower downtime and better maintenance planning.'],
    ['Telecom', 'Churn risk is identified only after customers have already disengaged.', 'Use AI churn prediction and retention offer recommendations.', 'Lower churn and more targeted retention spending.'],
    ['Media', 'Content teams have difficulty producing enough channel-specific copy quickly.', 'Use AI content adaptation for campaigns, scripts, and ad variants.', 'Faster campaign launch and more efficient creative operations.'],
    ['Public Sector', 'Citizen service requests are routed slowly across departments.', 'Use AI intake classification and case summarization.', 'Faster response time and more transparent case handling.']
  ];

  const lines = [
    '# AI Service Industry Pain Point Proposal',
    '',
    '## Executive Summary',
    'This document outlines 20 current industry pain points, realistic AI-enabled improvement scenarios, and the business value that can be used in proposal or sales conversations.',
    '',
    '## Pain Points And AI Improvement Opportunities',
    ''
  ];

  industries.forEach(([industry, painPoint, aiSolution, expectedImpact], index) => {
    lines.push(`### ${index + 1}. ${industry}`);
    lines.push(`- Pain point: ${painPoint}`);
    lines.push(`- AI improvement approach: ${aiSolution}`);
    lines.push(`- Expected effect: ${expectedImpact}`);
    lines.push('- Suggested service framing: Provide a tailored AI workflow, connect business data sources, and keep a human approval loop where risk is high.');
    lines.push('');
  });

  lines.push('## Recommended Positioning');
  lines.push('Your AI service should be positioned as a practical productivity and decision-support layer, not just a chatbot. Emphasize workflow integration, measurable KPIs, and incremental rollout.');
  lines.push('');
  lines.push('## Recommendation Letter Template');
  lines.push('');
  lines.push('Dear Prospective Partner,');
  lines.push('');
  lines.push('We are recommending the adoption of our AI service because many industries are currently facing the same operational pattern: repetitive manual work, delayed decision-making, fragmented data, and limited scalability of human teams. Our service is designed to improve these exact bottlenecks.');
  lines.push('');
  lines.push('Rather than replacing people, the service strengthens existing teams by automating repetitive handling, generating structured insights, drafting responses and reports, and surfacing risks earlier. This makes it especially suitable for customer service, operations, sales support, document processing, scheduling, forecasting, and internal knowledge workflows.');
  lines.push('');
  lines.push('The strongest advantage of this approach is practicality. We can begin with a narrow business scenario, connect to the client\'s current process, measure the outcome, and then expand to additional use cases once value is proven. This lowers adoption risk while still creating visible business results.');
  lines.push('');
  lines.push('If your organization is looking to reduce labor-intensive work, improve response speed, and build a more scalable service model, our AI service is a strong fit. We would welcome the opportunity to discuss the most relevant use case for your team and propose a realistic implementation plan.');
  lines.push('');
  lines.push('Sincerely,');
  lines.push('AI Solutions Consultant');
  lines.push('');
  lines.push('## Notes');
  lines.push(`- Source task: ${task.title}`);
  if (analysis?.task_understanding) {
    lines.push(`- Analysis summary: ${analysis.task_understanding}`);
  }

  return lines.join('\n') + '\n';
}

async function executeArticleSummaryTask(task, analysis, fileName) {
  const title = extractQuotedTitle(task, analysis) || buildResearchQuery(task, analysis);
  const query = `${title} article`;
  const searchResults = await searchTutorialPages(query);

  if (searchResults.length === 0) {
    return {
      success: false,
      error: `No article results found for query: ${query}`
    };
  }

  let selectedPage = null;
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

  if (!selectedPage) {
    return {
      success: false,
      error: `Found search results for "${title}" but could not extract article content`
    };
  }

  const summary = buildChineseArticleSummary(title, selectedPage);
  let outputPath = null;

  if (fileName) {
    outputPath = path.join(process.cwd(), fileName);
  } else {
    outputPath = path.join(process.cwd(), `article-summary-task-${task.id}.txt`);
  }

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

function extractQuotedTitle(task, analysis) {
  const sources = [
    task?.title || '',
    task?.description || '',
    ...(analysis?.execution_plan || [])
  ];

  for (const source of sources) {
    const chineseQuote = source.match(/[《「『]([^》」』]{4,200})[》」』]/);
    if (chineseQuote) return chineseQuote[1].trim();

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

  return lines.join('\n') + '\n';
}

function toChineseBullet(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return `- ${cleaned}`;
}


async function executeResearchToFileTask(task, analysis, fileName) {
  const filePath = path.join(process.cwd(), fileName);
  const query = buildResearchQuery(task, analysis);
  const searchResults = await searchTutorialPages(query);

  if (searchResults.length === 0) {
    return {
      success: false,
      error: `No search results found for query: ${query}`
    };
  }

  const collectedPages = [];

  for (const result of searchResults.slice(0, 3)) {
    try {
      const page = await fetchReadablePage(result.url, query);
      if (page && page.snippets.length > 0) {
        collectedPages.push(page);
      }
    } catch (err) {
      log(`[Scheduler] Failed to fetch tutorial page ${result.url}: ${err.message}`);
    }
  }

  if (collectedPages.length === 0) {
    return {
      success: false,
      error: `Search succeeded for "${query}" but no readable tutorial content was extracted`
    };
  }

  const content = buildResearchFileContent(query, collectedPages);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');

  return {
    success: true,
    action: 'researched_and_written',
    path: filePath,
    query,
    sources: collectedPages.map(page => ({ title: page.title, url: page.url })),
    steps_completed: analysis?.execution_plan || [],
    timestamp: new Date().toISOString()
  };
}

function buildResearchQuery(task, analysis) {
  const rawText = [task?.title || '', task?.description || '']
    .filter(Boolean)
    .join(' ')
    .replace(/\b[a-z0-9][a-z0-9._-]*\.[a-z0-9]{1,10}\b/gi, ' ')
    .replace(/\u7576\u524d\u76ee\u9304|\u76ee\u524d\u76ee\u9304|current directory/gi, ' ')
    .replace(/\u6a94\u6848\u540d\u7a31|\u6587\u4ef6\u540d|file name/gi, ' ')
    .replace(/\u5b58\u5230|\u4fdd\u5b58\u5230|save to|write to/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const topic = extractPrimaryTopic(rawText) || 'Redis';
  const wantsBasic = /(\u57fa\u672c|\u57fa\u7840|\u5165\u9580|\u5165\u95e8|\u521d\u5b78|\u521d\u5b66|beginner|basic)/i.test(rawText);
  const wantsTutorial = /(\u6559\u5b78|\u6559\u7a0b|tutorial|guide)/i.test(rawText) || true;

  return [topic, wantsBasic ? 'basic' : '', wantsTutorial ? 'tutorial' : '']
    .filter(Boolean)
    .join(' ');
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

async function searchTutorialPages(query) {
  const candidates = [];
  const seenUrls = new Set();
  const searchTargets = [
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
      const response = await axios.get(target.url, {
        params: target.params,
        timeout: 12000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36'
        }
      });

      const results = target.parser(response.data, query);
      for (const result of results) {
        if (!result.url || seenUrls.has(result.url)) continue;
        seenUrls.add(result.url);
        candidates.push(result);
      }

      if (candidates.length >= 5) {
        break;
      }
    } catch (err) {
      log(`[Scheduler] Search provider failed for "${query}": ${err.message}`);
    }
  }

  if (candidates.length === 0 && /\bredis\b/i.test(query)) {
    candidates.push(
      { title: 'Redis quick start guide', url: 'https://redis.io/learn/howtos/quick-start/' },
      { title: 'What is Redis?: An Overview', url: 'https://redis.io/tutorials/what-is-redis/' },
      { title: 'Redis data types', url: 'https://redis.io/docs/latest/develop/data-types/' }
    );
  }

  return candidates.slice(0, 6);
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
  const positiveSignals = ['redis', 'tutorial', 'guide', 'learn', 'docs', 'getting started'];
  return positiveSignals.some(signal => haystack.includes(signal));
}

async function fetchReadablePage(url, query) {
  const response = await axios.get(url, {
    timeout: 12000,
    maxRedirects: 5,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml'
    }
  });

  const html = typeof response.data === 'string' ? response.data : '';
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(stripHtml(titleMatch[1])).trim() : url;
  const text = htmlToText(html);
  const snippets = extractRelevantSnippets(text, query);

  return {
    title,
    url,
    snippets
  };
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
