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

function parseFormPostData(postData = '') {
  const form = new URLSearchParams(postData);
  let variables = null;
  let variablesParseError = null;
  try {
    variables = JSON.parse(form.get('variables') || 'null');
  } catch (error) {
    variablesParseError = String(error?.message || error);
  }
  return {
    docId: form.get('doc_id'),
    lsd: form.get('lsd'),
    friendlyName: form.get('fb_api_req_friendly_name'),
    variables,
    variablesParseError
  };
}

function parseGraphqlRequest(request) {
  const postData = request.postData() || '';
  const parsed = parseFormPostData(postData);
  return {
    url: request.url(),
    method: request.method(),
    resourceType: request.resourceType(),
    friendlyName: request.headers()['x-fb-friendly-name'] || parsed.friendlyName || null,
    docId: parsed.docId,
    lsd: parsed.lsd,
    variables: parsed.variables,
    variablesParseError: parsed.variablesParseError,
    hasAfter: Boolean(parsed.variables && typeof parsed.variables === 'object' && parsed.variables.after),
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

function isInterestingRequest(request) {
  const url = request.url();
  const type = request.resourceType();
  return request.method() === 'POST' ||
    type === 'xhr' ||
    type === 'fetch' ||
    /graphql|api\/|ajax|relay|bulk-route|pagination|text_feed|threads/i.test(url);
}

function summarizeRequest(request, index) {
  const postData = request.postData() || '';
  const parsed = parseFormPostData(postData);
  return {
    index,
    method: request.method(),
    resourceType: request.resourceType(),
    url: request.url(),
    friendlyName: request.headers()['x-fb-friendly-name'] || parsed.friendlyName || null,
    docId: parsed.docId,
    variables: parsed.variables,
    postDataPrefix: postData ? postData.slice(0, 400) : null
  };
}

async function pageSnapshot(page) {
  return page.evaluate(() => {
    const bodyText = document.body?.innerText || '';
    const postLinks = [...document.querySelectorAll('a[href*="/post/"]')]
      .map((a) => a.getAttribute('href'))
      .filter(Boolean);
    return {
      url: location.href,
      title: document.title,
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      postLinkCount: new Set(postLinks).size,
      postLinks: [...new Set(postLinks)].slice(0, 20),
      bodyTextPreview: bodyText.slice(0, 1200),
      signals: {
        login: /登入|Log in|Sign in/i.test(bodyText),
        notNow: /稍後|Not now/i.test(bodyText),
        challenge: /challenge|驗證|verify|unusual activity/i.test(bodyText),
        cookie: /cookie|餅乾/i.test(bodyText)
      }
    };
  });
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
const interestingRequests = [];
const requestTypeCounts = {};
const pendingResponses = [];

page.on('request', (request) => {
  const type = request.resourceType();
  requestTypeCounts[type] = (requestTypeCounts[type] || 0) + 1;

  if (isInterestingRequest(request) && interestingRequests.length < 200) {
    interestingRequests.push(summarizeRequest(request, interestingRequests.length + 1));
  }

  if (!request.url().includes('/api/graphql')) return;
  graphqlRequests.push({
    index: graphqlRequests.length + 1,
    at: new Date().toISOString(),
    ...parseGraphqlRequest(request),
    response: null
  });
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
  const navResponse = await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3500);

  const initialSnapshot = await pageSnapshot(page);
  const scrollSnapshots = [];

  for (let i = 0; i < 12; i += 1) {
    await page.mouse.wheel(0, 1400);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(1400);
    if ([0, 2, 5, 8, 11].includes(i)) scrollSnapshots.push(await pageSnapshot(page));
  }

  await page.waitForTimeout(3000);
  await Promise.allSettled(pendingResponses);
  const finalSnapshot = await pageSnapshot(page);

  const paginationRequests = graphqlRequests.filter((entry) => entry.hasAfter);
  const profileThreadRequests = graphqlRequests.filter((entry) =>
    entry.hasAfter || /Profile.*Threads|Threads.*Profile/i.test(entry.friendlyName || '')
  );

  const report = {
    fetchedAt: new Date().toISOString(),
    username,
    profileUrl,
    executablePath,
    navigation: {
      status: navResponse?.status() ?? null,
      finalUrl: page.url()
    },
    pageState: {
      initial: initialSnapshot,
      scrollSnapshots,
      final: finalSnapshot
    },
    requestTypeCounts,
    interestingRequestCount: interestingRequests.length,
    interestingRequests,
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
    navigation: report.navigation,
    pageState: {
      initial: report.pageState.initial,
      final: report.pageState.final
    },
    requestTypeCounts: report.requestTypeCounts,
    interestingRequestCount: report.interestingRequestCount,
    interestingRequests: report.interestingRequests.slice(0, 40),
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
