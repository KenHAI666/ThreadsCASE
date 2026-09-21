function memberLogin_(input) {
  const user = verifyGoogleAccessToken_(input && (input.googleAccessToken || input.google_access_token));
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const member = upsertMember_(user, input && (input.extensionVersion || input.extension_version));
    const usage = usageStateForUser_(user, member);
    return {
      ok: true,
      api_version: TR_APP.apiVersion,
      usage_contract: TR_APP.usageContract,
      user: { email: user.email, name: user.name },
      session_token: createSessionToken_(user),
      session_expires_in: TR_APP.sessionSeconds,
      license: usage.license,
      usage: usage.usage
    };
  } finally {
    lock.releaseLock();
  }
}

function getUsageState(input) {
  try {
    const user = authenticateRequest_(input);
    const member = findMember_(user);
    if (!member) throw new Error("找不到會員資料，請重新登入");
    return { ok: true, ...usageStateForUser_(user, member) };
  } catch (error) {
    return failure_(error);
  }
}

function submitUsageBatch(input) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const user = authenticateRequest_(input);
    const batch = normalizeBatchInput_(input);
    const member = findMember_(user);
    if (!member) throw new Error("找不到會員資料，請重新登入");
    if (String(member.status || "active").toLowerCase() !== "active") throw new Error("會員狀態目前不可使用");

    const batchesSheet = sheet_("BATCHES");
    const existingBatch = rowsAsObjects_(batchesSheet).find(row => String(row.batch_id) === batch.batch_id);
    const payloadDigest = batchDigest_(user.id, batch);
    if (existingBatch) {
      if (String(existingBatch.user_id) !== user.id) throw new Error("batch_id 已被其他會員使用");
      if (String(existingBatch.payload_digest) !== payloadDigest) throw new Error("同一 batch_id 不可變更文章內容");
      return batchResponse_(existingBatch, usageStateForUser_(user, member), true);
    }

    const plan = planForMember_(member);
    if (!plan.active) throw new Error("此方案目前未開放");
    if (batch.received_count > Math.min(TR_APP.maxBatchSize, plan.max_per_batch)) throw new Error(`此方案單次最多同步 ${plan.max_per_batch} 篇`);

    const period = currentPeriod_();
    const postKeyRows = rowsAsObjects_(sheet_("POST_KEYS")).filter(row => String(row.user_id) === user.id);
    const existingKeys = new Set(postKeyRows.map(row => String(row.post_key).toLowerCase()));
    const newCandidates = batch.items.map(item => item.post_key).filter(key => !existingKeys.has(key));
    const periodUsed = postKeyRows.filter(row => String(row.period) === period).length;
    const allocation = allocateNewKeys_(newCandidates, plan, postKeyRows.length, periodUsed);
    const acceptedSet = new Set(allocation.accepted);
    const acceptedItems = batch.items.filter(item => acceptedSet.has(item.post_key));
    const newCount = acceptedItems.length;
    const duplicateCount = batch.received_count - newCandidates.length;
    const lifetimeTotal = postKeyRows.length + newCount;
    const periodTotal = periodUsed + newCount;
    const nextQuota = quotaSnapshot_(plan, lifetimeTotal, periodTotal);
    const now = new Date();

    const batchRow = {
      batch_id: batch.batch_id,
      user_id: user.id,
      email: user.email,
      period,
      payload_digest: payloadDigest,
      received_count: batch.received_count,
      new_count: newCount,
      duplicate_count: duplicateCount,
      skipped_limit_count: allocation.skipped_limit_count,
      status: "confirmed",
      created_at: now,
      confirmed_at: now,
      extension_version: batch.extension_version,
      usage_contract: TR_APP.usageContract
    };
    const eventRow = {
      event_id: `usage:${batch.batch_id}`,
      batch_id: batch.batch_id,
      user_id: user.id,
      email: user.email,
      period,
      delta: newCount,
      lifetime_total: lifetimeTotal,
      period_total: periodTotal,
      remaining: nextQuota.limit > 0 ? nextQuota.remaining : "",
      created_at: now
    };

    const postKeySheet = sheet_("POST_KEYS");
    const usageEventSheet = sheet_("USAGE_EVENTS");
    const requests = acceptedItems.map(item => appendCellsRequest_(postKeySheet, TR_SHEETS.POST_KEYS, {
      user_id: user.id,
      post_key: item.post_key,
      key_version: item.key_version,
      first_batch_id: batch.batch_id,
      period,
      created_at: now
    }));
    requests.push(appendCellsRequest_(batchesSheet, TR_SHEETS.BATCHES, batchRow));
    requests.push(appendCellsRequest_(usageEventSheet, TR_SHEETS.USAGE_EVENTS, eventRow));
    Sheets.Spreadsheets.batchUpdate({ requests }, getDatabase_().getId());

    const state = usageStateForTotals_(member, plan, lifetimeTotal, periodTotal);
    return batchResponse_(batchRow, state, false);
  } catch (error) {
    return failure_(error);
  } finally {
    lock.releaseLock();
  }
}

function upsertMember_(user, extensionVersion) {
  const sheet = sheet_("MEMBERS");
  const rows = rowsAsObjects_(sheet);
  const existing = rows.find(row => String(row.user_id) === user.id || String(row.email).toLowerCase() === user.email);
  const now = new Date();
  if (!existing) {
    const value = {
      user_id: user.id,
      email: user.email,
      name: user.name,
      plan: "free",
      status: "active",
      created_at: now,
      updated_at: now,
      last_login_at: now,
      login_count: 1,
      extension_version: String(extensionVersion || "").slice(0, 40)
    };
    sheet.appendRow(TR_SHEETS.MEMBERS.map(header => value[header] == null ? "" : value[header]));
    return value;
  }

  const columns = headerIndex_(sheet);
  const updates = {
    email: user.email,
    name: user.name,
    updated_at: now,
    last_login_at: now,
    login_count: Math.max(0, Number(existing.login_count) || 0) + 1,
    extension_version: String(extensionVersion || existing.extension_version || "").slice(0, 40)
  };
  Object.keys(updates).forEach(key => sheet.getRange(existing._row, columns[key]).setValue(updates[key]));
  return { ...existing, ...updates };
}

function findMember_(user) {
  return rowsAsObjects_(sheet_("MEMBERS")).find(row => String(row.user_id) === user.id || String(row.email).toLowerCase() === user.email) || null;
}

function planForMember_(member) {
  const planKey = String(member && member.plan || "free").toLowerCase();
  const rows = rowsAsObjects_(sheet_("PLAN_LIMITS"));
  const row = rows.find(value => String(value.plan).toLowerCase() === planKey) || rows.find(value => String(value.plan).toLowerCase() === "free");
  if (!row) throw new Error("PLAN_LIMITS 尚未設定 Free 方案");
  return applyMemberQuotaOverrides_(row, member);
}

function usageStateForUser_(user, member) {
  const plan = planForMember_(member);
  const period = currentPeriod_();
  const rows = rowsAsObjects_(sheet_("POST_KEYS")).filter(row => String(row.user_id) === user.id);
  const lifetimeTotal = rows.length;
  const periodTotal = rows.filter(row => String(row.period) === period).length;
  return usageStateForTotals_(member, plan, lifetimeTotal, periodTotal);
}

function usageStateForTotals_(member, plan, lifetimeTotal, periodTotal) {
  const quota = quotaSnapshot_(plan, lifetimeTotal, periodTotal);
  const lifetimeLimit = quota.mode === "lifetime" ? quota.limit : 0;
  const monthlyLimit = quota.mode === "monthly" ? quota.limit : 0;
  const defaultLibraryLimit = plan.plan === "free" ? 100 : 500;
  const localLibraryLimit = quota.limit > 0 ? Math.max(defaultLibraryLimit, quota.limit) : defaultLibraryLimit;
  const keywordLimit = plan.keyword_limit_override !== null && plan.keyword_limit_override !== undefined
    ? plan.keyword_limit_override
    : Math.max(0, Number(plan.keyword_limit) || 0);

  const effectiveLifetimeUsed = quota.mode === "lifetime" ? quota.used : quota.lifetime_used;
  const effectivePeriodUsed = quota.mode === "monthly" ? quota.used : quota.period_used;

  const usage = {
    period: currentPeriod_(),
    lifetime_used: quota.lifetime_used,
    period_used: quota.period_used,
    raw_used: quota.raw_used,
    usage_adjustment: quota.usage_adjustment,
    used: quota.used,
    limit: quota.limit,
    remaining: quota.limit > 0 ? quota.remaining : null,
    lifetime_new_scraped_posts: effectiveLifetimeUsed,
    new_scraped_posts: effectivePeriodUsed,
    scraped_posts: effectivePeriodUsed
  };

  return {
    license: {
      plan: plan.plan,
      label: plan.label,
      status: String(member.status || "active"),
      quota_mode: quota.mode,
      max_per_batch: plan.max_per_batch,
      max_scrape: plan.max_per_batch,
      max_posts: localLibraryLimit,
      library_limit: localLibraryLimit,
      max_scrapes_lifetime: lifetimeLimit,
      max_scrapes_per_month: monthlyLimit,
      keyword_limit: keywordLimit,
      usage
    },
    usage
  };
}

function batchDigest_(userId, batch) {
  const canonical = `${userId}\n${batch.batch_id}\n${batch.items.map(item => item.post_key).sort().join("\n")}`;
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8);
  return `sha256:${bytes.map(value => (value < 0 ? value + 256 : value).toString(16).padStart(2, "0")).join("")}`;
}

function batchResponse_(batch, state, idempotent) {
  return {
    ok: true,
    api_version: TR_APP.apiVersion,
    usage_contract: TR_APP.usageContract,
    idempotent: Boolean(idempotent),
    batch: {
      batch_id: String(batch.batch_id),
      status: String(batch.status),
      received_count: Number(batch.received_count) || 0,
      new_count: Number(batch.new_count) || 0,
      duplicate_count: Number(batch.duplicate_count) || 0,
      skipped_limit_count: Number(batch.skipped_limit_count) || 0,
      confirmed_at: batch.confirmed_at instanceof Date ? batch.confirmed_at.toISOString() : String(batch.confirmed_at || "")
    },
    license: state.license,
    usage: state.usage
  };
}

function failure_(error) {
  console.error(error && error.stack ? error.stack : error);
  return { ok: false, api_version: TR_APP.apiVersion, error: String(error && error.message || "伺服器錯誤") };
}
