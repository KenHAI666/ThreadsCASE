import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeUsername } from './threads-public.js';

const THREADS_ORIGIN = 'https://www.threads.com';
const OPERATION_NAME = 'BarcelonaProfileThreadsTabQuery';
const CRAWLER_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const input = process.argv[2] || '@runing_9to5';
const username = normalizeUsername(input);
const profileUrl = `${THREADS_ORIGIN}/@${encodeURIComponent(username)}`;

function decodeEntities(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function collectScriptUrls(html) {
  const urls = [];
  const regex = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const raw = decodeEntities(match[1]);
    if (!raw || raw.startsWith('data:')) continue;
    try {
      urls.push(new URL(raw, THREADS_ORIGIN).href);
    } catch {
      // Ignore malformed script URLs.
    }
  }
  return unique(urls);
}

function extractOperationContexts(source, contextSize = 12000) {
  const contexts = [];
  let index = 0;
  while ((index = source.indexOf(OPERATION_NAME, index)) !== -1 && contexts.length < 10) {
    contexts.push(source.slice(Math.max(0, index - contextSize), Math.min(source.length, index + OPERATION_NAME.length + contextSize)));
    index += OPERATION_NAME.length;
  }
  return contexts;
}

function extractDocIds(context) {
  return unique([
    ...[...context.matchAll(/\bparams\s*:\s*\{[\s\S]{0,500}?\bid\s*:\s*["'](\d{5,})["']/g)].map((m) => m[1]),
    ...[...context.matchAll(/["']id["']\s*:\s*["'](\d{5,})["']/g)].map((m) => m[1]),
    ...[...context.matchAll(/\bid\s*:\s*["'](\d{5,})["']/g)].map((m) => m[1]),
    ...[...context.matchAll(/\bdoc_id\b[^0-9]{0,20}(\d{5,})/g)].map((m) => m[1])
  ]);
}

function extractRelayVariables(context) {
  return unique([...context.matchAll(/__relay_internal__pv__[A-Za-z0-9_]+relayprovider/g)].map((m) => m[0]));
}

function extractArgumentNames(context) {
  const names = unique([
    ...[...context.matchAll(/(?:name|variableName)\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...context.matchAll(/["'](?:name|variableName)["']\s*:\s*["']([^"']+)["']/g)].map((m) => m[1])
  ]);
  return names.filter((name) =>
    ['userID', 'after', 'before', 'first', 'last'].includes(name) ||
    name.startsWith('__relay_internal__pv__') ||
    /Barcelona|Crawler|Logged|Cookie|Internal/i.test(name)
  );
}

async function fetchText(url, referer) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': CRAWLER_UA,
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.9',
        referer
      }
    });
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type'),
      text: await response.text()
    };
  } catch (error) {
    return { ok: false, status: null, contentType: null, text: '', error: String(error?.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}

const profileResponse = await fetch(profileUrl, {
  redirect: 'follow',
  headers: {
    'user-agent': CRAWLER_UA,
    accept: 'text/html,application/xhtml+xml',
    'accept-language': 'en-US,en;q=0.9'
  }
});
const html = await profileResponse.text();
const scriptUrls = collectScriptUrls(html).slice(0, 80);
const matchedAssets = [];

for (let i = 0; i < scriptUrls.length; i += 6) {
  const batch = scriptUrls.slice(i, i + 6);
  const results = await Promise.all(batch.map((assetUrl) => fetchText(assetUrl, profileUrl)));

  for (let j = 0; j < batch.length; j += 1) {
    const assetUrl = batch[j];
    const result = results[j];
    if (!result.text.includes(OPERATION_NAME)) continue;

    const contexts = extractOperationContexts(result.text);
    matchedAssets.push({
      assetUrl,
      status: result.status,
      bytes: Buffer.byteLength(result.text, 'utf8'),
      contentType: result.contentType,
      docIds: unique(contexts.flatMap(extractDocIds)),
      relayVariables: unique(contexts.flatMap(extractRelayVariables)),
      argumentNames: unique(contexts.flatMap(extractArgumentNames)),
      contextPreviews: contexts.slice(0, 3).map((context) => {
        const index = context.indexOf(OPERATION_NAME);
        return context.slice(Math.max(0, index - 900), Math.min(context.length, index + OPERATION_NAME.length + 1800));
      })
    });
  }
}

const report = {
  fetchedAt: new Date().toISOString(),
  username,
  profileStatus: profileResponse.status,
  htmlBytes: Buffer.byteLength(html, 'utf8'),
  assetCount: scriptUrls.length,
  matchedAssetCount: matchedAssets.length,
  docIds: unique(matchedAssets.flatMap((asset) => asset.docIds)),
  relayVariables: unique(matchedAssets.flatMap((asset) => asset.relayVariables)),
  argumentNames: unique(matchedAssets.flatMap((asset) => asset.argumentNames)),
  matchedAssets
};

await mkdir(new URL('../../debug/', import.meta.url), { recursive: true });
const reportPath = new URL(`../../debug/${username}.querymeta.json`, import.meta.url);
await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

console.log(JSON.stringify({
  username,
  profileStatus: report.profileStatus,
  assetCount: report.assetCount,
  matchedAssetCount: report.matchedAssetCount,
  docIds: report.docIds,
  relayVariables: report.relayVariables,
  argumentNames: report.argumentNames,
  reportFile: `debug/${username}.querymeta.json`,
  matchedAssets: report.matchedAssets.map((asset) => ({
    assetUrl: asset.assetUrl,
    status: asset.status,
    bytes: asset.bytes,
    docIds: asset.docIds,
    relayVariables: asset.relayVariables,
    argumentNames: asset.argumentNames
  }))
}, null, 2));

if (!profileResponse.ok) process.exitCode = 2;
