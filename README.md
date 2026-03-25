# myagent3-demo

簡單示範：如何在一個線上聊天機器人中維持上下文（context）以及模擬 function-calling 的流程。

主要檔案
- `server.js`：Express 伺服器，提供 `/chat` 與 `/call_function`。
- `ai.js`：簡易 AI 模組，決定是否要回覆或要求執行 function，並在 function 回傳後繼續對話。
- `public/index.html` & `public/app.js`：前端聊天 UI，會顯示訊息並自動執行伺服器回傳的 function_call。
- `infor.txt`：提供範例資料（已存在於專案根目錄）。

執行方式

1. 安裝相依套件：

```powershell
cd c:\D\eric\myagent3
npm install
```

2. 啟動伺服器：

```powershell
npm start
```

3. 開啟瀏覽器：

 - 前往 `http://localhost:3000`

遠端驗證（將請求發送到 `https://ai2.aischool.edu.pl/v1/chat/completions`）

 - 若你要把訊息真的傳到遠端 API 進行驗證，請在啟動前設定環境變數：

```powershell
# 遠端 API URL（預設會嘗試從 infor.txt 讀取第一行 URL）
$env:REMOTE_API_URL = 'https://ai2.aischool.edu.pl/v1/chat/completions'

# API Key（如果該服務需要授權）
$env:API_KEY = '你的_api_key_如果需要的話'

npm start
```

 - 流程說明：當 `REMOTE_API_URL` 被設定，伺服器會把 `context`（由前端傳來的訊息陣列）加上最新的 user 訊息，並將該 payload POST 到遠端。若遠端回覆中包含 `function_call`，伺服器會將 `function_call` 與更新後的 `context` 回傳給前端，前端會呼叫 `/call_function` 讓伺服器實際執行（例如讀 `infor.txt` 或回傳時間），然後伺服器會把 function 執行結果再 POST 回遠端以取得最終 assistant 回覆。

注意事項
- 確保 `REMOTE_API_URL` 與 `API_KEY`（若需要）正確設定。遠端 API 的回傳格式預期為類似 `choices[0].message` 的格式，其中 `message` 可能含 `function_call` 欄位。

上下文持久化紀錄（可選）

 - 如果你想要把每次 `/chat` 與 `/call_function` 的上下文與 function 結果保留下來以便後續分析，可以啟用環境變數 `RECORD_CONTEXT=true`。
 - 啟用後，伺服器會把事件以 JSON Lines 格式追加到專案 `logs/contexts.jsonl`，每行包含時間戳、事件類型（`chat_request`、`chat_reply`、`function_executed`）以及相關資料（messages、reply、functionResult 等）。
 - 啟用範例（PowerShell）：

```powershell
$env:RECORD_CONTEXT = 'true'
npm start
```

 - 日誌檔案位置：`logs/contexts.jsonl`（每行是一個獨立的 JSON 物件）。

已實作的本地工具（對應 `infor.txt` 中列出的 `tools`）

- `get_weather`：模擬回傳指定城市的天氣（回傳 `weather` 物件）。可擴充為呼叫真實天氣 API。
- `get_time`：回傳目前系統時間（字串）。
- `translate_text`：簡單示範翻譯輸出（目前為 placeholder，回傳 `{ translated: '...' }`）。
- `write_file`：在伺服器上寫入檔案，支援寫入專案目錄或系統暫存目錄（path 必須在允許範圍內）。回傳 `ok` 與實際路徑。
- `append_file`：將內容追加到檔案，同樣受 path 安全檢查。
- `read_file`：讀取指定檔案並回傳內容。
- 為相容性保留一個 `read_infor`：方便在測試時搜尋 `infor.txt` 內容。

安全性提醒：寫入與讀取檔案的操作會做基本路徑檢查，僅允許在專案目錄或系統暫存目錄進行，以避免任意路徑存取風險。
使用說明
- 在輸入框輸入自然語句：
  - 輸入包含「現在時間」或「時間」會觸發 `get_time` 模擬函式並回傳時間。
  - 輸入包含「infor」/「資訊」/「查詢」/「天氣」等字眼會觸發 `read_infor`，伺服器會在 `infor.txt` 中搜尋相關行並回傳結果。

這個範例的重點是：如何把 `context` 物件來回傳遞、如何用一個 `function_call` 結構請求執行外部函式，並將函式結果再送回 AI 模組以完成對話。
