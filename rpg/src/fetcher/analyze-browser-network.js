import { readFile } from 'node:fs/promises';
import { normalizeUsername } from './threads-public.js';

const input = process.argv[2] || '@runing_9to5';
const username = normalizeUsername(input);
const reportPath = new URL(`../../debug/${username}.browser-login-network.json`, import.meta.url);

function collectKeys(value, out = new Set(), depth = 0) {
  if (value == null || depth > 6) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out, depth + 1);
    return out;
  }
  if (typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    out.add(key);
    collectKeys(child, out, depth + 1);
  }
  return out;
}

function scoreEntry(entry) {
  const friendly = entry.friendlyName || '';
  const variables = entry.variables || null;
  const response = entry.response || null;
  const keys = [...collectKeys(variables)];
  const responsePrefix = response?.responsePrefix || '';
  const reasons = [];
  let score = 0;

  const hasCursorVariable = Boolean(
    entry.pagination?.after || entry.pagination?.before ||
    keys.includes('cursor') || keys.includes('end_cursor') || keys.includes('next_cursor')
  );
  const hasWindowVariable = Boolean(
    entry.pagination?.first != null || entry.pagination?.last != null ||
    keys.includes('first') || keys.includes('last') || keys.includes('limit')
  );
  const hasProfileVariable = keys.some((key) => /^(userID|user_id|profileID|profile_id|target_user_id)$/i.test(key));
  const nameLooksFeedLike = /Profile|Threads|Feed|Posts|Timeline|TextPosts/i.test(friendly);
  const nameLooksCountOnly = /DynamicPostCounts|PostCounts|Subscription/i.test(friendly) || keys.includes('post_ids');
  const responseHasPageInfo = /page_info|end_cursor|has_next_page|next_cursor/i.test(responsePrefix);
  const responseHasFeedShape = /thread_items|edges|text_post|caption|taken_at/i.test(responsePrefix);

  if (hasCursorVariable) {
    score += 10;
    reasons.push('request_has_cursor');
  }
  if (hasWindowVariable) {
    score += 4;
    reasons.push('request_has_window');
  }
  if (hasProfileVariable) {
    score += 5;
    reasons.push('request_has_profile_id');
  }
  if (nameLooksFeedLike) {
    score += 4;
    reasons.push('friendly_name_feed_like');
  }
  if (response?.nextCursor) {
    score += 12;
    reasons.push('response_has_next_cursor');
  }
  if (response?.hasNextPage != null) {
    score += 8;
    reasons.push('response_has_next_page');
  }
  if ((response?.postCodeCount || 0) > 0) {
    score += 6;
    reasons.push(`response_has_${response.postCodeCount}_post_codes`);
  }
  if (responseHasPageInfo) {
    score += 8;
    reasons.push('response_prefix_has_page_info');
  }
  if (responseHasFeedShape) {
    score += 4;
    reasons.push('response_prefix_looks_like_feed');
  }
  if (nameLooksCountOnly) {
    score -= 20;
    reasons.push('dynamic_counts_not_pagination');
  }

  return {
    score,
    reasons,
    variableKeys: keys.sort(),
    likelyCountOnly: nameLooksCountOnly
  };
}

let report;
try {
  report = JSON.parse(await readFile(reportPath, 'utf8'));
} catch (error) {
  console.error(`Cannot read ${reportPath.pathname}: ${String(error?.message || error)}`);
  console.error('Run `npm run fetch:browser-login-network -- @username` first.');
  process.exit(2);
}

const entries = Array.isArray(report.graphqlRequests) ? report.graphqlRequests : [];
const ranked = entries
  .map((entry) => ({ entry, analysis: scoreEntry(entry) }))
  .sort((a, b) => b.analysis.score - a.analysis.score || a.entry.index - b.entry.index);

const compact = ({ entry, analysis }) => ({
  index: entry.index,
  score: analysis.score,
  reasons: analysis.reasons,
  endpoint: entry.endpoint,
  friendlyName: entry.friendlyName,
  docId: entry.docId,
  pagination: entry.pagination,
  variableKeys: analysis.variableKeys,
  variables: entry.variables,
  response: entry.response,
  likelyCountOnly: analysis.likelyCountOnly
});

const candidates = ranked.filter(({ analysis }) => analysis.score > 0 && !analysis.likelyCountOnly).slice(0, 15);
const rejectedCountQueries = ranked.filter(({ analysis }) => analysis.likelyCountOnly).map(compact);

console.log(JSON.stringify({
  username,
  sourceReport: `debug/${username}.browser-login-network.json`,
  totalGraphqlRequests: entries.length,
  candidateCount: candidates.length,
  candidates: candidates.map(compact),
  rejectedDynamicCountQueries: rejectedCountQueries.slice(0, 10)
}, null, 2));
