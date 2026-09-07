const THREADS_ORIGIN = 'https://www.threads.com';

function normalizeEscapedJson(source) {
  return source.includes('\\"taken_at\\"') ? source.replaceAll('\\"', '"') : source;
}

function nearestStringBefore(source, name, anchor, maxDistance = 12000) {
  const start = Math.max(0, anchor - maxDistance);
  const chunk = source.slice(start, anchor + 1);
  const regex = new RegExp(`"${name}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'g');
  let match;
  let last = null;
  while ((match = regex.exec(chunk))) last = match[1];
  if (last == null) return null;
  try {
    return JSON.parse(`"${last}"`);
  } catch {
    return last;
  }
}

function nearestNumberBefore(source, names, anchor, maxDistance = 12000) {
  const start = Math.max(0, anchor - maxDistance);
  const chunk = source.slice(start, anchor + 1);
  let best = null;
  let bestIndex = -1;

  for (const name of names) {
    const regex = new RegExp(`"${name}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'g');
    let match;
    while ((match = regex.exec(chunk))) {
      if (match.index > bestIndex) {
        bestIndex = match.index;
        best = Number(match[1]);
      }
    }
  }
  return best;
}

function nearestNumberAfter(source, names, anchor, maxDistance = 4000) {
  const chunk = source.slice(anchor, Math.min(source.length, anchor + maxDistance));
  let best = null;
  let bestIndex = Infinity;

  for (const name of names) {
    const regex = new RegExp(`"${name}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'g');
    const match = regex.exec(chunk);
    if (match && match.index < bestIndex) {
      bestIndex = match.index;
      best = Number(match[1]);
    }
  }
  return best;
}

function allTakenAtIndexes(source) {
  const regex = /"taken_at"\s*:\s*(\d+)/g;
  const hits = [];
  let match;
  while ((match = regex.exec(source))) {
    hits.push({ index: match.index, timestamp: Number(match[1]) });
  }
  return hits;
}

export function parseHydrationData(html, username) {
  const source = normalizeEscapedJson(html);
  const seen = new Set();
  const posts = [];

  for (const hit of allTakenAtIndexes(source)) {
    const code = nearestStringBefore(source, 'code', hit.index);
    if (!code || seen.has(code)) continue;

    const text = nearestStringBefore(source, 'text', hit.index) || nearestStringBefore(source, 'caption_text', hit.index);
    const likes = nearestNumberBefore(source, ['like_count'], hit.index) ?? nearestNumberAfter(source, ['like_count'], hit.index);
    const replies = nearestNumberBefore(source, ['direct_reply_count', 'reply_count'], hit.index) ?? nearestNumberAfter(source, ['direct_reply_count', 'reply_count'], hit.index);
    const reposts = nearestNumberBefore(source, ['repost_count'], hit.index) ?? nearestNumberAfter(source, ['repost_count'], hit.index);
    const quotes = nearestNumberBefore(source, ['quote_count'], hit.index) ?? nearestNumberAfter(source, ['quote_count'], hit.index);
    const reshares = nearestNumberBefore(source, ['reshare_count'], hit.index) ?? nearestNumberAfter(source, ['reshare_count'], hit.index);
    const detectedLanguage = nearestStringBefore(source, 'detected_language', hit.index, 3000);

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
      takenAtCount: allTakenAtIndexes(source).length,
      parsedPostCount: posts.length,
      followerCountFound: followers != null
    }
  };
}
