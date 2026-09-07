import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeUsername } from './threads-public.js';

const THREADS_ORIGIN = 'https://www.threads.com';
const GRAPHQL_URL = `${THREADS_ORIGIN}/api/graphql`;
const PROFILE_THREADS_DOC_ID = '33773912952222602';
const CRAWLER_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
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
  'next_cursor',
  'user_id',
  'LSD'
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

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1] || null;
  }
  return null;
}

function extractUserId(text, handle) {
  const escapedHandle = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return firstMatch(text, [
    new RegExp(`"username"\\s*:\\s*"${escapedHandle}"[\\s\\S]{0,2500}?"pk"\\s*:\\s*"(\\d+)"`, 'i'),
    new RegExp(`"username"\\s*:\\s*"${escapedHandle}"[\\s\\S]{0,2500}?"id"\\s*:\\s*"(\\d+)"`, 'i'),
    /"user_id"\s*:\s*"(\d+)"/i,
    /"user_id"\s*:\s*(\d+)/i
  ]);
}

function extractLsdToken(text) {
  return firstMatch(text, [
    /"LSD"\s*,\s*\[\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/i,
    /"token"\s*:\s*"([A-Za-z0-9_-]{10,})"[\s\S]{0,120}?"LSD"/i,
    /"LSD"[\s\S]{0,180}?"token"\s*:\s*"([^"]+)"/i
  ]);
}

function stripJsonGuard(text) {
  return text.replace(/^\s*for\s*\(;;\);\s*/, '').trim();
}

function collectErrorMessages(value, output = [], depth = 0) {
  if (depth > 8 || output.length >= 20 || value == null) return output;
  if (typeof value === 'string') return output;
  if (Array.isArray(value)) {
    for (const item of value) collectErrorMessages(item, output, depth + 1);
    return output;
  }
  if (typeof value !== 'object') return output;

  for (const [key, child] of Object.entries(value)) {
    if (['message', 'error_user_msg', 'errorSummary', 'errorDescription'].includes(key) && typeof child === 'string') {
      output.push(child);
    } else {
      collectErrorMessages(child, output, depth + 1);
    }
  }
  return output;
}

function inspectGraphqlText(text, contentType) {
  const normalized = text.replaceAll('\\"', '"');
  const guarded = stripJsonGuard(text);
  let parsed = null;
  let jsonParseError = null;

  try {
    parsed = JSON.parse(guarded);
  } catch (error) {
    jsonParseError = String(error?.message || error);
  }

  const postCodes = unique([
    ...[...normalized.matchAll(/"code"\s*:\s*"([A-Za-z0-9_-]+)"/g)].map((m) => m[1]),
    ...[...normalized.matchAll(/\\"code\\"\s*:\s*\\"([A-Za-z0-9_-]+)\\"/g)].map((m) => m[1])
  ]);
  const nextCursor = firstMatch(normalized, [
    /"end_cursor"\s*:\s*"([^"]+)"/,
    /"next_cursor"\s*:\s*"([^"]+)"/
  ]);
  const hasNext = normalized.match(/"has_next_page"\s*:\s*(true|false)/)?.[1] ?? null;

  return {
    contentType: contentType || null,
    looksLikeHtml: /^\s*<!doctype html|^\s*<html/i.test(text),
    responsePrefix: text.slice(0, 220),
    jsonParsed: Boolean(parsed),
    jsonParseError,
    topLevelKeys: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).slice(0, 30) : [],
    errorMessages: unique(collectErrorMessages(parsed)).slice(0, 20),
    postCodeCount: postCodes.length,
    postCodes: postCodes.slice(0, 20),
    nextCursor,
    hasNextPage: hasNext == null ? null : hasNext === 'true',
    fieldSignals: {
      data: normalized.includes('"data"'),
      errors: normalized.includes('"errors"'),
      code: normalized.includes('"code"'),
      takenAt: normalized.includes('"taken_at"'),
      threadItems: normalized.includes('thread_items'),
      pageInfo: normalized.includes('page_info'),
      endCursor: normalized.includes('end_cursor')
    }
  };
}

function relayProviderVars() {
  return {
    __relay_internal__pv__BarcelonaIsLoggedInrelayprovider: false,
    __relay_internal__pv__BarcelonaIsInternalUserrelayprovider: false,
    __relay_internal__pv__BarcelonaIsCrawlerrelayprovider: true,
    __relay_internal__pv__BarcelonaOptionalCookiesEnabledrelayprovider: true,
    __relay_internal__pv__BarcelonaIsLoggedOutrelayprovider: true
  };
}

async function tryGraphqlPage({ userId, cursor, lsd }) {
  if (!userId || !cursor || !lsd) {
    return {
      attempted: false,
      reason: !userId ? 'user_id_not_found' : !cursor ? 'cursor_not_found' : 'lsd_not_found'
    };
  }

  const variables = {
    userID: userId,
    after: cursor,
    ...relayProviderVars()
  };

  const requestCandidates = [
    { label: 'page-lsd', requestLsd: lsd, variables },
    { label: 'static-lsd-t', requestLsd: 't', variables }
  ];

  const attempts = [];

  for (let attemptIndex = 0; attemptIndex < requestCandidates.length; attemptIndex += 1) {
    const candidate = requestCandidates[attemptIndex];
    const body = new URLSearchParams();
    body.set('lsd', candidate.requestLsd);
    body.set('doc_id', PROFILE_THREADS_DOC_ID);
    body.set('variables', JSON.stringify(candidate.variables));

    try {
      const graphqlResponse = await fetch(GRAPHQL_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: {
          'user-agent': CRAWLER_UA,
          accept: '*/*',
          'accept-language': 'zh-TW,zh;q=0.9,en;q=0.7',
          'content-type': 'application/x-www-form-urlencoded',
          origin: THREADS_ORIGIN,
          referer: url,
          'x-fb-friendly-name': 'BarcelonaProfileThreadsTabQuery',
          'x-fb-lsd': candidate.requestLsd,
          'x-ig-app-id': '238260118697367'
        },
        body
      });

      const text = await graphqlResponse.text();
      const inspection = inspectGraphqlText(text, graphqlResponse.headers.get('content-type'));
      const probePath = new URL(`../../debug/${username}.pagination-probe-${attemptIndex + 1}.txt`, import.meta.url);
      await writeFile(probePath, text, 'utf8');

      attempts.push({
        attempt: attemptIndex + 1,
        label: candidate.label,
        variables: candidate.variables,
        lsdMode: candidate.requestLsd === 't' ? 'static-t' : 'page-token',
        status: graphqlResponse.status,
        ok: graphqlResponse.ok,
        bytes: Buffer.byteLength(text, 'utf8'),
        probeFile: `debug/${username}.pagination-probe-${attemptIndex + 1}.txt`,
        ...inspection
      });

      if (graphqlResponse.ok && inspection.postCodeCount) break;
    } catch (error) {
      attempts.push({
        attempt: attemptIndex + 1,
        label: candidate.label,
        variables: candidate.variables,
        error: String(error?.message || error)
      });
    }
  }

  return {
    attempted: true,
    docId: PROFILE_THREADS_DOC_ID,
    attempts
  };
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

const operationNames = unique([
  ...[...source.matchAll(/"operationName"\s*:\s*"([^"]+)"/g)].map((m) => m[1]),
  ...[...source.matchAll(/"operation_name"\s*:\s*"([^"]+)"/g)].map((m) => m[1]),
  ...[...source.matchAll(/Barcelona[A-Za-z0-9_]+Query/g)].map((m) => m[0])
]);

const hasNextPageValues = [...source.matchAll(/"has_next_page"\s*:\s*(true|false)/g)].map((m) => m[1] === 'true');
const firstCursor = cursors[0] || null;
const firstCursorIndex = firstCursor ? source.indexOf(firstCursor) : -1;
const cursorContextPreview = firstCursorIndex >= 0
  ? source.slice(Math.max(0, firstCursorIndex - 2200), Math.min(source.length, firstCursorIndex + firstCursor.length + 2200))
  : null;
const userId = extractUserId(source, username);
const lsd = extractLsdToken(source);
const graphqlProbe = await tryGraphqlPage({ userId, cursor: firstCursor, lsd });

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
    scriptsWithGraphqlTerms: scripts.filter((s) => s.containsGraphqlTerms).map((s) => s.index),
    userIdFound: Boolean(userId),
    lsdFound: Boolean(lsd)
  },
  cursors: cursors.slice(0, 20),
  docIds: docIds.slice(0, 50),
  queryIds: queryIds.slice(0, 50),
  operationNames: operationNames.slice(0, 50),
  userId,
  lsdPreview: lsd ? `${lsd.slice(0, 6)}…` : null,
  cursorContextPreview,
  graphqlProbe,
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
  userId: report.userId,
  lsdPreview: report.lsdPreview,
  graphqlProbe: report.graphqlProbe,
  cursorContextPreview: report.cursorContextPreview
}, null, 2));

if (!response.ok) process.exitCode = 2;
