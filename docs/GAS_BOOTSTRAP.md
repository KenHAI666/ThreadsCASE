# 第一次 GAS Bootstrap

如果 `Sync GAS to Apps Script` 出現：

```text
Remote Apps Script contains files that are not tracked in gas/
```

不要關閉保護，也不要直接 `clasp push --force`。

請執行：

```text
GitHub
→ Actions
→ Bootstrap GAS from Apps Script
→ Run workflow
```

Bootstrap 會：

```text
線上 Apps Script
↓
clasp clone
↓
只找 GitHub gas/ 缺少的檔案
↓
把缺少檔案加入 gas/
↓
不覆寫 GitHub 已存在檔案
↓
JavaScript / manifest 檢查
↓
commit 到 main
↓
clasp push --force
↓
GitHub 與 Apps Script 完成第一次對齊
```

目前偵測到的遠端檔案包括：

```text
AdminServer.js
AppJs.html
Auth.js
ClientLogic.html
Config.js
Database.js
Index.html
Styles.html
Usage.js
UsageCore.js
```

Bootstrap 只需要成功執行一次。

之後正常流程就是：

```text
修改 GitHub gas/**
→ main
→ Sync GAS to Apps Script
→ 自動 clasp push
```

## 安全規則

Bootstrap 不會用遠端版本覆寫 GitHub 已存在的：

```text
Code.js
RadarBackendV2.js
Admin.html
appsscript.json
```

因此 GitHub 目前已修改的新版後台邏輯仍然保留。

如果發現同名衝突，workflow 會直接失敗，不會猜測哪個版本應該覆蓋。
