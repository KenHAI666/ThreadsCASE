import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeUsername } from './threads-public.js';

const THREADS_ORIGIN = 'https://www.threads.com';
const input = process.argv[2] || '@runing_9to5';
const username = normalizeUsername(input);
const url = `${THREADS_ORIGIN}/@${encodeURIComponent(username)}`;

const response = await fetch(url, {
  redirect: 'follow',
  headers: {
    'user-agent': 'Mozilla/5.0 (compatible; ThreadsRPGPoC/0.1; +https://runing9to5.com)',
    accept: 'text/html,application/xhtml+xml',
    'accept-language': 'zh-TW,zh;q=0.9,en;q=0.7'
  }
});

const html = await response.text();
const source = html.replaceAll('\\"', '"');

await mkdir(new URL('../../debug/', import.meta.url), { recursive: true });
const reportPath = new URL(`../../debug/${username}.pagination.json`, import.meta.url);

const probeNames = [
  'end_cursor',
  'has_next_page',
  'page_info',
  'cursor',
  'after',
  'before',
  'doc_id',
  'query_id',
  'graphql',
  'relay',
  'pagination',
  'next_page',
  'next_cursor',
  'operationName',
  'fb_api_req_friendly_name',
  'variables',
  'lsd',
  '__a',
  'comet_req'
];

function findOccurrences(text, needle, context = 500, limit = 30) {
  const hits = [];
  let index = 0;
  while ((index = text.indexOf(needle, index)) !== -1 && hits.length < limit) {
    hits.push({
      index,
      context: text.slice(Math.max(0, index - context), Math.min(text.length, index + needle.length + context))
    });
    index += needle.length;
  }
  return hits;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function contextForValue(text, value, radius = 1800) {
  const index = text.indexOf(value);
  if (index === -1) return null;
  return {
    index,
    context: text.slice(Math.max(0, index - radius), Math.min(text.length, index + value.length + radius))
  };
}

const scriptPattern = new RegExp('<script\\b([^>]*)>([\\s\\S]*?)<\\/script>', 'gi');
const scriptMatches = [...source.matchAll(scriptPattern)];
const scripts = scriptMatches.map((match, index) => ({
  index,
  bytes: Buffer.byteLength(match[2] || '', 'utf8'),
  src: match[1]?.match(/\\bsrc=["']([^"']+)["']/i)?.[1] || null,
  containsCursorTerms: /end_cursor|has_next_page|page_info|next_cursor|pagination/i.test(match[2] || ''),
  containsGraphqlTerms: /doc_id|query_id|graphql|relay|operationName|fb_api_req_friendly_name/i.test(match[2] || '')
}));

const cursors = unique([
  ...[...source.matchAll(/"end_cursor"\s*:\s*"([^"]+)"/g)].map((m) => m[1]),
  ...[...source.matchAll(/"next_cursor"\s*:\s*"([^"]+)"/g)].map((m) => m[1]),
  ...[...source.matchAll(/"cursor"\s*:\s*"([^"]{8,})"/g)].map((m) => m[1])
]);

const docIds = unique([
  ...[...source.matchAll(/"doc_id"\s*:\s*"?(\d{5,})"?/g)].map((m) => m[1]),
  ...[...source.matchAll(/doc_id[=:\\"']+(\d{5,})/g)].map((m) => m[1])
]);

const queryIds = unique([
  ...[...source.matchAll(/"query_id"\s*:\s*"?([A-Za-z0-9_-]{5,})"?/g)].map((m) => m[1])
]);

const operationNames = unique([
  ...[...source.matchAll(/"operationName"\s*:\s*"([^"]+)"/g)].map((m) => m[1]),
  ...[...source.matchAll(/"fb_api_req_friendly_name"\s*:\s*"([^"]+)"/g)].map((m) => m[1]),
  ...[...source.matchAll(/(?:Query|Mutation|Subscription):([A-Za-z0-9_]+)/g)].map((m) => m[1])
]);

const hasNextPageValues = [...source.matchAll(/"has_next_page"\s*:\s*(true|false)/g)].map((m) => m[1] === 'true');

const cursorContexts = cursors
  .map((cursor) => ({ cursor, ...contextForValue(source, cursor, 2200) }))
  .filter((item) => item.index != null);

const paginationContexts = [
  ...findOccurrences(source, 'page_info', 1400, 10),
  ...findOccurrences(source, 'has_next_page', 1400, 10),
  ...findOccurrences(source, 'end_cursor', 1400, 10)
];

const graphQlContexts = [
  ...findOccurrences(source, 'graphql', 900, 10),
  ...findOccurrences(source, 'operationName', 900, 10),
  ...findOccurrences(source, 'fb_api_req_friendly_name', 900, 10),
  ...findOccurrences(source, 'doc_id', 900, 10)
];

const report = {
  fetchedAt: new Date().toISOString(),
  username,
  status: response.status,
  htmlBytes: Buffer.byteLength(html, 'utf8'),
  summary: {
    cursorCount: cursors.length,
    docIdCount: docIds.length,
    queryIdCount: queryIds.length,
    operationNameCount: operationNames.length,
    hasNextPageValues,
    scriptsWithCursorTerms: scripts.filter((s) => s.containsCursorTerms).map((s) => s.index),
    scriptsWithGraphqlTerms: scripts.filter((s) => s.containsGraphqlTerms).map((s) => s.index)
  },
  cursors: cursors.slice(0, 20),
  docIds: docIds.slice(0, 50),
  queryIds: queryIds.slice(0, 50),
  operationNames: operationNames.slice(0, 50),
  cursorContexts,
  paginationContexts,
  graphQlContexts,
  probes: Object.fromEntries(probeNames.map((name) => [name, findOccurrences(source, name)])),
  scripts
};

await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

console.log(JSON.stringify({
  username,
  status: response.status,
  htmlBytes: report.htmlBytes,
  reportFile: `debug/${username}.pagination.json`,
  ...report.summary,
  cursors: report.cursors,
  docIds: report.docIds,
  queryIds: report.queryIds,
  operationNames: report.operationNames,
  cursorContextPreview: report.cursorContexts[0]?.context || null
}, null, 2));

if (!response.ok) process.exitCode = 2;
