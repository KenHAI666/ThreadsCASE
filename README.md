# 脆文雷達客戶前台

貓咪小卡是免費入口與小範圍引流測試；小卡完成後導向脆文雷達，透過 Chrome 擴充功能完成自己的文案抓取與分析，再申請 PRO 早鳥內測。雲端 Render 只提供卡面展示與未來服務，不直接爬取 Threads。收費方案、會員到期與付款 Webhook 的執行流程記錄在主專案 `docs/PAID_LAUNCH_PLAN.md`。

這個 Repository 是脆文雷達的公開客戶前台，透過 GitHub Pages 提供：

- 產品介紹與方案說明
- 客戶主控台入口
- 隱私政策

Threads 文案、留言、分析、監控規則與回覆紀錄保存在使用者自己的 Chrome，不會儲存在這個 Repository。會員身分、方案與必要用量由獨立的 GAS 營運後台處理。

## 頁面

- `index.html`：產品首頁，並直接嵌入貓咪小卡預覽與本機文案讀取入口
- `dashboard.html`：客戶主控台，內含「貓咪小卡」頁面（五維、完整卡面、職業介紹、下載與分享）
- `cat-card.html`：保留給舊連結使用的獨立小卡頁；主流程已整合到主控台
- `privacy.html`：隱私政策

## 部署

GitHub Pages 請使用 `main` 分支根目錄部署。綁定自有網域後，需同步更新 Chrome 擴充功能的 `externally_connectable` 與主控台可信來源。

貓咪小卡頁面會透過擴充功能 bridge 讀取本機 IndexedDB 的分析資料；它不會從公開伺服器重新抓取 Threads，也不會把原始文案送到這個 Repository。完整操作、分支與部署驗收見 [`docs/FINAL_RELEASE_RUNBOOK.md`](docs/FINAL_RELEASE_RUNBOOK.md)。
