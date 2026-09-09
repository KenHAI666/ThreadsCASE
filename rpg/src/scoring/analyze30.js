import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeCatPosts } from '../../assets/cat-card-analyzer.js';

const defaultInputPath = fileURLToPath(new URL('../../debug/runing_9to5.30posts-http.json', import.meta.url));
const inputPath = resolve(process.argv[2] || defaultInputPath);
const source = JSON.parse(await readFile(inputPath, 'utf8'));
const username = source.username || basename(inputPath).split('.')[0];
const defaultOutputPath = fileURLToPath(new URL(`../../debug/${username}.analysis.json`, import.meta.url));
const outputPath = resolve(process.argv[3] || defaultOutputPath);

const report = analyzeCatPosts(source.posts, {
  username,
  inputPath,
  transport: source.transport,
  fetchSuccess: source.success === true,
  browserUsed: source.browserUsed === true,
  loginUsed: source.loginUsed === true,
  requestedCount: source.requestedCount || 30
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');

console.log(JSON.stringify({
  username,
  sampleCount: report.source.sampleCount,
  battlePower: report.battlePower,
  profession: report.profession.label,
  dimensions: report.dimensions.map(({ label, score }) => ({ label, score })),
  outputFile: outputPath
}, null, 2));
