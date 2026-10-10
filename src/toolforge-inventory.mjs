import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { quotePowerShell, skillCommandText, skillId, skillRunner } from './toolforge-skill-command.mjs';

function contained(root, path) {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../') && !isAbsolute(rel);
}

export function inspectToolforgeSkill(skill, root) {
  const id = skillId(skill);
  const result = { ...skill, id, runnable: false, command: '', availability: 'unavailable' };
  if (!/^[a-z0-9_][a-z0-9_-]*$/i.test(id)) return { ...result, reason: 'Invalid skill identifier' };
  const directory = resolve(root, 'skills', id);
  if (!existsSync(directory) || !contained(realpathSync(resolve(root, 'skills')), realpathSync(directory))) {
    return { ...result, reason: 'Skill is not installed' };
  }
  for (const name of ['skill.json', 'SKILL.json']) {
    const path = join(directory, name);
    if (!existsSync(path)) continue;
    try {
      const installed = JSON.parse(readFileSync(path, 'utf8'));
      result.entrypoint = installed.entrypoint || installed.entry || skill.entrypoint;
      result.runtime = installed.runtime || skill.runtime;
      break;
    } catch {
      return { ...result, reason: 'Installed skill metadata is invalid' };
    }
  }
  const entry = String(result.entrypoint || 'SKILL.md');
  const entrypoint = resolve(entry.replace(/\\/g, '/').startsWith('skills/') ? root : directory, entry);
  if (!contained(directory, entrypoint) || (existsSync(entrypoint) && !contained(realpathSync(directory), realpathSync(entrypoint)))) {
    return { ...result, reason: 'Entrypoint escapes skill directory' };
  }
  const instructions = join(directory, 'SKILL.md');
  if (existsSync(instructions) && contained(realpathSync(directory), realpathSync(instructions))) {
    result.command = `code ${quotePowerShell(instructions)}`;
    result.availability = 'instructions';
  }
  if (!existsSync(entrypoint)) return { ...result, reason: 'Entrypoint is missing' };
  const source = readFileSync(entrypoint, 'utf8');
  const extension = entrypoint.split('.').pop().toLowerCase();
  if (extension === 'md' || !(['ps1', 'sh'].includes(extension) || /process\.argv|__name__\s*==\s*['"]__main__['"]/.test(source))) {
    return { ...result, reason: 'Requires skill inputs or host integration' };
  }
  let runner;
  if (['ts', 'tsx'].includes(extension) || result.runtime === 'typescript') {
    const launcher = ['tsx/dist/cli.mjs', 'ts-node/dist/bin.js']
      .map(path => join(directory, 'node_modules', path)).find(existsSync);
    if (!launcher) return { ...result, reason: 'Local TypeScript launcher is missing' };
    runner = ['node', [launcher, entrypoint]];
    result.command = `node ${runner[1].map(quotePowerShell).join(' ')}`;
  } else {
    runner = skillRunner(result, root);
    result.command = skillCommandText(result, root);
  }
  if (!runner) return { ...result, reason: 'No standalone runtime' };
  return { ...result, runnable: true, availability: 'cli', reason: '', runner };
}

export function readToolforgeInventory(manifestPath, root) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.skills)) throw new TypeError('Invalid Toolforge skills manifest');
  return { ...manifest, skills: manifest.skills.map(skill => inspectToolforgeSkill(skill, root)) };
}
