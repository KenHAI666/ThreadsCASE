// Shared source of truth for the public card and the local Radar card.
// It accepts both the extension's IndexedDB post shape and the public fetcher's shape.
export const TARGET_FIELDS = ['likes', 'replies', 'reposts', 'quotes', 'reshares'];

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values, average = mean(values)) {
  return values.length ? Math.sqrt(mean(values.map((value) => (value - average) ** 2))) : 0;
}

function timestampFor(post) {
  const seconds = finite(post.timestamp);
  if (seconds != null) return seconds;
  const raw = post.timestampIso || post.published_at || post.posted_at || post.scraped_at;
  const milliseconds = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(milliseconds) ? milliseconds / 1000 : null;
}

function fieldValue(post, field) {
  if (field === 'reposts') return finite(post.reposts) ?? finite(post.shares);
  return finite(post[field]);
}

function normalizePost(post) {
  const timestamp = timestampFor(post);
  const normalized = {
    code: post.code ?? post.post_id ?? null,
    url: post.url ?? post.post_url ?? null,
    timestamp,
    timestampIso: timestamp == null ? null : (post.timestampIso || new Date(timestamp * 1000).toISOString()),
    text: typeof post.text === 'string' ? post.text : null
  };
  for (const field of TARGET_FIELDS) normalized[field] = fieldValue(post, field);
  normalized.interactions = TARGET_FIELDS.reduce((sum, field) => sum + (normalized[field] ?? 0), 0);
  return normalized;
}

export function analyzeCatPosts(inputPosts, options = {}) {
  const rawPosts = Array.isArray(inputPosts) ? inputPosts : [];
  const posts = rawPosts.map(normalizePost).filter((post) => post.timestamp != null).sort((a, b) => a.timestamp - b.timestamp);
  const username = options.username || rawPosts.find((post) => post?.username)?.username || null;
  const interactionValues = posts.map((post) => post.interactions);
  const averageInteractions = mean(interactionValues);
  const medianInteractions = median(interactionValues);
  const maximumInteractions = Math.max(...interactionValues, 0);
  const interactionStdDev = standardDeviation(interactionValues, averageInteractions);
  const interactionCv = averageInteractions ? interactionStdDev / averageInteractions : 0;
  const totalInteractions = interactionValues.reduce((sum, value) => sum + value, 0);
  const totalReplies = posts.reduce((sum, post) => sum + (post.replies ?? 0), 0);
  const totalShares = posts.reduce((sum, post) => sum + (post.reposts ?? 0) + (post.quotes ?? 0) + (post.reshares ?? 0), 0);
  const firstTimestamp = posts[0]?.timestamp || null;
  const lastTimestamp = posts.at(-1)?.timestamp || null;
  const activeDays = firstTimestamp && lastTimestamp ? Math.max(1, Math.ceil((lastTimestamp - firstTimestamp) / 86400) + 1) : 0;
  const postsPerWeek = activeDays ? (posts.length / activeDays) * 7 : 0;
  const baseline = medianInteractions;
  const highPerformanceCount = baseline > 0 ? interactionValues.filter((value) => value >= baseline * 1.5).length : 0;
  const criticalRate = posts.length ? highPerformanceCount / posts.length : 0;
  const meanToPeak = maximumInteractions ? Math.log1p(averageInteractions) / Math.log1p(maximumInteractions) : 0;
  const medianToPeak = maximumInteractions ? Math.log1p(medianInteractions) / Math.log1p(maximumInteractions) : 0;
  const scores = {
    attack: clamp((meanToPeak * 0.6 + medianToPeak * 0.4) * 100),
    charm: clamp(totalInteractions ? (totalReplies / totalInteractions / 0.4) * 100 : 0),
    agility: clamp((1 - Math.exp(-postsPerWeek / 10)) * 100),
    stability: clamp(100 / (1 + interactionCv)),
    critical: clamp((1 - Math.exp(-criticalRate / 0.25)) * 100)
  };
  const dimensionRows = [
    { key: 'attack', label: '攻擊', icon: '⚔', score: round(scores.attack), basis: '平均與中位互動相對於樣本峰值' },
    { key: 'charm', label: '魅力', icon: '💬', score: round(scores.charm), basis: '留言占總互動比例' },
    { key: 'agility', label: '敏捷', icon: '⚡', score: round(scores.agility), basis: '樣本期間每週發文頻率' },
    { key: 'stability', label: '穩定', icon: '🛡', score: round(scores.stability), basis: '互動變異係數的反向分數' },
    { key: 'critical', label: '爆擊', icon: '🍀', score: round(scores.critical), basis: '高於自身 baseline 1.5 倍的貼文比例' }
  ];
  const professionCandidates = [
    { key: 'warrior', label: '戰士', description: '高頻輸出型', dimension: 'agility' },
    { key: 'bard', label: '吟遊詩人', description: '討論互動型', dimension: 'charm' },
    { key: 'assassin', label: '刺客', description: '爆擊型', dimension: 'critical' },
    { key: 'knight', label: '騎士', description: '穩定經營型', dimension: 'stability' }
  ];
  const battlePower = round(mean(dimensionRows.map((row) => row.score)));
  const strongest = [...professionCandidates].sort((a, b) => scores[b.dimension] - scores[a.dimension])[0];
  const profession = posts.length < 10
    ? { key: 'villager', label: '村民', description: '有效樣本不足', basis: '樣本少於 10 篇' }
    : { ...strongest, basis: `${strongest.label}取決於${dimensionRows.find((row) => row.key === strongest.dimension).label}分數最高` };
  const coverage = Object.fromEntries(TARGET_FIELDS.map((field) => {
    const available = posts.filter((post) => post[field] != null).length;
    return [field, { available, total: posts.length, rate: posts.length ? round(available / posts.length, 4) : 0 }];
  }));
  return {
    generatedAt: options.generatedAt || new Date().toISOString(),
    username,
    source: {
      ...(options.inputPath ? { input: options.inputPath } : {}),
      transport: options.transport || null,
      fetchSuccess: options.fetchSuccess ?? true,
      browserUsed: options.browserUsed === true,
      loginUsed: options.loginUsed === true,
      sampleCount: posts.length,
      requestedCount: Number(options.requestedCount || 100),
      scoreScope: 'within-account sample; no follower-normalized cross-account ranking'
    },
    coverage,
    sample: {
      firstTimestamp,
      lastTimestamp,
      firstDate: firstTimestamp ? new Date(firstTimestamp * 1000).toISOString() : null,
      lastDate: lastTimestamp ? new Date(lastTimestamp * 1000).toISOString() : null,
      activeDays,
      postsPerWeek: round(postsPerWeek),
      totalInteractions,
      averageInteractions: round(averageInteractions),
      medianInteractions: round(medianInteractions),
      maximumInteractions,
      interactionStdDev: round(interactionStdDev),
      interactionCv: round(interactionCv, 4),
      totalReplies,
      replyShare: totalInteractions ? round(totalReplies / totalInteractions, 4) : 0,
      totalShares,
      highPerformanceCount,
      criticalRate: round(criticalRate, 4)
    },
    dimensions: dimensionRows,
    level: posts.length ? Math.max(1, Math.min(99, Math.round(battlePower / 10))) : 1,
    battlePower,
    profession,
    disabled: { mage: '文字分析尚未啟用，避免把文字品質假設成數值分數' },
    posts: posts.map((post) => ({
      code: post.code,
      url: post.url,
      timestamp: post.timestamp,
      timestampIso: post.timestampIso,
      interactions: post.interactions,
      likes: post.likes,
      replies: post.replies,
      reposts: post.reposts,
      quotes: post.quotes,
      reshares: post.reshares
    }))
  };
}
