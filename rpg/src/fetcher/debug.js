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
    'accept': 'text/html,application/xhtml+xml',
    'accept-language': 'zh-TW,zh;q=0.9,en;q=0.7'
  }
});

const html = await response.text();
await mkdir(new URL('../../debug/', import.meta.url), { recursive: true });

const htmlPath = new URL(`../../debug/${username}.html`, import.meta.url);
const reportPath = new URL(`../../debug/${username}.report.json`, import.meta.url);

await writeFile(htmlPath, html, 'utf8');

const probes = [
  'like_count',
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

const report = {
  fetchedAt: new Date().toISOString(),
  username,
  url: response.url,
  status: response.status,
  ok: response.ok,
  htmlBytes: Buffer.byteLength(html, 'utf8'),
  scripts: [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match, i) => ({
    index: i,
    bytes: Buffer.byteLength(match[1] || '', 'utf8'),
    hasJsonLikeData: /\{[\s\S]*\}/.test(match[1] || '')
  })),
  probes: Object.fromEntries(probes.map((probe) => [probe, findOccurrences(html, probe)]))
};

await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

console.log(JSON.stringify({
  username,
  status: response.status,
  htmlBytes: report.htmlBytes,
  htmlFile: `debug/${username}.html`,
  reportFile: `debug/${username}.report.json`,
  probeCounts: Object.fromEntries(Object.entries(report.probes).map(([key, hits]) => [key, hits.length]))
}, null, 2));

if (!response.ok) process.exitCode = 2;
