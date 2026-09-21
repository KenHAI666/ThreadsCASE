function normalizeBatchInput_(input) {
  const value = input && typeof input === "object" ? input : {};
  const batchId = String(value.batchId || value.batch_id || "").trim();
  if (!/^[A-Za-z0-9._:-]{12,160}$/.test(batchId)) throw new Error("batch_id 格式錯誤");

  const rawItems = Array.isArray(value.items) ? value.items : [];
  if (!rawItems.length) throw new Error("批次沒有文章識別資料");
  if (rawItems.length > TR_APP.maxBatchSize) throw new Error(`單一批次最多 ${TR_APP.maxBatchSize} 篇`);

  const normalized = rawItems.map(item => {
    const postKey = String(item && (item.postKey || item.post_key) || "").trim().toLowerCase();
    const keyVersion = String(item && (item.keyVersion || item.key_version) || TR_APP.keyVersion).trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(postKey)) throw new Error("文章識別 hash 格式錯誤");
    if (keyVersion !== TR_APP.keyVersion) throw new Error("不支援的文章識別版本");
    return { post_key: postKey, key_version: keyVersion };
  });

  const seen = new Set();
  const uniqueItems = normalized.filter(item => {
    if (seen.has(item.post_key)) return false;
    seen.add(item.post_key);
    return true;
  });

  return {
    batch_id: batchId,
    items: uniqueItems,
    received_count: rawItems.length,
    within_batch_duplicates: rawItems.length - uniqueItems.length,
    extension_version: String(value.extensionVersion || value.extension_version || "").trim().slice(0, 40)
  };
}

function normalizePlan_(row) {
  const value = row && typeof row === "object" ? row : {};
  const mode = String(value.quota_mode || "lifetime").toLowerCase();
  if (!["lifetime", "monthly"].includes(mode)) throw new Error("方案額度模式錯誤");
  const active = value.active === true || String(value.active).toLowerCase() === "true";
  return {
    plan: String(value.plan || "free").toLowerCase(),
    label: String(value.label || value.plan || "Free"),
    quota_mode: mode,
    lifetime_limit: Math.max(0, Number(value.lifetime_limit) || 0),
    monthly_limit: Math.max(0, Number(value.monthly_limit) || 0),
    max_per_batch: Math.max(1, Number(value.max_per_batch) || TR_APP.maxBatchSize),
    active
  };
}

function quotaSnapshot_(plan, lifetimeUsed, periodUsed) {
  const normalized = normalizePlan_(plan);
  const lifetime = Math.max(0, Number(lifetimeUsed) || 0);
  const period = Math.max(0, Number(periodUsed) || 0);
  const limit = normalized.quota_mode === "monthly" ? normalized.monthly_limit : normalized.lifetime_limit;
  const used = normalized.quota_mode === "monthly" ? period : lifetime;
  return {
    mode: normalized.quota_mode,
    limit,
    used,
    remaining: limit > 0 ? Math.max(0, limit - used) : Number.MAX_SAFE_INTEGER,
    lifetime_used: lifetime,
    period_used: period
  };
}

function allocateNewKeys_(newKeys, plan, lifetimeUsed, periodUsed) {
  const quota = quotaSnapshot_(plan, lifetimeUsed, periodUsed);
  const keys = Array.isArray(newKeys) ? newKeys : [];
  const capacity = quota.limit > 0 ? quota.remaining : keys.length;
  const accepted = keys.slice(0, capacity);
  return {
    accepted,
    skipped_limit_count: Math.max(0, keys.length - accepted.length),
    quota
  };
}
