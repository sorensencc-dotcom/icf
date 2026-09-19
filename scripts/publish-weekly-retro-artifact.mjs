import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildWeeklyRetroArtifact } from '../reporting/src/publication-artifact.mjs';
import { CATEGORY_REGISTRY, normalizeCategoryMetrics } from '../reporting/src/category-contract.mjs';

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

function getPath(source, path) {
  return path.split('.').reduce((value, key) => value?.[key], source);
}

function deriveProjections(report) {
  const normalized = normalizeCategoryMetrics(report, { registry: CATEGORY_REGISTRY, allowPartial: true });
  const definitions = new Map(CATEGORY_REGISTRY.categories.map(category => [category.id, category]));
  const categories = normalized.map(category => {
    const definition = definitions.get(category.category_id);
    const measured = category.metrics.filter(metric => metric.state !== 'unavailable').length;
    return {
      id: category.category_id,
      name: definition.label,
      summary: `${measured} of ${category.metrics.length} category metrics measured from the weekly report.`
    };
  });
  const evidence = normalized.flatMap(category => {
    const definition = definitions.get(category.category_id);
    return category.metrics
      .filter(metric => metric.state !== 'unavailable' && metric.value !== null)
      .map(metric => ({
        label: `${definition.label}: ${metric.metric_id} = ${metric.value}`,
        source: metric.source_field,
        category: category.category_id
      }));
  });
  return {
    categories,
    evidence,
    actions: Array.isArray(report.actions) ? report.actions : undefined
  };
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
} else {
  projections = deriveProjections(report);
}

const artifact = buildWeeklyRetroArtifact({ report, ...projections });
await atomicWrite(runPath, artifact);
await atomicWrite(latestPath, artifact);
