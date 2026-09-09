import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeUsername } from './src/fetcher/threads-public.js';

const execFileAsync = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const cacheTtlMs = Number(process.env.RPG_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const concurrencyLimit = Math.max(1, Number(process.env.RPG_MAX_CONCURRENT || 2));
const rateLimitPerMinute = Math.max(1, Number(process.env.RPG_RATE_LIMIT_PER_MIN || 10));
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const cache = new Map();
const inFlight = new Map();
const rateBuckets = new Map();
const computeQueue = [];
let activeComputations = 0;

function sendJson(response, status, value) {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  response.end(body);
}

function safeFetchDiagnostics(details) {
  if (!details || typeof details !== 'object') return undefined;
  return {
    stage: details.stage || null,
    profileStatus: details.profileStatus ?? null,
    initialCount: details.initialCount ?? null,
    returnedCount: details.returnedCount ?? null,
    attempts: Array.isArray(details.attempts)
      ? details.attempts.map((attempt) => ({
        page: attempt.page ?? null,
        docId: attempt.docId ?? null,
        status: attempt.status ?? null,
        postCount: attempt.postCount ?? null,
        nextCursorFound: attempt.nextCursorFound ?? null,
        hasNextPage: attempt.hasNextPage ?? null,
        errors: Array.isArray(attempt.errors) ? attempt.errors.slice(0, 3) : []
      }))
      : []
  };
}

async function readReport(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function runScript(script, args, { allowExitCodes = [] } = {}) {
  try {
    return await execFileAsync(process.execPath, [join(root, script), ...args], {
      cwd: root,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true
    });
  } catch (error) {
    if (allowExitCodes.includes(error?.code)) {
      return { stdout: error?.stdout || '', stderr: error?.stderr || '' };
    }
    const output = `${error?.stdout || ''}\n${error?.stderr || ''}`.trim();
    const wrapped = new Error(`執行 ${script} 失敗`);
    wrapped.code = error?.code || 'SCRIPT_FAILED';
    wrapped.details = output.slice(-2500) || null;
    throw wrapped;
  }
}

async function compute(username) {
  const taskDir = await mkdtemp(join(tmpdir(), 'threads-rpg-'));
  const fetchPath = join(taskDir, 'posts.json');
  const analysisPath = join(taskDir, 'analysis.json');
  try {

  await runScript('src/fetcher/fetch30-http-v2.js', [`@${username}`, fetchPath], { allowExitCodes: [2] });
  const fetched = await readReport(fetchPath).catch(() => null);
  if (!fetched || !fetched.posts?.length || fetched.complete === false) {
    const error = new Error('Threads 公開頁面目前無法取得足夠資料');
    error.code = 'FETCH_INCOMPLETE';
    error.details = {
      stage: fetched?.stage || null,
      profileStatus: fetched?.profileStatus || null,
      returnedCount: fetched?.returnedCount || 0,
      initialCount: fetched?.initialCount || 0,
      attempts: fetched?.attempts || []
    };
    throw error;
  }

  await runScript('src/scoring/analyze30.js', [fetchPath, analysisPath]);
  const analysis = await readReport(analysisPath);
  delete analysis.source.input;
  return {
    analysis,
    fetched: {
      fetchedAt: fetched.fetchedAt,
      returnedCount: fetched.returnedCount,
      complete: fetched.complete,
      success: fetched.success,
      initialCount: fetched.initialCount,
      collectedCount: fetched.collectedCount,
      transport: fetched.transport,
      browserUsed: fetched.browserUsed,
      loginUsed: fetched.loginUsed
    }
  };
  } finally {
    await rm(taskDir, { recursive: true, force: true });
  }
}

async function withComputeSlot(task) {
  if (activeComputations >= concurrencyLimit) {
    if (computeQueue.length >= 12) {
      const error = new Error('目前冒險者較多，請一分鐘後再試。');
      error.code = 'BUSY';
      throw error;
    }
    await new Promise((resolve) => computeQueue.push(resolve));
  }
  activeComputations += 1;
  try {
    return await task();
  } finally {
    activeComputations -= 1;
    computeQueue.shift()?.();
  }
}

function requestKey(request) {
  const forwarded = request.headers['x-forwarded-for'];
  return String(forwarded || request.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function rateLimitExceeded(key) {
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { startedAt: now, count: 0 };
  if (now - bucket.startedAt >= 60_000) {
    bucket.startedAt = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 5000) {
    for (const [entryKey, entry] of rateBuckets) {
      if (now - entry.startedAt >= 60_000) rateBuckets.delete(entryKey);
    }
  }
  return bucket.count > rateLimitPerMinute;
}

async function analyze(username) {
  const cached = cache.get(username);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, cache: { hit: true, expiresAt: cached.expiresAt } };
  }

  if (!inFlight.has(username)) {
    const task = withComputeSlot(() => compute(username))
      .then((value) => {
        const expiresAt = Date.now() + cacheTtlMs;
        if (cache.size >= 300) cache.delete(cache.keys().next().value);
        cache.set(username, { value, expiresAt });
        return { ...value, cache: { hit: false, expiresAt } };
      })
      .finally(() => inFlight.delete(username));
    inFlight.set(username, task);
  }

  return inFlight.get(username);
}

function contentType(path) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.svg')) return 'image/svg+xml; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}

async function serveStatic(pathname, response) {
  let relativePath = null;
  if (pathname === '/' || pathname === '/rpg' || pathname === '/rpg/') relativePath = 'index.html';
  else if (pathname.startsWith('/assets/')) relativePath = join('assets', pathname.slice('/assets/'.length));
  if (!relativePath || relativePath.includes('..') || relativePath.includes('\\')) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  const filePath = resolve(root, relativePath);
  if (!filePath.startsWith(`${root}/`)) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      'content-type': contentType(filePath),
      'cache-control': filePath.endsWith('.png') ? 'public, max-age=86400' : 'no-cache'
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}

const server = http.createServer(async (request, response) => {
  let url;
  try { url = new URL(request.url || '/', 'http://localhost'); }
  catch { sendJson(response, 400, { ok: false, message: '網址格式錯誤' }); return; }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type'
    });
    response.end();
    return;
  }

  if (!['GET', 'HEAD'].includes(request.method)) {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }

  if (url.pathname === '/api/health') {
    sendJson(response, 200, {
      ok: true,
      service: 'threads-rpg',
      cacheTtlMs,
      concurrencyLimit,
      activeComputations,
      queuedComputations: computeQueue.length
    });
    return;
  }

  if (url.pathname === '/api/analyze') {
    if (rateLimitExceeded(requestKey(request))) {
      response.writeHead(429, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '60',
        'access-control-allow-origin': '*'
      });
      response.end(JSON.stringify({ ok: false, error: 'rate_limited', message: '請稍後再試。' }));
      return;
    }
    let username;
    try {
      username = normalizeUsername(url.searchParams.get('username'));
    } catch (error) {
      sendJson(response, 400, { ok: false, error: 'invalid_username', message: error.message });
      return;
    }

    try {
      const result = await analyze(username);
      sendJson(response, 200, { ok: true, username, ...result });
    } catch (error) {
      console.error('analysis failed', username, error.code, error.details || error.message);
      sendJson(response, error.code === 'BUSY' ? 503 : error.code === 'FETCH_INCOMPLETE' ? 422 : 502, {
        ok: false,
        username,
        error: error.code || 'analysis_failed',
        message: error.code === 'BUSY' ? error.message : '目前無法讀取這個帳號的公開貼文。請確認帳號為公開，或稍後再試。',
        diagnostics: safeFetchDiagnostics(error.details)
      });
    }
    return;
  }

  await serveStatic(url.pathname, response);
});

server.listen(port, host, () => {
  console.log(`Threads RPG web: http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
