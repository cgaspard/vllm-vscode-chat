import * as vscode from 'vscode';
import { ServerRegistry } from '../connection';
import { DetectResult } from '../core/vllmDetect';
import { VllmServeConfig } from '../core/vllmArgs';
import { LoraClient } from '../vllm/loRA';
import { VllmClient } from '../vllm/client';
import { HfManager } from '../vllm/hf';
import { VllmProcessManager } from '../vllm/processManager';
import { log, logError } from '../logger';
import {
  ManagerFromWebview,
  ManagerToWebview,
  UiCachedModel,
  UiInstance,
  UiServeForm,
} from '../shared';
import { managerHtml } from './managerHtml';

export interface ManagerDeps {
  processManager: VllmProcessManager;
  hf: HfManager;
  servers: ServerRegistry;
  detect: DetectResult;
  defaults: { port: number; maxModelLen: number; gpuMemoryUtilization: number };
  apiKey: string;
}

/**
 * The "Manage Local Models" panel: a single-instance editor-tab webview that
 * drives local `vllm serve` processes, Hugging Face downloads, and runtime
 * LoRA adapters. On hosts without vLLM, the local-spawn controls are disabled
 * with a notice (the chat panel still works against a remote server).
 */
export class ManagerPanel {
  private static current: ManagerPanel | undefined;

  static show(extensionUri: vscode.Uri, deps: ManagerDeps): void {
    if (ManagerPanel.current) {
      ManagerPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'vllmCode.manager',
      'vLLM · Model Manager',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri] },
    );
    ManagerPanel.current = new ManagerPanel(panel, extensionUri, deps);
  }

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly deps: ManagerDeps,
  ) {
    panel.webview.html = managerHtml(panel.webview, extensionUri);
    this.disposables.push(
      panel.webview.onDidReceiveMessage((m: ManagerFromWebview) => this.onMessage(m)),
      deps.processManager.onChange(() => this.postInstances()),
      panel.onDidDispose(() => this.dispose()),
    );
  }

  private dispose(): void {
    ManagerPanel.current = undefined;
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private post(msg: ManagerToWebview): void {
    void this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: ManagerFromWebview): Promise<void> {
    try {
      switch (msg.type) {
        case 'managerReady':
          this.post({
            type: 'managerInit',
            canServeLocally: this.deps.detect.canServeLocally,
            canDownload: this.deps.detect.canDownload,
            vllmPath: this.deps.detect.vllm ?? this.deps.detect.python,
            hfPath: this.deps.detect.hf,
            defaults: this.deps.defaults,
          });
          this.postInstances();
          this.postCached();
          break;
        case 'refreshInstances':
          this.postInstances();
          break;
        case 'startInstance':
          this.startInstance(msg.form);
          break;
        case 'stopInstance':
          this.deps.processManager.stop(msg.id);
          break;
        case 'removeInstance':
          this.deps.processManager.remove(msg.id);
          break;
        case 'viewLogs':
          this.viewLogs(msg.id);
          break;
        case 'refreshCached':
          this.postCached();
          break;
        case 'download':
          this.download(msg.repo);
          break;
        case 'serveCached':
          // Pre-fill a start with this repo at the next free default port.
          this.post({ type: 'managerStatus', text: `Use the Instances tab to serve ${msg.repo}.` });
          break;
        case 'listLoras':
          await this.listLoras(msg.baseUrl);
          break;
        case 'loadLora':
          await this.loadLora(msg.baseUrl, msg.name, msg.path);
          break;
        case 'unloadLora':
          await this.unloadLora(msg.baseUrl, msg.name);
          break;
      }
    } catch (err) {
      logError(`manager handling ${msg.type}`, err);
      this.post({ type: 'managerStatus', text: errMsg(err), kind: 'error' });
    }
  }

  private startInstance(form: UiServeForm): void {
    const config: VllmServeConfig = {
      model: form.model,
      port: form.port,
      maxModelLen: form.maxModelLen,
      gpuMemoryUtilization: form.gpuMemoryUtilization,
      dtype: form.dtype || undefined,
      quantization: form.quantization || undefined,
      tensorParallelSize: form.tensorParallelSize,
      enableLora: form.enableLora,
      apiKey: form.apiKey || undefined,
    };
    const inst = this.deps.processManager.start(config); // throws on invalid/no-vllm
    // Auto-register the started instance so the chat panel can switch to it.
    void this.deps.servers
      .add(`Local: ${form.model.split('/').pop()}`, inst.baseUrl)
      .catch((err) => logError('register instance server', err));
    this.post({ type: 'managerStatus', text: `Starting ${form.model} on :${form.port}…` });
    this.postInstances();
  }

  private postInstances(): void {
    const instances: UiInstance[] = this.deps.processManager.list().map((i) => ({
      id: i.id,
      label: i.config.label ?? i.config.model,
      model: i.config.model,
      baseUrl: i.baseUrl,
      status: i.status,
      maxModelLen: i.config.maxModelLen,
      gpuMemoryUtilization: i.config.gpuMemoryUtilization,
      enableLora: i.config.enableLora,
      error: i.error,
    }));
    this.post({ type: 'instances', instances });
  }

  private viewLogs(id: string): void {
    const inst = this.deps.processManager.get(id);
    if (!inst) {
      return;
    }
    log(`--- logs for vllm instance ${id} (${inst.config.model}) ---`);
    for (const line of inst.logs) {
      log(`[vllm:${id}] ${line}`);
    }
    showLogsChannel();
  }

  private postCached(): void {
    const models: UiCachedModel[] = this.deps.hf.available ? this.deps.hf.listCached() : [];
    this.post({ type: 'cached', models });
  }

  private download(repo: string): void {
    if (!this.deps.hf.available) {
      this.post({ type: 'downloadDone', repo, error: 'Hugging Face CLI not found on this host.' });
      return;
    }
    this.post({ type: 'managerStatus', text: `Downloading ${repo}…` });
    const { promise } = this.deps.hf.download({ repo }, (line) =>
      this.post({ type: 'downloadProgress', repo, line }),
    );
    promise
      .then(() => {
        this.post({ type: 'downloadDone', repo });
        this.postCached();
      })
      .catch((err) => this.post({ type: 'downloadDone', repo, error: errMsg(err) }));
  }

  private async listLoras(baseUrl: string): Promise<void> {
    const client = new VllmClient(baseUrl, this.deps.apiKey);
    const models = await client.listModels();
    this.post({
      type: 'loras',
      baseUrl,
      adapters: models.filter((m) => m.isLora).map((m) => ({ id: m.id, parent: m.parent })),
    });
  }

  private async loadLora(baseUrl: string, name: string, path: string): Promise<void> {
    const client = new LoraClient(baseUrl, this.deps.apiKey);
    await client.load({ loraName: name, loraPath: path });
    this.post({ type: 'managerStatus', text: `Loaded LoRA ${name}.` });
    await this.listLoras(baseUrl);
  }

  private async unloadLora(baseUrl: string, name: string): Promise<void> {
    const client = new LoraClient(baseUrl, this.deps.apiKey);
    await client.unload(name);
    this.post({ type: 'managerStatus', text: `Unloaded LoRA ${name}.` });
    await this.listLoras(baseUrl);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function showLogsChannel(): void {
  void vscode.commands.executeCommand('vllmCode.showLogs');
}
