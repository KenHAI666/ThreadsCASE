# Threads 文案雷達：GAS + clasp + GitHub 工作流程

目標：把目前 Google Apps Script 後台正式納入 `KenHAI666/ThreadsCASE` 版本控制，之後以 GitHub 為程式碼來源，再用 clasp 同步到 Apps Script。

## Threads Radar V1.1.4 用量同步契約

正式抓取用量的來源檔是 `release/v1.0.0/operator-backend/Backend.gs`，不是根目錄舊版 `gas/Code.gs`。新版路線固定為：

```text
Chrome 擴充功能抓取並整理文章
        ↓
送出 batch_id + usage_event_id + 文章唯一識別 Hash
        ↓
GAS 驗證會員、格式、批次重試與 USAGE_POST_KEYS 去重
        ↓
GAS 寫入 USAGE_POST_KEYS／USAGE_EVENTS／USAGE_MONTHLY／USAGE_LIFETIME
        ↓
GAS 成功寫入後回傳最新 license.usage 與本批次 new_count／duplicate_count
        ↓
Chrome 擴充功能保存確認結果，GitHub 前台透過 bridge 顯示 GAS 回傳值
```

新版契約名稱為 `scan_unique_v3`，舊版待同步事件仍以 `scan_unique_v2` 相容處理。V1.1.4 不更動既有 Threads DOM 抓取、IndexedDB 保存、匯出與冒險者核心功能；只新增後台批次用量驗證與確認結果同步。

正式 Apps Script 專案位置：`release/v1.0.0/operator-backend/`。該目錄的 `.clasp.json` 指向正式 Script ID，部署前必須先確認 `clasp pull`／`git diff`，再執行 `clasp push`。

## 重要安全規則

1. **第一次只能 Pull，不能先 Push。**
2. `clasp push` 會用本機專案內容取代線上 Apps Script 專案，因此必須先把線上現有 GAS 全部拉回本機並確認完整。
3. `.clasp.json` 與 `~/.clasprc.json` 不提交 GitHub。
4. 不使用 `clasp pull --deleteUnusedFiles`，避免誤刪本機尚未上線的 V2 檔案。
5. Portaly 正式金流尚未啟用前，不把 test callback 寫成正式 PRO entitlement。

## 目前 Repository 結構

```text
ThreadsCASE/
├─ gas/
│  └─ RadarBackendV2.gs
├─ .clasp.json.example
├─ package.json
└─ docs/GAS_CLASP_WORKFLOW.md
```

第一次 `clasp pull` 後，`gas/` 內應再出現線上既有 Apps Script 檔案以及實際的 `appsscript.json`。

## 一次性設定

### 1. 確認 Node.js

clasp 3.4.1 需要 Node.js 22 以上。

```bash
node -v
```

### 2. 下載依賴

在 Repository 根目錄：

```bash
npm install
```

### 3. 開啟 Apps Script API

到 Google Apps Script 使用者設定開啟 Apps Script API：

`https://script.google.com/home/usersettings`

### 4. 建立本機 `.clasp.json`

```bash
cp .clasp.json.example .clasp.json
```

將 `.clasp.json` 的 `scriptId` 改成目前「Threads 文案雷達－營運會員資料庫」Apps Script 專案的 Script ID。

格式：

```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "gas"
}
```

`.clasp.json` 已加入 `.gitignore`，不要提交。

### 5. Google 登入

```bash
npm run gas:login
```

瀏覽器完成 Google 授權後，clasp 會把 OAuth 憑證存在本機使用者目錄；不要把該憑證提交 GitHub。

## 第一次同步：現有 GAS → GitHub

### 1. 先保留目前 Git 狀態

```bash
git status
git pull
```

### 2. 從線上 Apps Script 拉回完整專案

```bash
npm run gas:pull
```

不要加 `--deleteUnusedFiles`。

這會把線上 Apps Script 的既有 `.gs` / `.html` / `appsscript.json` 寫入 `gas/`。目前尚未在線上的 `gas/RadarBackendV2.gs` 應保留在本機。

### 3. 檢查差異

```bash
git status
git diff
npm run gas:status
```

確認至少包含：

- 線上現有 GAS 原始碼
- `gas/appsscript.json`
- `gas/RadarBackendV2.gs`

**這一步先不要 push 到 Apps Script。**

### 4. 先提交 GitHub 備份

```bash
git add gas package.json package-lock.json .gitignore .clasp.json.example docs/GAS_CLASP_WORKFLOW.md
git commit -m "chore: import existing GAS project via clasp"
git push origin main
```

到這一步，現有 GAS 才算正式納入 GitHub 版本控制。

## 日常開發流程

開始修改前：

```bash
git pull
npm run gas:pull
git status
```

修改完成後：

```bash
npm run gas:status
git diff
```

確認內容正確後：

```bash
git add gas
git commit -m "feat: update GAS backend"
git push origin main
```

最後才同步 Apps Script：

```bash
npm run gas:push
```

## 建議的安全發布順序

```text
Google Apps Script 線上版
        ↓ clasp pull
本機 gas/
        ↓ review / merge
Git commit
        ↓
GitHub main
        ↓ clasp push
Google Apps Script HEAD
        ↓ 手動測試
Web App 新版本 / 更新 deployment
```

不要把 `git push` 與 `clasp push` 視為同一件事：

- `git push`：送程式碼到 GitHub。
- `clasp push`：覆寫 Apps Script 專案 HEAD。
- Web App deployment：仍是另一個發布步驟。

## V2 合併原則

目前 `gas/RadarBackendV2.gs` 已包含：

- `PRO > VIP > FREE` 有效方案判定
- VIP 人工授權 / 撤銷
- ENTITLEMENTS
- USAGE_EVENTS 去重與用量帳本
- USAGE_MONTHLY / USAGE_LIFETIME 重建
- AUDIT_LOG
- LockService
- Portaly PRO 預留入口
- Portaly test/live 防呆

第一次 Pull 完成後，先確認現有 GAS 的 `doGet(e)` / `doPost(e)` 路由，再逐步把舊方案判定改呼叫 V2 函式。不要直接另外新增第二組 `doGet` / `doPost`。

## Portaly 上線前

目前後台應維持：

```text
portaly_enabled = FALSE
portaly_mode = test
allow_test_entitlement_write = FALSE
```

等 GAS V2 跑穩，再接：

```text
Portaly Checkout
→ Signed Callback Gateway
→ HMAC 驗證
→ GAS
→ PAYMENT_EVENTS
→ ENTITLEMENTS(PRO)
```

正式切換前才將 Portaly 改為 live。

## 常用指令

```bash
npm run gas:login
npm run gas:pull
npm run gas:status
npm run gas:push
npm run gas:open
npm run gas:deployments
```

若要除錯 clasp：

```bash
DEBUG=clasp:* npm run gas:pull
```
