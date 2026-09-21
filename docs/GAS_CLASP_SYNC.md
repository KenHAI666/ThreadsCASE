# GitHub → Google Apps Script 自動同步（clasp）

這個 Repo 已設定 GitHub Actions，讓 `main` 分支的 `gas/**` 發生變更時，自動執行：

```text
GitHub main
↓
gas/**
↓
GitHub Actions
↓
@google/clasp
↓
Apps Script 專案原始碼
```

目前只做 **程式碼同步（clasp push）**。

不會自動建立或更新正式 Web App deployment。正式部署之後可另外建立人工按鈕或受保護的 deploy workflow。

## 安全設計

`clasp push` 不是逐檔 patch，而是會把 Apps Script 專案內容以本地專案整包同步。

因此 workflow 在 push 前會：

1. 登入 clasp。
2. Clone 線上的 Apps Script 到暫存目錄。
3. 比較「線上檔名」與 GitHub `gas/` 檔名。
4. 如果線上有 GitHub 沒有的檔案，直接失敗。
5. 只有確認不會誤刪遠端檔案才執行 `clasp push --force`。

## 0. 先開啟 Google Apps Script API

clasp 使用 Apps Script API 同步專案。請用管理這個 GAS 專案的 Google 帳號開啟：

https://script.google.com/home/usersettings

確認：

```text
Google Apps Script API
→ ON
```

官方 clasp 安裝說明也要求先開啟 Apps Script API。

## 需要設定的 GitHub Secrets

到：

```text
GitHub
→ ThreadsCASE
→ Settings
→ Secrets and variables
→ Actions
→ New repository secret
```

建立兩個 Secret。

### 1. GAS_SCRIPT_ID

這不是 Web App 的 `AKfy...` deployment ID。

請到：

```text
Apps Script
→ Project Settings（專案設定）
→ IDs
→ Script ID
```

把 Script ID 完整貼到：

```text
GAS_SCRIPT_ID
```

### 2. CLASP_AUTH_JSON

這是 clasp 存取 Apps Script 的 Google OAuth 憑證。

在自己的 Mac Terminal 執行：

```bash
cd ThreadsCASE
npm ci
npx clasp login
```

如果 localhost callback 不方便：

```bash
npx clasp login --no-localhost
```

登入「擁有／可編輯該 Apps Script」的 Google 帳號。

成功後 clasp 會把登入資料放在：

```text
~/.clasprc.json
```

Mac 可執行：

```bash
cat ~/.clasprc.json | pbcopy
```

然後在 GitHub 新增：

```text
Name:
CLASP_AUTH_JSON

Secret:
貼上整份 ~/.clasprc.json
```

不要把 `.clasprc.json` commit 到 GitHub。

## 第一次啟用

兩個 Secrets 都建立後：

```text
GitHub
→ Actions
→ Sync GAS to Apps Script
→ Run workflow
```

第一次建議手動執行。

如果 workflow 顯示：

```text
Remote Apps Script contains files that are not tracked in gas/
```

表示 Apps Script 線上還有 GitHub 沒有保存的程式檔。

此時 **不要強制 Push**。

先把那些檔案補進 `gas/`，再執行一次。

## 自動同步

第一次手動 workflow 成功後，之後：

```text
修改 gas/Code.js
修改 gas/RadarBackendV2.js
修改 gas/Admin.html
修改 gas/appsscript.json
↓
commit / merge 到 main
↓
自動執行 clasp push
```

修改前台：

```text
dashboard.html
index.html
cat-card.html
```

不會觸發 GAS Sync。

## 本機指令

Repo 已有：

```bash
npm run gas:login
npm run gas:pull
npm run gas:status
npm run gas:push
npm run gas:open
npm run gas:deployments
```

本機使用時先建立：

```.clasp.json
{
  "scriptId": "你的 Script ID",
  "rootDir": "gas"
}
```

Repo 已有 `.clasp.json.example` 可參考。

## 目前版本

Workflow 使用：

```text
Node.js 22
@google/clasp 3.4.1
```

## 正式部署

目前 GitHub Actions：

```text
會做：
clasp push

不會做：
create-deployment
redeploy production Web App
```

原因是程式碼同步與正式發布應分開。

下一階段可新增：

```text
GitHub Actions
→ Deploy GAS Production
→ 手動 Run workflow
→ 指定既有 Deployment ID
→ 建立新 Version
→ redeploy 同一條 Web App URL
```

這樣可以做到：

```text
平常 commit
→ 自動同步 Apps Script 原始碼

確認測試 OK
→ 按一次 Deploy
→ 正式 Web App 更新
```
