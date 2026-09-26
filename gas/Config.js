const TR_APP = Object.freeze({
  name: "脆文雷達",
  version: "2.0.0-beta.7",
  apiVersion: "v2",
  usageContract: "portal_usage_v1",
  keyVersion: "sha256-post-v1",
  maxBatchSize: 100,
  sessionSeconds: 3600,
  spreadsheetProperty: "THREADS_RADAR_V2_SPREADSHEET_ID",
  operatorSpreadsheetId: "11WOJPBBByb-HgtW9-7Naphe3y3X_XkC45yWRJ8sxBo4",
  sessionSecretProperty: "THREADS_RADAR_V2_SESSION_SECRET",
  extensionIdProperty: "THREADS_RADAR_EXTENSION_ID",
  adminEmailsProperty: "THREADS_RADAR_ADMIN_EMAILS",
  adminClientIdProperty: "THREADS_RADAR_GOOGLE_WEB_CLIENT_ID",
  defaultAdminEmails: Object.freeze(["runing9to5@gmail.com", "luciferhai666@gmail.com"]),
  defaultAdminClientId: "",
  adminUiEnabled: false,
  storeExtensionId: "aaaihgbgeagjlblhfmacjokjemeidgnf",
  localTestExtensionIds: Object.freeze(["djmanfnolkmkjpilojblkmjjgofdanee"])
});

const TR_SHEETS = Object.freeze({
  MEMBERS: Object.freeze([
    "user_id", "email", "name", "plan", "status", "created_at", "updated_at",
    "last_login_at", "login_count", "extension_version"
  ]),
  PLAN_LIMITS: Object.freeze([
    "plan", "label", "quota_mode", "lifetime_limit", "monthly_limit",
    "max_per_batch", "active", "updated_at"
  ]),
  BATCHES: Object.freeze([
    "batch_id", "user_id", "email", "period", "payload_digest", "received_count",
    "new_count", "duplicate_count", "skipped_limit_count", "status", "created_at",
    "confirmed_at", "extension_version", "usage_contract"
  ]),
  POST_KEYS: Object.freeze([
    "user_id", "post_key", "key_version", "first_batch_id", "period", "created_at"
  ]),
  USAGE_EVENTS: Object.freeze([
    "event_id", "batch_id", "user_id", "email", "period", "delta",
    "lifetime_total", "period_total", "remaining", "created_at"
  ])
});

const TR_DEFAULT_PLANS = Object.freeze([
  Object.freeze({ plan: "free", label: "Free", quota_mode: "lifetime", lifetime_limit: 100, monthly_limit: 0, max_per_batch: 100, active: true }),
  Object.freeze({ plan: "vip", label: "VIP", quota_mode: "lifetime", lifetime_limit: 500, monthly_limit: 0, max_per_batch: 100, active: true }),
  Object.freeze({ plan: "pro", label: "PRO", quota_mode: "monthly", lifetime_limit: 0, monthly_limit: 500, max_per_batch: 100, active: true })
]);
