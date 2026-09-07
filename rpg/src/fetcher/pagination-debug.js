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
  'relay',
  'pagination',
  'next_page',
  'next_cursor'
];

function findOccurrences(text, needle, context = 260, limit = 30) {
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

const scriptPattern = new RegExp('<script\\b[^>]*>([\\s\\S]*?)<\\/script>', 'gi');
const scripts = [...source.matchAll(scriptPattern)].map((match, index) => ({
  index,
  bytes: Buffer.byteLength(match[1] || '', 'utf8'),
  containsCursorTerms: /end_cursor|has_next_page|page_info|next_cursor|pagination/i.test(match[1] || ''),
  containsGraphqlTerms: /doc_id|query_id|graphql|relay/i.test(match[1] || '')
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

const hasNextPageValues = [...source.matchAll(/"has_next_page"\s*:\s*(true|false)/g)].map((m) => m[1] === 'true');

const report = {
  fetchedAt: new Date().toISOString(),
  username,
  status: response.status,
  htmlBytes: Buffer.byteLength(html, 'utf8'),
  summary: {
    cursorCount: cursors.length,
    docIdCount: docIds.length,
    queryIdCount: queryIds.length,
    hasNextPageValues,
    scriptsWithCursorTerms: scripts.filter((s) => s.containsCursorTerms).map((s) => s.index),
    scriptsWithGraphqlTerms: scripts.filter((s) => s.containsGraphqlTerms).map((s) => s.index)
  },
  cursors: cursors.slice(0, 20),
  docIds: docIds.slice(0, 50),
  queryIds: queryIds.slice(0, 50),
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
  queryIds: report.queryIds
}, null, 2));

if (!response.ok) process.exitCode = 2;
