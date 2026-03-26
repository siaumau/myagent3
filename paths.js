/**
 * 統一文件輸出路徑配置
 * 所有生成的文件都通過此文件定義路徑，確保規範一致
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = __dirname;
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

// 定義所有輸出路徑
const PATHS = {
  // 日誌
  LOGS: path.join(DATA_DIR, 'output', 'logs'),

  // 圖片輸出
  IMAGES_OUTPUT: path.join(DATA_DIR, 'output', 'images'),

  // 文本輸出
  TEXT_OUTPUT: path.join(DATA_DIR, 'output', 'text'),

  // 報告輸出
  REPORTS: path.join(DATA_DIR, 'output', 'reports'),

  // 臨時文件
  TEMP: path.join(DATA_DIR, 'temp'),

  // 快取
  CACHE: path.join(DATA_DIR, 'cache')
};

/**
 * 確保目錄存在，不存在則建立
 * @param {string} dirPath - 目錄路徑
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 初始化所有必要的目錄
 */
function initializeDirectories() {
  Object.values(PATHS).forEach(dirPath => {
    ensureDir(dirPath);
  });
}

module.exports = {
  PATHS,
  ensureDir,
  initializeDirectories,
  PROJECT_ROOT,
  DATA_DIR
};
