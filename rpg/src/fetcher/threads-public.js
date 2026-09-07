const THREADS_ORIGIN = 'https://www.threads.com';

export function normalizeUsername(input) {
  if (!input) throw new Error('username is required');
  const raw = String(input).trim();
  const fromUrl = raw.match(/threads\.(?:com|net)\/@([^/?#]+)/i)?.[1];
  const username = (fromUrl || raw).replace(/^@/, '').trim();
  if (!/^[A-Za-z0-9._]+$/.test(username)) throw new Error('invalid Threads username');
  return username;
}

function decodeEntities(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function meta(html, key, attr = 'property') {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${escaped}["']`, 'i')
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1]);
  }
  return null;
}

function collectPermalinks(html, username) {
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:https?:\\/\\/(?:www\\.)?threads\\.(?:com|net))?\\/@${escaped}\\/post\\/([A-Za-z0-9_-]+)`, 'gi');
  const seen = new Set();
  const posts = [];
  let match;
  while ((match = regex.exec(html)) && posts.length < 30) {
    const code = match[1];
    if (seen.has(code)) continue;
    seen.add(code);
    posts.push({
      code,
      url: `${THREADS_ORIGIN}/@${username}/post/${code}`,
      timestamp: null,
      likes: null,
      replies: null,
      reposts: null,
      quotes: null,
      text: null
    });
  }
  return posts;
}

export function parsePublicProfileHtml(html, username, finalUrl) {
  const title = meta(html, 'og:title') || meta(html, 'twitter:title', 'name');
  const description = meta(html, 'og:description') || meta(html, 'description', 'name');
  const avatar = meta(html, 'og:image') || meta(html, 'twitter:image', 'name');
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1] || finalUrl;
  const posts = collectPermalinks(html, username);

  return {
    source: 'threads-public-html',
    fetchedAt: new Date().toISOString(),
    profile: {
      username,
      title,
      description,
      avatar,
      canonical,
      followers: null
    },
    posts,
    diagnostics: {
      htmlBytes: Buffer.byteLength(html, 'utf8'),
      postPermalinksFound: posts.length,
      hasMetaDescription: Boolean(description),
      note: posts.length
        ? 'Public HTML exposed post permalinks. Per-post metrics still require deeper parsing/fetching.'
        : 'No post permalinks found in initial HTML. Browser/hydration fallback may be required.'
    }
  };
}

export async function fetchThreadsPublicProfile(input, options = {}) {
  const username = normalizeUsername(input);
  const url = `${THREADS_ORIGIN}/@${encodeURIComponent(username)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; ThreadsRPGPoC/0.1; +https://runing9to5.com)',
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'zh-TW,zh;q=0.9,en;q=0.7'
      }
    });

    const html = await response.text();
    if (!response.ok) {
      return {
        source: 'threads-public-html',
        fetchedAt: new Date().toISOString(),
        profile: { username },
        posts: [],
        diagnostics: {
          status: response.status,
          blocked: [401, 403, 429].includes(response.status),
          htmlBytes: Buffer.byteLength(html, 'utf8'),
          note: `Threads returned HTTP ${response.status}`
        }
      };
    }

    const result = parsePublicProfileHtml(html, username, response.url);
    result.diagnostics.status = response.status;
    result.diagnostics.blocked = false;
    return result;
  } catch (error) {
    return {
      source: 'threads-public-html',
      fetchedAt: new Date().toISOString(),
      profile: { username },
      posts: [],
      diagnostics: {
        blocked: false,
        error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error),
        note: 'Initial public HTML fetch failed.'
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}
