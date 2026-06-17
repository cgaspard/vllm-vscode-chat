import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

function nonceStr(): string {
  return randomBytes(32).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
}

/**
 * Self-contained HTML + inline (nonce'd) script for the Model Manager panel.
 * Kept separate from the main chat webview build: the manager is small and has
 * no shared DOM, so an inline script avoids wiring a second esbuild entry. All
 * message shapes match ../shared.ts (ManagerToWebview / ManagerFromWebview).
 */
export function managerHtml(webview: vscode.Webview, _extensionUri: vscode.Uri): string {
  const nonce = nonceStr();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>vLLM · Model Manager</title>
<style nonce="${nonce}">
  :root { --accent: var(--vscode-button-background, #6c5ce7); }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px 16px; }
  h2 { margin: 0 0 4px; font-size: 15px; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 12px; }
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 12px; }
  .tab { padding: 6px 12px; cursor: pointer; border: none; background: none; color: var(--vscode-foreground); border-bottom: 2px solid transparent; font-size: 13px; }
  .tab.active { border-bottom-color: var(--accent); font-weight: 600; }
  .panel { display: none; } .panel.active { display: block; }
  label { display: block; font-size: 12px; margin: 8px 0 2px; color: var(--vscode-descriptionForeground); }
  input, select { width: 100%; box-sizing: border-box; padding: 5px 7px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; font-size: 13px; }
  .row { display: flex; gap: 10px; } .row > div { flex: 1; }
  button.primary { margin-top: 12px; padding: 6px 14px; background: var(--accent); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; font-size: 13px; }
  button.ghost { padding: 3px 9px; background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-panel-border); border-radius: 4px; cursor: pointer; font-size: 12px; }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; }
  .card .top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .mono { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .dot.ready { background: #3fb950; } .dot.starting { background: #d29922; } .dot.error { background: #f85149; } .dot.stopped { background: #6e7681; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 3px; }
  .notice { background: var(--vscode-inputValidation-warningBackground, #3a2f0b); border: 1px solid var(--vscode-inputValidation-warningBorder, #966c0e); padding: 8px 10px; border-radius: 6px; font-size: 12px; margin-bottom: 12px; }
  .status { margin-top: 10px; font-size: 12px; min-height: 16px; }
  .status.error { color: var(--vscode-errorForeground); }
  .empty { color: var(--vscode-descriptionForeground); font-size: 13px; padding: 8px 0; }
  pre.log { max-height: 160px; overflow: auto; background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; font-size: 11px; white-space: pre-wrap; }
  .actions { display: flex; gap: 6px; }
  .checkbox { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
  .checkbox input { width: auto; }
</style>
</head>
<body>
<h2>vLLM Model Manager</h2>
<div class="sub">Start and manage local vLLM servers, download models from Hugging Face, and manage LoRA adapters.</div>
<div id="notice"></div>
<div class="tabs">
  <button class="tab active" data-tab="instances">Instances</button>
  <button class="tab" data-tab="models">Models (HF)</button>
  <button class="tab" data-tab="lora">LoRA</button>
</div>

<div class="panel active" id="tab-instances">
  <div id="serveForm">
    <div class="row"><div><label>Model (HF repo or local path)</label><input id="f-model" placeholder="meta-llama/Llama-3.2-3B-Instruct" /></div><div style="max-width:90px"><label>Port</label><input id="f-port" type="number" /></div></div>
    <div class="row"><div><label>Max model len</label><input id="f-ctx" type="number" /></div><div><label>GPU mem util (0–1)</label><input id="f-gpu" type="number" step="0.05" /></div><div><label>Tensor parallel</label><input id="f-tp" type="number" placeholder="1" /></div></div>
    <div class="row"><div><label>dtype</label><select id="f-dtype"><option value="">auto</option><option>half</option><option>bfloat16</option><option>float16</option><option>float32</option></select></div><div><label>Quantization</label><input id="f-quant" placeholder="(none)" /></div></div>
    <div class="checkbox"><input id="f-lora" type="checkbox" /><label style="margin:0">Enable LoRA adapters (--enable-lora)</label></div>
    <button class="primary" id="startBtn">Start instance</button>
  </div>
  <div class="status" id="instStatus"></div>
  <div id="instances" style="margin-top:14px"></div>
</div>

<div class="panel" id="tab-models">
  <div class="row"><div><label>Download a Hugging Face repo</label><input id="dl-repo" placeholder="meta-llama/Llama-3.2-3B-Instruct" /></div></div>
  <button class="primary" id="dlBtn">Download</button>
  <pre class="log" id="dlLog" style="display:none"></pre>
  <h2 style="font-size:13px;margin-top:16px">Cached models</h2>
  <div id="cached"></div>
</div>

<div class="panel" id="tab-lora">
  <div class="row"><div><label>Instance base URL</label><input id="lora-base" placeholder="http://127.0.0.1:8000/v1" /></div></div>
  <div class="row"><div><label>Adapter name</label><input id="lora-name" placeholder="my-adapter" /></div><div><label>Adapter path / repo</label><input id="lora-path" placeholder="org/adapter or /path" /></div></div>
  <div class="actions" style="margin-top:12px"><button class="primary" id="loraLoad" style="margin:0">Load</button><button class="ghost" id="loraList">List loaded</button></div>
  <div class="status" id="loraStatus"></div>
  <div id="loras" style="margin-top:12px"></div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let canServe = false, canDownload = false, defaults = { port: 8000, maxModelLen: 32768, gpuMemoryUtilization: 0.9 };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
  t.classList.add('active');
  $('tab-' + t.dataset.tab).classList.add('active');
}));

$('startBtn').addEventListener('click', () => {
  const form = {
    model: $('f-model').value.trim(),
    port: parseInt($('f-port').value, 10),
    maxModelLen: intOrU($('f-ctx').value),
    gpuMemoryUtilization: floatOrU($('f-gpu').value),
    tensorParallelSize: intOrU($('f-tp').value),
    dtype: $('f-dtype').value || undefined,
    quantization: $('f-quant').value.trim() || undefined,
    enableLora: $('f-lora').checked,
  };
  vscode.postMessage({ type: 'startInstance', form });
});
$('dlBtn').addEventListener('click', () => {
  const repo = $('dl-repo').value.trim();
  if (!repo) return;
  $('dlLog').style.display = 'block'; $('dlLog').textContent = 'Starting download…\\n';
  vscode.postMessage({ type: 'download', repo });
});
$('loraLoad').addEventListener('click', () => vscode.postMessage({ type: 'loadLora', baseUrl: $('lora-base').value.trim(), name: $('lora-name').value.trim(), path: $('lora-path').value.trim() }));
$('loraList').addEventListener('click', () => vscode.postMessage({ type: 'listLoras', baseUrl: $('lora-base').value.trim() }));

function intOrU(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : undefined; }
function floatOrU(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; }

window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'managerInit') {
    canServe = m.canServeLocally; canDownload = m.canDownload; defaults = m.defaults;
    $('f-port').value = defaults.port; $('f-ctx').value = defaults.maxModelLen; $('f-gpu').value = defaults.gpuMemoryUtilization;
    const n = $('notice'); n.innerHTML = '';
    if (!canServe) n.innerHTML += '<div class="notice">vLLM was not found on this host, so local instances can\\'t be started here. Chat still works against a remote/WSL/Docker vLLM server — add its URL in the chat panel\\'s server menu.</div>';
    if (!canDownload) n.innerHTML += '<div class="notice">Hugging Face CLI not found — install with <span class="mono">pip install -U "huggingface_hub[cli]"</span> to download models from here.</div>';
    $('startBtn').disabled = !canServe; $('dlBtn').disabled = !canDownload;
  } else if (m.type === 'instances') {
    renderInstances(m.instances);
  } else if (m.type === 'cached') {
    renderCached(m.models);
  } else if (m.type === 'downloadProgress') {
    const el = $('dlLog'); el.textContent += m.line + '\\n'; el.scrollTop = el.scrollHeight;
  } else if (m.type === 'downloadDone') {
    const el = $('dlLog'); el.textContent += (m.error ? 'ERROR: ' + m.error : '✓ Done.') + '\\n';
  } else if (m.type === 'loras') {
    renderLoras(m.baseUrl, m.adapters);
  } else if (m.type === 'managerStatus') {
    setStatus('instStatus', m.text, m.kind);
  }
});

function renderInstances(list) {
  const root = $('instances');
  if (!list.length) { root.innerHTML = '<div class="empty">No local instances running.</div>'; return; }
  root.innerHTML = list.map((i) => \`
    <div class="card">
      <div class="top">
        <div><span class="dot \${esc(i.status)}"></span><b>\${esc(i.label)}</b></div>
        <div class="actions">
          <button class="ghost" data-logs="\${esc(i.id)}">Logs</button>
          \${i.status === 'ready' || i.status === 'starting' ? \`<button class="ghost" data-stop="\${esc(i.id)}">Stop</button>\` : \`<button class="ghost" data-remove="\${esc(i.id)}">Remove</button>\`}
        </div>
      </div>
      <div class="meta mono">\${esc(i.baseUrl)} · \${esc(i.status)}\${i.maxModelLen ? ' · ctx ' + i.maxModelLen : ''}\${i.enableLora ? ' · LoRA' : ''}</div>
      \${i.error ? '<div class="meta" style="color:var(--vscode-errorForeground)">' + esc(i.error) + '</div>' : ''}
    </div>\`).join('');
  root.querySelectorAll('[data-stop]').forEach((b) => b.addEventListener('click', () => vscode.postMessage({ type: 'stopInstance', id: b.dataset.stop })));
  root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => vscode.postMessage({ type: 'removeInstance', id: b.dataset.remove })));
  root.querySelectorAll('[data-logs]').forEach((b) => b.addEventListener('click', () => vscode.postMessage({ type: 'viewLogs', id: b.dataset.logs })));
}

function renderCached(list) {
  const root = $('cached');
  if (!list.length) { root.innerHTML = '<div class="empty">No models in the Hugging Face cache yet.</div>'; return; }
  root.innerHTML = list.map((m) => \`<div class="card"><div class="top"><span class="mono">\${esc(m.repo)}</span><button class="ghost" data-serve="\${esc(m.repo)}">Use in Instances</button></div></div>\`).join('');
  root.querySelectorAll('[data-serve]').forEach((b) => b.addEventListener('click', () => { $('f-model').value = b.dataset.serve; document.querySelector('[data-tab=instances]').click(); }));
}

function renderLoras(baseUrl, adapters) {
  const root = $('loras');
  if (!adapters.length) { root.innerHTML = '<div class="empty">No LoRA adapters loaded on ' + esc(baseUrl) + '.</div>'; return; }
  root.innerHTML = adapters.map((a) => \`<div class="card"><div class="top"><span class="mono">\${esc(a.id)}</span><button class="ghost" data-unload="\${esc(a.id)}">Unload</button></div>\${a.parent ? '<div class="meta">base: ' + esc(a.parent) + '</div>' : ''}</div>\`).join('');
  root.querySelectorAll('[data-unload]').forEach((b) => b.addEventListener('click', () => vscode.postMessage({ type: 'unloadLora', baseUrl, name: b.dataset.unload })));
}

function setStatus(id, text, kind) { const el = $(id); el.textContent = text || ''; el.className = 'status' + (kind === 'error' ? ' error' : ''); }

vscode.postMessage({ type: 'managerReady' });
</script>
</body>
</html>`;
}
