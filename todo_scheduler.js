// Todo List Scheduler - Checks pending tasks every 1 minutes
const todoService = require('./todo_service');
const { analyzeTask, verifyTaskCompletion } = require('./todo_analyzer');
const fs = require('fs');
const path = require('path');

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
    this.intervalMs = 10 * 60 * 1000; // 10 minutes
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

    try {
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
    combinedText.includes('移動') ||
    combinedText.includes('搬移') ||
    combinedText.includes('重新命名')
  ) {
    return 'move';
  }

  if (
    combinedText.includes('delete') ||
    combinedText.includes('remove') ||
    combinedText.includes('刪除')
  ) {
    return 'delete';
  }

  if (
    combinedText.includes('create') ||
    combinedText.includes('new file') ||
    combinedText.includes('empty file') ||
    combinedText.includes('新增') ||
    combinedText.includes('建立') ||
    combinedText.includes('創建')
  ) {
    return 'create';
  }

  return null;
}

// Export singleton instance
const scheduler = new TodoScheduler();

module.exports = {
  scheduler,
  TodoScheduler
};
