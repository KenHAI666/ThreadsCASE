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
await mkdir(new URL('../../debug/', import.meta.url), { recursive: true });

const htmlPath = new URL(`../../debug/${username}.html`, import.meta.url);
const reportPath = new URL(`../../debug/${username}.report.json`, import.meta.url);
const candidatesPath = new URL(`../../debug/${username}.candidates.json`, import.meta.url);

await writeFile(htmlPath, html, 'utf8');

const probes = [
  'like_count',
  'direct_reply_count',
  'reply_count',
  'repost_count',
  'quote_count',
  'text_post_app_info',
  'taken_at',
  'caption',
  'followers',
  'follower_count',
  'user_count',
  'Dbam7lLGAeu'
];

function findOccurrences(source, needle, context = 180) {
  const hits = [];
  let index = 0;
  while ((index = source.indexOf(needle, index)) !== -1 && hits.length < 20) {
    hits.push({
      index,
      context: source.slice(Math.max(0, index - context), Math.min(source.length, index + needle.length + context))
    });
    index += needle.length;
  }
  return hits;
}

function firstMatch(source, patterns) {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return match[1] ?? null;
  }
  return null;
}

function numberMatch(source, names) {
  const patterns = names.flatMap((name) => [
    new RegExp(`"${name}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`),
    new RegExp(`\\\\"${name}\\\\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`)
  ]);
  const raw = firstMatch(source, patterns);
  return raw == null ? null : Number(raw);
}

function stringMatch(source, names) {
  const patterns = names.flatMap((name) => [
    new RegExp(`"${name}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`),
    new RegExp(`\\\\"${name}\\\\"\\s*:\\s*\\\\"((?:\\\\\\\\.|[^\\\\"])*)\\\\"`)
  ]);
  const raw = firstMatch(source, patterns);
  if (raw == null) return null;
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch {
    return raw;
  }
}

function findTakenAtIndexes(source) {
  const indexes = new Set();
  for (const needle of ['"taken_at":', '\\"taken_at\\":']) {
    let index = 0;
    while ((index = source.indexOf(needle, index)) !== -1) {
      indexes.add(index);
      index += needle.length;
    }
  }
  return [...indexes].sort((a, b) => a - b);
}

function extractCandidateWindows(source) {
  const windows = [];
  const seen = new Set();

  for (const index of findTakenAtIndexes(source)) {
    const start = Math.max(0, index - 9000);
    const end = Math.min(source.length, index + 5000);
    const chunk = source.slice(start, end);
    const takenAt = numberMatch(chunk, ['taken_at']);
    const code = stringMatch(chunk, ['code']);
    const id = stringMatch(chunk, ['pk', 'id']);
    const key = `${takenAt || index}:${code || id || 'unknown'}`;

    if (!seen.has(key)) {
      seen.add(key);
      windows.push({ index, chunk });
    }
  }

  return windows;
}

function normalizeCandidate({ index, chunk }) {
  const code = stringMatch(chunk, ['code']);
  const text = stringMatch(chunk, ['text']);
  const captionText = stringMatch(chunk, ['caption_text']);
  const takenAt = numberMatch(chunk, ['taken_at']);

  return {
    sourceIndex: index,
    code,
    id: stringMatch(chunk, ['pk', 'id']),
    text: text || captionText,
    timestamp: takenAt,
    timestampIso: takenAt ? new Date(takenAt * 1000).toISOString() : null,
    likes: numberMatch(chunk, ['like_count']),
    replies: numberMatch(chunk, ['direct_reply_count', 'reply_count']),
    reposts: numberMatch(chunk, ['repost_count']),
    quotes: numberMatch(chunk, ['quote_count']),
    reshares: numberMatch(chunk, ['reshare_count']),
    detectedLanguage: stringMatch(chunk, ['detected_language']),
    url: code ? `${THREADS_ORIGIN}/@${username}/post/${code}` : null
  };
}

const candidates = extractCandidateWindows(html)
  .map(normalizeCandidate)
  .filter((candidate) => candidate.timestamp || candidate.likes != null || candidate.code);

const scriptPattern = new RegExp('<script\\b[^>]*>([\\s\\S]*?)<\\/script>', 'gi');
const scripts = [...html.matchAll(scriptPattern)].map((match, i) => ({
  index: i,
  bytes: Buffer.byteLength(match[1] || '', 'utf8'),
  hasJsonLikeData: (match[1] || '').includes('{')
}));

const report = {
  fetchedAt: new Date().toISOString(),
  username,
  url: response.url,
  status: response.status,
  ok: response.ok,
  htmlBytes: Buffer.byteLength(html, 'utf8'),
  scripts,
  probes: Object.fromEntries(probes.map((probe) => [probe, findOccurrences(html, probe)]))
};

await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
await writeFile(candidatesPath, JSON.stringify(candidates, null, 2), 'utf8');

console.log(JSON.stringify({
  username,
  status: response.status,
  htmlBytes: report.htmlBytes,
  htmlFile: `debug/${username}.html`,
  reportFile: `debug/${username}.report.json`,
  candidatesFile: `debug/${username}.candidates.json`,
  candidateCount: candidates.length,
  candidates,
  probeCounts: Object.fromEntries(Object.entries(report.probes).map(([key, hits]) => [key, hits.length]))
}, null, 2));

if (!response.ok) process.exitCode = 2;
