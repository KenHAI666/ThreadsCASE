# 脆文雷達最終可運行版本

## 使用者流程

1. 使用者在 Chrome 登入 Threads。
2. 安裝並開啟「脆文雷達」擴充功能。
3. 在擴充功能輸入自己的帳號，擴充功能開啟 Threads 個人頁面並實際滾動抓取。
4. 貼文、分析與小卡資料保存在這台 Chrome 的 IndexedDB。
5. 前台 `radar.runing9to5.com` 透過 extension bridge 讀取本機資料。
6. 貓咪小卡在前台產生，可下載 PNG、分享結果，原文不送到 Render。

## 服務分工

- GitHub Pages：產品首頁、內嵌貓咪小卡預覽、客戶主控台與隱私說明。
- Chrome Extension：Threads 頁面滾動抓取、去重、分析、匯出、人工候選流程與本機資料保存。
- Render：貓咪小卡示範頁、圖片產生／分享服務預留、`/api/health` 健康檢查。公開 Threads 抓取端點保持停用。
- GAS／會員後台：只處理 Google 身分、方案、用量與未來 Portaly 付款事件，不保存 Threads 原文。

## 目前網址

- 正式前台：<https://radar.runing9to5.com/>
- 客戶主控台：<https://radar.runing9to5.com/dashboard.html>
- Render 示範頁：<https://threads-adventurer.onrender.com/>
- GitHub 部署分支：<https://github.com/KenHAI666/ThreadsCASE/tree/deploy/threads-adventurer>

Render 示範頁不接受帳號爬取，只展示示範卡與下載／分享介面；自己的卡片請從正式前台按「讀取本機文案」。

## 分支整理

- `main`：GitHub Pages 正式來源，合併後才會更新正式前台。
- `deploy/threads-adventurer`：目前整合完成、可供 PR review 的部署分支。
- `feature/threads-pagination-30`：已合併的抓取研究分支，保留作歷史紀錄。
- 其他 `feature/*` 與 `pages-*`：歷史研究或頁面草稿，不作目前正式入口。

PR 合併前先在 `deploy/threads-adventurer` 測試；合併後確認 GitHub Pages 的部署工作流程成功，再做正式網址驗收。

## 擴充功能封裝

使用根目錄原始碼重新載入 Chrome 擴充功能，或使用 `dist/threads-radar-extension-v1.0.4-final.zip`。載入後請確認 manifest 的版本為 `1.0.4`，並在 `radar.runing9to5.com` 測試「抓取我的文案」與「讀取本機文案」。

V1 不提供雲端代抓、關鍵字探索、自動回覆、私訊或熱力圖；監控只產生人工候選，送出動作由使用者在 Threads 親自完成。
