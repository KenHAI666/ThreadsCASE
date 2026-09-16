const ADMIN_EMAIL = "luciferhai666@gmail.com";
const OPERATOR_SPREADSHEET_ID = "1PMgVFKAtqempy2CZpMW5KEDP9n2kClARdZEzmLJUhw4";
const RELEASE_VERSION = "2.0.0";
const MEMBER_STATUS_OPTIONS = ["啟用", "停用", "active", "terminated"];

/**
 * Threads 文案雷達－GAS 營運入口 V2
 *
 * 重要原則：
 * 1. MEMBERS!方案只是相容鏡像，不再允許人工直接切 FREE/VIP/PRO。
 * 2. VIP 必須透過 ENTITLEMENTS 的 admin grant/revoke 管理。
 * 3. PRO 只預留 Portaly 驗證後事件寫入，目前不從此檔案直接開通。
 * 4. MEMBER_ACCESS 是目前有效方案的快取檢視；實際判定仍由 RadarBackendV2.gs 計算。
 * 5. 不再清空「統計」或重建成舊版格式。
 */

/**
 * 目前 Web App 仍只作營運狀態頁，不作公開會員 API。
 * appsscript.json 現在 access=MYSELF，因此只有部署者可開啟。
 */
function doGet() {
  const admin = requireSoleAdmin_();
  const database = SpreadsheetApp.openById(OPERATOR_SPREADSHEET_ID);
  const config = radarV2GetConfig();
  return json_({
    ok: true,
    service: "Threads Radar Spreadsheet Operator",
    version: RELEASE_VERSION,
    backend: "entitlement-v2",
    admin: admin,
    spreadsheet_url: database.getUrl(),
    portaly: {
      enabled: Boolean(config.portaly_enabled),
      mode: String(config.portaly_mode || "test"),
      pro_price_twd: Number(config.portaly_pro_price_twd || 150)
    },
    message: "V2 已啟用：VIP 由 ENTITLEMENTS 人工授權；PRO 預留 Portaly。"
  });
}

/**
 * 暫時拒絕公開 POST。
 * Portaly Callback 不應直接打到 GAS；之後由可讀 HTTP headers 的 gateway 驗證後再呼叫 V2 處理邏輯。
 */
function doPost() {
  requireSoleAdmin_();
  return json_({
    ok: false,
    error: "PUBLIC_POST_DISABLED",
    message: "目前 GAS 不接受公開 API 或未驗證 Portaly callback。"
  });
}

/**
 * 管理員：查看 V2 後台狀態。
 */
function adminV2Status() {
  const admin = requireSoleAdmin_();
  const database = SpreadsheetApp.openById(OPERATOR_SPREADSHEET_ID);
  const requiredSheets = [
    "MEMBERS",
    "ENTITLEMENTS",
    "PLAN_LIMITS",
    "USAGE_EVENTS",
    "USAGE_MONTHLY",
    "USAGE_LIFETIME",
    "PAYMENT_EVENTS",
    "AUDIT_LOG",
    "SYSTEM_CONFIG",
    "MEMBER_ACCESS",
    "統計"
  ];
  const missingSheets = requiredSheets.filter(name => !database.getSheetByName(name));
  const config = radarV2GetConfig();

  return {
    ok: missingSheets.length === 0,
    version: RELEASE_VERSION,
    admin: admin,
    spreadsheet_url: database.getUrl(),
    missingSheets: missingSheets,
    portaly: {
      enabled: Boolean(config.portaly_enabled),
      mode: String(config.portaly_mode || "test"),
      allowTestEntitlementWrite: Boolean(config.allow_test_entitlement_write),
      proPriceTwd: Number(config.portaly_pro_price_twd || 150)
    }
  };
}

/**
 * 管理員：依 Email 授權 VIP。
 * VIP 不經 Portaly。
 */
function adminGrantVip(email, reason) {
  const admin = requireSoleAdmin_();
  const normalizedEmail = normalizeEmail_(email);
  if (!normalizedEmail) throw new Error("EMAIL_REQUIRED");
  return radarV2GrantVipByEmail(normalizedEmail, reason || "管理員人工授權 VIP", admin);
}

/**
 * 管理員：撤銷人工 VIP。
 * 如果會員同時有 active PRO，撤銷 VIP 後仍會維持 PRO。
 */
function adminRevokeVip(email, reason) {
  const admin = requireSoleAdmin_();
  const normalizedEmail = normalizeEmail_(email);
  if (!normalizedEmail) throw new Error("EMAIL_REQUIRED");
  return radarV2RevokeVipByEmail(normalizedEmail, reason || "管理員人工撤銷 VIP", admin);
}

/** 管理員：查單一會員目前真正有效方案與額度。 */
function adminGetMemberAccess(memberIdOrEmail) {
  requireSoleAdmin_();
  const key = String(memberIdOrEmail || "").trim();
  if (!key) throw new Error("MEMBER_REQUIRED");
  return radarV2GetMemberAccess(key);
}

/** 管理員：重算全部 MEMBER_ACCESS 快取。 */
function adminRefreshMemberAccess() {
  requireSoleAdmin_();
  return radarV2RefreshMemberAccess();
}

/**
 * 管理員：從 USAGE_EVENTS 重建用量彙總。
 * memberId 留空時重建全部會員。
 */
function adminRebuildUsage(memberId) {
  requireSoleAdmin_();
  return radarV2RebuildUsageSummaries(memberId ? String(memberId).trim() : null);
}

/** 管理員：把 MEMBERS!方案 相容鏡像同步為目前有效方案。 */
function adminSyncLegacyPlans() {
  requireSoleAdmin_();
  return radarV2SyncAllLegacyPlans();
}

/**
 * 舊函式名稱保留，避免既有人工流程找不到；
 * V2 不再允許直接操作 MEMBERS!方案，只套用帳號狀態下拉與欄位提示。
 */
function applyMemberDropdownsOnly() {
  requireSoleAdmin_();
  const database = SpreadsheetApp.openById(OPERATOR_SPREADSHEET_ID);
  const sheet = database.getSheetByName("MEMBERS");
  if (!sheet) throw new Error("MEMBERS_SHEET_NOT_FOUND");
  ensureMemberValidation_(sheet);
  return {
    ok: true,
    spreadsheet_url: database.getUrl(),
    message: "V2：方案欄由 ENTITLEMENTS 自動同步；只保留帳號狀態人工操作。"
  };
}

/**
 * 舊函式名稱保留，但改成非破壞式 V2 維護。
 * 不刪表、不清空統計、不重建成舊 schema。
 */
function rebuildOperatorSpreadsheet() {
  requireSoleAdmin_();
  const status = adminV2Status();
  if (status.missingSheets.length) {
    throw new Error("V2_SHEETS_MISSING: " + status.missingSheets.join(","));
  }

  const database = SpreadsheetApp.openById(OPERATOR_SPREADSHEET_ID);
  ensureMemberValidation_(database.getSheetByName("MEMBERS"));

  // 依事件帳本重建彙總，再同步方案鏡像與 MEMBER_ACCESS。
  radarV2RebuildUsageSummaries();
  radarV2SyncAllLegacyPlans();
  radarV2RefreshMemberAccess();

  return {
    ok: true,
    version: RELEASE_VERSION,
    spreadsheet_url: database.getUrl(),
    mode: "non-destructive-v2-maintenance",
    message: "已依 USAGE_EVENTS 重建用量，並同步有效方案與 MEMBER_ACCESS；未清空任何 V2 表格。"
  };
}

function requireSoleAdmin_() {
  const email = String(
    Session.getEffectiveUser().getEmail() ||
    Session.getActiveUser().getEmail() ||
    ""
  ).trim().toLowerCase();

  if (email !== ADMIN_EMAIL) {
    throw new Error("只有唯一管理員可以操作試算表後台");
  }
  return email;
}

/**
 * V2 的 MEMBERS!方案 是唯讀相容鏡像。
 * 只讓「狀態」欄可以人工選擇，避免直接把方案改成 vip/pro 造成權限來源失真。
 */
function ensureMemberValidation_(sheet) {
  if (!sheet) return;

  const headers = sheet
    .getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
    .getValues()[0]
    .map(value => String(value || "").trim());

  const planColumn = headers.indexOf("方案") + 1;
  const statusColumn = headers.indexOf("狀態") + 1;
  const rows = Math.max(1, sheet.getMaxRows() - 1);

  if (planColumn) {
    const range = sheet.getRange(2, planColumn, rows, 1);
    range.clearDataValidations();
    sheet.getRange(1, planColumn).setNote(
      "V2 系統欄位：由 ENTITLEMENTS 依 PRO > VIP > FREE 自動同步，請勿手動修改。"
    );
  }

  if (statusColumn) {
    sheet.getRange(2, statusColumn, rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(MEMBER_STATUS_OPTIONS, true)
        .setAllowInvalid(false)
        .build()
    );
    sheet.getRange(1, statusColumn).setNote("會員帳號狀態；與付款／訂閱狀態分離。 ");
  }
}

function normalizeEmail_(value) {
  return String(value || "").trim().toLowerCase();
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}


