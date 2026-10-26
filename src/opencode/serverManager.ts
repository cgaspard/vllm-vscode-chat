import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ExtensionConfig, getConfig } from '../config';
import { clampContext } from '../core/context';
import { augmentedPath, toEngineMcp, withLocalEnvironment } from '../core/mcp';
import { opencodePermission } from '../core/permission';
import { toEngineProviderID } from '../core/providerIds';
import { discoverMcpServers } from '../mcp/discovery';
import { VllmClient } from '../vllm/client';
import { log, logError } from '../logger';
import { createHost, type SdkHost } from './embedded';
import { BUILD_PROMPT, PLAN_PROMPT } from './prompts';
import { OpencodeV2Client } from './v2client';

export interface ServerStartResult {
  /** Where the engine runs, for logs only: there is no network address. */
  baseUrl: string;
  client: OpencodeV2Client;
}

export interface Disposable {
  dispose(): void;
}

/** Shown in logs where a server URL used to be. */
const EMBEDDED_URL = 'embedded://opencode';

/**
 * The provider id the panel uses for the vLLM server. OpenCode 2 ships a
 * built-in `vllm` plugin that claims this id (it would replace our declared
 * models and options), so it only ever crosses into the engine through
 * `toEngineProviderID`.
 */
export const VLLM_PROVIDER_ID = 'vllm';

/**
 * Owns the embedded OpenCode engine (OpenCode 2, running in-process through
 * @opencode/sdk), configured to talk to a local/remote vLLM server over its
 * OpenAI-compatible /v1 endpoint. Config is handed to the engine in memory, so
 * nothing is written to the user's workspace or global config.
 *
 * Still named a "server" manager: the bridge's lifecycle (start, restart,
 * dispose) is unchanged, only what it starts is.
 */
export class OpencodeServerManager {
  private host: SdkHost | undefined;
  private client: OpencodeV2Client | undefined;
  private starting: Promise<ServerStartResult> | undefined;
  /**
   * The previous engine's shutdown. A new host must not open the same database
   * and folders while the old one is still closing (two engines in one
   * process over one SQLite file), so a start waits for this first.
   */
  private closing: Promise<void> = Promise.resolve();
  private readonly exitListeners = new Set<() => void>();

  constructor(
    private readonly cfg: ExtensionConfig,
    private readonly vllm: VllmClient,
    /** Extension install dir — holds the bundled engine in `opencode-sdk/`. */
    private readonly extensionPath: string,
    /** Private data dir for the engine, isolated from the user's own OpenCode. */
    private readonly dataDir: string,
  ) {}

  get isRunning(): boolean {
    return !!this.client;
  }

  /**
   * The live engine's client, or undefined while stopped. A panel holding any
   * other client is talking to an engine that was restarted or stopped.
   */
  get currentClient(): OpencodeV2Client | undefined {
    return this.client;
  }

  /**
   * Register a callback fired whenever the engine stops unexpectedly.
   * Multiple bridges (sidebar + secondary + editor tabs) share one manager, so
   * each registers its own listener and disposes it on teardown.
   */
  addExitListener(cb: () => void): Disposable {
    this.exitListeners.add(cb);
    return { dispose: () => this.exitListeners.delete(cb) };
  }

  /** Start (or return the in-flight start of) the engine. Idempotent. */
  async start(): Promise<ServerStartResult> {
    if (this.client) {
      return { baseUrl: EMBEDDED_URL, client: this.client };
    }
    if (this.starting) {
      return this.starting;
    }
    const starting: Promise<ServerStartResult> = this.doStart().finally(() => {
      // Only clear our own start: a dispose() + start() may have replaced it.
      if (this.starting === starting) {
        this.starting = undefined;
      }
    });
    this.starting = starting;
    return starting;
  }

  private async doStart(): Promise<ServerStartResult> {
    await this.closing;
    const starting = this.starting;
    const configContent = await this.buildConfigContent();
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
    const version = this.engineVersion();
    log(`starting embedded opencode ${version} (cwd=${cwd})`);
    const host = await createHost(this.extensionPath, { root: this.dataDir }, configContent);
    if (this.starting !== starting) {
      // dispose() ran while the engine was being created: this start is stale
      // and its host must not outlive it.
      await host.close().catch((err: unknown) => logError('closing a superseded engine', err));
      throw new Error('OpenCode engine stopped');
    }
    this.host = host;
    this.client = new OpencodeV2Client(host, cwd, version);
    log('embedded opencode ready');
    return { baseUrl: EMBEDDED_URL, client: this.client };
  }

  /** The bundled engine's version, from the stamp the build writes. */
  private engineVersion(): string {
    try {
      return fs.readFileSync(path.join(this.extensionPath, 'opencode-sdk', 'version'), 'utf8').split('\n')[0].trim();
    } catch {
      return 'unknown';
    }
  }

  /** Build the engine config injecting the vLLM provider. */
  private async buildConfigContent(): Promise<string> {
    // Read fresh so context-size changes apply on the next restart.
    const cfg = getConfig();
    const defaultCtx = cfg.minContextLength;

    const models: Record<string, Record<string, unknown>> = {};
    try {
      const list = await this.vllm.listModels();
      for (const m of list) {
        // Per-model context budget: the server's --max-model-len when reported,
        // else the global minContextLength, clamped. This drives OpenCode's
        // `limit.context` (how much it packs before compacting + the meter
        // denominator). vLLM's runner window is fixed at launch; we never resize
        // it from here. LoRA adapters are skipped — they chat through their base
        // model id, not as separate provider models.
        if (m.isLora) {
          continue;
        }
        const ctx = clampContext(m.maxContextLength ?? defaultCtx, m.maxContextLength);
        models[m.id] = {
          name: m.displayName,
          reasoning: true,
          tool_call: true,
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: ctx, output: Math.min(8192, Math.floor(ctx / 2)) },
        };
      }
    } catch (err) {
      logError('could not enumerate vLLM models for config', err);
    }

    // MCP servers discovered from .mcp.json / .vscode/mcp.json / VS Code user
    // settings / our own `vllmCode.mcpServers`. Tokens like ${VAR} are already
    // resolved to literals (the injected config is not substituted by
    // OpenCode), so what we inject is ready to spawn as-is. Their tools flow
    // through OpenCode's existing tool-call + permission machinery for free.
    let mcp: ReturnType<typeof discoverMcpServers>['map'] = {};
    try {
      // stdio servers inherit the extension host's environment. When VS Code
      // was launched from a GUI context its PATH can be minimal (the #1 reason
      // npx/uvx-based servers fail to start), so add the usual install
      // locations; existing entries stay first so the user's toolchain wins.
      mcp = withLocalEnvironment(discoverMcpServers().map, {
        PATH: augmentedPath(process.env.PATH, os.homedir(), path.delimiter),
      });
    } catch (err) {
      logError('could not discover MCP servers', err);
    }

    const providerID = toEngineProviderID(VLLM_PROVIDER_ID);
    const config = {
      $schema: 'https://opencode.ai/config.json',
      // Only the vLLM provider. OpenCode would otherwise also enable any
      // provider it can find a key for in the environment (an exported
      // OPENAI_API_KEY) and auto-discover local servers — including its own
      // built-in vLLM plugin — and its internal title/summary agents could then
      // use a model the user never picked.
      enabled_providers: [providerID],
      // Servers the user already declared for Claude Code / VS Code Copilot,
      // plus our own setting, in OpenCode 2's native shape with Code Mode off
      // so each MCP tool is a direct tool (see toEngineMcp). Omitted entirely
      // when nothing is configured.
      ...(Object.keys(mcp).length ? { mcp: toEngineMcp(mcp) } : {}),
      // Let the model ask the user clarifying questions via the built-in
      // `question` tool. "allow" surfaces the picker immediately (the picker is
      // the interaction; no redundant approval gate). The bridge relays the
      // `question.asked` event and replies through the form API. Leaving the
      // workspace asks first, as it did under OpenCode 1.x (see core/permission).
      permission: opencodePermission(),
      agent: {
        build: { prompt: BUILD_PROMPT },
        plan: { prompt: PLAN_PROMPT },
      },
      // OpenCode 2 ships its todo tool behind a flag.
      experimental: { todo: true },
      provider: {
        // OpenCode's bundled `@ai-sdk/openai-compatible` provider against
        // vLLM's OpenAI-compatible /v1 endpoint. The stored base URL already
        // ends in /v1, so it passes through as-is. `includeUsage` makes vLLM
        // stream real token counts (drives the meter). vLLM needs no auth by
        // default; an `apiKey` is forwarded only when the user configured one
        // (server started with --api-key).
        [providerID]: {
          npm: '@ai-sdk/openai-compatible',
          name: 'vLLM',
          options: {
            baseURL: this.vllm.getBaseUrl(),
            includeUsage: true,
            ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
          },
          ...(Object.keys(models).length ? { models } : {}),
        },
      },
    };
    return JSON.stringify(config);
  }

  async restart(): Promise<ServerStartResult> {
    this.dispose();
    return this.start();
  }

  dispose(): void {
    if (this.client) {
      log('stopping embedded opencode');
    }
    this.client?.dispose();
    const host = this.host;
    this.host = undefined;
    this.client = undefined;
    // Drop any in-flight start so a dispose mid-startup (e.g. restart()) can't
    // have its stale promise returned by the next start() — forces a fresh one.
    this.starting = undefined;
    // Closing releases the engine's watchers, MCP children and database. The
    // next start waits for it (see `closing`).
    if (host) {
      const previous = this.closing;
      this.closing = previous
        .then(() => host.close())
        .catch((err: unknown) => logError('closing embedded opencode', err));
    }
  }
}
