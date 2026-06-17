import * as vscode from 'vscode';
import { getConfig } from './config';
import { ServerRegistry } from './connection';
import { detectTooling } from './core/vllmDetect';
import { VllmClient } from './vllm/client';
import { VllmProcessManager, resolverFromDetect } from './vllm/processManager';
import { HfManager, resolveHfToken } from './vllm/hf';
import { initLogger, log, showLogs } from './logger';
import { OpencodeServerManager } from './opencode/serverManager';
import { BridgeDeps } from './panel/bridge';
import { ChatViewProvider, openChatPanel } from './panel/chatViewProvider';
import { ManagerPanel } from './panel/managerPanel';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';

let server: OpencodeServerManager | undefined;
let processManager: VllmProcessManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  initLogger(context);
  log('activating vLLM Code');

  const cfg = getConfig();
  const servers = new ServerRegistry(context, cfg.vllmBaseUrl);
  const vllm = new VllmClient(servers.active().url, cfg.apiKey);

  // Resolve local vLLM / HF tooling once at activation. On hosts without vLLM
  // (Windows, most macOS) this reports client-only and the manager disables
  // its local-spawn controls; the chat path still works against a remote URL.
  const detect = detectTooling({
    exists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
    which: whichSync,
    platform: process.platform,
    vllmPathOverride: cfg.vllmPath,
    pythonPathOverride: cfg.pythonPath,
    hfPathOverride: cfg.hfPath,
  });
  processManager = new VllmProcessManager(resolverFromDetect(detect));
  const hf = new HfManager(detect.hf, resolveHfToken(cfg.hfToken));

  // Bundled binary lives under the extension dir; the managed server's on-disk
  // state is sandboxed under globalStorage so it never collides with a user's
  // own OpenCode install.
  const dataDir = vscode.Uri.joinPath(context.globalStorageUri, 'opencode').fsPath;
  server = new OpencodeServerManager(cfg, vllm, context.extensionPath, dataDir);

  const deps: BridgeDeps = { context, server, vllm, servers };

  // The `secondarySidebar` viewsContainers slot needs VS Code >= 1.106. On
  // older builds, flip this context key so the activitybar fallback shows
  // instead (same approach the Claude Code / Codex extensions use).
  const [major, minor] = vscode.version.split('.').map((n) => Number(n));
  const supportsSecondarySidebar = major > 1 || (major === 1 && minor >= 106);
  if (!supportsSecondarySidebar) {
    void vscode.commands.executeCommand(
      'setContext',
      'vllmCode:doesNotSupportSecondarySidebar',
      true,
    );
  }

  // Register a provider for both the activitybar fallback view and the
  // secondary-sidebar view; only one is active at a time via `when` clauses.
  const providerPrimary = new ChatViewProvider(context.extensionUri, deps);
  const providerSecondary = new ChatViewProvider(context.extensionUri, deps);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('vllmCode.chat', providerPrimary, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider('vllmCode.chatSecondary', providerSecondary, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  const provider = { newChat: () => { providerPrimary.newChat(); providerSecondary.newChat(); }, showHistory: () => { providerPrimary.showHistory(); providerSecondary.showHistory(); } };

  context.subscriptions.push(
    vscode.commands.registerCommand('vllmCode.newChat', () => provider.newChat()),
    vscode.commands.registerCommand('vllmCode.history', () => provider.showHistory()),
    vscode.commands.registerCommand('vllmCode.focus', () =>
      vscode.commands.executeCommand('vllmCode.chat.focus'),
    ),
    vscode.commands.registerCommand('vllmCode.openInTab', () =>
      openChatPanel(context.extensionUri, deps),
    ),
    vscode.commands.registerCommand('vllmCode.openManager', () =>
      ManagerPanel.show(context.extensionUri, {
        processManager: processManager!,
        hf,
        servers,
        detect,
        defaults: {
          port: 8000,
          maxModelLen: cfg.defaultMaxModelLen,
          gpuMemoryUtilization: cfg.defaultGpuMemoryUtilization,
        },
        apiKey: cfg.apiKey,
      }),
    ),
    vscode.commands.registerCommand('vllmCode.showLogs', () => showLogs()),
    vscode.commands.registerCommand('vllmCode.restartServer', async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Restarting OpenCode server…' },
        async () => {
          try {
            if (!server) {
              throw new Error('Extension is not fully activated yet.');
            }
            await server.restart();
            vscode.window.showInformationMessage('vLLM Code: OpenCode server restarted.');
          } catch (err) {
            vscode.window.showErrorMessage(
              `vLLM Code: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        },
      );
    }),
  );

  // Restart the server if relevant settings change.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('vllmCode.serverUrl') ||
        e.affectsConfiguration('vllmCode.apiKey') ||
        e.affectsConfiguration('vllmCode.opencodePath') ||
        e.affectsConfiguration('vllmCode.serverPort')
      ) {
        log('relevant configuration changed; restarting server on next use');
        server?.dispose();
      }
    }),
  );
}

export function deactivate(): void {
  server?.dispose();
  processManager?.dispose();
}

/** Resolve a command on PATH synchronously (which/where), or null. */
function whichSync(cmd: string): string | null {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const res = spawnSync(which, [cmd], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout.trim()) {
      return res.stdout.trim().split(/\r?\n/)[0].trim();
    }
  } catch {
    // ignore
  }
  return null;
}
