# 脆文雷達 V1 最小上線手冊

更新日期：2026-09-12

## 這一版要完成什麼

V1 只驗證一條可運作的核心路徑：

```text
Threads（使用者已登入的 Chrome）
  → Chrome 擴充功能滾動讀取自己的文章
  → IndexedDB 本機保存與分析
  → GitHub Pages 主控台讀取 extension bridge
  → 產生貓咪小卡
  → PNG 下載／手機系統分享／Threads 發文入口
```

金流、Portaly Webhook、VIP／PRO 正式授權列為第 2 步；V1 不顯示付款按鈕，也不讓 Render 代抓 Threads。

## 服務分工

| 元件 | V1 角色 | 上線判定 |
|---|---|---|
| GitHub Pages | 正式首頁、主控台、貓咪小卡、隱私頁 | 使用者唯一入口 |
| Chrome 擴充功能 1.0.5 | Threads 滾動抓取、去重、分析、本機資料庫、冒險者轉職與卡面分級 | 必須在已登入 Threads 的 Chrome 測試 |
| GAS | Google 會員識別、方案讀取、用量紀錄預留 | 不接收 Threads 原文 |
| Render Node | 示範卡面、素材、`/api/health` | 公開抓取端點維持停用 |
| Portaly | V2 才開啟 | V1 不接入 |

GAS 或 Render 不能直接讀取 Chrome 的 IndexedDB；「連接擴充功能」是由 GitHub Pages 的網頁透過 extension bridge 讀本機資料。

## 使用者測試步驟

1. 開啟 [脆文雷達首頁](https://radar.runing9to5.com/)。
2. 下載並解壓 `dist/threads-radar-extension-v1.0.5-test.zip`，在 `chrome://extensions` 開啟開發人員模式後載入。
3. 在 Threads 登入自己的帳號，從擴充功能選「我的帳號」並執行抓取。未登入 Google 的本機模式先測 30 篇；登入 Google 後再測 100 篇，並確認累積上限 500 篇。
4. 回到 [客戶主控台](https://radar.runing9to5.com/dashboard.html)，按重新整理，確認文案數與最近一次抓取紀錄。
5. 開啟「貓咪小卡」，確認職業、LV、戰鬥力與五維資料，測試下載 PNG、手機系統分享，以及 Threads 發文入口。
6. 在 Chrome 開發者工具確認流程沒有把原始文案送到 Render 或 GAS。

## 上線驗收

### GitHub Pages

- 首頁顯示「當一個帶著任務的勇者，讓貓咪幫你抓文案」。
- 首頁不提供公開帳號輸入框。
- 主控台與貓咪小卡都能載入 `BRIDGE_SNAPSHOT`。
- 沒有擴充功能時顯示本機模式提示，不把錯誤誤報成伺服器故障。

### Chrome 擴充功能

- manifest 版本為 1.0.5。
- 只抓使用者自己的 Threads 文章；抓取動作會實際滾動頁面。
- 文章、分析、規則與小卡資料留在 IndexedDB。
- V1 不開放關鍵字探索、特定帳號探索、自動回覆或雲端代抓。

### GAS

- `/exec` 健康回應為 `Threads Radar Member API`。
- 只保存 Email、方案、狀態、到期日、擴充版本與必要用量。
- 手動 VIP／PRO 操作只在營運後台使用，不放在客戶首頁。

### Render

- `GET /api/health` 回傳 `publicAnalyzeEnabled: false`。
- `GET /api/analyze` 必須回傳 `public_scrape_disabled`。
- 首頁應是「擴充功能小卡示範」，不能再出現「輸入公開 Threads 帳號」。

## 目前部署讀回

- GitHub Pages：新版首頁、主控台與小卡已回傳 HTTP 200。
- Render：健康檢查已回傳 HTTP 200 且公開抓取停用；首頁仍讀到舊版公開帳號畫面，需在 Render Dashboard 手動部署目前 `main`（或 `deploy/threads-adventurer`）最新 commit 後再驗收。
- GAS：會員 API 版本維持獨立部署；冒險者狀態與文案仍保存在 Chrome，不由 GAS 讀取。

Render 現在不列入使用者主流程；在首頁與主控台測試通過前，不把 Render 網址當成正式入口。

## 第 2 步：金流接法

V1 穩定後再接 Portaly：

```text
Portaly Checkout
  → Portaly 簽章 Webhook
  → Render webhook adapter（驗證原始 body、timestamp、event_id）
  → GAS 會員 API（只寫入最小會員／方案事件）
  → 擴充功能重新驗證授權
```

正式開啟前需測試付款成功、重送事件、續期、取消、退款、到期回 Free，以及 GAS 手動 VIP／PRO 備援。V1 不先放付款按鈕，避免把未驗證的付款狀態當成授權。
