import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultInputPath = fileURLToPath(new URL('../../debug/runing_9to5.30posts-http.json', import.meta.url));
const inputPath = resolve(process.argv[2] || defaultInputPath);
const source = JSON.parse(await readFile(inputPath, 'utf8'));
const username = source.username || basename(inputPath).split('.')[0];
const defaultOutputPath = fileURLToPath(new URL(`../../debug/${username}.analysis.json`, import.meta.url));
const outputPath = resolve(process.argv[3] || defaultOutputPath);

const DAY_SECONDS = 86400;
const TARGET_FIELDS = ['likes', 'replies', 'reposts', 'quotes', 'reshares'];

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
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
  if (!values.length) return 0;
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function metricValue(post, field) {
  return finite(post[field]) ?? 0;
}

const rawPosts = Array.isArray(source.posts) ? source.posts : [];
const posts = rawPosts
  .filter((post) => post && finite(post.timestamp) != null)
  .map((post) => {
    const interactions = TARGET_FIELDS.reduce((sum, field) => sum + metricValue(post, field), 0);
    return {
      code: post.code || null,
      url: post.url || null,
      timestamp: finite(post.timestamp),
      timestampIso: post.timestampIso || new Date(Number(post.timestamp) * 1000).toISOString(),
      text: typeof post.text === 'string' ? post.text : null,
      likes: finite(post.likes),
      replies: finite(post.replies),
      reposts: finite(post.reposts),
      quotes: finite(post.quotes),
      reshares: finite(post.reshares),
      interactions
    };
  })
  .sort((a, b) => a.timestamp - b.timestamp);

const interactionValues = posts.map((post) => post.interactions);
const averageInteractions = mean(interactionValues);
const medianInteractions = median(interactionValues);
const maximumInteractions = Math.max(...interactionValues, 0);
const interactionStdDev = standardDeviation(interactionValues, averageInteractions);
const interactionCv = averageInteractions ? interactionStdDev / averageInteractions : 0;
const totalInteractions = interactionValues.reduce((sum, value) => sum + value, 0);
const totalReplies = posts.reduce((sum, post) => sum + metricValue(post, 'replies'), 0);
const totalShares = posts.reduce(
  (sum, post) => sum + metricValue(post, 'reposts') + metricValue(post, 'quotes') + metricValue(post, 'reshares'),
  0
);

const firstTimestamp = posts[0]?.timestamp || null;
const lastTimestamp = posts.at(-1)?.timestamp || null;
const activeDays = firstTimestamp && lastTimestamp
  ? Math.max(1, Math.ceil((lastTimestamp - firstTimestamp) / DAY_SECONDS) + 1)
  : 0;
const postsPerWeek = activeDays ? (posts.length / activeDays) * 7 : 0;
const baseline = medianInteractions;
const highPerformanceCount = baseline > 0
  ? interactionValues.filter((value) => value >= baseline * 1.5).length
  : 0;
const criticalRate = posts.length ? highPerformanceCount / posts.length : 0;
const meanToPeak = maximumInteractions ? Math.log1p(averageInteractions) / Math.log1p(maximumInteractions) : 0;
const medianToPeak = maximumInteractions ? Math.log1p(medianInteractions) / Math.log1p(maximumInteractions) : 0;

// These are intentionally within-account scores. Without follower count or a
// comparison cohort they describe the shape of this sample, not a universal rank.
const dimensions = {
  attack: clamp((meanToPeak * 0.6 + medianToPeak * 0.4) * 100),
  charm: clamp(totalInteractions ? (totalReplies / totalInteractions / 0.4) * 100 : 0),
  agility: clamp((1 - Math.exp(-postsPerWeek / 10)) * 100),
  stability: clamp(100 / (1 + interactionCv)),
  critical: clamp((1 - Math.exp(-criticalRate / 0.25)) * 100)
};

const dimensionRows = [
  { key: 'attack', label: '攻擊', icon: '⚔', score: dimensions.attack, basis: '平均與中位互動相對於樣本峰值' },
  { key: 'charm', label: '魅力', icon: '💬', score: dimensions.charm, basis: '留言占總互動比例' },
  { key: 'agility', label: '敏捷', icon: '⚡', score: dimensions.agility, basis: '樣本期間每週發文頻率' },
  { key: 'stability', label: '穩定', icon: '🛡', score: dimensions.stability, basis: '互動變異係數的反向分數' },
  { key: 'critical', label: '爆擊', icon: '🍀', score: dimensions.critical, basis: '高於自身 baseline 1.5 倍的貼文比例' }
];

const professionCandidates = [
  { key: 'warrior', label: '戰士', description: '高頻輸出型', dimension: 'agility' },
  { key: 'bard', label: '吟遊詩人', description: '討論互動型', dimension: 'charm' },
  { key: 'assassin', label: '刺客', description: '爆擊型', dimension: 'critical' },
  { key: 'knight', label: '騎士', description: '穩定經營型', dimension: 'stability' }
];
const battlePower = round(mean(dimensionRows.map((row) => row.score)));
const strongest = [...professionCandidates].sort((a, b) => dimensions[b.dimension] - dimensions[a.dimension])[0];
const profession = posts.length < 10
  ? { key: 'villager', label: '村民', description: '有效樣本不足', basis: '樣本少於 10 篇' }
  : { ...strongest, basis: `${strongest.label}取決於${dimensionRows.find((row) => row.key === strongest.dimension).label}分數最高` };
const level = posts.length ? Math.max(1, Math.min(99, Math.round(battlePower / 10))) : 1;

const coverage = Object.fromEntries(TARGET_FIELDS.map((field) => [
  field,
  {
    available: posts.filter((post) => finite(post[field]) != null).length,
    total: posts.length,
    rate: posts.length ? round(posts.filter((post) => finite(post[field]) != null).length / posts.length, 4) : 0
  }
]));

const report = {
  generatedAt: new Date().toISOString(),
  username,
  source: {
    input: inputPath,
    transport: source.transport || null,
    fetchSuccess: source.success === true,
    browserUsed: source.browserUsed === true,
    loginUsed: source.loginUsed === true,
    sampleCount: posts.length,
    requestedCount: 30,
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
  dimensions: dimensionRows.map((row) => ({ ...row, score: round(row.score) })),
  level,
  battlePower,
  profession,
  disabled: {
    mage: '文字分析尚未啟用，避免把文字品質假設成數值分數'
  },
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

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');

console.log(JSON.stringify({
  username,
  sampleCount: report.source.sampleCount,
  battlePower: report.battlePower,
  profession: report.profession.label,
  dimensions: report.dimensions.map(({ label, score }) => ({ label, score })),
  outputFile: outputPath
}, null, 2));
