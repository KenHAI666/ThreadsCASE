function configureThreadsRadarAdmin(adminEmails, googleWebClientId) {
  const emails = normalizeAdminEmails_(adminEmails);
  const clientId = String(googleWebClientId || "").trim();
  if (!emails.length) throw new Error("至少需要一個管理員 Email");
  if (!/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error("Google Web Client ID 格式錯誤");
  }
  PropertiesService.getScriptProperties().setProperties({
    [TR_APP.adminEmailsProperty]: emails.join(","),
    [TR_APP.adminClientIdProperty]: clientId
  }, false);
  return {
    ok: true,
    admin_emails: emails,
    admin_url: `${ScriptApp.getService().getUrl() || ""}?page=admin`
  };
}

function adminBootstrap(idToken) {
  const admin = verifyAdminAccess_(idToken);
  return adminDashboardSnapshot_(admin);
}

function verifyAdminAccess_(idToken) {
  if (String(idToken || "").trim()) return verifyAdminIdToken_(idToken);
  const email = String(Session.getActiveUser().getEmail() || "").trim().toLowerCase();
  if (!email) {
    throw new Error("請使用『以存取者身分執行』的營運後台專用部署連結");
  }
  if (!adminEmails_().includes(email)) throw new Error("此 Google 帳號沒有營運後台權限");
  return { id: email, email, name: email };
}

function adminGoogleClientId_() {
  return String(PropertiesService.getScriptProperties().getProperty(TR_APP.adminClientIdProperty) || TR_APP.defaultAdminClientId || "").trim();
}

function adminEmails_() {
  const configured = PropertiesService.getScriptProperties().getProperty(TR_APP.adminEmailsProperty);
  return normalizeAdminEmails_(configured || TR_APP.defaultAdminEmails);
}

function normalizeAdminEmails_(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
  return [...new Set(items.map(item => String(item || "").trim().toLowerCase()).filter(item => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item)))];
}

function verifyAdminIdToken_(idToken) {
  const token = String(idToken || "").trim();
  const clientId = adminGoogleClientId_();
  if (!clientId) throw new Error("營運後台尚未設定 Google Web Client ID");
  if (!token) throw new Error("請先使用管理員 Google 帳號登入");

  const response = UrlFetchApp.fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`, {
    method: "get",
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error("Google 管理員登入已失效，請重新登入");
  const value = JSON.parse(response.getContentText() || "{}");
  const issuer = String(value.iss || "");
  const verified = value.email_verified === true || String(value.email_verified).toLowerCase() === "true";
  const expiresAt = Number(value.exp) || 0;
  if (String(value.aud || "") !== clientId || !verified || !["accounts.google.com", "https://accounts.google.com"].includes(issuer) || expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new Error("Google 管理員身分驗證失敗");
  }

  const email = String(value.email || "").trim().toLowerCase();
  if (!adminEmails_().includes(email)) throw new Error("此 Google 帳號沒有營運後台權限");
  return {
    id: String(value.sub || ""),
    email,
    name: String(value.name || email)
  };
}

function adminDashboardSnapshot_(admin) {
  const period = currentPeriod_();
  const now = Date.now();
  const members = rowsAsObjects_(sheet_("MEMBERS"));
  const planRows = rowsAsObjects_(sheet_("PLAN_LIMITS"));
  const batches = rowsAsObjects_(sheet_("BATCHES"));
  const postKeys = rowsAsObjects_(sheet_("POST_KEYS"));
  const plans = new Map(planRows.map(row => [String(row.plan || "free").toLowerCase(), normalizePlan_(row)]));
  const usageByUser = new Map();
  const latestBatchByUser = new Map();

  postKeys.forEach(row => {
    const userId = String(row.user_id || "");
    const usage = usageByUser.get(userId) || { lifetime: 0, period: 0 };
    usage.lifetime += 1;
    if (String(row.period || "") === period) usage.period += 1;
    usageByUser.set(userId, usage);
  });

  batches.forEach(row => {
    const userId = String(row.user_id || "");
    const current = latestBatchByUser.get(userId);
    const timestamp = adminTimestamp_(row.confirmed_at || row.created_at);
    if (!current || timestamp > current.timestamp) latestBatchByUser.set(userId, { timestamp, row });
  });

  const memberRows = members.map(row => {
    const userId = String(row.user_id || "");
    const planKey = String(row.plan || "free").toLowerCase();
    const plan = plans.get(planKey) || plans.get("free") || normalizePlan_(TR_DEFAULT_PLANS[0]);
    const usage = usageByUser.get(userId) || { lifetime: 0, period: 0 };
    const quota = quotaSnapshot_(plan, usage.lifetime, usage.period);
    const latest = latestBatchByUser.get(userId);
    return {
      user_id: userId,
      email: String(row.email || ""),
      name: String(row.name || ""),
      plan: plan.plan,
      plan_label: plan.label,
      status: String(row.status || "active"),
      created_at: adminIso_(row.created_at),
      last_login_at: adminIso_(row.last_login_at),
      login_count: Math.max(0, Number(row.login_count) || 0),
      extension_version: String(row.extension_version || ""),
      quota_mode: quota.mode,
      used: quota.used,
      limit: quota.limit,
      remaining: quota.limit > 0 ? quota.remaining : null,
      lifetime_used: quota.lifetime_used,
      period_used: quota.period_used,
      last_batch_at: latest ? adminIso_(latest.row.confirmed_at || latest.row.created_at) : ""
    };
  }).sort((left, right) => adminTimestamp_(right.last_login_at) - adminTimestamp_(left.last_login_at));

  const recentBatches = batches.slice().sort((left, right) => adminTimestamp_(right.confirmed_at || right.created_at) - adminTimestamp_(left.confirmed_at || left.created_at)).slice(0, 100).map(row => ({
    batch_id: String(row.batch_id || ""),
    email: String(row.email || ""),
    status: String(row.status || ""),
    received_count: Math.max(0, Number(row.received_count) || 0),
    new_count: Math.max(0, Number(row.new_count) || 0),
    duplicate_count: Math.max(0, Number(row.duplicate_count) || 0),
    skipped_limit_count: Math.max(0, Number(row.skipped_limit_count) || 0),
    confirmed_at: adminIso_(row.confirmed_at || row.created_at),
    extension_version: String(row.extension_version || "")
  }));

  const planCounts = { free: 0, vip: 0, pro: 0 };
  memberRows.forEach(member => {
    if (Object.prototype.hasOwnProperty.call(planCounts, member.plan)) planCounts[member.plan] += 1;
  });

  return {
    ok: true,
    admin: { email: admin.email, name: admin.name },
    generated_at: new Date().toISOString(),
    summary: {
      members_total: memberRows.length,
      active_7d: memberRows.filter(member => adminTimestamp_(member.last_login_at) >= now - 7 * 86400000).length,
      unique_posts_total: postKeys.length,
      unique_posts_period: postKeys.filter(row => String(row.period || "") === period).length,
      batches_total: batches.length,
      confirmed_batches: batches.filter(row => String(row.status || "").toLowerCase() === "confirmed").length,
      plans: planCounts
    },
    plans: planRows.map(row => {
      const plan = normalizePlan_(row);
      return {
        plan: plan.plan,
        label: plan.label,
        quota_mode: plan.quota_mode,
        lifetime_limit: plan.lifetime_limit,
        monthly_limit: plan.monthly_limit,
        max_per_batch: plan.max_per_batch,
        active: plan.active,
        member_count: planCounts[plan.plan] || 0
      };
    }),
    members: memberRows,
    batches: recentBatches,
    system: {
      app_version: TR_APP.version,
      api_version: TR_APP.apiVersion,
      usage_contract: TR_APP.usageContract,
      period,
      database_ready: true,
      payment_webhook: "not_connected",
      content_storage: "hash_and_counts_only"
    }
  };
}

function adminTimestamp_(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function adminIso_(value) {
  const timestamp = adminTimestamp_(value);
  return timestamp ? new Date(timestamp).toISOString() : "";
}
