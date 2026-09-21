const RADAR_DB_ID = '1PMgVFKAtqempy2CZpMW5KEDP9n2kClARdZEzmLJUhw4';
// 營運後台 Sheet：會員方案、人工額度調整、個人 override 的優先來源。
const RADAR_OPERATOR_DB_ID = '11WOJPBBByb-HgtW9-7Naphe3y3X_XkC45yWRJ8sxBo4';
const RADAR_TZ = 'Asia/Taipei';

/**
 * Threads 文案雷達－營運後台 V2
 *
 * 設計原則：
 * 1. MEMBERS 只保存會員基本資料；舊版 D 欄「方案」維持相容鏡像。
 * 2. ENTITLEMENTS 是 VIP / PRO 權限來源；有效方案優先級 PRO > VIP > FREE。
 * 3. VIP 只允許 admin 人工授權。
 * 4. PRO 預留 Portaly；目前由 SYSTEM_CONFIG.portaly_enabled 控制，預設 false。
 * 5. USAGE_EVENTS 是用量唯一事件帳本；只有「本次新增」會消耗方案額度，重複文章只統計不扣額度；USAGE_MONTHLY / USAGE_LIFETIME 是可重建彙總。
 * 6. 所有會改權限／用量的操作使用 LockService，並寫 AUDIT_LOG。
 *
 * 注意：本檔刻意不宣告 doGet / doPost，避免直接覆蓋既有 Web App 路由。
 * 將既有 API 路由逐步改呼叫本檔公開函式即可。
 */

function radarV2GetConfig() {
  const rows = radarV2ReadTable_('SYSTEM_CONFIG');
  const out = {};
  rows.rows.forEach(row => {
    const key = String(row[rows.map['設定鍵']] || '').trim();
    if (!key) return;
    const type = String(row[rows.map['類型']] || 'string').trim();
    let value = row[rows.map['設定值']];
    if (type === 'boolean') value = radarV2Bool_(value);
    if (type === 'number') value = Number(value || 0);
    out[key] = value;
  });
  return out;
}

function radarV2GetEffectivePlan(memberIdOrEmail) {
  return radarV2GetMemberAccess(memberIdOrEmail).effectivePlan;
}

function radarV2GetMemberAccess(memberIdOrEmail) {
  // 目前營運決策：Google Sheet 是會員／額度 Source of Truth。
  // 優先讀新版營運資料庫；若尚未有該會員，再 fallback 舊 V2 entitlement 架構。
  const operatorAccess = radarV2GetOperatorSheetAccess_(memberIdOrEmail);
  if (operatorAccess) return operatorAccess;

  const member = radarV2FindMember_(memberIdOrEmail);
  if (!member) throw new Error('MEMBER_NOT_FOUND');

  const entitlement = radarV2ResolveEntitlement_(member.memberId, new Date());
  const plan = radarV2GetPlan_(entitlement.plan);
  const usage = radarV2GetUsage_(member.memberId);
  const limit = entitlement.plan === 'pro'
    ? Number(plan['每月抓取上限'] || 0)
    : Number(plan['累積抓取上限'] || 0);
  const used = entitlement.plan === 'pro' ? usage.monthly : usage.lifetime;

  return {
    memberId: member.memberId,
    email: member.email,
    memberStatus: member.status,
    effectivePlan: entitlement.plan,
    entitlementSource: entitlement.source,
    entitlementId: entitlement.entitlementId,
    entitlementEndAt: entitlement.endAt || '',
    usageLifetime: usage.lifetime,
    usageMonthly: usage.monthly,
    used: used,
    limit: limit,
    scrapeLimit: limit,
    remaining: limit > 0 ? Math.max(0, limit - used) : null,
    keywordWatchLimit: Number(plan['關鍵字追蹤上限'] || 0),
    keywordLimit: Number(plan['關鍵字追蹤上限'] || 0),
    accountWatchLimit: Number(plan['帳號追蹤上限'] || 0),
    analysisEnabled: radarV2Bool_(plan['分析功能']),
    analysisBasicEnabled: radarV2Bool_(plan['分析功能']),
    analysisAdvancedEnabled: radarV2Bool_(plan['分析功能']) && ['vip', 'pro'].includes(entitlement.plan),
    keywordWatchEnabled: radarV2Bool_(plan['關鍵字海巡']),
    accountWatchEnabled: radarV2Bool_(plan['帳號海巡']),
    calculatedAt: radarV2Now_()
  };
}

/**
 * 新版營運資料庫讀取層。
 *
 * MEMBERS 主要欄位：
 * user_id / email / plan / status
 * usage_adjustment / scrape_limit_override / keyword_limit_override
 * usage_effective / effective_scrape_limit / effective_keyword_limit / remaining_scrape
 *
 * PLAN_LIMITS 主要欄位：
 * plan / quota_mode / lifetime_limit / monthly_limit / keyword_limit / ...
 *
 * 重要：
 * - 個人 override 優先於方案預設。
 * - usage_effective 已包含 usage_adjustment。
 * - 不把 usage_adjustment / internal_tag / note 回傳給 Extension。
 */
function radarV2GetOperatorSheetAccess_(memberIdOrEmail) {
  const key = String(memberIdOrEmail || '').trim().toLowerCase();
  if (!key) return null;

  let db;
  try {
    db = SpreadsheetApp.openById(RADAR_OPERATOR_DB_ID);
  } catch (error) {
    return null;
  }

  const membersSheet = db.getSheetByName('MEMBERS');
  const plansSheet = db.getSheetByName('PLAN_LIMITS');
  if (!membersSheet || !plansSheet) return null;

  const memberValues = membersSheet.getDataRange().getValues();
  if (memberValues.length < 2) return null;

  const memberMap = radarV2HeaderMap_(memberValues[0]);
  const userIdCol = radarV2HeaderIndexByAliases_(memberMap, ['user_id', '會員編號']);
  const emailCol = radarV2HeaderIndexByAliases_(memberMap, ['email', '電子郵件']);
  if (userIdCol < 0 && emailCol < 0) return null;

  const memberRow = memberValues.slice(1).find(row => {
    const userId = userIdCol >= 0 ? String(row[userIdCol] || '').trim().toLowerCase() : '';
    const email = emailCol >= 0 ? String(row[emailCol] || '').trim().toLowerCase() : '';
    return userId === key || email === key;
  });
  if (!memberRow) return null;

  const memberId = radarV2RowValueByAliases_(memberRow, memberMap, ['user_id', '會員編號']);
  const email = radarV2RowValueByAliases_(memberRow, memberMap, ['email', '電子郵件']);
  const status = String(radarV2RowValueByAliases_(memberRow, memberMap, ['status', '狀態']) || 'active').trim().toLowerCase();
  const planCode = String(radarV2RowValueByAliases_(memberRow, memberMap, ['plan', '方案']) || 'free').trim().toLowerCase();

  const planValues = plansSheet.getDataRange().getValues();
  if (planValues.length < 2) throw new Error('PLAN_LIMITS_EMPTY');
  const planMap = radarV2HeaderMap_(planValues[0]);
  const planCol = radarV2HeaderIndexByAliases_(planMap, ['plan', '方案']);
  const planRow = planValues.slice(1).find(row =>
    planCol >= 0 && String(row[planCol] || '').trim().toLowerCase() === planCode
  );
  if (!planRow) throw new Error('PLAN_NOT_FOUND:' + planCode);

  const quotaMode = String(
    radarV2RowValueByAliases_(planRow, planMap, ['quota_mode', '額度模式']) || 'lifetime'
  ).trim().toLowerCase();

  const defaultLimit = quotaMode === 'monthly'
    ? radarV2Number_(radarV2RowValueByAliases_(planRow, planMap, ['monthly_limit', '每月抓取上限']), 0)
    : radarV2Number_(radarV2RowValueByAliases_(planRow, planMap, ['lifetime_limit', '累積抓取上限']), 0);

  const rawOverride = radarV2RowValueByAliases_(memberRow, memberMap, ['scrape_limit_override', '特殊抓取上限']);
  const overrideLimit = radarV2OptionalPositiveNumber_(rawOverride);
  const calculatedLimit = overrideLimit !== null ? overrideLimit : defaultLimit;

  const effectiveLimitCell = radarV2OptionalNonNegativeNumber_(
    radarV2RowValueByAliases_(memberRow, memberMap, ['effective_scrape_limit', '最終抓取上限'])
  );
  const limit = effectiveLimitCell !== null ? effectiveLimitCell : calculatedLimit;

  let used = radarV2OptionalNonNegativeNumber_(
    radarV2RowValueByAliases_(memberRow, memberMap, ['usage_effective', '有效使用量'])
  );

  if (used === null) {
    used = radarV2GetOperatorUsageFallback_(db, memberId, email, quotaMode);
    const adjustment = radarV2Number_(
      radarV2RowValueByAliases_(memberRow, memberMap, ['usage_adjustment', '人工額度調整']),
      0
    );
    used = Math.max(0, used + adjustment);
  }

  const rawKeywordOverride = radarV2RowValueByAliases_(memberRow, memberMap, ['keyword_limit_override', '特殊關鍵字上限']);
  const keywordOverride = radarV2OptionalPositiveNumber_(rawKeywordOverride);
  const planKeywordLimit = radarV2Number_(
    radarV2RowValueByAliases_(planRow, planMap, ['keyword_limit', '關鍵字追蹤上限']),
    0
  );
  const effectiveKeywordCell = radarV2OptionalNonNegativeNumber_(
    radarV2RowValueByAliases_(memberRow, memberMap, ['effective_keyword_limit', '最終關鍵字上限'])
  );
  const keywordLimit = effectiveKeywordCell !== null
    ? effectiveKeywordCell
    : (keywordOverride !== null ? keywordOverride : planKeywordLimit);

  const remainingCell = radarV2OptionalNonNegativeNumber_(
    radarV2RowValueByAliases_(memberRow, memberMap, ['remaining_scrape', '剩餘抓取量'])
  );
  const remaining = remainingCell !== null
    ? remainingCell
    : Math.max(0, limit - used);

  const accountWatchLimit = radarV2Number_(
    radarV2RowValueByAliases_(planRow, planMap, ['account_watch_limit', '帳號追蹤上限']),
    0
  );

  const analysisBasic = radarV2Bool_(
    radarV2RowValueByAliases_(planRow, planMap, ['analysis_basic', '基本分析', '分析功能'])
  );
  const analysisAdvanced = radarV2Bool_(
    radarV2RowValueByAliases_(planRow, planMap, ['analysis_advanced', '進階分析'])
  );
  const keywordScout = radarV2Bool_(
    radarV2RowValueByAliases_(planRow, planMap, ['keyword_scout', '關鍵字海巡'])
  );
  const accountWatch = radarV2Bool_(
    radarV2RowValueByAliases_(planRow, planMap, ['account_watch', '帳號海巡'])
  );

  return {
    memberId: String(memberId || ''),
    email: String(email || ''),
    memberStatus: status,
    effectivePlan: planCode,
    entitlementSource: 'operator_sheet',
    entitlementId: '',
    entitlementEndAt: radarV2RowValueByAliases_(memberRow, memberMap, ['membership_expires_at', '資格到期時間']) || '',
    usageLifetime: quotaMode === 'lifetime' ? used : 0,
    usageMonthly: quotaMode === 'monthly' ? used : 0,
    used: used,
    limit: limit,
    scrapeLimit: limit,
    remaining: remaining,
    keywordWatchLimit: keywordLimit,
    keywordLimit: keywordLimit,
    accountWatchLimit: accountWatchLimit,
    analysisEnabled: analysisBasic || analysisAdvanced,
    analysisBasicEnabled: analysisBasic,
    analysisAdvancedEnabled: analysisAdvanced,
    keywordWatchEnabled: keywordScout,
    accountWatchEnabled: accountWatch,
    calculatedAt: radarV2Now_()
  };
}

function radarV2GetOperatorUsageFallback_(db, memberId, email, quotaMode) {
  const sheet = db.getSheetByName('USAGE_EVENTS');
  if (!sheet) return 0;

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return 0;

  const map = radarV2HeaderMap_(values[0]);
  const memberCol = radarV2HeaderIndexByAliases_(map, ['user_id', '會員編號']);
  const emailCol = radarV2HeaderIndexByAliases_(map, ['email', '電子郵件']);
  const periodCol = radarV2HeaderIndexByAliases_(map, ['period', '月份']);
  const lifetimeCol = radarV2HeaderIndexByAliases_(map, ['lifetime_total', '終身累積', '累積抓取量']);
  const monthlyCol = radarV2HeaderIndexByAliases_(map, ['period_total', '本期累積', '每月抓取量']);

  const normalizedMemberId = String(memberId || '').trim().toLowerCase();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const currentPeriod = Utilities.formatDate(new Date(), RADAR_TZ, 'yyyy-MM');

  let total = 0;
  values.slice(1).forEach(row => {
    const rowMember = memberCol >= 0 ? String(row[memberCol] || '').trim().toLowerCase() : '';
    const rowEmail = emailCol >= 0 ? String(row[emailCol] || '').trim().toLowerCase() : '';
    if (rowMember !== normalizedMemberId && rowEmail !== normalizedEmail) return;

    if (quotaMode === 'monthly') {
      const period = periodCol >= 0 ? String(row[periodCol] || '').trim() : '';
      if (period !== currentPeriod) return;
      if (monthlyCol >= 0) total = Math.max(total, radarV2Number_(row[monthlyCol], 0));
    } else if (lifetimeCol >= 0) {
      total = Math.max(total, radarV2Number_(row[lifetimeCol], 0));
    }
  });

  return total;
}

function radarV2HeaderIndexByAliases_(map, aliases) {
  for (let i = 0; i < aliases.length; i++) {
    const key = aliases[i];
    if (map[key] !== undefined) return map[key];
  }
  return -1;
}

function radarV2RowValueByAliases_(row, map, aliases) {
  const index = radarV2HeaderIndexByAliases_(map, aliases);
  return index >= 0 ? row[index] : '';
}

function radarV2Number_(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number(fallback || 0);
}

function radarV2OptionalPositiveNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function radarV2OptionalNonNegativeNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function radarV2GrantVipByEmail(email, reason, operator) {
  return radarV2WithLock_(() => {
    const member = radarV2FindMember_(email);
    if (!member) throw new Error('MEMBER_NOT_FOUND');

    const ent = radarV2ReadTable_('ENTITLEMENTS');
    const now = radarV2Now_();
    const duplicate = ent.rows.find(row =>
      String(row[ent.map['會員編號']]) === member.memberId &&
      String(row[ent.map['方案']]).toLowerCase() === 'vip' &&
      String(row[ent.map['來源']]).toLowerCase() === 'admin' &&
      radarV2EntitlementIsEffective_(row, ent.map, new Date())
    );

    if (duplicate) {
      return { ok: true, changed: false, reason: 'VIP_ALREADY_ACTIVE', access: radarV2GetMemberAccess(member.memberId) };
    }

    const entitlementId = 'ent-vip-' + Utilities.getUuid();
    radarV2AppendByHeaders_('ENTITLEMENTS', {
      '權限編號': entitlementId,
      '會員編號': member.memberId,
      '方案': 'vip',
      '來源': 'admin',
      '狀態': 'active',
      '開始時間': now,
      '到期時間': '',
      'Portaly訂閱編號': '',
      'Portaly方案編號': '',
      'Portaly客戶Email': '',
      '建立時間': now,
      '更新時間': now,
      '備註': reason || '人工授權 VIP'
    });

    radarV2Audit_({
      memberId: member.memberId,
      action: 'grant_vip',
      source: 'admin',
      beforeValue: member.legacyPlan,
      afterValue: 'vip',
      reason: reason || '人工授權 VIP',
      operator: operator || 'admin',
      eventKey: entitlementId
    });

    radarV2SyncLegacyPlan_(member.memberId);
    radarV2RefreshMemberAccess_();
    return { ok: true, changed: true, entitlementId, access: radarV2GetMemberAccess(member.memberId) };
  });
}

function radarV2RevokeVipByEmail(email, reason, operator) {
  return radarV2WithLock_(() => {
    const member = radarV2FindMember_(email);
    if (!member) throw new Error('MEMBER_NOT_FOUND');

    const sheet = radarV2Sheet_('ENTITLEMENTS');
    const values = sheet.getDataRange().getValues();
    const map = radarV2HeaderMap_(values[0]);
    const now = radarV2Now_();
    let changed = 0;

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (
        String(row[map['會員編號']]) === member.memberId &&
        String(row[map['方案']]).toLowerCase() === 'vip' &&
        String(row[map['來源']]).toLowerCase() === 'admin' &&
        ['active', 'canceling'].includes(String(row[map['狀態']]).toLowerCase())
      ) {
        sheet.getRange(i + 1, map['狀態'] + 1).setValue('revoked');
        sheet.getRange(i + 1, map['更新時間'] + 1).setValue(now);
        const note = String(row[map['備註']] || '');
        sheet.getRange(i + 1, map['備註'] + 1).setValue([note, reason || '人工取消 VIP'].filter(Boolean).join('；'));
        changed++;
      }
    }

    radarV2Audit_({
      memberId: member.memberId,
      action: 'revoke_vip',
      source: 'admin',
      beforeValue: 'vip',
      afterValue: 'resolved',
      reason: reason || '人工取消 VIP',
      operator: operator || 'admin',
      eventKey: 'vip-revoke-' + Utilities.getUuid()
    });

    radarV2SyncLegacyPlan_(member.memberId);
    radarV2RefreshMemberAccess_();
    return { ok: true, changed: changed > 0, revokedCount: changed, access: radarV2GetMemberAccess(member.memberId) };
  });
}

function radarV2RecordUsageEvent(payload) {
  payload = payload || {};
  return radarV2WithLock_(() => {
    const memberId = String(payload.memberId || '').trim();
    if (!memberId || !radarV2FindMember_(memberId)) throw new Error('MEMBER_NOT_FOUND');

    const processed = radarV2NonNegativeInt_(payload.used);
    const added = radarV2NonNegativeInt_(payload.added);
    const duplicate = radarV2NonNegativeInt_(payload.duplicate);
    if (processed !== added + duplicate) throw new Error('USAGE_COUNT_MISMATCH');

    const eventId = String(payload.eventId || ('usage-' + Utilities.getUuid()));
    const events = radarV2ReadTable_('USAGE_EVENTS');
    const exists = events.rows.some(row => String(row[events.map['用量事件編號']]) === eventId);
    if (exists) return { ok: true, changed: false, duplicateEvent: true, eventId };

    const now = radarV2Now_();
    const month = String(payload.month || Utilities.formatDate(new Date(), RADAR_TZ, 'yyyy-MM'));
    radarV2AppendByHeaders_('USAGE_EVENTS', {
      '用量事件編號': eventId,
      '會員編號': memberId,
      '月份': month,
      '用量類型': String(payload.type || 'scrape'),
      '本次用量': added,
      '本次新增': added,
      '本次重複': duplicate,
      '建立時間': now,
      '來源': String(payload.source || 'extension'),
      '處理狀態': 'processed',
      '錯誤訊息': ''
    });

    radarV2RebuildUsageSummaries_(memberId);
    radarV2RefreshMemberAccess_();
    return { ok: true, changed: true, eventId, access: radarV2GetMemberAccess(memberId) };
  });
}

function radarV2RebuildUsageSummaries(memberId) {
  return radarV2WithLock_(() => {
    radarV2RebuildUsageSummaries_(memberId ? String(memberId) : null);
    radarV2RefreshMemberAccess_();
    return { ok: true };
  });
}

function radarV2RefreshMemberAccess() {
  return radarV2WithLock_(() => {
    radarV2RefreshMemberAccess_();
    return { ok: true };
  });
}

function radarV2SyncAllLegacyPlans() {
  return radarV2WithLock_(() => {
    const members = radarV2ReadTable_('MEMBERS');
    members.rows.forEach(row => {
      const memberId = String(row[members.map['會員編號']] || '').trim();
      if (memberId) radarV2SyncLegacyPlan_(memberId);
    });
    radarV2RefreshMemberAccess_();
    return { ok: true };
  });
}

/**
 * Portaly 尚未正式啟用時可先由測試／對帳流程呼叫。
 * 真正 Callback 一定要在可讀 HTTP headers 的 gateway 驗證 HMAC 後，才把已驗證 payload 傳入此函式。
 */
function radarV2ApplyVerifiedPortalyEvent(event) {
  event = event || {};
  const config = radarV2GetConfig();
  if (!radarV2Bool_(config.portaly_enabled)) throw new Error('PORTALY_DISABLED');
  if (String(event.mode || '') === 'test' && !radarV2Bool_(config.allow_test_entitlement_write)) {
    return { ok: true, changed: false, ignored: true, reason: 'TEST_ENTITLEMENT_WRITE_DISABLED' };
  }

  return radarV2WithLock_(() => {
    const memberId = String(event.memberId || '').trim();
    const member = radarV2FindMember_(memberId);
    if (!member) throw new Error('MEMBER_NOT_FOUND');

    const amount = Number(event.amount || 0);
    const currency = String(event.currency || 'TWD').toUpperCase();
    if (currency !== 'TWD') throw new Error('PORTALY_CURRENCY_MISMATCH');
    if (amount > 0 && amount !== Number(config.portaly_pro_price_twd || 199)) throw new Error('PORTALY_AMOUNT_MISMATCH');

    const eventKey = String(event.eventKey || '').trim();
    if (!eventKey) throw new Error('PORTALY_EVENT_KEY_REQUIRED');
    const payments = radarV2ReadTable_('PAYMENT_EVENTS');
    if (payments.rows.some(row => String(row[payments.map['事件鍵']]) === eventKey)) {
      return { ok: true, changed: false, duplicateEvent: true, eventKey };
    }

    const now = radarV2Now_();
    radarV2AppendByHeaders_('PAYMENT_EVENTS', {
      '事件鍵': eventKey,
      'Portaly事件': String(event.eventType || ''),
      '會員編號': memberId,
      'Subscription ID': String(event.subscriptionId || ''),
      'Session ID': String(event.sessionId || ''),
      'Merchant Order Number': String(event.merchantOrderNumber || ''),
      'Payment Reference': String(event.paymentReference || ''),
      '金額': amount,
      '幣別': currency,
      '模式': String(event.mode || 'test'),
      '狀態': String(event.status || ''),
      'Portaly事件時間': String(event.eventAt || ''),
      '收到時間': now,
      '處理狀態': 'pending',
      '處理時間': '',
      '錯誤訊息': '',
      'Payload Hash': String(event.payloadHash || '')
    });

    const type = String(event.eventType || '');
    if (type === 'creator_subscription.checkout.completed' || type === 'creator_subscription.payment.succeeded' || type === 'creator_subscription.active') {
      radarV2UpsertProEntitlement_(memberId, event, now);
    } else if (type === 'creator_subscription.cancel_requested') {
      radarV2MarkProCanceling_(memberId, event, now);
    } else if (type === 'creator_subscription.canceled') {
      radarV2ExpireProEntitlement_(memberId, event, now);
    }

    radarV2SetPaymentEventStatus_(eventKey, 'processed', '');
    radarV2SyncLegacyPlan_(memberId);
    radarV2RefreshMemberAccess_();
    return { ok: true, changed: true, eventKey, access: radarV2GetMemberAccess(memberId) };
  });
}

function radarV2ResolveEntitlement_(memberId, at) {
  const ent = radarV2ReadTable_('ENTITLEMENTS');
  const plans = radarV2ReadTable_('PLAN_LIMITS');
  const priorities = {};
  plans.rows.forEach(row => priorities[String(row[plans.map['方案']]).toLowerCase()] = Number(row[plans.map['方案優先級']] || 0));

  const candidates = ent.rows
    .filter(row => String(row[ent.map['會員編號']]) === String(memberId))
    .filter(row => radarV2EntitlementIsEffective_(row, ent.map, at))
    .map(row => ({
      entitlementId: String(row[ent.map['權限編號']] || ''),
      plan: String(row[ent.map['方案']] || '').toLowerCase(),
      source: String(row[ent.map['來源']] || ''),
      status: String(row[ent.map['狀態']] || ''),
      endAt: row[ent.map['到期時間']] || '',
      priority: priorities[String(row[ent.map['方案']] || '').toLowerCase()] || 0
    }))
    .sort((a, b) => b.priority - a.priority);

  return candidates[0] || { entitlementId: '', plan: 'free', source: 'system', status: 'active', endAt: '', priority: 0 };
}

function radarV2EntitlementIsEffective_(row, map, at) {
  const status = String(row[map['狀態']] || '').toLowerCase();
  if (!['active', 'canceling'].includes(status)) return false;
  const start = radarV2Date_(row[map['開始時間']]);
  const end = radarV2Date_(row[map['到期時間']]);
  if (start && start.getTime() > at.getTime()) return false;
  if (end && end.getTime() <= at.getTime()) return false;
  return true;
}

function radarV2GetUsage_(memberId) {
  const lifetime = radarV2ReadTable_('USAGE_LIFETIME');
  const monthly = radarV2ReadTable_('USAGE_MONTHLY');
  const month = Utilities.formatDate(new Date(), RADAR_TZ, 'yyyy-MM');
  const lifeRow = lifetime.rows.find(row => String(row[lifetime.map['會員編號']]) === String(memberId));
  const monthRow = monthly.rows.find(row =>
    String(row[monthly.map['會員編號']]) === String(memberId) &&
    String(row[monthly.map['月份']]) === month
  );
  return {
    lifetime: lifeRow ? Number(lifeRow[lifetime.map['抓取篇數']] || 0) : 0,
    monthly: monthRow ? Number(monthRow[monthly.map['抓取篇數']] || 0) : 0
  };
}

function radarV2RebuildUsageSummaries_(onlyMemberId) {
  const events = radarV2ReadTable_('USAGE_EVENTS');
  const byMember = {};
  events.rows.forEach(row => {
    const memberId = String(row[events.map['會員編號']] || '').trim();
    if (!memberId || (onlyMemberId && memberId !== onlyMemberId)) return;
    const status = String(row[events.map['處理狀態']] || 'processed').toLowerCase();
    if (status !== 'processed') return;
    const month = String(row[events.map['月份']] || '').trim();
    const used = Number(row[events.map['本次用量']] || 0);
    const added = Number(row[events.map['本次新增']] || 0);
    const duplicate = Number(row[events.map['本次重複']] || 0);
    byMember[memberId] = byMember[memberId] || { used: 0, added: 0, duplicate: 0, months: {} };
    byMember[memberId].used += used;
    byMember[memberId].added += added;
    byMember[memberId].duplicate += duplicate;
    byMember[memberId].months[month] = byMember[memberId].months[month] || { used: 0, added: 0, duplicate: 0 };
    byMember[memberId].months[month].used += used;
    byMember[memberId].months[month].added += added;
    byMember[memberId].months[month].duplicate += duplicate;
  });

  Object.keys(byMember).forEach(memberId => {
    const now = radarV2Now_();
    radarV2UpsertByKeys_('USAGE_LIFETIME', { '會員編號': memberId }, {
      '會員編號': memberId,
      '抓取篇數': byMember[memberId].added,
      '新增篇數': byMember[memberId].added,
      '重複篇數': byMember[memberId].duplicate,
      '更新時間': now
    });
    Object.keys(byMember[memberId].months).forEach(month => {
      const m = byMember[memberId].months[month];
      radarV2UpsertByKeys_('USAGE_MONTHLY', { '會員編號': memberId, '月份': month }, {
        '用量編號': 'event-' + month + '-' + memberId,
        '會員編號': memberId,
        '月份': month,
        '抓取篇數': m.added,
        '新增篇數': m.added,
        '重複篇數': m.duplicate,
        '更新時間': now
      });
    });
  });
}

function radarV2RefreshMemberAccess_() {
  const members = radarV2ReadTable_('MEMBERS');
  const sheet = radarV2Sheet_('MEMBER_ACCESS');
  const rows = [];
  members.rows.forEach(row => {
    const memberId = String(row[members.map['會員編號']] || '').trim();
    if (!memberId) return;
    const access = radarV2GetMemberAccess(memberId);
    rows.push([
      access.memberId,
      access.email,
      access.memberStatus,
      access.effectivePlan,
      access.entitlementSource,
      access.entitlementId,
      access.entitlementEndAt,
      access.usageLifetime,
      access.usageMonthly,
      access.limit,
      access.remaining === null ? '' : access.remaining,
      access.keywordWatchLimit,
      access.accountWatchLimit,
      access.analysisEnabled,
      access.calculatedAt
    ]);
  });

  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getMaxColumns()).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function radarV2SyncLegacyPlan_(memberId) {
  const plan = radarV2ResolveEntitlement_(memberId, new Date()).plan;
  const sheet = radarV2Sheet_('MEMBERS');
  const values = sheet.getDataRange().getValues();
  const map = radarV2HeaderMap_(values[0]);
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][map['會員編號']]) === String(memberId)) {
      sheet.getRange(i + 1, map['方案'] + 1).setValue(plan);
      sheet.getRange(i + 1, map['更新時間'] + 1).setValue(radarV2Now_());
      return plan;
    }
  }
  throw new Error('MEMBER_NOT_FOUND');
}

function radarV2UpsertProEntitlement_(memberId, event, now) {
  const ent = radarV2ReadTable_('ENTITLEMENTS');
  const subscriptionId = String(event.subscriptionId || event.sessionId || '');
  const rowIndex = ent.rows.findIndex(row =>
    String(row[ent.map['會員編號']]) === memberId &&
    String(row[ent.map['方案']]).toLowerCase() === 'pro' &&
    String(row[ent.map['來源']]).toLowerCase() === 'portaly' &&
    String(row[ent.map['Portaly訂閱編號']] || '') === subscriptionId
  );

  const data = {
    '方案': 'pro',
    '來源': 'portaly',
    '狀態': 'active',
    '開始時間': event.periodStart || event.completedAt || now,
    '到期時間': event.periodEnd || '',
    'Portaly訂閱編號': subscriptionId,
    'Portaly方案編號': String(event.planId || ''),
    'Portaly客戶Email': String(event.customerEmail || ''),
    '更新時間': now,
    '備註': 'Portaly PRO 月訂'
  };

  if (rowIndex >= 0) {
    radarV2UpdateRowByHeaders_('ENTITLEMENTS', rowIndex + 2, data);
  } else {
    data['權限編號'] = 'ent-pro-' + Utilities.getUuid();
    data['會員編號'] = memberId;
    data['建立時間'] = now;
    radarV2AppendByHeaders_('ENTITLEMENTS', data);
  }
}

function radarV2MarkProCanceling_(memberId, event, now) {
  radarV2UpdatePortalyEntitlementStatus_(memberId, event, 'canceling', now);
}

function radarV2ExpireProEntitlement_(memberId, event, now) {
  radarV2UpdatePortalyEntitlementStatus_(memberId, event, 'expired', now);
}

function radarV2UpdatePortalyEntitlementStatus_(memberId, event, status, now) {
  const sheet = radarV2Sheet_('ENTITLEMENTS');
  const values = sheet.getDataRange().getValues();
  const map = radarV2HeaderMap_(values[0]);
  const subscriptionId = String(event.subscriptionId || event.sessionId || '');
  for (let i = 1; i < values.length; i++) {
    if (
      String(values[i][map['會員編號']]) === memberId &&
      String(values[i][map['方案']]).toLowerCase() === 'pro' &&
      String(values[i][map['來源']]).toLowerCase() === 'portaly' &&
      String(values[i][map['Portaly訂閱編號']] || '') === subscriptionId
    ) {
      sheet.getRange(i + 1, map['狀態'] + 1).setValue(status);
      sheet.getRange(i + 1, map['更新時間'] + 1).setValue(now);
      if (event.periodEnd && map['到期時間'] !== undefined) sheet.getRange(i + 1, map['到期時間'] + 1).setValue(event.periodEnd);
      return true;
    }
  }
  return false;
}

function radarV2SetPaymentEventStatus_(eventKey, status, errorMessage) {
  const sheet = radarV2Sheet_('PAYMENT_EVENTS');
  const values = sheet.getDataRange().getValues();
  const map = radarV2HeaderMap_(values[0]);
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][map['事件鍵']]) === eventKey) {
      sheet.getRange(i + 1, map['處理狀態'] + 1).setValue(status);
      sheet.getRange(i + 1, map['處理時間'] + 1).setValue(radarV2Now_());
      sheet.getRange(i + 1, map['錯誤訊息'] + 1).setValue(errorMessage || '');
      return;
    }
  }
}

function radarV2Audit_(item) {
  radarV2AppendByHeaders_('AUDIT_LOG', {
    '稽核編號': 'audit-' + Utilities.getUuid(),
    '會員編號': item.memberId || '',
    '操作類型': item.action || '',
    '來源': item.source || 'system',
    '變更前': item.beforeValue || '',
    '變更後': item.afterValue || '',
    '原因': item.reason || '',
    '操作者': item.operator || 'system',
    '關聯事件鍵': item.eventKey || '',
    '建立時間': radarV2Now_()
  });
}

function radarV2FindMember_(memberIdOrEmail) {
  const needle = String(memberIdOrEmail || '').trim().toLowerCase();
  if (!needle) return null;
  const table = radarV2ReadTable_('MEMBERS');
  const row = table.rows.find(r =>
    String(r[table.map['會員編號']] || '').trim().toLowerCase() === needle ||
    String(r[table.map['電子郵件']] || '').trim().toLowerCase() === needle
  );
  if (!row) return null;
  return {
    memberId: String(row[table.map['會員編號']] || ''),
    email: String(row[table.map['電子郵件']] || ''),
    name: String(row[table.map['姓名']] || ''),
    status: String(row[table.map['狀態']] || ''),
    legacyPlan: String(row[table.map['方案']] || 'free').toLowerCase()
  };
}

function radarV2GetPlan_(planCode) {
  const table = radarV2ReadTable_('PLAN_LIMITS');
  const row = table.rows.find(r => String(r[table.map['方案']] || '').toLowerCase() === String(planCode).toLowerCase());
  if (!row) throw new Error('PLAN_NOT_FOUND');
  const obj = {};
  table.headers.forEach((h, i) => obj[h] = row[i]);
  return obj;
}

function radarV2ReadTable_(sheetName) {
  const sheet = radarV2Sheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  const headers = values.length ? values[0].map(String) : [];
  return { sheet, headers, map: radarV2HeaderMap_(headers), rows: values.slice(1) };
}

function radarV2HeaderMap_(headers) {
  const map = {};
  headers.forEach((h, i) => map[String(h).trim()] = i);
  return map;
}

function radarV2AppendByHeaders_(sheetName, obj) {
  const table = radarV2ReadTable_(sheetName);
  const row = table.headers.map(h => Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : '');
  table.sheet.appendRow(row);
}

function radarV2UpdateRowByHeaders_(sheetName, rowNumber, obj) {
  const table = radarV2ReadTable_(sheetName);
  Object.keys(obj).forEach(key => {
    if (table.map[key] === undefined) return;
    table.sheet.getRange(rowNumber, table.map[key] + 1).setValue(obj[key]);
  });
}

function radarV2UpsertByKeys_(sheetName, keys, obj) {
  const table = radarV2ReadTable_(sheetName);
  const index = table.rows.findIndex(row => Object.keys(keys).every(k => String(row[table.map[k]]) === String(keys[k])));
  if (index >= 0) radarV2UpdateRowByHeaders_(sheetName, index + 2, obj);
  else radarV2AppendByHeaders_(sheetName, obj);
}

function radarV2Sheet_(name) {
  const sheet = SpreadsheetApp.openById(RADAR_DB_ID).getSheetByName(name);
  if (!sheet) throw new Error('SHEET_NOT_FOUND:' + name);
  return sheet;
}

function radarV2WithLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function radarV2Now_() {
  return Utilities.formatDate(new Date(), RADAR_TZ, 'yyyy-MM-dd HH:mm:ss.SSS');
}

function radarV2Date_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function radarV2Bool_(value) {
  if (value === true || value === false) return value;
  return ['true', '1', 'yes', 'y', 'on'].includes(String(value || '').trim().toLowerCase());
}

function radarV2NonNegativeInt_(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) throw new Error('INVALID_NON_NEGATIVE_INTEGER');
  return n;
}
