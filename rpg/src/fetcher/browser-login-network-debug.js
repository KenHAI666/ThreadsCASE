import { access, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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
      // Try the next location.
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
    method: request.method(),
    resourceType: request.resourceType(),
    friendlyName: request.headers()['x-fb-friendly-name'] || form.get('fb_api_req_friendly_name') || null,
    docId: form.get('doc_id'),
    lsdMode: form.get('lsd') ? 'present' : 'missing',
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

async function inspectResponse(response) {
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
    jsonParseError = `response_read_failed: ${String(error?.message || error)}`;
  }

  const normalized = text.replaceAll('\\"', '"');
  const postCodes = [...new Set([...normalized.matchAll(/"code"\s*:\s*"([A-Za-z0-9_-]+)"/g)].map((m) => m[1]))];
  const cursorMatch = normalized.match(/"end_cursor"\s*:\s*"([^"]+)"/);
  const nextMatch = normalized.match(/"has_next_page"\s*:\s*(true|false)/);

  return {
    status: response.status(),
    contentType: response.headers()['content-type'] || null,
    bytes: Buffer.byteLength(text, 'utf8'),
    jsonParsed: Boolean(json),
    jsonParseError,
    errorMessages: [...new Set(collectErrorMessages(json))].slice(0, 20),
    postCodeCount: postCodes.length,
    postCodes: postCodes.slice(0, 30),
    nextCursor: cursorMatch?.[1] || null,
    hasNextPage: nextMatch ? nextMatch[1] === 'true' : null
  };
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

const debugDir = new URL('../../debug/', import.meta.url);
await mkdir(debugDir, { recursive: true });
const userDataDir = fileURLToPath(new URL('../../debug/chrome-research-profile/', import.meta.url));
const reportPath = new URL(`../../debug/${username}.browser-login-network.json`, import.meta.url);

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  executablePath,
  locale: 'zh-TW',
  viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled']
});

const page = context.pages()[0] || await context.newPage();
const graphqlRequests = [];
const interestingRequests = [];
const pendingResponses = [];

page.on('request', (request) => {
  const url = request.url();
  const type = request.resourceType();
  const interesting = ['xhr', 'fetch'].includes(type) || request.method() === 'POST' || /graphql|api|ajax|relay|pagination|bulk-route/i.test(url);
  if (interesting) {
    interestingRequests.push({
      at: new Date().toISOString(),
      method: request.method(),
      resourceType: type,
      url: url.slice(0, 800)
    });
  }

  if (!url.includes('/api/graphql')) return;
  graphqlRequests.push({
    index: graphqlRequests.length + 1,
    at: new Date().toISOString(),
    url,
    ...parseGraphqlRequest(request),
    response: null
  });
});

page.on('response', (response) => {
  if (!response.url().includes('/api/graphql')) return;
  const task = (async () => {
    const parsed = parseGraphqlRequest(response.request());
    const match = [...graphqlRequests].reverse().find((entry) =>
      entry.docId === parsed.docId && entry.response == null
    );
    if (!match) return;
    match.response = await inspectResponse(response);
  })();
  pendingResponses.push(task);
});

async function pageState() {
  return page.evaluate(() => ({
    href: location.href,
    title: document.title,
    scrollHeight: document.documentElement.scrollHeight,
    postLinkCount: new Set([...document.querySelectorAll('a[href*="/post/"]')].map((a) => a.href)).size,
    bodyPreview: (document.body?.innerText || '').slice(0, 500)
  }));
}

try {
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);

  let state = await pageState();
  if (state.postLinkCount < 3) {
    console.log('\nThreads 目前需要登入。請在剛開啟的 Chrome 視窗手動登入。');
    console.log('這個 Chrome 使用獨立的 debug 研究 profile；密碼/Cookie 不會寫進 report，也不會進 Git。');
    console.log('登入後回到目標 Threads 個人頁即可。腳本最多等待 180 秒。\n');

    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      state = await pageState();
      if (state.postLinkCount >= 3) break;
    }
  }

  if ((await pageState()).postLinkCount < 3) {
    throw new Error('login_or_profile_content_not_ready_after_180s');
  }

  const beforeScroll = await pageState();
  for (let i = 0; i < 18; i += 1) {
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 0.95, 750)));
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);
  await Promise.allSettled(pendingResponses);
  const afterScroll = await pageState();

  const paginationRequests = graphqlRequests.filter((entry) => entry.hasAfter);
  const profileThreadRequests = graphqlRequests.filter((entry) =>
    entry.hasAfter || /Profile.*Threads|Threads.*Profile/i.test(entry.friendlyName || '')
  );

  const report = {
    fetchedAt: new Date().toISOString(),
    username,
    profileUrl,
    researchOnly: true,
    note: 'Logged-in browser is used only to observe request shape. Cookies and request headers are intentionally not stored.',
    beforeScroll,
    afterScroll,
    totalGraphqlRequests: graphqlRequests.length,
    paginationRequestCount: paginationRequests.length,
    profileThreadRequestCount: profileThreadRequests.length,
    graphqlRequests,
    interestingRequests: interestingRequests.slice(-300),
    paginationRequests,
    profileThreadRequests
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify({
    username,
    beforeScroll,
    afterScroll,
    totalGraphqlRequests: report.totalGraphqlRequests,
    paginationRequestCount: report.paginationRequestCount,
    profileThreadRequestCount: report.profileThreadRequestCount,
    reportFile: `debug/${username}.browser-login-network.json`,
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
  await context.close();
}
