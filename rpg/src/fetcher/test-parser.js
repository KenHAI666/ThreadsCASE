import assert from 'node:assert/strict';
import { normalizeUsername, parsePublicProfileHtml } from './threads-public.js';

assert.equal(normalizeUsername('@runing_9to5'), 'runing_9to5');
assert.equal(normalizeUsername('https://www.threads.com/@runing_9to5'), 'runing_9to5');

const html = `<!doctype html><html><head>
<meta property="og:title" content="K叔 (@runing_9to5) on Threads">
<meta property="og:description" content="公開帳號測試">
<meta property="og:image" content="https://example.com/avatar.jpg">
<link rel="canonical" href="https://www.threads.com/@runing_9to5">
</head><body>
<a href="/@runing_9to5/post/ABC123">post</a>
<a href="https://www.threads.com/@runing_9to5/post/XYZ789">post2</a>
</body></html>`;

const parsed = parsePublicProfileHtml(html, 'runing_9to5', 'https://www.threads.com/@runing_9to5');
assert.equal(parsed.profile.username, 'runing_9to5');
assert.equal(parsed.posts.length, 2);
assert.equal(parsed.posts[0].code, 'ABC123');
assert.equal(parsed.diagnostics.postPermalinksFound, 2);

console.log('parser smoke test passed');
