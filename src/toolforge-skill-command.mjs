import { join, resolve } from 'node:path';

const DEFAULT_TOOLFORGE_ROOT = 'C:\\dev';

export function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function skillId(skill) {
  return String(skill?.id || skill?.name || '').trim();
}

export function skillEntrypointPath(skill, toolforgeRoot = DEFAULT_TOOLFORGE_ROOT) {
  const id = skillId(skill);
  const entrypoint = String(skill?.entrypoint || 'SKILL.md').replace(/\//g, '\\');
  if (!id) return null;
  if (/^[A-Za-z]:\\/.test(entrypoint)) return entrypoint;
  if (entrypoint.toLowerCase().startsWith('skills\\')) return resolve(toolforgeRoot, entrypoint);
  return join(toolforgeRoot, 'skills', id, entrypoint);
}

export function skillDirectory(skill, toolforgeRoot = DEFAULT_TOOLFORGE_ROOT) {
  const id = skillId(skill);
  if (!id) return null;
  return join(toolforgeRoot, 'skills', id);
}

export function skillRelativeEntrypoint(skill) {
  const id = skillId(skill);
  const entrypoint = String(skill?.entrypoint || 'SKILL.md').replace(/\//g, '\\');
  const prefix = `skills\\${id}\\`.toLowerCase();
  return entrypoint.toLowerCase().startsWith(prefix) ? entrypoint.slice(prefix.length) : entrypoint;
}

export function skillCommandText(skill, toolforgeRoot = DEFAULT_TOOLFORGE_ROOT) {
  const entrypoint = skillEntrypointPath(skill, toolforgeRoot);
  if (!entrypoint) return '';

  const runtime = String(skill?.runtime || '').toLowerCase();
  const lower = entrypoint.toLowerCase();
  const q = quotePowerShell(entrypoint);

  if (runtime === 'bash' || lower.endsWith('.sh')) return `bash ${q}`;
  if (runtime === 'python' || lower.endsWith('.py')) return `python ${q}`;
  if (runtime === 'powershell' || lower.endsWith('.ps1')) return `pwsh -NoProfile -File ${q}`;
  if (runtime === 'typescript' || lower.endsWith('.ts') || lower.endsWith('.tsx')) {
    return `code ${quotePowerShell(join(skillDirectory(skill, toolforgeRoot), 'SKILL.md'))}`;
  }
  if (runtime === 'prompt' || lower.endsWith('skill.md')) return `code ${q}`;
  return `node ${q}`;
}

export function skillRunner(skill, toolforgeRoot = DEFAULT_TOOLFORGE_ROOT) {
  const entrypoint = skillEntrypointPath(skill, toolforgeRoot);
  if (!entrypoint) return null;

  const runtime = String(skill?.runtime || '').toLowerCase();
  const lower = entrypoint.toLowerCase();
  if (runtime === 'bash' || lower.endsWith('.sh')) return ['bash', [entrypoint]];
  if (runtime === 'python' || lower.endsWith('.py')) return ['python', [entrypoint]];
  if (runtime === 'powershell' || lower.endsWith('.ps1')) return ['pwsh.exe', ['-NoProfile', '-File', entrypoint]];
  if (runtime === 'typescript' || lower.endsWith('.ts') || lower.endsWith('.tsx')) {
    return null;
  }
  if (runtime === 'prompt' || lower.endsWith('skill.md')) return null;
  return ['node', [entrypoint]];
}
