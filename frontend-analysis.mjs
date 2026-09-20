const METRIC_KEYS = ["likes", "replies", "reposts", "quotes"];

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized || normalized === "-") return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function postKey(post) {
  const explicit = post?.uid ?? post?.post_id ?? post?.post_url;
  if (explicit !== undefined && explicit !== null && String(explicit).trim()) {
    return String(explicit).trim();
  }
  return [post?.username, post?.published_at, post?.published_date, post?.text]
    .map(value => String(value ?? "").trim())
    .join("\u001f");
}

function normalizePost(post) {
  const normalized = { ...post };
  METRIC_KEYS.forEach(key => {
    normalized[key] = numberValue(post?.[key]);
  });
  normalized.total_engagement = METRIC_KEYS.reduce((sum, key) => sum + normalized[key], 0);
  return normalized;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

function isOwnPost(post) {
  return post?.content_scope === "my_account"
    || post?.content_scope === "own"
    || (!post?.content_scope && ["profile", "my_account"].includes(post?.source_type));
}

export function buildFrontendAnalysis(snapshot = {}) {
  const sourceRows = Array.isArray(snapshot.posts) ? snapshot.posts.filter(isOwnPost) : [];
  const seen = new Set();
  const posts = [];
  let duplicateCount = 0;

  sourceRows.forEach(post => {
    const key = postKey(post);
    if (seen.has(key)) {
      duplicateCount += 1;
      return;
    }
    seen.add(key);
    posts.push(normalizePost(post));
  });

  const totals = METRIC_KEYS.reduce((result, key) => {
    result[key] = posts.reduce((sum, post) => sum + post[key], 0);
    return result;
  }, {});
  totals.total_interactions = METRIC_KEYS.reduce((sum, key) => sum + totals[key], 0);

  const interactionValues = posts.map(post => post.total_engagement);
  const medianInteractions = median(interactionValues);
  const averageInteractions = posts.length
    ? totals.total_interactions / posts.length
    : 0;
  const highestRelativePerformance = medianInteractions > 0
    ? Math.max(...posts.map(post => post.total_engagement / medianInteractions), 0)
    : 0;
  const fingerprint = hash(posts
    .map(post => `${postKey(post)}:${post.total_engagement}`)
    .sort()
    .join("\u001e"));

  return {
    version: "frontend-analysis-v1",
    computed_at: new Date().toISOString(),
    source_post_count: sourceRows.length,
    sample_count: posts.length,
    duplicate_count: duplicateCount,
    posts,
    totals,
    median_interactions: medianInteractions,
    average_interactions: averageInteractions,
    highest_relative_performance: highestRelativePerformance,
    fingerprint
  };
}

export function buildAnalysisSyncPayload(snapshot = {}, analysis = buildFrontendAnalysis(snapshot)) {
  const latest = Array.isArray(snapshot.history) ? snapshot.history[0] || {} : {};
  return {
    sync_id: `analysis-${analysis.fingerprint}`,
    analysis_version: analysis.version,
    computed_at: analysis.computed_at,
    source_post_count: analysis.source_post_count,
    sample_count: analysis.sample_count,
    duplicate_count: analysis.duplicate_count,
    totals: { ...analysis.totals },
    latest_scrape: {
      fetched: Number(latest.fetched ?? latest.saved ?? 0) || 0,
      inserted: Number(latest.inserted ?? 0) || 0,
      duplicates: Number(latest.duplicates ?? 0) || 0,
      updated: Number(latest.updated ?? 0) || 0,
      skipped_limit: Number(latest.skipped_limit ?? 0) || 0
    }
  };
}

