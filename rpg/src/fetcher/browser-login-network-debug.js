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

function isGraphqlRequestUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('threads.com') &&
      (parsed.pathname === '/api/graphql' || parsed.pathname === '/graphql/query');
  } catch {
    return false;
  }
}

function graphqlEndpoint(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function findNestedValue(value, key, depth = 0) {
  if (value == null || depth > 8) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedValue(item, key, depth + 1);
      if (found != null) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  for (const child of Object.values(value)) {
    const found = findNestedValue(child, key, depth + 1);
    if (found != null) return found;
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

  const after = findNestedValue(variables, 'after');
  const before = findNestedValue(variables, 'before');
  const first = findNestedValue(variables, 'first');
  const last = findNestedValue(variables, 'last');

  return {
    endpoint: graphqlEndpoint(request.url()),
    method: request.method(),
    resourceType: request.resourceType(),
    friendlyName: request.headers()['x-fb-friendly-name'] || form.get('fb_api_req_friendly_name') || null,
    docId: form.get('doc_id'),
    lsdMode: form.get('lsd') ? 'present' : 'missing',
    formKeys: [...new Set([...form.keys()])].sort(),
    variables,
    variablesParseError,
    pagination: {
      after: after ?? null,
      before: before ?? null,
      first: first ?? null,
      last: last ?? null
    },
    hasAfter: typeof after === 'string' && after.length > 0,
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
    hasNextPage: nextMatch ? nextMatch[1] === 'true' : null,
    responsePrefix: text.slice(0, 220)
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
const requestEntries = new Map();

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

  if (!isGraphqlRequestUrl(url)) return;
  const entry = {
    index: graphqlRequests.length + 1,
    at: new Date().toISOString(),
    url,
    ...parseGraphqlRequest(request),
    response: null
  };
  graphqlRequests.push(entry);
  requestEntries.set(request, entry);
});

page.on('response', (response) => {
  if (!isGraphqlRequestUrl(response.url())) return;
  const task = (async () => {
    const match = requestEntries.get(response.request());
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

async function authState() {
  const cookies = await context.cookies(['https://www.threads.com', 'https://www.instagram.com']);
  const names = [...new Set(cookies.map((cookie) => cookie.name))];
  return {
    authenticated: names.includes('sessionid') || names.includes('ds_user_id'),
    authCookieNames: names.filter((name) => ['sessionid', 'ds_user_id'].includes(name))
  };
}

async function waitForLogin() {
  let auth = await authState();
  if (auth.authenticated) return auth;

  console.log('\n這個研究 Chrome 尚未登入 Threads / Instagram。');
  console.log('請在剛開啟的 Chrome 視窗完成登入；腳本只檢查登入 Cookie 名稱，不讀取或輸出 Cookie 值。');
  console.log('登入完成後不用關閉視窗，腳本會自動回到目標 Threads 個人頁。最多等待 240 秒。\n');

  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    auth = await authState();
    if (auth.authenticated) return auth;
  }
  throw new Error('login_not_detected_after_240s');
}

try {
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const auth = await waitForLogin();

  // The logged-out SSR page can expose several post links even though scrolling
  // still redirects to Instagram SSO. Always navigate back after auth is proven.
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const readyState = await pageState();
  if (readyState.postLinkCount < 3 || !readyState.href.includes(`/@${username}`)) {
    throw new Error(`authenticated_profile_not_ready: ${readyState.href}`);
  }

  // Drop login/navigation traffic so the report focuses on profile pagination.
  graphqlRequests.length = 0;
  interestingRequests.length = 0;
  pendingResponses.length = 0;
  requestEntries.clear();

  const beforeScroll = await pageState();
  for (let i = 0; i < 18; i += 1) {
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 0.95, 750)));
    await page.waitForTimeout(1000);
    if (!page.url().includes('threads.com/@')) break;
  }
  await page.waitForTimeout(3000);
  await Promise.allSettled(pendingResponses);
  const afterScroll = await pageState();

  const paginationRequests = graphqlRequests.filter((entry) => entry.hasAfter);
  const profileThreadRequests = graphqlRequests.filter((entry) =>
    entry.hasAfter ||
    /Profile.*Threads|Threads.*Profile/i.test(entry.friendlyName || '') ||
    (entry.response?.postCodeCount > 0 && entry.response?.nextCursor)
  );

  const endpointCounts = Object.fromEntries(
    [...new Set(graphqlRequests.map((entry) => entry.endpoint))]
      .map((endpoint) => [endpoint, graphqlRequests.filter((entry) => entry.endpoint === endpoint).length])
  );

  const report = {
    fetchedAt: new Date().toISOString(),
    username,
    profileUrl,
    researchOnly: true,
    note: 'Logged-in browser is used only to observe request shape. Cookie values and request headers are intentionally not stored.',
    auth: {
      authenticated: auth.authenticated,
      authCookieNames: auth.authCookieNames
    },
    beforeScroll,
    afterScroll,
    totalGraphqlRequests: graphqlRequests.length,
    endpointCounts,
    paginationRequestCount: paginationRequests.length,
    profileThreadRequestCount: profileThreadRequests.length,
    graphqlRequests,
    interestingRequests: interestingRequests.slice(-300),
    paginationRequests,
    profileThreadRequests
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  const compact = (entry) => ({
    index: entry.index,
    endpoint: entry.endpoint,
    friendlyName: entry.friendlyName,
    docId: entry.docId,
    formKeys: entry.formKeys,
    pagination: entry.pagination,
    variables: entry.variables,
    response: entry.response
  });

  console.log(JSON.stringify({
    username,
    auth: report.auth,
    beforeScroll,
    afterScroll,
    totalGraphqlRequests: report.totalGraphqlRequests,
    endpointCounts: report.endpointCounts,
    paginationRequestCount: report.paginationRequestCount,
    profileThreadRequestCount: report.profileThreadRequestCount,
    reportFile: `debug/${username}.browser-login-network.json`,
    paginationRequests: report.paginationRequests.map(compact),
    profileThreadRequests: report.profileThreadRequests.map(compact),
    graphqlRequests: report.graphqlRequests.map(compact)
  }, null, 2));
} finally {
  await context.close();
}
