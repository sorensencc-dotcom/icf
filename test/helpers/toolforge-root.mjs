import { mkdtemp, mkdir, copyFile, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const icfRoot = resolve(here, '../..');
const pinnedDir = resolve(here, '../fixtures/toolforge-pinned');

// Builds a hermetic Toolforge root: the managed CLI is copied from the real Toolforge tree, while
// manifest.json and package.json are the copies pinned in invocation-reviewed.json. The live root
// files change independently of the pin, so tests must not hash them directly.
export async function createToolforgeTestRoot() {
  const sourceRoot = resolve(process.env.ICF_TEST_TOOLFORGE_ROOT || resolve(icfRoot, '..'));
  const root = await mkdtemp(join(tmpdir(), 'icf-toolforge-root-'));
  const cli = 'skills/toolforge-cli';
  await mkdir(join(root, cli, 'src'), { recursive: true });
  await copyFile(join(sourceRoot, cli, 'SKILL.json'), join(root, cli, 'SKILL.json'));
  for (const file of await readdir(join(sourceRoot, cli, 'src'))) {
    await copyFile(join(sourceRoot, cli, 'src', file), join(root, cli, 'src', file));
  }
  // The pin also covers each pilot skill's own files; those come from the real tree and must match.
  const reviewed = JSON.parse(await readFile(join(sourceRoot, cli, 'src/invocation-reviewed.json'), 'utf8'));
  const skillFiles = Object.values(reviewed.skills).flatMap(skill => skill.files);
  for (const file of skillFiles) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await copyFile(join(sourceRoot, file), join(root, file));
  }
  for (const file of ['manifest.json', 'package.json']) await copyFile(join(pinnedDir, file), join(root, file));
  return { root, sourceRoot, icfRoot, cleanup: () => rm(root, { recursive: true, force: true }) };
}
