// Pure formatter copied from the managed API; parity is pinned by command tests.
export function formatInvocationCommand(skillId, input, { nodeExecutable, scriptPath, workspaceRoots }) {
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const argv = [scriptPath, '--skill', skillId, ...workspaceRoots.flatMap(root => ['--workspace-root', root])];
  return `& {
  if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 or newer is required' }
  $toolforgeOutputEncoding = $OutputEncoding
  $toolforgeProcess = [System.Diagnostics.Process]::new()
  $toolforgeStarted = $false
  try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $toolforgeProcess.StartInfo.FileName = ${quote(nodeExecutable)}
    $toolforgeProcess.StartInfo.UseShellExecute = $false
    $toolforgeProcess.StartInfo.CreateNoWindow = $true
    $toolforgeProcess.StartInfo.RedirectStandardInput = $true
    $toolforgeProcess.StartInfo.StandardInputEncoding = [System.Text.UTF8Encoding]::new($false)
${argv.map(value => `    $toolforgeProcess.StartInfo.ArgumentList.Add(${quote(value)})`).join('\n')}
    $toolforgeStarted = $toolforgeProcess.Start()
    $toolforgeProcess.StandardInput.Write(${quote(JSON.stringify(input))})
    $toolforgeProcess.StandardInput.Close()
    $toolforgeProcess.WaitForExit()
  } finally {
    try {
      if ($toolforgeStarted) {
        if (!$toolforgeProcess.HasExited) {
          try { $toolforgeProcess.Kill($true) }
          catch { if (!$toolforgeProcess.HasExited) { throw } }
        }
        $toolforgeProcess.WaitForExit()
        $global:LASTEXITCODE = $toolforgeProcess.ExitCode
      }
    } finally {
      try { $toolforgeProcess.Dispose() }
      finally { $OutputEncoding = $toolforgeOutputEncoding }
    }
  }
}`;
}

const fields = {
  'roadmap-validator': ['roadmapPath', 'strict', 'verbose'],
  'agent-drift-detector': ['agentName', 'expectedSchema', 'actualSchema'],
  'retro-schema-validator': ['filePaths']
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const keys = (value, required, optional = []) => object(value) && required.every(key => Object.hasOwn(value, key)) &&
  Object.keys(value).every(key => required.includes(key) || optional.includes(key));

// Match managed native-result contracts and classification, not handler algorithms.
function resultOutcome(skillId, result) {
  if (!object(result)) return null;
  if (skillId === 'agent-drift-detector') {
    if (!keys(result, ['agentName', 'driftDetected', 'missingFields', 'extraFields', 'recommendations']) ||
        typeof result.agentName !== 'string' || !result.agentName.trim() || typeof result.driftDetected !== 'boolean' ||
        !strings(result.missingFields) || !strings(result.extraFields) || !strings(result.recommendations) ||
        result.driftDetected !== Boolean(result.missingFields.length || result.extraFields.length)) return null;
    return result.driftDetected ? 'findings' : 'pass';
  }
  if (skillId === 'retro-schema-validator') {
    if (!keys(result, ['status', 'verdict', 'filesValidated', 'violations', 'timestamp']) ||
        !integer(result.filesValidated) || result.filesValidated < 1 || result.filesValidated > 32 ||
        !timestamp(result.timestamp) || !Array.isArray(result.violations)) return null;
    for (const violation of result.violations) {
      if (!keys(violation, ['file', 'field', 'level', 'message']) || !['error', 'warning'].includes(violation.level) ||
          ![violation.file, violation.field, violation.message].every(value => typeof value === 'string')) return null;
    }
    const verdict = result.violations.some(violation => violation.level === 'error') ? 'RED' : result.violations.length ? 'YELLOW' : 'GREEN';
    if (result.verdict !== verdict || result.status !== (verdict === 'RED' ? 'error' : 'success')) return null;
    return verdict === 'GREEN' ? 'pass' : 'findings';
  }
  if (!keys(result, ['status', 'message'], ['code', 'data']) || !['success', 'error'].includes(result.status) ||
      typeof result.message !== 'string' || (Object.hasOwn(result, 'code') && typeof result.code !== 'string') || result.code === 'SKILL_ERROR') return null;
  if (!Object.hasOwn(result, 'data')) return result.status === 'error' && result.code ? 'findings' : null;
  const data = result.data;
  if (!keys(data, ['isValid', 'findings', 'syncMarkersPresent', 'contentLength', 'validated']) ||
      typeof data.isValid !== 'boolean' || typeof data.syncMarkersPresent !== 'boolean' || !integer(data.contentLength) ||
      !timestamp(data.validated) || !Array.isArray(data.findings)) return null;
  for (const finding of data.findings) {
    if (!keys(finding, ['level', 'code', 'message'], ['line']) || !['error', 'warning', 'info'].includes(finding.level) ||
        typeof finding.code !== 'string' || typeof finding.message !== 'string' ||
        (Object.hasOwn(finding, 'line') && (!integer(finding.line) || finding.line < 1))) return null;
  }
  if (data.isValid === data.findings.some(finding => finding.level === 'error') || result.status !== (data.isValid ? 'success' : 'error')) return null;
  return result.status === 'error' || data.findings.some(finding => finding.level !== 'info') ? 'findings' : 'pass';
}
function invalid(field, message) { throw Object.assign(new Error(`${field}: ${message}`), { field }); }
function pathInput(value, field, extension) {
  if (typeof value !== 'string' || !value.trim()) invalid(field, 'Enter an absolute file path.');
  if (!/^(?:[A-Za-z]:[\\/]|\/(?!\/))/.test(value) || !value.toLowerCase().endsWith(extension)) {
    invalid(field, `Enter an absolute ${extension} file path.`);
  }
  return value;
}

export function validateInvocationInput(skillId, input) {
  if (!fields[skillId]) invalid('skillId', 'Pilot unavailable.');
  if (!object(input)) invalid('input', 'Expected a JSON object.');
  for (const key of Object.keys(input)) if (!fields[skillId].includes(key)) invalid(key, 'Unknown field.');
  let normalized;
  if (skillId === 'roadmap-validator') {
    const roadmapPath = pathInput(input.roadmapPath, 'roadmapPath', '.md');
    for (const key of ['strict', 'verbose']) {
      if (input[key] !== undefined && typeof input[key] !== 'boolean') invalid(key, 'Expected a boolean.');
    }
    normalized = { roadmapPath, strict: input.strict ?? false, verbose: input.verbose ?? false };
  } else if (skillId === 'agent-drift-detector') {
    if (typeof input.agentName !== 'string' || !input.agentName.trim()) invalid('agentName', 'Enter an agent name.');
    for (const key of ['expectedSchema', 'actualSchema']) if (!object(input[key])) invalid(key, 'Expected a JSON object.');
    normalized = { agentName: input.agentName.trim(), expectedSchema: input.expectedSchema, actualSchema: input.actualSchema };
  } else {
    if (!Array.isArray(input.filePaths) || input.filePaths.length < 1 || input.filePaths.length > 32) invalid('filePaths', 'Select 1-32 files.');
    const filePaths = input.filePaths.map(value => pathInput(value, 'filePaths', '.json'));
    if (new Set(filePaths).size !== filePaths.length) invalid('filePaths', 'Remove duplicate paths.');
    normalized = { filePaths };
  }
  if (new TextEncoder().encode(JSON.stringify({ skillId, input: normalized })).length > 65536) invalid('input', 'Request exceeds 64 KiB.');
  return normalized;
}

export function mountToolforgeInvocation({ inventory, rootElement, copyCommand, onResult }) {
  const doc = rootElement.ownerDocument;
  const element = (tag, text, parent) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  };
  const style = element('style', `
    .toolforge-dialog { width:min(38rem,calc(100% - 2rem)); max-height:calc(100% - 2rem); margin:auto; padding:1.25rem; border:2px solid var(--bone); border-radius:4px; background:var(--forge); color:var(--bone); font-family:var(--font-ui,'Barlow Condensed',sans-serif); overflow:auto; }
    .toolforge-dialog::backdrop { background:rgba(0,0,0,.55); }
    .toolforge-dialog h2 { font-family:var(--font-display,'Playfair Display',serif); font-size:1.3rem; margin:0 0 1rem; overflow-wrap:anywhere; }
    .toolforge-dialog label { display:block; margin:.75rem 0; }
    .toolforge-dialog input:not([type=checkbox]), .toolforge-dialog textarea { display:block; width:100%; min-width:0; padding:.5rem; margin-top:.3rem; border:1px solid var(--ash); border-radius:2px; background:var(--black); color:var(--bone); font:inherit; }
    .toolforge-dialog textarea { min-height:6rem; resize:vertical; font-family:monospace; }
    .toolforge-dialog button { padding:.45rem .7rem; border:1px solid var(--ash); border-radius:2px; background:var(--iron); color:var(--bone); cursor:pointer; font:inherit; }
    .toolforge-dialog button:disabled { opacity:.55; cursor:default; }
    .toolforge-dialog :focus-visible { outline:3px solid var(--bone); outline-offset:3px; }
    .toolforge-dialog [aria-selected=true] { border-bottom:3px solid var(--sage); }
    .toolforge-dialog .tf-actions { display:flex; flex-wrap:wrap; gap:.5rem; margin:.75rem 0; }
    .toolforge-dialog pre, .toolforge-dialog [role=status] { white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; margin:.75rem 0; }
    .toolforge-dialog [hidden] { display:none; }
  `, rootElement);
  const dialog = element('dialog', undefined, rootElement);
  dialog.className = 'toolforge-dialog';
  dialog.setAttribute('aria-labelledby', 'toolforge-dialog-title');
  const title = element('h2', '', dialog);
  title.id = 'toolforge-dialog-title';
  const tabs = element('div', undefined, dialog);
  tabs.className = 'tf-actions';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Invocation views');
  const button = (text, parent, handler) => {
    const node = element('button', text, parent);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  };
  const inputsTab = button('Inputs', tabs, () => view(false));
  const resultTab = button('Result', tabs, () => view(true));
  const form = element('form', undefined, dialog);
  form.noValidate = true;
  form.id = 'toolforge-inputs';
  form.setAttribute('role', 'tabpanel');
  const controls = element('div', undefined, form);
  const run = element('button', 'Run', form);
  run.type = 'submit';
  const resultPanel = element('section', undefined, dialog);
  resultPanel.id = 'toolforge-result';
  resultPanel.setAttribute('role', 'tabpanel');
  const resultText = element('pre', '', resultPanel);
  const status = element('p', '', dialog);
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const actions = element('div', undefined, dialog);
  actions.className = 'tf-actions';
  const copy = button('Copy Command', actions, copyResult);
  copy.setAttribute('aria-describedby', 'toolforge-shell-requirement');
  const cancel = button('Cancel', actions, cancelRun);
  button('Close', actions, () => dialog.close());
  const shell = element('p', 'Copy Command requires PowerShell 7 or newer.', dialog);
  shell.id = 'toolforge-shell-requirement';
  for (const [tab, panel] of [[inputsTab, form], [resultTab, resultPanel]]) {
    tab.setAttribute('role', 'tab');
    tab.id = `${panel.id}-tab`;
    tab.setAttribute('aria-controls', panel.id);
    panel.setAttribute('aria-labelledby', tab.id);
  }
  tabs.addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const result = event.key === 'End' || (event.key !== 'Home' && form.hidden === false);
      view(result);
      (result ? resultTab : inputsTab).focus();
    }
  });
  let skill, trigger, controller, token = 0, command = '', disposed = false;
  let inputs = {}, pathRows = [];
  function view(result) {
    form.hidden = result;
    resultPanel.hidden = !result;
    inputsTab.setAttribute('aria-selected', String(!result));
    resultTab.setAttribute('aria-selected', String(result));
    inputsTab.tabIndex = result ? -1 : 0;
    resultTab.tabIndex = result ? 0 : -1;
  }
  function invalidate() {
    token++;
    controller?.abort();
    controller = null;
    command = '';
    copy.disabled = true;
    resultText.textContent = '';
    status.textContent = '';
    cancel.disabled = true;
  }
  function readInput() {
    if (skill.id === 'retro-schema-validator') return validateInvocationInput(skill.id, { filePaths: pathRows.map(row => row.input.value) });
    const input = {};
    for (const [key, node] of Object.entries(inputs)) {
      if (node.type === 'checkbox') input[key] = node.checked;
      else if (node.tagName === 'TEXTAREA') {
        try { input[key] = JSON.parse(node.value); }
        catch { invalid(key, 'Enter valid JSON.'); }
      } else input[key] = node.value;
    }
    return validateInvocationInput(skill.id, input);
  }
  function validate(report = false) {
    let valid = false;
    for (const node of [...Object.values(inputs), ...pathRows.map(row => row.input)]) node.removeAttribute('aria-invalid');
    try { readInput(); valid = true; }
    catch (error) {
      if (report) {
        status.textContent = error.message;
        (inputs[error.field] || pathRows[0]?.input)?.setAttribute('aria-invalid', 'true');
      }
    }
    run.disabled = !valid || !!controller || !skill?.inputInvocation?.available;
  }
  function changed() { invalidate(); validate(true); }
  controls.addEventListener('input', changed);
  controls.addEventListener('change', changed);
  function field(key, label, type, value) {
    const wrapper = element('label', label, controls);
    const node = element(type === 'object' ? 'textarea' : 'input', undefined, wrapper);
    node.name = key;
    if (type !== 'object') node.type = type;
    if (type === 'checkbox') node.checked = value;
    else node.value = value;
    inputs[key] = node;
    return node;
  }
  function addPath(value = '') {
    const row = element('div', undefined, controls);
    const label = element('label', 'JSON file path', row);
    const input = element('input', undefined, label);
    input.type = 'text'; input.value = value;
    const remove = button('Remove file', row, () => {
      row.remove(); pathRows = pathRows.filter(item => item.input !== input); updatePaths(); changed();
    });
    pathRows.push({ input, remove });
    updatePaths();
    return input;
  }
  let add;
  function updatePaths() {
    if (add) add.disabled = pathRows.length >= 32;
    for (const row of pathRows) row.remove.disabled = pathRows.length <= 1;
  }
  function cancelRun() {
    invalidate(); validate(); status.textContent = 'Cancelled'; view(true);
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (controller || !skill?.inputInvocation?.available) return;
    let input;
    try { input = readInput(); }
    catch (error) {
      status.textContent = error.message;
      (inputs[error.field] || pathRows[0]?.input)?.focus();
      return;
    }
    invalidate();
    const current = token;
    controller = new AbortController();
    run.disabled = true; cancel.disabled = false;
    status.textContent = 'Running';
    const selected = skill;
    try {
      const response = await fetch('/api/toolforge/invoke', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId: selected.id, input }), signal: controller.signal
      });
      const envelope = await response.json();
      if (current !== token || !dialog.open) return;
      if (!keys(envelope, ['contractVersion', 'skillId', 'state', 'outcome', 'result', 'error', 'durationMs']) ||
          !Number.isFinite(envelope.durationMs) || envelope.durationMs < 0) throw new Error('Invalid invocation response.');
      const states = ['completed', 'rejected', 'unavailable', 'failed', 'timed_out', 'cancelled'];
      const preparseStatus = { FORBIDDEN: 403, METHOD_NOT_ALLOWED: 405, UNSUPPORTED_CONTENT_TYPE: 400, PAYLOAD_TOO_LARGE: 413, INVALID_JSON: 400, INVALID_INPUT: 400, INVALID_TARGET: 400, WORKER_FAILED: 500 };
      const failure = envelope.outcome === null && envelope.result === null && keys(envelope.error, ['code', 'message'], ['fieldErrors']) &&
        typeof envelope.error.code === 'string' && typeof envelope.error.message === 'string' &&
        (!Object.hasOwn(envelope.error, 'fieldErrors') || (object(envelope.error.fieldErrors) && Object.values(envelope.error.fieldErrors).every(value => typeof value === 'string')));
      const preparse = envelope.skillId === null && failure && !response.ok &&
        response.status === preparseStatus[envelope.error.code] &&
        envelope.state === (envelope.error.code === 'WORKER_FAILED' ? 'failed' : 'rejected');
      if (envelope.contractVersion !== 1 || (envelope.skillId !== selected.id && !preparse) || !states.includes(envelope.state) ||
          (envelope.state !== 'completed' && !failure)) throw new Error('Invalid invocation response.');
      const completed = response.ok && envelope.state === 'completed' && ['pass', 'findings'].includes(envelope.outcome) &&
        envelope.error === null && resultOutcome(selected.id, envelope.result) === envelope.outcome;
      if (envelope.state === 'completed' && !completed) throw new Error('Invalid completion response.');
      const names = { completed: `Completed / ${envelope.outcome === 'pass' ? 'Pass' : 'Findings'}`, rejected: 'Rejected', unavailable: 'Unavailable', failed: 'Failed', timed_out: 'Timed Out', cancelled: 'Cancelled' };
      status.textContent = names[envelope.state];
      if (envelope.error) status.textContent += `\n${envelope.error.code}: ${envelope.error.message}${envelope.error.fieldErrors ? '\n' + JSON.stringify(envelope.error.fieldErrors, null, 2) : ''}`;
      resultText.textContent = completed ? JSON.stringify(envelope.result, null, 2) : '';
      if (completed) command = formatInvocationCommand(selected.id, input, selected.inputInvocation.commandContext);
      copy.disabled = !command;
      view(completed || !envelope.error?.fieldErrors);
      onResult?.(envelope);
    } catch (error) {
      if (current !== token || !dialog.open) return;
      command = ''; copy.disabled = true;
      status.textContent = error.name === 'AbortError' ? 'Cancelled' : `Failed: ${error.message}`;
      view(true);
    } finally {
      if (current === token) { controller = null; cancel.disabled = true; validate(); }
    }
  });
  async function copyResult() {
    if (!command || copy.disabled) return;
    const current = token, payload = command;
    copy.disabled = true;
    try {
      // Legacy callbacks may swallow clipboard rejection; only explicit true confirms success.
      const copied = copyCommand ? await copyCommand(payload) : await doc.defaultView.navigator.clipboard.writeText(payload).then(() => true);
      if (current !== token || !dialog.open) return;
      status.textContent = copied === true ? 'Copied command' : 'Could not copy command';
    } catch {
      if (current === token && dialog.open) status.textContent = 'Could not copy command';
    } finally { if (current === token) copy.disabled = !command; }
  }
  function clear() {
    invalidate(); controls.replaceChildren(); inputs = {}; pathRows = []; add = null; skill = null;
    title.textContent = ''; run.disabled = true;
    trigger?.focus(); trigger = null;
  }
  dialog.addEventListener('close', () => { if (!dialog.open) clear(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
  return {
    open(skillId, source) {
      if (disposed) return false;
      const skills = typeof inventory === 'function' ? inventory() : inventory;
      const selected = skills.find(item => item.id === skillId);
      if (!fields[skillId] || selected?.inputInvocation?.contractVersion !== 1 || !selected.inputInvocation.available) return false;
      if (dialog.open) dialog.close();
      clear(); skill = selected; trigger = source || doc.activeElement;
      title.textContent = selected.name || skillId;
      if (skillId === 'roadmap-validator') {
        field('roadmapPath', 'Roadmap path', 'text', '');
        field('strict', 'Strict', 'checkbox', false); field('verbose', 'Verbose', 'checkbox', false);
      } else if (skillId === 'agent-drift-detector') {
        field('agentName', 'Agent name', 'text', '');
        field('expectedSchema', 'Expected schema (JSON object)', 'object', '{}');
        field('actualSchema', 'Actual schema (JSON object)', 'object', '{}');
      } else {
        addPath();
        add = button('Add file', controls, () => { if (pathRows.length < 32) { const node = addPath(); changed(); node.focus(); } });
        updatePaths();
      }
      view(false); validate(); dialog.showModal();
      (Object.values(inputs)[0] || pathRows[0]?.input).focus();
      return true;
    },
    dispose() {
      disposed = true;
      if (dialog.open) dialog.close();
      clear(); dialog.remove(); style.remove();
    }
  };
}
