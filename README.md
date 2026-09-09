# 脆文雷達客戶前台

貓咪小卡是免費入口與小範圍引流測試；小卡完成後導向脆文雷達，先用 Free 完成自己的文案抓取與分析，再申請 PRO 早鳥內測。收費方案、會員到期與付款 Webhook 的執行流程記錄在主專案 `docs/PAID_LAUNCH_PLAN.md`。

這個 Repository 是脆文雷達的公開客戶前台，透過 GitHub Pages 提供：

- 產品介紹與方案說明
- 客戶主控台入口
- 隱私政策

Threads 文案、留言、分析、監控規則與回覆紀錄保存在使用者自己的 Chrome，不會儲存在這個 Repository。會員身分、方案與必要用量由獨立的 GAS 營運後台處理。

## 頁面

- `index.html`：產品首頁
- `dashboard.html`：客戶主控台
- `privacy.html`：隱私政策

## 部署

GitHub Pages 請使用 `main` 分支根目錄部署。綁定自有網域後，需同步更新 Chrome 擴充功能的 `externally_connectable` 與主控台可信來源。
