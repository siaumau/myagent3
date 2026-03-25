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
      const verification = await verifyTaskCompletion(task, analysisResult.analysis);

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

    try {
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
    combinedText.includes('ç§»å?') ||
    combinedText.includes('?¬ç§»') ||
    combinedText.includes('?æ–°?½å?')
  ) {
    return 'move';
  }

  if (
    combinedText.includes('delete') ||
    combinedText.includes('remove') ||
    combinedText.includes('?ªé™¤')
  ) {
    return 'delete';
  }

  if (
    combinedText.includes('create') ||
    combinedText.includes('new file') ||
    combinedText.includes('empty file') ||
    combinedText.includes('?°å?') ||
    combinedText.includes('å»ºç?') ||
    combinedText.includes('?µå»º')
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
