import { fetchThreadsPublicProfile } from './threads-public.js';

const username = process.argv[2] || '@runing_9to5';
const result = await fetchThreadsPublicProfile(username);
console.log(JSON.stringify(result, null, 2));

if (result.diagnostics?.error || result.diagnostics?.blocked) {
  process.exitCode = 2;
}
