function setupThreadsRadarV2() {
  const properties = PropertiesService.getScriptProperties();
  let spreadsheetId = properties.getProperty(TR_APP.spreadsheetProperty);
  let spreadsheet;
  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.create("脆文雷達 V2｜營運資料庫");
    spreadsheetId = spreadsheet.getId();
    properties.setProperty(TR_APP.spreadsheetProperty, spreadsheetId);
  }

  Object.keys(TR_SHEETS).forEach(name => ensureSheet_(spreadsheet, name, TR_SHEETS[name]));
  seedPlanLimits_(spreadsheet.getSheetByName("PLAN_LIMITS"));
  ensureSessionSecret_();

  const defaultSheet = spreadsheet.getSheets()[0];
  if (!Object.prototype.hasOwnProperty.call(TR_SHEETS, defaultSheet.getName()) && spreadsheet.getSheets().length > 1) {
    spreadsheet.deleteSheet(defaultSheet);
  }

  return {
    ok: true,
    app_version: TR_APP.version,
    spreadsheet_id: spreadsheetId,
    spreadsheet_url: spreadsheet.getUrl(),
    web_app_url: ScriptApp.getService().getUrl() || "",
    sheets: Object.keys(TR_SHEETS)
  };
}

function getDatabase_() {
  const id = PropertiesService.getScriptProperties().getProperty(TR_APP.spreadsheetProperty);
  if (!id) throw new Error("請先執行 setupThreadsRadarV2() 建立營運資料庫");
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  const sheet = getDatabase_().getSheetByName(name);
  if (!sheet) throw new Error(`缺少資料表：${name}`);
  assertHeaders_(sheet, TR_SHEETS[name]);
  return sheet;
}

function ensureSheet_(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#eaf3ff");
  } else {
    assertHeaders_(sheet, headers);
  }
  return sheet;
}

function assertHeaders_(sheet, headers) {
  const actual = sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn())).getDisplayValues()[0].slice(0, headers.length);
  if (actual.join("\u001f") !== headers.join("\u001f")) {
    throw new Error(`${sheet.getName()} 欄位不符合 V2 規格，已停止寫入`);
  }
}

function seedPlanLimits_(sheet) {
  if (sheet.getLastRow() > 1) return;
  const now = new Date();
  const headers = TR_SHEETS.PLAN_LIMITS;
  const rows = TR_DEFAULT_PLANS.map(plan => headers.map(header => header === "updated_at" ? now : plan[header]));
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function rowsAsObjects_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(String);
  return values.map((row, index) => {
    const value = {};
    headers.forEach((header, column) => { value[header] = row[column]; });
    value._row = index + 2;
    return value;
  });
}

function headerIndex_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(String);
  return Object.fromEntries(headers.map((header, index) => [header, index + 1]));
}

function currentPeriod_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM");
}

function cellValue_(value) {
  if (value instanceof Date) return { userEnteredValue: { numberValue: value.getTime() / 86400000 + 25569 }, userEnteredFormat: { numberFormat: { type: "DATE_TIME", pattern: "yyyy-mm-dd hh:mm:ss" } } };
  if (typeof value === "number" && Number.isFinite(value)) return { userEnteredValue: { numberValue: value } };
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
  return { userEnteredValue: { stringValue: String(value == null ? "" : value) } };
}

function appendCellsRequest_(sheet, headers, value) {
  return {
    appendCells: {
      sheetId: sheet.getSheetId(),
      rows: [{ values: headers.map(header => cellValue_(value[header])) }],
      fields: "userEnteredValue,userEnteredFormat.numberFormat"
    }
  };
}
