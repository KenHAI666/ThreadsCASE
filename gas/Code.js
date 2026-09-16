const ADMIN_EMAIL = "luciferhai666@gmail.com";
const OPERATOR_SPREADSHEET_ID = "1PMgVFKAtqempy2CZpMW5KEDP9n2kClARdZEzmLJUhw4";
const RELEASE_VERSION = "1.1.0";
const PLAN_OPTIONS = ["free","vip","pro"];
const STATUS_OPTIONS = ["active","terminated","paid","completed","cancelled","past_due","expired","refunded"];
const SHEET_HEADERS = {
  MEMBERS:["會員編號","電子郵件","姓名","方案","狀態","建立時間","更新時間","最後登入時間","登入次數","擴充版本","方案到期時間","付款來源","付款客戶編號","最後付款事件"],
  USAGE_MONTHLY:["用量編號","會員編號","月份","抓取篇數","新增篇數","重複篇數","更新時間"],
  USAGE_LIFETIME:["會員編號","抓取篇數","新增篇數","重複篇數","更新時間"]
};
const LEGACY_REPLY_HEADERS = new Set(["auto_replies","自動回覆次數","day","日期"]);

/** 這個 GAS 專案現在只回傳試算表位置，不再提供 HTML 管理頁。 */
function doGet() {
  requireSoleAdmin_();
  const database = SpreadsheetApp.openById(OPERATOR_SPREADSHEET_ID);
  return json_({ok:true,service:"Threads Radar Spreadsheet Operator",version:RELEASE_VERSION,backend:"spreadsheet-only",spreadsheet_url:database.getUrl(),message:"請直接在試算表的會員資料與統計工作表操作"});
}

function doPost() {
  requireSoleAdmin_();
  return json_({ok:false,error:"試算表後台不接受公開 API 請求"});
}

/** 測試用安全操作：只套用方案／狀態下拉選單，不刪除任何資料。 */
function applyMemberDropdownsOnly() {
  requireSoleAdmin_();
  const database = SpreadsheetApp.openById(OPERATOR_SPREADSHEET_ID);
  ensureSheet_(database, "MEMBERS", SHEET_HEADERS.MEMBERS);
  ensureMemberValidation_(database.getSheetByName("MEMBERS"));
  return {ok:true,spreadsheet_url:database.getUrl(),planOptions:PLAN_OPTIONS,statusOptions:STATUS_OPTIONS};
}

/** 在 GAS 編輯器手動執行一次，將舊欄位改成中文並移除回覆資料。 */
function rebuildOperatorSpreadsheet() {
  requireSoleAdmin_();
  const database = SpreadsheetApp.openById(OPERATOR_SPREADSHEET_ID);
  Object.entries(SHEET_HEADERS).forEach(([name,headers]) => ensureSheet_(database,name,headers));
  const legacy = database.getSheetByName("USAGE_DAILY");
  if (legacy) database.deleteSheet(legacy);
  ["USAGE_MONTHLY","USAGE_LIFETIME"].forEach(name => removeLegacyReplyColumns_(database.getSheetByName(name)));
  ensureStatsSheet_(database);
  ensureMemberValidation_(database.getSheetByName("MEMBERS"));
  return {ok:true,version:RELEASE_VERSION,spreadsheet_url:database.getUrl(),removed:["USAGE_DAILY","auto_replies","回覆統計"],stats_sheet:"統計"};
}

function requireSoleAdmin_() {
  const email = String(Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail() || "").trim().toLowerCase();
  if (email !== ADMIN_EMAIL) throw new Error("只有唯一管理員可以操作試算表後台");
  return email;
}

function ensureSheet_(database,name,headers) {
  const sheet = database.getSheetByName(name) || database.insertSheet(name);
  if (!sheet.getLastRow()) sheet.getRange(1,1,1,headers.length).setValues([headers]);
  const current = sheet.getRange(1,1,1,Math.max(1,sheet.getLastColumn())).getValues()[0];
  current.forEach((value,index) => { if (headers.includes(String(value).trim())) return; const legacy = String(value).trim(); const mapped = legacy === "user_id" ? "會員編號" : legacy === "email" ? "電子郵件" : legacy === "plan" ? "方案" : legacy === "status" ? "狀態" : legacy === "period" ? "月份" : legacy === "scraped_posts" ? "抓取篇數" : legacy === "new_scraped_posts" ? "新增篇數" : legacy === "duplicate_scraped_posts" ? "重複篇數" : legacy === "updated_at" ? "更新時間" : legacy === "created_at" ? "建立時間" : legacy === "last_login_at" ? "最後登入時間" : legacy === "login_count" ? "登入次數" : legacy === "extension_version" ? "擴充版本" : legacy === "expires_at" ? "方案到期時間" : legacy === "payment_provider" ? "付款來源" : legacy === "customer_id" ? "付款客戶編號" : legacy === "payment_event_id" ? "最後付款事件" : ""; if (mapped && headers.includes(mapped)) sheet.getRange(1,index + 1).setValue(mapped); });
  const normalized = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const missing = headers.filter(header => !normalized.includes(header));
  if (missing.length) sheet.getRange(1,sheet.getLastColumn() + 1,1,missing.length).setValues([missing]);
  sheet.setFrozenRows(1); sheet.getRange(1,1,1,sheet.getLastColumn()).setFontWeight("bold").setBackground("#171717").setFontColor("#fff");
  return sheet;
}

function removeLegacyReplyColumns_(sheet) {
  if (!sheet) return;
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String);
  for (let column = headers.length - 1; column >= 0; column--) if (LEGACY_REPLY_HEADERS.has(headers[column].trim())) sheet.deleteColumn(column + 1);
}

function ensureMemberValidation_(sheet) {
  if (!sheet) return;
  const headers = sheet.getRange(1,1,1,Math.max(1,sheet.getLastColumn())).getValues()[0].map(value => String(value || "").trim());
  const planColumn = headers.indexOf("方案") + 1, statusColumn = headers.indexOf("狀態") + 1, rows = Math.max(1, sheet.getMaxRows() - 1);
  if (planColumn) sheet.getRange(2,planColumn,rows,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(PLAN_OPTIONS, true).setAllowInvalid(false).build());
  if (statusColumn) sheet.getRange(2,statusColumn,rows,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUS_OPTIONS, true).setAllowInvalid(false).build());
}

function ensureStatsSheet_(database) {
  const sheet = database.getSheetByName("統計") || database.insertSheet("統計");
  sheet.clearContents();
  sheet.getRange(1,1,1,2).setValues([["統計項目","目前數值"]]);
  sheet.getRange(2,1,10,1).setValues([["會員總數"],["7 日內登入"],["Free 會員"],["VIP 會員"],["PRO 會員"],["本月抓取"],["本月新增"],["本月重複"],["V1 單次抓取上限"],["V1 累積保存上限"]]);
  sheet.getRange(2,2,10,1).setFormulas([["=COUNTA(MEMBERS!A2:A)"],["=COUNTIFS(MEMBERS!H2:H,\">=\"&TODAY()-7)"],["=COUNTIF(MEMBERS!D2:D,\"free\")"],["=COUNTIF(MEMBERS!D2:D,\"vip\")"],["=COUNTIF(MEMBERS!D2:D,\"pro\")"],["=SUMIFS(USAGE_MONTHLY!D2:D,USAGE_MONTHLY!C2:C,TEXT(TODAY(),\"yyyy-mm\"))"],["=SUMIFS(USAGE_MONTHLY!E2:E,USAGE_MONTHLY!C2:C,TEXT(TODAY(),\"yyyy-mm\"))"],["=SUMIFS(USAGE_MONTHLY!F2:F,USAGE_MONTHLY!C2:C,TEXT(TODAY(),\"yyyy-mm\"))"],["=100"],["=500"]]);
  sheet.setFrozenRows(1); sheet.getRange(1,1,1,2).setFontWeight("bold").setBackground("#171717").setFontColor("#fff"); sheet.autoResizeColumns(1,2);
  return sheet;
}

function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
