# Threads RPG PoC

這個目錄用來開發「Threads 冒險者」公開網頁工具。

## 產品流程

1. 使用者輸入公開 Threads 帳號（例如 `@runing_9to5`）
2. 後端讀取該帳號的公開頁面
3. 正規化最近 30 篇有效貼文資料
4. 計算五維能力與專業指標
5. 判定 RPG 職業、LV、戰鬥力
6. 顯示分析結果
7. 產生 K叔貓角色分享卡（1080×1350 PNG）

## V0 驗收標準

第一階段只驗證資料取得，不先做完整 UI：

- 輸入 `@runing_9to5`
- 取得公開 profile 基本資料
- 取得最近貼文的 timestamp / likes / replies / reposts（能取得多少先如實回傳）
- 將資料輸出為標準 JSON
- 明確標示抓取成功、資料不足或被 Threads 阻擋

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

- 不要求使用者登入 Threads
- 不依賴 Chrome Extension
- 只處理公開頁面與公開可見資料
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
