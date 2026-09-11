import { access, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeUsername } from './threads-public.js';
import { parseHydrationData } from './hydration-parser.js';

const THREADS_ORIGIN = 'https://www.threads.com';
const input = process.argv[2] || '@runing_9to5';
const username = normalizeUsername(input);
const profileUrl = `${THREADS_ORIGIN}/@${encodeURIComponent(username)}`;
const TARGET_COUNT = 30;
const COLLECT_COUNT = 36;

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
      // Try next candidate.
    }
  }
  return null;
}

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asString(value) {
  return typeof value === 'string' && value.length ? value : null;
}

function postUsername(value) {
  if (!value || typeof value !== 'object') return null;
  return asString(value.user?.username) || asString(value.owner?.username) || asString(value.username);
}

function normalizePostObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const code = asString(value.code);
  const timestamp = asNumber(value.taken_at);
  if (!code || !timestamp) return null;

  const ownerUsername = postUsername(value);
  const appInfo = value.text_post_app_info && typeof value.text_post_app_info === 'object'
    ? value.text_post_app_info
    : {};

  const text = asString(value.caption?.text)
    || asString(value.text)
    || asString(value.caption_text);

  return {
    code,
    url: `${THREADS_ORIGIN}/@${ownerUsername || username}/post/${code}`,
    username: ownerUsername,
    text,
    timestamp,
    timestampIso: new Date(timestamp * 1000).toISOString(),
    likes: asNumber(value.like_count),
    replies: asNumber(appInfo.direct_reply_count) ?? asNumber(value.reply_count),
    reposts: asNumber(appInfo.repost_count) ?? asNumber(value.repost_count),
    quotes: asNumber(appInfo.quote_count) ?? asNumber(value.quote_count),
    reshares: asNumber(appInfo.reshare_count) ?? asNumber(value.reshare_count),
    detectedLanguage: asString(value.detected_language)
  };
}

function collectPosts(value, output = [], depth = 0) {
  if (value == null || depth > 24) return output;

  if (Array.isArray(value)) {
    for (const item of value) collectPosts(item, output, depth + 1);
    return output;
  }

  if (typeof value !== 'object') return output;

  const post = normalizePostObject(value);
  if (post) output.push(post);

  for (const child of Object.values(value)) {
    collectPosts(child, output, depth + 1);
  }
  return output;
}

function mergePost(existing, incoming) {
  if (!existing) return incoming;
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value != null && value !== '') merged[key] = value;
  }
  return merged;
}

function stripJsonGuard(text) {
  return text.replace(/^\s*for\s*\(;;\);\s*/, '').trim();
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
const reportPath = new URL(`../../debug/${username}.30posts.json`, import.meta.url);

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  executablePath,
  locale: 'zh-TW',
  viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled']
});

const page = context.pages()[0] || await context.newPage();
const postsByCode = new Map();
const pendingResponses = new Set();
let responseCount = 0;
let parsedResponseCount = 0;

function addPosts(posts) {
  for (const post of posts) {
    if (!post?.code) continue;
    if (post.username && post.username.toLowerCase() !== username.toLowerCase()) continue;
    postsByCode.set(post.code, mergePost(postsByCode.get(post.code), post));
  }
}

page.on('response', (response) => {
  const request = response.request();
  if (!['xhr', 'fetch'].includes(request.resourceType())) return;
  if (!response.url().includes('threads.com')) return;

  const task = (async () => {
    responseCount += 1;
    const contentType = response.headers()['content-type'] || '';
    if (!/json|javascript|text/i.test(contentType)) return;

    let text;
    try {
      text = await response.text();
    } catch {
      return;
    }
    if (!text || (!text.includes('"code"') && !text.includes('\\"code\\"'))) return;

    let parsed = null;
    try {
      parsed = JSON.parse(stripJsonGuard(text));
    } catch {
      // Some Threads payloads may contain escaped JSON fragments. The hydration
      // parser below is used as a fallback because it already handles that shape.
    }

    if (parsed) {
      const found = collectPosts(parsed);
      if (found.length) {
        parsedResponseCount += 1;
        addPosts(found);
      }
      return;
    }

    const fallback = parseHydrationData(text, username);
    if (fallback.posts.length) {
      parsedResponseCount += 1;
      addPosts(fallback.posts);
    }
  })();

  pendingResponses.add(task);
  task.finally(() => pendingResponses.delete(task));
});

async function authState() {
  const cookies = await context.cookies(['https://www.threads.com', 'https://www.instagram.com']);
  const names = new Set(cookies.map((cookie) => cookie.name));
  return names.has('sessionid') || names.has('ds_user_id');
}

async function waitForLogin() {
  if (await authState()) return;
  console.log('\n請在剛開啟的 Chrome 視窗登入 Threads / Instagram。');
  console.log('登入完成後不用關閉視窗，腳本會自動繼續。最多等待 240 秒。\n');

  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    if (await authState()) return;
  }
  throw new Error('login_not_detected_after_240s');
}

async function seedFromPageHtml() {
  const html = await page.content();
  const hydration = parseHydrationData(html, username);
  addPosts(hydration.posts);
  return hydration.posts.length;
}

try {
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  await waitForLogin();

  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3500);

  const initialCount = await seedFromPageHtml();
  let roundsWithoutGrowth = 0;
  let lastCount = postsByCode.size;
  let scrollRounds = 0;

  while (postsByCode.size < COLLECT_COUNT && scrollRounds < 80 && roundsWithoutGrowth < 10) {
    scrollRounds += 1;
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 0.95, 760)));
    await page.waitForTimeout(900);

    if (pendingResponses.size) {
      await Promise.allSettled([...pendingResponses]);
    }

    const currentCount = postsByCode.size;
    if (currentCount > lastCount) {
      roundsWithoutGrowth = 0;
      lastCount = currentCount;
      console.log(`已累積 ${currentCount} 篇...`);
    } else {
      roundsWithoutGrowth += 1;
    }
  }

  if (pendingResponses.size) {
    await Promise.allSettled([...pendingResponses]);
  }

  const allPosts = [...postsByCode.values()]
    .filter((post) => !post.username || post.username.toLowerCase() === username.toLowerCase())
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const posts = allPosts.slice(0, TARGET_COUNT);

  const report = {
    fetchedAt: new Date().toISOString(),
    username,
    targetCount: TARGET_COUNT,
    success: posts.length >= TARGET_COUNT,
    initialCount,
    uniqueCollected: allPosts.length,
    returnedCount: posts.length,
    scrollRounds,
    responseCount,
    parsedResponseCount,
    posts
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({
    username: report.username,
    success: report.success,
    initialCount: report.initialCount,
    uniqueCollected: report.uniqueCollected,
    returnedCount: report.returnedCount,
    scrollRounds: report.scrollRounds,
    reportFile: `debug/${username}.30posts.json`,
    posts: report.posts
  }, null, 2));

  if (!report.success) process.exitCode = 3;
} finally {
  await context.close();
}
