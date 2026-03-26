const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
require('dotenv').config();
const { PATHS, initializeDirectories } = require('./paths');

const SUPPORTED_FORMATS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const PROCESSOR_LOG = path.join(PATHS.LOGS, 'image_processor.log');

// Ensure logs directory exists
if (!fs.existsSync(PATHS.LOGS)) {
  fs.mkdirSync(PATHS.LOGS, { recursive: true });
}

function log(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  if (process.env.IMAGE_PROCESSOR_LOG_ENABLED !== 'false') {
    console.log(logLine.replace(/\n$/, ''));
  }
  try {
    fs.appendFileSync(PROCESSOR_LOG, logLine, 'utf8');
  } catch (err) {
    console.warn('Failed to write processor log:', err.message);
  }
}

class ImageProcessor {
  constructor() {
    this.inputFolder = process.env.IMAGE_INPUT_FOLDER || path.join(PATHS.IMAGES_OUTPUT, 'input');
    this.outputFolder = process.env.IMAGE_OUTPUT_FOLDER || path.join(PATHS.IMAGES_OUTPUT, 'processed');
    this.apiUrl = process.env.IMAGE_AI_API_URL || 'https://ai3.aischool.edu.pl/v1/chat/completions';
    this.model = process.env.IMAGE_AI_MODEL || 'Qwen2-VL-2B-Instruct';
    this.intervalMs = parseInt(process.env.IMAGE_PROCESSOR_INTERVAL_MS) || 60000;
    this.timer = null;
    this.isRunning = false;
    this.processingSet = new Set(); // Track images being processed
  }

  /**
   * Start the image processor
   */
  start() {
    if (this.timer) {
      log('[ImageProcessor] Already running');
      return;
    }

    // Initialize output directories
    initializeDirectories();

    // Ensure directories exist
    this.ensureDirectories();

    log('[ImageProcessor] Starting...');
    log(`[ImageProcessor] Input folder: ${this.inputFolder}`);
    log(`[ImageProcessor] Output folder: ${this.outputFolder}`);
    log(`[ImageProcessor] Interval: ${this.intervalMs}ms`);
    this.isRunning = true;

    // Run immediately on start
    this.processImages();

    // Then run on interval
    this.timer = setInterval(() => {
      this.processImages();
    }, this.intervalMs);
  }

  /**
   * Stop the image processor
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.isRunning = false;
      log('[ImageProcessor] Stopped');
    }
  }

  /**
   * Ensure input and output directories exist
   */
  ensureDirectories() {
    const inputPath = path.join(process.cwd(), this.inputFolder);
    const outputPath = path.join(process.cwd(), this.outputFolder);

    if (!fs.existsSync(inputPath)) {
      fs.mkdirSync(inputPath, { recursive: true });
      log(`[ImageProcessor] Created input folder: ${inputPath}`);
    }

    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
      log(`[ImageProcessor] Created output folder: ${outputPath}`);
    }
  }

  /**
   * Main processing loop
   */
  async processImages() {
    if (!this.isRunning) return;

    const inputPath = path.join(process.cwd(), this.inputFolder);

    try {
      if (!fs.existsSync(inputPath)) {
        log(`[ImageProcessor] Input folder not found: ${inputPath}`);
        return;
      }

      const files = fs.readdirSync(inputPath);
      const imageFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return SUPPORTED_FORMATS.includes(ext);
      });

      if (imageFiles.length === 0) {
        log('[ImageProcessor] No image files to process');
        return;
      }

      log(`[ImageProcessor] Found ${imageFiles.length} image(s) to process`);

      for (const imageFile of imageFiles) {
        // Skip if already being processed
        if (this.processingSet.has(imageFile)) {
          log(`[ImageProcessor] Image ${imageFile} already being processed, skipping`);
          continue;
        }

        this.processingSet.add(imageFile);

        try {
          await this.processImage(imageFile);
        } catch (err) {
          log(`[ImageProcessor] Error processing ${imageFile}: ${err.message}`);
        } finally {
          this.processingSet.delete(imageFile);
        }
      }
    } catch (err) {
      log(`[ImageProcessor] Error in processImages: ${err.message}`);
    }
  }

  /**
   * Compress image to fit within max dimensions
   * Maintains aspect ratio
   */
  async compressImage(imageBuffer, maxDimension = 1000) {
    try {
      const metadata = await sharp(imageBuffer).metadata();
      const { width, height } = metadata;

      log(`[ImageProcessor] Original dimensions: ${width}x${height}`);

      // Check if resizing is needed
      if (width <= maxDimension && height <= maxDimension) {
        log(`[ImageProcessor] Image already within limits (${maxDimension}px)`);
        return imageBuffer;
      }

      // Calculate new dimensions maintaining aspect ratio
      let newWidth = width;
      let newHeight = height;

      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        newWidth = Math.round(width * ratio);
        newHeight = Math.round(height * ratio);
      }

      log(`[ImageProcessor] Resizing to: ${newWidth}x${newHeight}`);

      // Resize and convert to JPEG for consistency
      const compressedBuffer = await sharp(imageBuffer)
        .resize(newWidth, newHeight, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();

      log(`[ImageProcessor] Compression complete. Size reduced: ${imageBuffer.length} → ${compressedBuffer.length} bytes`);

      return compressedBuffer;
    } catch (err) {
      log(`[ImageProcessor] Compression failed: ${err.message}. Using original image.`);
      return imageBuffer;
    }
  }

  /**
   * Process a single image
   */
  async processImage(imageFile) {
    const inputPath = path.join(process.cwd(), this.inputFolder);
    const imagePath = path.join(inputPath, imageFile);
    const imageFileName = path.parse(imageFile).name;

    log(`[ImageProcessor] Processing image: ${imageFile}`);

    try {
      // Read image file
      let imageBuffer = fs.readFileSync(imagePath);

      // Compress image to max 1000px width/height
      log(`[ImageProcessor] Compressing image to max 1000px...`);
      imageBuffer = await this.compressImage(imageBuffer, 1000);

      const base64Image = imageBuffer.toString('base64');

      // Analyze image with AI
      log(`[ImageProcessor] Sending ${imageFile} to AI model for analysis...`);
      const analysisResult = await this.analyzeImageWithAI(base64Image, imageFile);

      // Check if analysis was successful (no error message)
      const isError = analysisResult.startsWith('Error');

      if (isError) {
        // Failed analysis - save error log in input folder for retry
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('Z')[0];
        const errorFileName = `${timestamp}_${imageFileName}_error.txt`;
        const errorPath = path.join(process.cwd(), this.inputFolder, errorFileName);

        fs.writeFileSync(errorPath, analysisResult, 'utf8');
        log(`[ImageProcessor] Error log saved: ${errorFileName}`);
        log(`[ImageProcessor] Image ${imageFile} kept in ${this.inputFolder} for retry`);
        log(`[ImageProcessor] Error reason: ${analysisResult}`);

        return {
          success: false,
          imageFile,
          errorFile: errorFileName,
          timestamp: new Date().toISOString(),
          reason: analysisResult
        };
      }

      // Success - create folder with image name and save both image and analysis
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('Z')[0];
      const imageFolderName = imageFileName;
      const imageFolderPath = path.join(process.cwd(), this.outputFolder, imageFolderName);

      // Create folder for this image
      if (!fs.existsSync(imageFolderPath)) {
        fs.mkdirSync(imageFolderPath, { recursive: true });
        log(`[ImageProcessor] Created folder: ${this.outputFolder}/${imageFolderName}`);
      }

      // Save analysis result to the image folder
      const outputFileName = `${timestamp}_${imageFileName}.txt`;
      const outputPath = path.join(imageFolderPath, outputFileName);
      fs.writeFileSync(outputPath, analysisResult, 'utf8');
      log(`[ImageProcessor] Analysis saved to: ${imageFolderName}/${outputFileName}`);

      // Move processed image to the image folder
      const movedImagePath = path.join(imageFolderPath, imageFile);
      fs.renameSync(imagePath, movedImagePath);
      log(`[ImageProcessor] Image moved to: ${this.outputFolder}/${imageFolderName}/${imageFile}`);

      return {
        success: true,
        imageFile,
        folder: imageFolderName,
        outputFile: outputFileName,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      log(`[ImageProcessor] Failed to process ${imageFile}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Analyze image using AI vision model
   */
  async analyzeImageWithAI(base64Image, imageFileName) {
    try {
      const dataUrl = `data:image/jpeg;base64,${base64Image}`;
      const prompt = '請詳細分析這張圖片的內容。包括：1. 主要主題 2. 包含的文字或信息 3. 重要細節 4. 整體感觀描述';

      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: prompt
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: dataUrl
                  }
                }
              ]
            }
          ],
          max_tokens: 300,
          temperature: 0.7
        },
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data && response.data.choices && response.data.choices.length > 0) {
        const messageContent = response.data.choices[0].message?.content || '';
        const analysisText = typeof messageContent === 'string'
          ? messageContent
          : (Array.isArray(messageContent)
              ? messageContent.map(block => block.text || '').join('\n')
              : String(messageContent));

        return this.formatAnalysisResult(imageFileName, analysisText);
      }

      return `Error: No response from AI model for ${imageFileName}`;
    } catch (err) {
      // Capture detailed error information
      let errorDetails = err.message;

      if (err.response) {
        // API returned an error response
        const status = err.response.status;
        const data = err.response.data;

        log(`[ImageProcessor] API Error Status: ${status}`);

        // Try to extract detailed error message from response
        if (typeof data === 'string') {
          errorDetails = `HTTP ${status}: ${data}`;
        } else if (data && typeof data === 'object') {
          if (data.error) {
            errorDetails = `HTTP ${status}: ${JSON.stringify(data.error)}`;
          } else if (data.message) {
            errorDetails = `HTTP ${status}: ${data.message}`;
          } else if (data.detail) {
            errorDetails = `HTTP ${status}: ${data.detail}`;
          } else {
            errorDetails = `HTTP ${status}: ${JSON.stringify(data, null, 2)}`;
          }
        } else {
          errorDetails = `HTTP ${status}: ${String(data)}`;
        }

        log(`[ImageProcessor] Detailed error for ${imageFileName}: ${errorDetails}`);
      } else if (err.request) {
        // Request made but no response received
        errorDetails = `No response from server: ${err.message}`;
        log(`[ImageProcessor] Network error for ${imageFileName}: ${errorDetails}`);
      } else {
        // Error in setting up the request
        log(`[ImageProcessor] Request setup error for ${imageFileName}: ${err.message}`);
      }

      return `Error analyzing image: ${errorDetails}`;
    }
  }

  /**
   * Format the analysis result
   */
  formatAnalysisResult(imageFileName, analysisText) {
    const timestamp = new Date().toISOString();
    const lines = [
      `圖片名稱: ${imageFileName}`,
      `分析時間: ${timestamp}`,
      `模型: ${this.model}`,
      '',
      '=== 圖片內容分析 ===',
      '',
      analysisText,
      '',
      '=== 分析完成 ===',
      `生成時間: ${timestamp}`
    ];

    return lines.join('\n');
  }

  /**
   * Get processor status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      inputFolder: this.inputFolder,
      outputFolder: this.outputFolder,
      intervalMs: this.intervalMs,
      processingCount: this.processingSet.size,
      model: this.model,
      apiUrl: this.apiUrl
    };
  }
}

// Export singleton instance
const processor = new ImageProcessor();

module.exports = {
  processor,
  ImageProcessor
};
