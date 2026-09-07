import { access, mkdir, writeFile } from 'node:fs/promises';
import { normalizeUsername } from './threads-public.js';

const THREADS_ORIGIN = 'https://www.threads.com';
const input = process.argv[2] || '@runing_9to5';
const username = normalizeUsername(input);
const profileUrl = `${THREADS_ORIGIN}/@${encodeURIComponent(username)}`;

async function findChromeExecutable() {
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Chromium.app/Contents/MacOS/Chromium'
      ]
    : process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser'
        ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known Chrome/Chromium location.
    }
  }
  return null;
}

function parseGraphqlRequest(request) {
  const postData = request.postData() || '';
  const form = new URLSearchParams(postData);
  let variables = null;
  let variablesParseError = null;

  try {
    variables = JSON.parse(form.get('variables') || 'null');
  } catch (error) {
    variablesParseError = String(error?.message || error);
  }

  return {
    url: request.url(),
    method: request.method(),
    friendlyName: request.headers()['x-fb-friendly-name'] || form.get('fb_api_req_friendly_name') || null,
    docId: form.get('doc_id'),
    lsd: form.get('lsd'),
    variables,
    variablesParseError,
    hasAfter: Boolean(variables && typeof variables === 'object' && variables.after),
    postDataBytes: Buffer.byteLength(postData, 'utf8')
  };
}

function collectErrorMessages(value, out = [], depth = 0) {
  if (value == null || depth > 8 || out.length >= 20) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectErrorMessages(item, out, depth + 1);
    return out;
  }
  if (typeof value !== 'object') return out;

  for (const [key, child] of Object.entries(value)) {
    if (key === 'message' && typeof child === 'string') out.push(child);
    else collectErrorMessages(child, out, depth + 1);
  }
  return out;
}

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('Missing dependency: playwright-core. Run `npm install` inside rpg, then retry.');
  process.exit(2);
}

const executablePath = await findChromeExecutable();
if (!executablePath) {
  console.error('Google Chrome / Chromium executable was not found.');
  process.exit(2);
}

await mkdir(new URL('../../debug/', import.meta.url), { recursive: true });
const reportPath = new URL(`../../debug/${username}.browser-network.json`, import.meta.url);

const browser = await chromium.launch({
  headless: false,
  executablePath,
  args: ['--disable-blink-features=AutomationControlled']
});

const context = await browser.newContext({
  locale: 'zh-TW',
  viewport: { width: 1280, height: 900 }
});
const page = await context.newPage();
const graphqlRequests = [];
const pendingResponses = [];

page.on('request', (request) => {
  if (!request.url().includes('/api/graphql')) return;
  const entry = {
    index: graphqlRequests.length + 1,
    at: new Date().toISOString(),
    ...parseGraphqlRequest(request),
    response: null
  };
  graphqlRequests.push(entry);
});

page.on('response', (response) => {
  if (!response.url().includes('/api/graphql')) return;
  const task = (async () => {
    const request = response.request();
    const parsedRequest = parseGraphqlRequest(request);
    const match = [...graphqlRequests].reverse().find((entry) =>
      entry.url === parsedRequest.url &&
      entry.docId === parsedRequest.docId &&
      entry.response == null
    );
    if (!match) return;

    let text = '';
    let json = null;
    let jsonParseError = null;
    try {
      text = await response.text();
      try {
        json = JSON.parse(text.replace(/^\s*for\s*\(;;\);\s*/, ''));
      } catch (error) {
        jsonParseError = String(error?.message || error);
      }
    } catch (error) {
      text = '';
      jsonParseError = `response_read_failed: ${String(error?.message || error)}`;
    }

    const normalized = text.replaceAll('\\"', '"');
    const postCodes = [...new Set([...normalized.matchAll(/"code"\s*:\s*"([A-Za-z0-9_-]+)"/g)].map((m) => m[1]))];
    const cursorMatch = normalized.match(/"end_cursor"\s*:\s*"([^"]+)"/);
    const nextMatch = normalized.match(/"has_next_page"\s*:\s*(true|false)/);

    match.response = {
      status: response.status(),
      contentType: response.headers()['content-type'] || null,
      bytes: Buffer.byteLength(text, 'utf8'),
      jsonParsed: Boolean(json),
      jsonParseError,
      errorMessages: [...new Set(collectErrorMessages(json))].slice(0, 20),
      postCodeCount: postCodes.length,
      postCodes: postCodes.slice(0, 30),
      nextCursor: cursorMatch?.[1] || null,
      hasNextPage: nextMatch ? nextMatch[1] === 'true' : null,
      responsePrefix: text.slice(0, 220)
    };
  })();
  pendingResponses.push(task);
});

try {
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  for (let i = 0; i < 12; i += 1) {
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 0.9, 700)));
    await page.waitForTimeout(1200);
  }

  await page.waitForTimeout(3000);
  await Promise.allSettled(pendingResponses);

  const paginationRequests = graphqlRequests.filter((entry) => entry.hasAfter);
  const profileThreadRequests = graphqlRequests.filter((entry) =>
    entry.hasAfter || /Profile.*Threads|Threads.*Profile/i.test(entry.friendlyName || '')
  );

  const report = {
    fetchedAt: new Date().toISOString(),
    username,
    profileUrl,
    executablePath,
    totalGraphqlRequests: graphqlRequests.length,
    paginationRequestCount: paginationRequests.length,
    profileThreadRequestCount: profileThreadRequests.length,
    graphqlRequests,
    paginationRequests,
    profileThreadRequests
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify({
    username,
    totalGraphqlRequests: report.totalGraphqlRequests,
    paginationRequestCount: report.paginationRequestCount,
    profileThreadRequestCount: report.profileThreadRequestCount,
    reportFile: `debug/${username}.browser-network.json`,
    paginationRequests: report.paginationRequests.map((entry) => ({
      index: entry.index,
      friendlyName: entry.friendlyName,
      docId: entry.docId,
      variables: entry.variables,
      response: entry.response
    })),
    profileThreadRequests: report.profileThreadRequests.map((entry) => ({
      index: entry.index,
      friendlyName: entry.friendlyName,
      docId: entry.docId,
      variables: entry.variables,
      response: entry.response
    }))
  }, null, 2));
} finally {
  await browser.close();
}
