# 脆文雷達｜下載與匯出

## 已可使用

下載與匯出沿用 Local-first 設計。貼文、互動數字、分析與匯出連結 metadata 都先留在目前 Chrome；只有使用者按下匯出時，才會產生檔案或送往已完成設定的目的地。

- **CSV**：依現有貼文欄位輸出帳號、日期、完整文案、HOOK、Likes、Replies、Reposts、Quotes、Views、總互動、互動率、原文 URL 與抓取時間。欄位沒有值時保持空白，不自行補數字。
- **JSON**：輸出 `schema_version`、`exported_at`、`scope` 與 `posts`，可作為完整 AI 分析資料或備份來源。
- **複製**：只複製目前選取的文案文字，文章之間以分隔線區隔。
- **批次選取**：前台「我的帳號」與擴充功能文案庫都支援本頁全選、取消全選與批次匯出；匯出最多接受 500 個 UID。

匯出結果固定回傳 `successCount`、`duplicateCount`、`failedCount` 與 `errors`。貼文去重優先使用 `post_id`，沒有 ID 時才使用清理過的 `post_url`。

Google Sheets adapter 的連結流程會先用 OAuth 驗證目前帳號，再讀取指定 Spreadsheet 的 metadata，確認工作表存在。第一次寫入會帶 Header；後續只追加資料列，不會重複覆蓋或重建整份試算表。遠端既有資料不會被讀回去做去重，重複判斷只針對本次選取與本機保存資料。

## Google Sheets／Notion

兩個 adapter 已依現有貼文欄位建立，Notion adapter 也接受本機保存的 `mapping` 來對應使用者資料庫欄位。主控台的「下載與匯出」會顯示連結狀態；未完成連結時，使用者會看到可理解的錯誤，不會執行外送。

要正式啟用 Google Sheets，需由發布者另外完成：

1. Google Cloud 專案啟用 Google Sheets API。
2. OAuth Consent Screen、測試使用者與正式 Chrome Extension ID。
3. `manifest.json` 的 OAuth scope 包含 `userinfo.email` 與 `spreadsheets`；發布新版本後，使用者在設定頁輸入 Google Sheet 網址或 ID，工作表名稱可留白。
4. 測試連結、追加、撤銷授權、目標檔案權限不足與 401／403／404／429 錯誤回報。

要正式啟用 Notion，需另外完成：

1. Notion public integration 與 OAuth 設定，provider redirect URI 設為 `https://threads-adventurer.onrender.com/api/notion/oauth/callback`。
2. Render 服務設定 `NOTION_CLIENT_ID`、`NOTION_CLIENT_SECRET`、`NOTION_RETURN_URI=https://radar.runing9to5.com/notion-callback.html` 與 `NOTION_PROVIDER_REDIRECT_URI=https://threads-adventurer.onrender.com/api/notion/oauth/callback`。
3. 使用者在主控台填入 Database ID 後啟動 OAuth；交換後的 access token 只暫存在目前 Chrome 的 `storage.session`，client secret 不會進入 extension、GitHub Pages 或 GAS。
4. 將 Database 分享給 Notion connection，確認欄位名稱符合 Notion schema 後再建立 pages。Render 服務重啟會使本機 Notion 連結需要重新授權。

Google Sheets 與 Notion 都是額外的匯出目的地，不會取代 IndexedDB，也不會成為脆文雷達的主要資料庫。Google Sheets 可以直接使用；Notion 在 Render 補上環境變數前會明確回報尚未設定，不會假裝已連結。正式上架前仍要在 Chrome Web Store 隱私權實務規範說明新增的 `spreadsheets`、`api.notion.com` 與 Render OAuth 連線用途。

## 本機驗證

```bash
for file in background/*.js data/*.js dashboard/*.js utils/*.js utils/exporters/*.js; do node --check "$file" || exit 1; done
node --test tests/*.test.js
```

驗證順序：先在自己的 Threads 頁面抓取資料，再在「我的帳號」選取幾篇，測試複製、CSV、JSON，最後確認設定頁的 Sheets／Notion 未連結提示。不要把真實 token、client secret 或私有 Threads 原文放進測試檔或 commit。
