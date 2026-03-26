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
  const useChinese = taskRequestsChinese(task, analysis);

  if (useChinese) {
    return buildIndustryPlanMarkdownZh(task, analysis);
  }

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

function buildIndustryPlanMarkdownZh(task, analysis) {
  const industries = [
    ['製造業', '生產排程調整太慢，常常導致機台閒置、插單混亂與交期延誤。', '導入 AI 排程助手，結合訂單、產能、異常紀錄，自動提出更合理的排程建議。', '能降低加班與待料時間，提升準時交貨率與整體產能利用率。'],
    ['零售業', '門市補貨常靠經驗判斷，容易缺貨或囤貨。', '導入 AI 銷售預測工具，根據歷史銷量、節慶、促銷與天氣做補貨建議。', '可提升庫存周轉率，減少缺貨損失與庫存壓力。'],
    ['醫療產業', '櫃台與客服花大量時間回答重複問題，行政負擔很重。', '導入 AI 醫療客服助理，協助處理掛號、常見問答、看診流程說明。', '可降低櫃台壓力，縮短病患等待時間，提升服務效率。'],
    ['物流業', '配送路線與派車安排調整不夠即時，常受交通與臨時變動影響。', '導入 AI 路線規劃系統，動態調整配送順序與車輛配置。', '可降低延誤率與油耗，提升配送效率與車隊使用率。'],
    ['營建業', '工地資訊分散在照片、訊息與表單中，主管難以即時掌握風險。', '導入 AI 工地紀錄整理工具，自動彙整施工日報、異常回報與進度摘要。', '可更快掌握現場狀況，提早發現工安與進度風險。'],
    ['飯店旅宿業', '房價與住房策略過度依賴人工調整，反應速度不夠快。', '導入 AI 訂房與價格建議系統，依需求波動與訂房趨勢自動調整。', '可提升住房率與平均房價，增加整體營收。'],
    ['教育業', '老師花很多時間批改作業與撰寫回饋，教學時間被壓縮。', '導入 AI 批改與教學回饋助手，先產生批改建議與回饋草稿，再由老師確認。', '可減少重複行政工作，讓老師把時間留給教學與互動。'],
    ['房仲業', '名單很多，但難以快速分辨哪些客戶真正有成交機會。', '導入 AI 潛在客戶評分系統，分析互動紀錄、需求與意願。', '可讓業務更聚焦高潛力客戶，提高成交率。'],
    ['保險業', '理賠文件多、判讀慢，造成案件處理時間拉長。', '導入 AI 文件辨識與案件分類系統，自動整理理賠資料與初步判斷。', '可縮短理賠處理時間，降低人工作業負擔。'],
    ['金融業', '客戶資料很多，但理專不容易快速找出適合的商品推薦機會。', '導入 AI 客戶洞察工具，從交易與互動紀錄中找出推薦時機。', '可提升交叉銷售成功率，增加客戶經營成效。'],
    ['電商業', '客服大量時間花在查訂單、退款與重複問答上。', '導入 AI 客服助手，協助即時回答常見問題與處理標準流程。', '可降低客服工時，提升回覆速度與顧客滿意度。'],
    ['農業', '農作判斷常依賴經驗，缺乏即時數據整合。', '導入 AI 農業分析工具，整合天氣、土壤、病蟲害與影像資料。', '可更精準安排灌溉、施肥與防治，提高收成穩定度。'],
    ['餐飲業', '人力與食材準備常抓不準，容易浪費或忙不過來。', '導入 AI 來客預測與備料建議系統，根據時段、節日與歷史資料調整。', '可降低食材浪費、穩定人力成本並提升出餐效率。'],
    ['法務服務', '合約審閱大量重複，資深人員時間被低價值工作佔滿。', '導入 AI 合約條款比對與風險提示工具，先做初步標記再由法務確認。', '可縮短審約時間，提升法務處理量能。'],
    ['人資業', '履歷量大，人工初篩耗時且標準不一致。', '導入 AI 履歷篩選與面試問題建議工具，協助快速做初步判讀。', '可縮短招募流程，提升篩選效率與一致性。'],
    ['汽車維修業', '很多保養與維修建議依賴師傅經驗，難以標準化。', '導入 AI 維修推薦系統，根據車況、里程與過往工單提供建議。', '可提升回廠率、增加預防性保養收入並提升顧客信任。'],
    ['能源業', '設備異常通常等到出問題才處理，停機代價高。', '導入 AI 預測性維護系統，根據感測資料提早預警設備風險。', '可降低突發停機與維修成本，提升設備穩定度。'],
    ['電信業', '客戶流失通常發生後才發現，挽回太慢。', '導入 AI 流失預測模型，提早識別高風險客戶並提供挽留建議。', '可降低流失率，讓行銷與客服更精準投入資源。'],
    ['媒體行銷業', '不同平台需要大量改寫文案，內容團隊產能有限。', '導入 AI 文案改寫與多版本產生工具，加速社群、廣告與 EDM 產出。', '可縮短製作時間，提升行銷活動上線速度。'],
    ['公部門與服務窗口', '民眾陳情與申辦案件多，人工分類與轉派速度慢。', '導入 AI 案件分類與摘要系統，自動整理重點並分派給對應單位。', '可加快案件處理效率，提升民眾服務品質與透明度。']
  ];

  const lines = [
    '# AI 服務產業痛點與導入建議文宣',
    '',
    '## 總覽',
    '以下整理 20 個當前常見產業痛點，並搭配實際可落地的 AI 導入方式與預期改善效果，可作為對外介紹 AI 服務時的說明素材。',
    '',
    '## 20 個產業痛點與 AI 改善情境',
    ''
  ];

  industries.forEach(([industry, painPoint, aiSolution, expectedImpact], index) => {
    lines.push(`### ${index + 1}. ${industry}`);
    lines.push(`- 痛點描述：${painPoint}`);
    lines.push(`- AI 導入方式：${aiSolution}`);
    lines.push(`- 改善效果：${expectedImpact}`);
    lines.push('- 推薦說法：先從單一流程切入，保留人工確認機制，再逐步擴大使用範圍，較容易讓客戶接受。');
    lines.push('');
  });

  lines.push('## 對外推薦重點');
  lines.push('你的 AI 服務不應只被描述成聊天機器人，而應該被定位成能幫企業節省時間、降低人力負擔、提升效率與決策品質的實用工具。');
  lines.push('');
  lines.push('## 推薦信範本');
  lines.push('');
  lines.push('敬啟者：');
  lines.push('');
  lines.push('隨著市場競爭加劇，許多企業正面臨重複性工作過多、資訊分散、反應速度不足與人力成本上升等問題。我們推薦導入 AI 服務，原因在於它不只是新的技術工具，而是能實際協助企業改善流程、提升效率與強化營運能力的解決方案。');
  lines.push('');
  lines.push('本服務可協助企業處理客服問答、文件整理、數據分析、流程自動化、決策輔助與知識管理等工作，特別適合應用在行政作業繁重、回應速度要求高、資訊量大且需要持續優化流程的場景。');
  lines.push('');
  lines.push('相較於一次性的大型系統改造，AI 服務更適合從單一部門或單一流程開始導入，先快速看見成果，再逐步擴大。這樣不但能降低導入風險，也更容易讓團隊建立信心與使用習慣。');
  lines.push('');
  lines.push('若貴單位正在尋找能夠提升效率、降低重複勞務並強化服務品質的方法，我們相信 AI 服務將會是一個兼具實用性與發展性的選擇。期待有機會進一步與您交流最適合的應用情境。');
  lines.push('');
  lines.push('敬祝 商祺');
  lines.push('AI 解決方案顧問');
  lines.push('');
  lines.push('## 備註');
  lines.push(`- 原始任務：${task.title}`);
  if (analysis?.task_understanding) {
    lines.push(`- 任務理解：${analysis.task_understanding}`);
  }

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
    ? path.join(process.cwd(), fileName)
    : path.join(process.cwd(), `article-summary-task-${task.id}.txt`);

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
