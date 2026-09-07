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

// Threads sometimes embeds hydration JSON as escaped JSON inside script payloads.
// For debug extraction we create a tolerant view with escaped quotes normalized.
const parseSource = html.replace(/\\"/g, '"');

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

function numberField(source, name) {
  const key = `"${name}"`;
  const keyIndex = source.indexOf(key);
  if (keyIndex === -1) return null;
  const colonIndex = source.indexOf(':', keyIndex + key.length);
  if (colonIndex === -1) return null;
  const tail = source.slice(colonIndex + 1, colonIndex + 80);
  const match = tail.match(/^\s*(-?\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function stringField(source, name) {
  const key = `"${name}"`;
  const keyIndex = source.indexOf(key);
  if (keyIndex === -1) return null;
  const colonIndex = source.indexOf(':', keyIndex + key.length);
  if (colonIndex === -1) return null;
  const tail = source.slice(colonIndex + 1);
  const firstQuote = tail.indexOf('"');
  if (firstQuote === -1) return null;
  let escaped = false;
  let value = '';
  for (let i = firstQuote + 1; i < tail.length; i += 1) {
    const ch = tail[i];
    if (escaped) {
      value += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      value += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') break;
    value += ch;
    if (value.length > 10000) break;
  }
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch {
    return value;
  }
}

function allIndexes(source, needle) {
  const indexes = [];
  let index = 0;
  while ((index = source.indexOf(needle, index)) !== -1) {
    indexes.push(index);
    index += needle.length;
  }
  return indexes;
}

function nearestFieldWindow(source, centerIndex) {
  // In current Threads HTML, metrics and caption for one media object occur
  // before taken_at. Keep the window narrower than the gap to neighbouring posts.
  const start = Math.max(0, centerIndex - 6500);
  const end = Math.min(source.length, centerIndex + 1200);
  return source.slice(start, end);
}

function lastNumberField(source, name) {
  const matches = [...source.matchAll(new RegExp(`"${name}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'g'))];
  if (!matches.length) return null;
  return Number(matches.at(-1)[1]);
}

function lastStringField(source, name) {
  const key = `"${name}"`;
  const index = source.lastIndexOf(key);
  if (index === -1) return null;
  return stringField(source.slice(index), name);
}

const takenAtIndexes = allIndexes(parseSource, '"taken_at"');
const candidates = takenAtIndexes.map((index) => {
  const window = nearestFieldWindow(parseSource, index);
  const takenSlice = parseSource.slice(index, index + 120);
  const takenAt = numberField(takenSlice, 'taken_at');
  const code = lastStringField(window, 'code');
  const text = lastStringField(window, 'text') || lastStringField(window, 'caption_text');

  return {
    sourceIndex: index,
    code,
    id: lastStringField(window, 'pk') || lastStringField(window, 'id'),
    text,
    timestamp: takenAt,
    timestampIso: takenAt ? new Date(takenAt * 1000).toISOString() : null,
    likes: lastNumberField(window, 'like_count'),
    replies: lastNumberField(window, 'direct_reply_count') ?? lastNumberField(window, 'reply_count'),
    reposts: lastNumberField(window, 'repost_count'),
    quotes: lastNumberField(window, 'quote_count'),
    reshares: lastNumberField(window, 'reshare_count'),
    detectedLanguage: lastStringField(window, 'detected_language'),
    url: code ? `${THREADS_ORIGIN}/@${username}/post/${code}` : null
  };
}).filter((candidate) => candidate.timestamp != null);

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
  normalizedHtmlBytes: Buffer.byteLength(parseSource, 'utf8'),
  takenAtIndexes,
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
  takenAtIndexCount: takenAtIndexes.length,
  candidateCount: candidates.length,
  candidates,
  probeCounts: Object.fromEntries(Object.entries(report.probes).map(([key, hits]) => [key, hits.length]))
}, null, 2));

if (!response.ok) process.exitCode = 2;
