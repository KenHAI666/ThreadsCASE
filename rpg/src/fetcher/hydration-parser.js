const THREADS_ORIGIN = 'https://www.threads.com';

function normalizeEscapedJson(source) {
  return source.includes('\\"taken_at\\"') ? source.replaceAll('\\"', '"') : source;
}

function lastString(source, name) {
  const regex = new RegExp(`"${name}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'g');
  let match;
  let last = null;
  while ((match = regex.exec(source))) last = match[1];
  if (last == null) return null;
  try {
    return JSON.parse(`"${last}"`);
  } catch {
    return last;
  }
}

function lastNumber(source, names) {
  let best = null;
  let bestIndex = -1;

  for (const name of names) {
    const regex = new RegExp(`"${name}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'g');
    let match;
    while ((match = regex.exec(source))) {
      if (match.index > bestIndex) {
        bestIndex = match.index;
        best = Number(match[1]);
      }
    }
  }
  return best;
}

function allTakenAtIndexes(source) {
  const regex = /"taken_at"\s*:\s*(\d+)/g;
  const hits = [];
  let match;
  while ((match = regex.exec(source))) {
    hits.push({ index: match.index, timestamp: Number(match[1]), end: regex.lastIndex });
  }
  return hits;
}

function segmentForPost(source, hits, index) {
  // Threads hydration objects observed so far place a post's fields before its taken_at.
  // Bound the search to the region after the previous post's taken_at so values from
  // neighboring posts cannot bleed into the current record.
  const start = index === 0 ? Math.max(0, hits[index].index - 16000) : hits[index - 1].end;
  const end = hits[index].end;
  return source.slice(start, end);
}

export function parseHydrationData(html, username) {
  const source = normalizeEscapedJson(html);
  const hits = allTakenAtIndexes(source);
  const seen = new Set();
  const posts = [];

  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i];
    const segment = segmentForPost(source, hits, i);
    const code = lastString(segment, 'code');
    if (!code || seen.has(code)) continue;

    const text = lastString(segment, 'text') || lastString(segment, 'caption_text');
    const likes = lastNumber(segment, ['like_count']);
    const replies = lastNumber(segment, ['direct_reply_count', 'reply_count']);
    const reposts = lastNumber(segment, ['repost_count']);
    const quotes = lastNumber(segment, ['quote_count']);
    const reshares = lastNumber(segment, ['reshare_count']);
    const detectedLanguage = lastString(segment, 'detected_language');

    seen.add(code);
    posts.push({
      code,
      url: `${THREADS_ORIGIN}/@${username}/post/${code}`,
      text,
      timestamp: hit.timestamp,
      timestampIso: new Date(hit.timestamp * 1000).toISOString(),
      likes,
      replies,
      reposts,
      quotes,
      reshares,
      detectedLanguage
    });
  }

  const followerMatches = [...source.matchAll(/"follower_count"\s*:\s*(\d+)/g)];
  const followers = followerMatches.length ? Number(followerMatches.at(-1)[1]) : null;

  return {
    posts: posts.slice(0, 30),
    followers,
    diagnostics: {
      takenAtCount: hits.length,
      parsedPostCount: posts.length,
      followerCountFound: followers != null
    }
  };
}
