import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeUsername } from './threads-public.js';
import { parseHydrationData } from './hydration-parser.js';

const ORIGIN = 'https://www.threads.com';
const GRAPHQL_URL = `${ORIGIN}/graphql/query`;
const APP_ID = '238260118697367';
const ASBD_ID = '359341';
const OPERATION = 'BarcelonaProfileThreadsTabRefetchableDirectQuery';
const ROOT_FIELD = 'xdt_api__v1__text_feed__user_id__profile__connection';
const TARGET = 30;
const PAGE_SIZE = 10;

// This is the same public-profile UA that already returned the 4 SSR/hydration posts.
const PROFILE_UA = 'Mozilla/5.0 (compatible; ThreadsRPGPoC/0.1; +https://runing9to5.com)';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

// Persisted IDs rotate. These are only candidates for the same known pagination operation.
const DOC_IDS = [
  '26687434907534883',
  '28437090222560814',
  '33544334045182488',
  '27545758055009868',
  '27422205010763282'
];

const input = process.argv[2] || '@runing_9to5';
const username = normalizeUsername(input);
const profileUrl = `${ORIGIN}/@${encodeURIComponent(username)}`;

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1] || null;
  }
  return null;
}

function normalizeSource(text) {
  return text.replaceAll('\\"', '"');
}

function extractUserId(text) {
  const source = normalizeSource(text);
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return firstMatch(source, [
    new RegExp(`"username"\\s*:\\s*"${escaped}"[\\s\\S]{0,4000}?"pk"\\s*:\\s*"(\\d+)"`, 'i'),
    new RegExp(`"username"\\s*:\\s*"${escaped}"[\\s\\S]{0,4000}?"id"\\s*:\\s*"(\\d+)"`, 'i'),
    /"user_id"\s*:\s*"(\d+)"/i,
    /"user_id"\s*:\s*(\d+)/i
  ]);
}

function extractCursor(text) {
  const source = normalizeSource(text);
  return firstMatch(source, [
    /"end_cursor"\s*:\s*"([^"]+)"/,
    /"next_cursor"\s*:\s*"([^"]+)"/
  ]);
}

function extractLsd(text) {
  return firstMatch(text, [
    /"LSD"\s*,\s*\[\]\s*,\s*\{[^{}]{0,2048}?"token"\s*:\s*"([^"]+)"/i,
    /"LSD"[\s\S]{0,300}?"token"\s*:\s*"([^"]+)"/i
  ]);
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers.get('set-cookie');
  return raw ? raw.split(/,(?=\s*[^;,=]+=[^;,]+)/g) : [];
}

function mergeCookies(map, headers) {
  for (const line of getSetCookies(headers)) {
    const pair = line.split(';', 1)[0];
    const i = pair.indexOf('=');
    if (i > 0) map.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

function cookieHeader(map) {
  return [...map].map(([k, v]) => `${k}=${v}`).join('; ');
}

function relayFlags() {
  return {
    __relay_internal__pv__BarcelonaIsLoggedInrelayprovider: false,
    __relay_internal__pv__BarcelonaHasPostAuthorNotifControlsrelayprovider: false,
    __relay_internal__pv__BarcelonaShouldShowFediverseM1Featuresrelayprovider: false,
    __relay_internal__pv__BarcelonaHasInlineReplyComposerrelayprovider: false,
    __relay_internal__pv__BarcelonaHasDearAlgoConsumptionrelayprovider: true,
    __relay_internal__pv__BarcelonaHasEventBadgerelayprovider: false,
    __relay_internal__pv__BarcelonaIsSearchDiscoveryEnabledrelayprovider: false,
    __relay_internal__pv__BarcelonaHasCommunitiesrelayprovider: true,
    __relay_internal__pv__BarcelonaHasGameScoreSharerelayprovider: true,
    __relay_internal__pv__BarcelonaHasPublicViewCountCardrelayprovider: true,
    __relay_internal__pv__BarcelonaHasCommunityEntityCardrelayprovider: false,
    __relay_internal__pv__BarcelonaHasScorecardCommunityrelayprovider: false,
    __relay_internal__pv__BarcelonaHasMusicrelayprovider: false,
    __relay_internal__pv__BarcelonaHasNewspaperLinkStylerelayprovider: false,
    __relay_internal__pv__BarcelonaHasMessagingrelayprovider: false,
    __relay_internal__pv__BarcelonaHasGhostPostEmojiActivationrelayprovider: false,
    __relay_internal__pv__BarcelonaOptionalCookiesEnabledrelayprovider: true,
    __relay_internal__pv__BarcelonaHasDearAlgoWebProductionrelayprovider: false,
    __relay_internal__pv__BarcelonaIsCrawlerrelayprovider: false,
    __relay_internal__pv__BarcelonaHasCommunityTopContributorsrelayprovider: false,
    __relay_internal__pv__BarcelonaCanSeeSponsoredContentrelayprovider: false,
    __relay_internal__pv__BarcelonaShouldShowFediverseM075Featuresrelayprovider: false,
    __relay_internal__pv__BarcelonaIsInternalUserrelayprovider: false,
    __relay_internal__pv__BarcelonaHasProfileSelfReplyContextrelayprovider: false
  };
}

function normalizePost(post) {
  if (!post || typeof post !== 'object' || !post.code || !post.taken_at) return null;
  const info = post.text_post_app_info || {};
  const caption = post.caption || {};
  const user = post.user || {};
  const timestamp = Number(post.taken_at);
  if (!Number.isFinite(timestamp)) return null;
  return {
    code: String(post.code),
    url: `${ORIGIN}/@${user.username || username}/post/${post.code}`,
    username: user.username || username,
    text: caption.text ?? post.text ?? null,
    timestamp,
    timestampIso: new Date(timestamp * 1000).toISOString(),
    likes: Number.isFinite(Number(post.like_count)) ? Number(post.like_count) : null,
    replies: Number.isFinite(Number(info.direct_reply_count ?? info.reply_count)) ? Number(info.direct_reply_count ?? info.reply_count) : null,
    reposts: Number.isFinite(Number(info.repost_count)) ? Number(info.repost_count) : null,
    quotes: Number.isFinite(Number(info.quote_count)) ? Number(info.quote_count) : null,
    reshares: Number.isFinite(Number(info.reshare_count)) ? Number(info.reshare_count) : null,
    detectedLanguage: post.detected_language ?? null
  };
}

function walk(value, visit, seen = new Set(), depth = 0) {
  if (value == null || depth > 30 || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  visit(value);
  if (Array.isArray(value)) {
    for (const child of value) walk(child, visit, seen, depth + 1);
  } else {
    for (const child of Object.values(value)) walk(child, visit, seen, depth + 1);
  }
}

function parseGraphql(json) {
  const posts = [];
  let pageInfo = null;
  walk(json, (value) => {
    const post = normalizePost(value);
    if (post) posts.push(post);
    const info = value.page_info || value.pageInfo;
    if (!pageInfo && info && typeof info === 'object') {
      pageInfo = {
        cursor: info.end_cursor ?? info.endCursor ?? info.next_cursor ?? null,
        hasNextPage: info.has_next_page ?? info.hasNextPage ?? null
      };
    }
  });
  return { posts, pageInfo };
}

function collectErrors(value, out = [], depth = 0) {
  if (value == null || depth > 10 || out.length >= 10) return out;
  if (Array.isArray(value)) {
    for (const child of value) collectErrors(child, out, depth + 1);
  } else if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'message' && typeof child === 'string') out.push(child);
      else collectErrors(child, out, depth + 1);
    }
  }
  return [...new Set(out)];
}

function parseBootstrap(response, html, bootstrapFallback = false) {
  const hydration = parseHydrationData(html, username);
  return {
    response,
    html,
    posts: hydration.posts || [],
    userId: extractUserId(html),
    cursor: extractCursor(html),
    bootstrapFallback
  };
}

async function bootstrapPublicProfile() {
  const directResponse = await fetch(profileUrl, {
    redirect: 'follow',
    headers: {
      'user-agent': PROFILE_UA,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'zh-TW,zh;q=0.9,en;q=0.7'
    }
  });
  const directHtml = await directResponse.text();
  const direct = parseBootstrap(directResponse, directHtml);
  if (direct.response.ok && direct.posts.length > 0 && direct.userId && direct.cursor) return direct;

  // Some Render egress IPs receive an app shell until an anonymous home
  // session is established first. Retry the profile with the cookies minted
  // by `/`, matching the browser-like bootstrap used by Threads itself.
  const cookies = new Map();
  mergeCookies(cookies, directResponse.headers);
  const homeResponse = await fetch(`${ORIGIN}/`, {
    redirect: 'follow',
    headers: {
      'user-agent': BROWSER_UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'zh-TW,zh;q=0.9,en;q=0.7',
      'x-ig-app-id': APP_ID,
      cookie: cookieHeader(cookies)
    }
  });
  const homeHtml = await homeResponse.text();
  mergeCookies(cookies, homeResponse.headers);
  const retryResponse = await fetch(profileUrl, {
    redirect: 'follow',
    headers: {
      'user-agent': PROFILE_UA,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'zh-TW,zh;q=0.9,en;q=0.7',
      'x-ig-app-id': APP_ID,
      cookie: cookieHeader(cookies)
    }
  });
  const retryHtml = await retryResponse.text();
  const retry = parseBootstrap(retryResponse, retryHtml, true);
  // Keep the fallback response as the authoritative bootstrap, but retain
  // the home HTML in memory so the session builder can recover an LSD token.
  if (!extractLsd(retryHtml)) retry.html = `${retryHtml}\n${homeHtml}`;
  return retry;
}

async function buildAnonymousSession(profileBootstrap) {
  const cookies = new Map();
  mergeCookies(cookies, profileBootstrap.response.headers);
  let lsd = extractLsd(profileBootstrap.html);

  // If profile HTML did not mint enough anonymous-session state, enrich it once via home.
  const home = await fetch(`${ORIGIN}/`, {
    redirect: 'follow',
    headers: {
      'user-agent': BROWSER_UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'zh-TW,zh;q=0.9,en;q=0.7',
      'x-ig-app-id': APP_ID,
      cookie: cookieHeader(cookies)
    }
  });
  const homeHtml = await home.text();
  mergeCookies(cookies, home.headers);
  if (!lsd) lsd = extractLsd(homeHtml);

  return {
    cookies,
    lsd,
    csrf: cookies.get('csrftoken') || ''
  };
}

async function fetchPage({ session, userId, cursor, docId }) {
  const variables = {
    after: cursor,
    allow_page_info_for_lox_user: true,
    before: null,
    first: PAGE_SIZE,
    last: null,
    userID: String(userId),
    ...relayFlags()
  };
  const body = new URLSearchParams({
    lsd: session.lsd || 't',
    doc_id: docId,
    fb_api_req_friendly_name: OPERATION,
    fb_api_caller_class: 'RelayModern',
    server_timestamps: 'true',
    variables: JSON.stringify(variables)
  });

  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      'user-agent': BROWSER_UA,
      accept: '*/*',
      'accept-language': 'zh-TW,zh;q=0.9,en;q=0.7',
      'content-type': 'application/x-www-form-urlencoded',
      origin: ORIGIN,
      referer: profileUrl,
      'x-ig-app-id': APP_ID,
      'x-fb-lsd': session.lsd || 't',
      'x-csrftoken': session.csrf,
      'x-fb-friendly-name': OPERATION,
      'x-root-field-name': ROOT_FIELD,
      'x-logged-out-threads-migrated-request': 'true',
      'x-asbd-id': ASBD_ID,
      cookie: cookieHeader(session.cookies)
    },
    body
  });

  const text = await response.text();
  mergeCookies(session.cookies, response.headers);
  let json = null;
  try { json = JSON.parse(text.replace(/^\s*for\s*\(;;\);\s*/, '')); } catch {}
  const parsed = json ? parseGraphql(json) : { posts: [], pageInfo: null };
  return {
    status: response.status,
    ok: response.ok,
    bytes: Buffer.byteLength(text, 'utf8'),
    posts: parsed.posts,
    pageInfo: parsed.pageInfo,
    errors: json ? collectErrors(json) : [],
    responsePrefix: text.slice(0, 180)
  };
}

await mkdir(new URL('../../debug/', import.meta.url), { recursive: true });
const reportPath = new URL(`../../debug/${username}.30posts-http.json`, import.meta.url);

const bootstrap = await bootstrapPublicProfile();
if (!bootstrap.response.ok || !bootstrap.userId || !bootstrap.cursor || bootstrap.posts.length === 0) {
  console.log(JSON.stringify({
    username,
    success: false,
    stage: 'profile_bootstrap',
    profileStatus: bootstrap.response.status,
    initialCount: bootstrap.posts.length,
    userIdFound: Boolean(bootstrap.userId),
    cursorFound: Boolean(bootstrap.cursor),
    htmlBytes: Buffer.byteLength(bootstrap.html, 'utf8')
  }, null, 2));
  process.exit(2);
}

const session = await buildAnonymousSession(bootstrap);
if (!session.lsd) {
  console.log(JSON.stringify({
    username,
    success: false,
    stage: 'anonymous_session',
    initialCount: bootstrap.posts.length,
    cursorFound: true,
    reason: 'lsd_not_found'
  }, null, 2));
  process.exit(2);
}

const byCode = new Map(bootstrap.posts.filter((p) => p?.code).map((p) => [p.code, p]));
const attempts = [];
let cursor = bootstrap.cursor;
let chosenDocId = null;
let hasNextPage = true;
let page = 0;

while (byCode.size < TARGET && cursor && hasNextPage !== false && page < 8) {
  page += 1;
  const candidates = chosenDocId ? [chosenDocId] : DOC_IDS;
  let accepted = null;

  for (const docId of candidates) {
    const result = await fetchPage({ session, userId: bootstrap.userId, cursor, docId });
    attempts.push({
      page,
      docId,
      status: result.status,
      postCount: result.posts.length,
      nextCursorFound: Boolean(result.pageInfo?.cursor),
      hasNextPage: result.pageInfo?.hasNextPage ?? null,
      errors: result.errors,
      responsePrefix: result.responsePrefix
    });

    if (result.posts.length > 0) {
      chosenDocId = docId;
      accepted = result;
      break;
    }
  }

  if (!accepted) break;
  for (const post of accepted.posts) byCode.set(post.code, post);
  cursor = accepted.pageInfo?.cursor || null;
  hasNextPage = accepted.pageInfo?.hasNextPage ?? Boolean(cursor);
}

const posts = [...byCode.values()]
  .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
  .slice(0, TARGET);

// A complete result either reaches the requested sample size or proves that
// Threads has no next page. If a cursor is still live after an empty/failed
// page, keep the partial sample marked incomplete so the API cannot present it
// as a finished analysis.
const complete = posts.length >= TARGET || hasNextPage === false || !cursor;

const report = {
  username,
  success: posts.length >= TARGET,
  complete,
  browserUsed: false,
  loginUsed: false,
  initialCount: bootstrap.posts.length,
  userIdFound: true,
  cursorFound: true,
  chosenDocId,
  collectedCount: byCode.size,
  returnedCount: posts.length,
  attempts,
  posts
};

await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ ...report, posts: undefined, reportFile: `debug/${username}.30posts-http.json` }, null, 2));
if (!report.success) process.exitCode = 2;
