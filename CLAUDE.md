# 项目规范

## 文件输出规范

所有生成的文件必须保存到 `data/` 文件夹，按以下分类：

### 文件夹分类

- **data/output/logs/** - 应用日志文件（.log）
  - todo_scheduler.log
  - server.log 等

- **data/output/images/** - 处理后的图片文件（.jpg, .png, .gif）
  - 按日期或ID分类

- **data/output/text/** - 生成的文本文件（.txt, .json, .csv）
  - 搜索结果
  - 分析数据
  - 导出报告

- **data/output/reports/** - 格式化的分析报告（.md, .json）
  - AI 推荐
  - 数据分析

- **data/temp/** - 临时处理文件（自动清理）

- **data/cache/** - 缓存数据

### 禁止项目

❌ 不应该出现在项目根目录的文件：
- .txt 文件
- 临时数据文件
- 任何生成的输出文件

✅ 项目根目录只应该包含：
- 源代码 (.js, .py)
- 配置文件 (.json, .env)
- 文档 (.md)
- 依赖管理 (package.json, requirements.txt)

## 代码修改清单

需要更新的文件：
- [x] paths.js - 已配置输出路径到 data/output/
- [x] todo_scheduler.js - 已使用 data/output/logs/
- [x] server.js - 需要更新日志输出到 data/output/logs/
- [x] image_processor.js - 需要输出到 data/output/images/
- [x] todo_service.js - 需要输出到 data/output/text/

## 根目录清理

需要移动的文件：
- infor.txt → data/output/text/
- infor2.txt → data/output/text/
- redis1.txt → data/output/text/
- logs/ → data/output/logs/
