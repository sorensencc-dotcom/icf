import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildWeeklyRetroArtifact } from '../reporting/src/publication-artifact.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return resolve(process.argv[index + 1]);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function atomicWrite(path, value) {
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

const reportPath = argument('--report');
const runPath = argument('--run');
const latestPath = argument('--latest');
const projectionPath = process.argv.includes('--projection')
  ? argument('--projection')
  : undefined;

const report = await readJson(reportPath);
let projections = {};
if (projectionPath) {
  const supplied = await readJson(projectionPath);
  if (supplied === null || typeof supplied !== 'object' || Array.isArray(supplied)) {
    throw new TypeError('Projection sidecar must be an object');
  }
  projections = supplied;
}

const artifact = buildWeeklyRetroArtifact({ report, ...projections });
await atomicWrite(runPath, artifact);
await atomicWrite(latestPath, artifact);
