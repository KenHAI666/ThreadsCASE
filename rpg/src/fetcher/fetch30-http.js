import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeUsername } from './threads-public.js';
import { parseHydrationData } from './hydration-parser.js';

const THREADS_ORIGIN = 'https://www.threads.com';
const GRAPHQL_URL = `${THREADS_ORIGIN}/graphql/query`;
const APP_ID = '238260118697367';
const ASBD_ID = '359341';
const OPERATION = 'BarcelonaProfileThreadsTabRefetchableDirectQuery';
const ROOT_FIELD = 'xdt_api__v1__text_feed__user_id__profile__connection';
const TARGET_COUNT = 30;
const PAGE_SIZE = 10;
// Threads serves an app shell to a browser-like UA here.  The lightweight
// public profile response (with hydration data and the first-page cursor) is
// returned when the request identifies this server-side fetcher.
const UA = 'Mozilla/5.0 (compatible; ThreadsRPGPoC/0.1; +https://runing9to5.com)';

// Persisted query IDs rotate. Try the most relevant recent public captures first.
const DOC_ID_CANDIDATES = [
  '28150103917987977',
  '26687434907534883',
  '28437090222560814',
  '33544334045182488'
];

const input = process.argv[2] || '@runing_9to5';
const username = normalizeUsername(input);
const profileUrl = `${THREADS_ORIGIN}/@${encodeURIComponent(username)}`;
const reportPath = resolve(process.argv[3] || fileURLToPath(new URL(`../../debug/${username}.30posts-http.json`, import.meta.url)));

function setCookieLines(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers.get('set-cookie');
  if (!raw) return [];
  return raw.split(/,(?=\s*[^;,=]+=[^;,]+)/g);
}

function mergeCookies(cookieMap, headers) {
  for (const line of setCookieLines(headers)) {
    const pair = line.split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    cookieMap.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

function cookieHeader(cookieMap) {
  return [...cookieMap.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1] || null;
  }
  return null;
}

function extractLsd(text) {
  return firstMatch(text, [
    /"LSD"\s*,\s*\[\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/i,
    /"LSD"[\s\S]{0,300}?"token"\s*:\s*"([^"]+)"/i,
    /"token"\s*:\s*"([A-Za-z0-9_-]{8,})"[\s\S]{0,180}?"LSD"/i
  ]);
}

function extractUserId(text, handle) {
  const source = text.replaceAll('\\"', '"');
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return firstMatch(source, [
    new RegExp(`"username"\\s*:\\s*"${escaped}"\\s*,\\s*"id"\\s*:\\s*"(\\d+)"`, 'i'),
    new RegExp(`"username"\\s*:\\s*"${escaped}"[\\s\\S]{0,300}?"id"\\s*:\\s*"(\\d+)"`, 'i'),
    new RegExp(`"username"\\s*:\\s*"${escaped}"[\\s\\S]{0,3500}?"pk"\\s*:\\s*"(\\d+)"`, 'i'),
    new RegExp(`"username"\\s*:\\s*"${escaped}"[\\s\\S]{0,3500}?"id"\\s*:\\s*"(\\d+)"`, 'i'),
    /"user_id"\s*:\s*"(\d+)"/i,
    /"user_id"\s*:\s*(\d+)/i
  ]);
}

function extractInitialCursor(text) {
  const source = text.replaceAll('\\"', '"');
  return firstMatch(source, [
    /"end_cursor"\s*:\s*"([^"]+)"/,
    /"next_cursor"\s*:\s*"([^"]+)"/
  ]);
}

function collectErrorMessages(value, output = [], depth = 0) {
  if (value == null || depth > 10 || output.length >= 20) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectErrorMessages(item, output, depth + 1);
    return output;
  }
  if (typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'message' && typeof child === 'string') output.push(child);
    else collectErrorMessages(child, output, depth + 1);
  }
  return output;
}

function findPageInfo(value, depth = 0) {
  if (value == null || depth > 20) return null;
  const candidates = [];
  collectPageInfo(value, candidates, depth);
  return candidates.find((candidate) => candidate.cursor && candidate.hasNextPage === true)
    || candidates.find((candidate) => candidate.cursor)
    || candidates.find((candidate) => candidate.hasNextPage === true)
    || candidates[0]
    || null;
}

function collectPageInfo(value, output, depth = 0) {
  if (value == null || depth > 20) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPageInfo(item, output, depth + 1);
    }
    return;
  }
  if (typeof value !== 'object') return;

  const pageInfo = value.page_info || value.pageInfo;
  if (pageInfo && typeof pageInfo === 'object') {
    const cursor = pageInfo.end_cursor ?? pageInfo.endCursor ?? pageInfo.next_cursor ?? null;
    const hasNextPage = pageInfo.has_next_page ?? pageInfo.hasNextPage ?? null;
    if (cursor != null || hasNextPage != null) {
      output.push({ cursor, hasNextPage });
    }
  }

  for (const child of Object.values(value)) {
    collectPageInfo(child, output, depth + 1);
  }
}

function normalizeGraphqlPost(post) {
  if (!post || typeof post !== 'object' || !post.code || !post.taken_at) return null;
  if (post.user?.username?.toLowerCase() !== username) return null;
  if (post.text_post_app_info?.reply_to_author || post.text_post_app_info?.reply_to_id) return null;
  const info = post.text_post_app_info && typeof post.text_post_app_info === 'object'
    ? post.text_post_app_info
    : {};
  const user = post.user && typeof post.user === 'object' ? post.user : {};
  const caption = post.caption && typeof post.caption === 'object' ? post.caption : {};
  const timestamp = Number(post.taken_at);
  if (!Number.isFinite(timestamp)) return null;

  return {
    code: String(post.code),
    url: `${THREADS_ORIGIN}/@${user.username || username}/post/${post.code}`,
    username: user.username || username,
    text: caption.text ?? post.text ?? null,
    timestamp,
    timestampIso: new Date(timestamp * 1000).toISOString(),
    likes: Number.isFinite(Number(post.like_count)) ? Number(post.like_count) : null,
    replies: Number.isFinite(Number(info.direct_reply_count ?? info.reply_count))
      ? Number(info.direct_reply_count ?? info.reply_count)
      : null,
    reposts: Number.isFinite(Number(info.repost_count)) ? Number(info.repost_count) : null,
    quotes: Number.isFinite(Number(info.quote_count)) ? Number(info.quote_count) : null,
    reshares: Number.isFinite(Number(info.reshare_count)) ? Number(info.reshare_count) : null,
    detectedLanguage: post.detected_language ?? null
  };
}

function collectGraphqlPosts(value, output = [], seenObjects = new Set(), depth = 0) {
  if (value == null || depth > 30) return output;
  if (typeof value !== 'object') return output;
  if (seenObjects.has(value)) return output;
  seenObjects.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectGraphqlPosts(item, output, seenObjects, depth + 1);
    return output;
  }

  const post = normalizeGraphqlPost(value);
  if (post) output.push(post);
  for (const child of Object.values(value)) {
    collectGraphqlPosts(child, output, seenObjects, depth + 1);
  }
  return output;
}

function relayVariables() {
  return {
    __relay_internal__pv__BarcelonaIsLoggedInrelayprovider: false,
    __relay_internal__pv__BarcelonaHasProfileSelfReplyContextrelayprovider: true,
    __relay_internal__pv__BarcelonaHasDearAlgoConsumptionrelayprovider: true,
    __relay_internal__pv__BarcelonaHasMetaAiContentAttachmentsrelayprovider: false,
    __relay_internal__pv__BarcelonaHasEventBadgerelayprovider: false,
    __relay_internal__pv__BarcelonaGenAIRepliesEnabledrelayprovider: true,
    __relay_internal__pv__BarcelonaIsSearchDiscoveryEnabledrelayprovider: false,
    __relay_internal__pv__BarcelonaHasCommunitiesrelayprovider: true,
    __relay_internal__pv__BarcelonaHasGameScoreSharerelayprovider: true,
    __relay_internal__pv__BarcelonaMessagesHasLiveChatMessagingrelayprovider: false,
    __relay_internal__pv__BarcelonaHasPublicViewCountCardrelayprovider: true,
    __relay_internal__pv__BarcelonaHasCommunityEmojiUpdateCardrelayprovider: false,
    __relay_internal__pv__BarcelonaHasCommunityEntityCardrelayprovider: true,
    __relay_internal__pv__BarcelonaHasScorecardCommunityrelayprovider: true,
    __relay_internal__pv__BarcelonaHasSportTeamAllegianceCardrelayprovider: true,
    __relay_internal__pv__BarcelonaHasMusicrelayprovider: true,
    __relay_internal__pv__BarcelonaHasNewspaperLinkStylerelayprovider: false,
    __relay_internal__pv__BarcelonaHasMessagingrelayprovider: true,
    __relay_internal__pv__BarcelonaHasPodcastV2Consumptionrelayprovider: true,
    __relay_internal__pv__BarcelonaHasPodcastTranscriptConsumptionrelayprovider: true,
    __relay_internal__pv__BarcelonaShouldFulfillLightboxQueryrelayprovider: true,
    __relay_internal__pv__BarcelonaHasViewerRepliedrelayprovider: false,
    __relay_internal__pv__BarcelonaHasPrivateRepliesDeprecationrelayprovider: false,
    __relay_internal__pv__BarcelonaHasGhostPostEmojiActivationrelayprovider: false,
    __relay_internal__pv__BarcelonaOptionalCookiesEnabledrelayprovider: true,
    __relay_internal__pv__BarcelonaHasDearAlgoWebProductionrelayprovider: false,
    __relay_internal__pv__BarcelonaHasWebFaviconsrelayprovider: true,
    __relay_internal__pv__BarcelonaIsCrawlerrelayprovider: false,
    __relay_internal__pv__BarcelonaHasCommunityTopContributorsrelayprovider: false,
    __relay_internal__pv__BarcelonaCanSeeSponsoredContentrelayprovider: false,
    __relay_internal__pv__BarcelonaShouldShowFediverseM075Featuresrelayprovider: true,
    __relay_internal__pv__BarcelonaIsInternalUserrelayprovider: false
  };
}

async function createAnonymousSession() {
  const cookies = new Map();
  const response = await fetch(`${THREADS_ORIGIN}/`, {
    signal: AbortSignal.timeout(20000),
    redirect: 'follow',
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'zh-TW,zh;q=0.9,en;q=0.7',
      'x-ig-app-id': APP_ID
    }
  });
  const html = await response.text();
  mergeCookies(cookies, response.headers);
  return {
    cookies,
    lsd: extractLsd(html),
    csrf: cookies.get('csrftoken') || ''
  };
}

async function fetchProfileHtml(session) {
  const response = await fetch(profileUrl, {
    signal: AbortSignal.timeout(20000),
    redirect: 'follow',
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'zh-TW,zh;q=0.9,en;q=0.7',
      'x-ig-app-id': APP_ID,
      cookie: cookieHeader(session.cookies)
    }
  });
  const html = await response.text();
  mergeCookies(session.cookies, response.headers);
  return { response, html };
}

async function fetchGraphqlPage({ session, userId, cursor, docId }) {
  const variables = {
    after: cursor,
    allow_page_info_for_lox_user: true,
    before: null,
    first: PAGE_SIZE,
    last: null,
    userID: String(userId),
    ...relayVariables()
  };

  const body = new URLSearchParams({
    __a: '1',
    __user: '0',
    lsd: session.lsd,
    doc_id: docId,
    fb_api_req_friendly_name: OPERATION,
    fb_api_caller_class: 'RelayModern',
    server_timestamps: 'true',
    variables: JSON.stringify(variables)
  });

  const response = await fetch(GRAPHQL_URL, {
    signal: AbortSignal.timeout(20000),
    method: 'POST',
    redirect: 'follow',
    headers: {
      'user-agent': UA,
      accept: '*/*',
      'accept-language': 'zh-TW,zh;q=0.9,en;q=0.7',
      'content-type': 'application/x-www-form-urlencoded',
      origin: THREADS_ORIGIN,
      referer: profileUrl,
      'x-ig-app-id': APP_ID,
      'x-fb-lsd': session.lsd,
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
  let jsonParseError = null;
  try {
    json = JSON.parse(text.replace(/^\s*for\s*\(;;\);\s*/, ''));
  } catch (error) {
    jsonParseError = String(error?.message || error);
  }

  const posts = json ? collectGraphqlPosts(json) : [];
  const pageInfo = json ? findPageInfo(json) : null;
  const errors = json ? [...new Set(collectErrorMessages(json))] : [];

  return {
    status: response.status,
    ok: response.ok,
    text,
    json,
    jsonParseError,
    posts,
    pageInfo,
    errors
  };
}

await mkdir(dirname(reportPath), { recursive: true });

const session = await createAnonymousSession();
if (!session.lsd) {
  console.log(JSON.stringify({
    username,
    success: false,
    stage: 'anonymous_session',
    reason: 'lsd_not_found'
  }, null, 2));
  process.exit(2);
}

const { response: profileResponse, html } = await fetchProfileHtml(session);
const hydration = parseHydrationData(html, username);
const initialPosts = hydration.posts || [];
const userId = extractUserId(html, username);
let cursor = extractInitialCursor(html);

if (!profileResponse.ok || !userId || !cursor) {
  console.log(JSON.stringify({
    username,
    success: false,
    stage: 'profile_bootstrap',
    profileStatus: profileResponse.status,
    initialCount: initialPosts.length,
    userIdFound: Boolean(userId),
    cursorFound: Boolean(cursor)
  }, null, 2));
  process.exit(2);
}

const byCode = new Map(initialPosts.filter((post) => post?.code).map((post) => [post.code, post]));
const attempts = [];
let chosenDocId = null;
let hasNextPage = true;
let page = 0;

while (byCode.size < TARGET_COUNT && cursor && hasNextPage !== false && page < 8) {
  page += 1;
  let pageResult = null;

  const docIdsToTry = chosenDocId ? [chosenDocId] : DOC_ID_CANDIDATES;
  for (const docId of docIdsToTry) {
    const result = await fetchGraphqlPage({ session, userId, cursor, docId });
    attempts.push({
      page,
      docId,
      status: result.status,
      postCount: result.posts.length,
      errorMessages: result.errors,
      jsonParseError: result.jsonParseError,
      nextCursorFound: Boolean(result.pageInfo?.cursor),
      hasNextPage: result.pageInfo?.hasNextPage ?? null
    });

    if (result.posts.length > 0 || result.pageInfo?.cursor) {
      pageResult = result;
      chosenDocId = docId;
      break;
    }
  }

  if (!pageResult) break;

  for (const post of pageResult.posts) {
    if (post?.code) byCode.set(post.code, post);
  }

  const nextCursor = pageResult.pageInfo?.cursor || null;
  hasNextPage = pageResult.pageInfo?.hasNextPage ?? null;
  if (!nextCursor || nextCursor === cursor) break;
  cursor = nextCursor;
}

const posts = [...byCode.values()]
  .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
  .slice(0, TARGET_COUNT);

const report = {
  fetchedAt: new Date().toISOString(),
  username,
  success: posts.length >= TARGET_COUNT,
  transport: 'anonymous-server-http',
  browserUsed: false,
  loginUsed: false,
  profileStatus: profileResponse.status,
  userId,
  initialCount: initialPosts.length,
  chosenDocId,
  returnedCount: posts.length,
  attempts,
  posts
};

await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

console.log(JSON.stringify({
  username: report.username,
  success: report.success,
  browserUsed: report.browserUsed,
  loginUsed: report.loginUsed,
  initialCount: report.initialCount,
  chosenDocId: report.chosenDocId,
  returnedCount: report.returnedCount,
  attempts: report.attempts,
  reportFile: `debug/${username}.30posts-http.json`
}, null, 2));

if (!report.success) process.exitCode = 2;
