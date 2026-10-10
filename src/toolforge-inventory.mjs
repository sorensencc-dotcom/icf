import { existsSync, readFileSync, realpathSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { quotePowerShell, skillCommandText, skillId, skillRunner } from './toolforge-skill-command.mjs';

function contained(root, path) {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../') && !isAbsolute(rel);
}

export function inspectToolforgeSkill(skill, root) {
  const id = skillId(skill);
  const result = { ...skill, id, runnable: false, command: '', availability: 'unavailable' };
  delete result.inputInvocation;
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

export function readToolforgeInventory(manifestPath, root, inputInvocations = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.skills)) throw new TypeError('Invalid Toolforge skills manifest');
  return { ...manifest, skills: manifest.skills.map(skill => {
    const checked = inspectToolforgeSkill(skill, root);
    return TOOLFORGE_PILOTS.includes(checked.id) && Object.hasOwn(inputInvocations, checked.id) ? { ...checked, inputInvocation: inputInvocations[checked.id] } : checked;
  }) };
}

export const TOOLFORGE_PILOTS = Object.freeze(['roadmap-validator', 'agent-drift-detector', 'retro-schema-validator']);
const REVIEWED_PATH = 'skills/toolforge-cli/src/invocation-reviewed.json';
// Review anchor from Toolforge 903c4436; never learn trusted hashes from installed code.
const REVIEWED_SHA256 = 'e93d685b466750a29471df2991491dc841585987d819cc92b3a292c8be83eb51';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function verifyManagedBootstrap(context) {
  try {
    if (Number(process.versions.node.split('.')[0]) !== 24 || typeof context.nodeExecutable !== 'string' || !isAbsolute(context.nodeExecutable) ||
        realpathSync(context.nodeExecutable) !== realpathSync(process.execPath) || !context.workspaceRoots.length ||
        context.workspaceRoots.some(root => typeof root !== 'string' || !isAbsolute(root) || !lstatSync(realpathSync(root)).isDirectory())) throw new Error('runtime');
  } catch { throw Object.assign(new Error('runtime'), { code: 'RUNTIME_UNAVAILABLE' }); }
  if (!existsSync(join(context.toolforgeRoot, REVIEWED_PATH))) throw Object.assign(new Error('missing'), { code: 'RUNTIME_UNAVAILABLE' });
  const root = realpathSync(context.toolforgeRoot);
  const checkedFile = file => {
    const path = realpathSync(join(root, file));
    if (!contained(root, path)) throw new Error('escape');
    return readFileSync(path);
  };
  const bytes = checkedFile(REVIEWED_PATH);
  if (digest(bytes) !== REVIEWED_SHA256) throw new Error('anchor');
  const reviewed = JSON.parse(bytes);
  if (realpathSync(context.manifestPath) !== realpathSync(join(root, 'manifest.json'))) throw new Error('manifest');
  for (const file of reviewed.shared) {
    if (digest(checkedFile(file)) !== reviewed.files[file]) throw new Error('source');
  }
  for (const file of reviewed.absent) {
    try { lstatSync(join(root, file)); }
    catch (cause) { if (cause.code === 'ENOENT') continue; throw cause; }
    throw new Error('resolution');
  }
}

export function toolforgeHttpFailure(skillId, code, state = 'rejected') {
  const messages = { INVALID_JSON: 'Invalid JSON', INVALID_INPUT: 'Invalid invocation input', INVALID_TARGET: 'Unknown pilot skill',
    PAYLOAD_TOO_LARGE: 'Request exceeds 64 KiB', FORBIDDEN: 'Forbidden: loopback and configured Origin required',
    METHOD_NOT_ALLOWED: 'Method Not Allowed', UNSUPPORTED_CONTENT_TYPE: 'Expected application/json with UTF-8 encoding',
    RUNTIME_UNAVAILABLE: 'Compatible read-only runtime unavailable', SOURCE_DRIFT: 'Installed sources do not match reviewed pilot',
    WORKER_FAILED: 'Skill execution failed', CANCELLED: 'Invocation cancelled' };
  return { contractVersion: 1, skillId, state, outcome: null, result: null,
    error: { code, message: messages[code] }, durationMs: 0 };
}

export function createToolforgeInvocationConsumer(context, testApi) {
  const trusted = { ...context, workspaceRoots: [...context.workspaceRoots] };
  const commandContext = { nodeExecutable: trusted.nodeExecutable,
    scriptPath: join(trusted.toolforgeRoot, 'skills/toolforge-cli/src/invoke-skill.mjs'), workspaceRoots: trusted.workspaceRoots };
  let loading;
  let closed = false;
  async function load() {
    if (closed) throw Object.assign(new Error('closed'), { code: 'CANCELLED' });
    if (!testApi) {
      try { verifyManagedBootstrap(trusted); }
      catch (cause) { throw Object.assign(new Error('unavailable'), { code: cause.code === 'RUNTIME_UNAVAILABLE' ? cause.code : 'SOURCE_DRIFT' }); }
    }
    // Host-only test seam exercises transport failures without importing unreviewed fixtures.
    loading ??= (async () => {
      const api = testApi || await import(pathToFileURL(commandContext.scriptPath).href);
      return api.createInvocationRunner(trusted);
    })();
    return loading;
  }
  return {
    async inspectInvocation(id) {
      try {
        const runner = await load();
        return { ...await runner.inspectInvocation(id), commandContext: { ...commandContext, workspaceRoots: [...trusted.workspaceRoots] } };
      } catch (cause) {
        return { contractVersion: 1, fields: [], available: false, reason: cause.code || 'RUNTIME_UNAVAILABLE',
          commandContext: { ...commandContext, workspaceRoots: [...trusted.workspaceRoots] } };
      }
    },
    async invokeSkill(id, input, options) {
      try { return await (await load()).invokeSkill(id, input, options); }
      catch (cause) {
        const code = ['SOURCE_DRIFT', 'RUNTIME_UNAVAILABLE', 'CANCELLED'].includes(cause.code) ? cause.code : 'WORKER_FAILED';
        return toolforgeHttpFailure(id, code, code === 'CANCELLED' ? 'cancelled' : code === 'WORKER_FAILED' ? 'failed' : 'unavailable');
      }
    },
    async dispose() {
      closed = true;
      if (loading) await (await loading).dispose();
    },
  };
}
