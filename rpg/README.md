# Threads RPG 小卡服務

這個目錄提供貓咪小卡的展示、下載與分享頁面。Threads 會阻擋雲端爬蟲，因此正式產品不再讓 Render 直接輸入帳號抓取；自己的文案由 Chrome 擴充功能在使用者瀏覽器內讀取。

## 網頁 MVP

Render 目前提供可直接操作的示範頁：

```bash
cd rpg
npm run web
```

瀏覽器開啟 `http://127.0.0.1:8787/` 可查看示範資料、貓咪職業卡、下載與分享介面。要產生自己的卡，請前往脆文雷達前台，讓擴充功能讀取 Chrome 本機文案；Render 的 `/api/analyze` 目前刻意停用，避免再次觸發雲端 IP 封鎖。

`server.js` 是可部署的 Node HTTP 服務：`PORT` 與 `HOST` 可由環境變數指定，`/api/health` 提供健康檢查。前端是 `index.html`，使用六種貓咪職業素材呈現示範卡；後續 Render 可承接圖片產生、分享檔案或會員服務，不直接代抓 Threads。

## 免費上線方式

專案根目錄的 `render.yaml` 已準備好 Render Free 設定。建立 Render Web Service 時連接這個 GitHub repository，選擇 Blueprint 部署即可。服務會使用 `rpg/` 作為 root directory，啟動 `npm run web`，並由 Render 注入 `PORT`。

目前服務保留同時工作數與速率限制設定，作為未來圖片／會員服務的基礎；公開 Threads 抓取開關 `RPG_PUBLIC_ANALYZE_ENABLED` 預設為 `false`。

## 產品流程

1. 使用者在 Chrome 登入 Threads
2. 脆文雷達擴充功能抓取自己的文案並保存於 Chrome 本機
3. 前台從擴充功能 bridge 讀取本機資料
4. 計算五維能力、RPG 職業、LV 與戰鬥力
5. 產生 K叔貓角色分享卡（1080×1350 PNG）
6. 使用者下載小卡或分享至 Threads

## V0 驗收標準

第一階段改驗證擴充功能到小卡的資料流：

- 在 Chrome 取得自己的 Threads 文案
- 由本機分析器輸出標準 JSON
- 前台能讀取本機資料並顯示貓咪小卡
- 下載與分享不把原文送到 Render
- Render 健康檢查正常，公開抓取端點保持停用

## V1 分析維度

- ⚔ 攻擊：平均／中位互動效率
- 💬 魅力：留言與討論能力
- ⚡ 敏捷：發文頻率與活躍天數
- 🛡 穩定：貼文表現一致性
- 🍀 爆擊：高於自身 baseline 的高表現貼文

## 職業

- 戰士：高頻輸出型
- 吟遊詩人：討論互動型
- 刺客：爆擊型
- 騎士：穩定經營型
- 法師：內容實力型（文字分析成熟後啟用）
- 村民：有效樣本不足

職業描述經營方式，不代表排名；戰鬥力描述近期綜合表現。

## 技術原則

- 由 Chrome 擴充功能讀取使用者自己的 Threads 頁面
- 不把 Threads Cookie 或原文送到 Render
- Render 不直接抓取 Threads 公開帳號
- 抓取器與評分引擎分離，避免 Threads 頁面改版影響整個產品
- 先嘗試輕量 HTTP/HTML/hydration 解析；必要時才使用 headless browser
- 同帳號結果應做 cache，避免重複抓取
- 不偽造缺失的互動數據

## 建議模組

```text
rpg/
├── README.md
├── public/             # K叔貓職業素材
├── src/
│   ├── fetcher/        # Threads 公開資料取得
│   ├── normalizer/     # 統一資料格式
│   ├── scoring/        # 五維、戰鬥力、職業
│   └── share-card/     # 分享圖產生
└── tests/
```

現有 ThreadsCASE 主站先保持不動；PoC 在獨立 branch / 目錄開發，確認可行後再決定整合與部署方式。
