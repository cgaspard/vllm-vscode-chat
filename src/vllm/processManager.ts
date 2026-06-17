import { ChildProcess, spawn } from 'node:child_process';
import { buildServeArgs, serveBaseUrl, VllmServeConfig } from '../core/vllmArgs';
import { resolveServeCommand } from '../core/vllmDetect';
import { log, logError } from '../logger';

export type InstanceStatus = 'starting' | 'ready' | 'stopped' | 'error';

export interface VllmInstance {
  id: string;
  config: VllmServeConfig;
  baseUrl: string;
  status: InstanceStatus;
  pid?: number;
  error?: string;
  /** Tail of recent log lines (capped). */
  logs: string[];
}

export interface ServeResolver {
  /** Resolve { command, args } for the serve argv, or null if vLLM is absent. */
  resolve(serveArgs: string[]): { command: string; args: string[] } | null;
}

const MAX_LOG_LINES = 400;
let counter = 0;
function genId(): string {
  return 'vllm_' + (counter++).toString(36) + '_' + process.pid.toString(36);
}

/**
 * Owns the lifecycle of locally-spawned `vllm serve` processes (one per served
 * base model / port). Parses vLLM's startup log to learn when the OpenAI server
 * is accepting requests, streams logs, and notifies listeners of status
 * changes. Has NO vscode dependency so it can be exercised in tests by
 * injecting a custom `ServeResolver` and stubbing `spawn` via the resolver's
 * command (tests cover the pure arg/resolve layer; this orchestrator is thin).
 */
export class VllmProcessManager {
  private readonly instances = new Map<string, VllmInstance>();
  private readonly procs = new Map<string, ChildProcess>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly resolver: ServeResolver) {}

  onChange(cb: () => void): { dispose: () => void } {
    this.listeners.add(cb);
    return { dispose: () => this.listeners.delete(cb) };
  }

  list(): VllmInstance[] {
    return [...this.instances.values()];
  }

  get(id: string): VllmInstance | undefined {
    return this.instances.get(id);
  }

  /**
   * Start a new `vllm serve` instance. Returns the instance record (status
   * 'starting'); listeners are notified as it transitions to ready/error.
   * Throws synchronously only if vLLM tooling is unavailable or the config is
   * invalid (buildServeArgs validates).
   */
  start(config: VllmServeConfig): VllmInstance {
    const serveArgs = buildServeArgs(config); // throws on invalid config
    const resolved = this.resolver.resolve(serveArgs);
    if (!resolved) {
      throw new Error(
        'vLLM not found on this host. Install vLLM (Linux/WSL) or connect to a remote vLLM server instead.',
      );
    }
    const id = genId();
    const baseUrl = serveBaseUrl(config);
    const inst: VllmInstance = { id, config, baseUrl, status: 'starting', logs: [] };
    this.instances.set(id, inst);

    log(`starting vllm: ${resolved.command} ${resolved.args.join(' ')}`);
    const proc = spawn(resolved.command, resolved.args, { env: { ...process.env, NO_COLOR: '1' } });
    this.procs.set(id, proc);
    inst.pid = proc.pid;

    const readyRe = /(Application startup complete|Uvicorn running on)/i;
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) {
          continue;
        }
        this.appendLog(inst, line.trim());
        if (inst.status === 'starting' && readyRe.test(line)) {
          inst.status = 'ready';
          log(`vllm instance ${id} ready at ${baseUrl}`);
          this.emit();
        }
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', (err) => {
      inst.status = 'error';
      inst.error = err.message;
      logError(`vllm instance ${id} spawn error`, err);
      this.emit();
    });
    proc.on('exit', (code, signal) => {
      this.procs.delete(id);
      if (inst.status !== 'stopped') {
        inst.status = code === 0 ? 'stopped' : 'error';
        if (code !== 0) {
          inst.error = `exited (code=${code}, signal=${signal})`;
        }
      }
      log(`vllm instance ${id} exited (code=${code}, signal=${signal})`);
      this.emit();
    });

    this.emit();
    return inst;
  }

  /** Stop a running instance (SIGTERM). Idempotent. */
  stop(id: string): void {
    const proc = this.procs.get(id);
    const inst = this.instances.get(id);
    if (inst) {
      inst.status = 'stopped';
    }
    if (proc && !proc.killed) {
      proc.kill();
    }
    this.procs.delete(id);
    this.emit();
  }

  /** Remove a stopped instance record from the list. */
  remove(id: string): void {
    this.stop(id);
    this.instances.delete(id);
    this.emit();
  }

  dispose(): void {
    for (const id of [...this.procs.keys()]) {
      this.stop(id);
    }
    this.listeners.clear();
  }

  private appendLog(inst: VllmInstance, line: string): void {
    inst.logs.push(line);
    if (inst.logs.length > MAX_LOG_LINES) {
      inst.logs.splice(0, inst.logs.length - MAX_LOG_LINES);
    }
  }

  private emit(): void {
    for (const cb of [...this.listeners]) {
      try {
        cb();
      } catch (err) {
        logError('vllm instance listener threw', err);
      }
    }
  }
}

/** Build a ServeResolver from a detect result (the production wiring). */
export function resolverFromDetect(detect: { vllm: string | null; python: string | null }): ServeResolver {
  return {
    resolve: (serveArgs: string[]) => resolveServeCommand(detect, serveArgs),
  };
}
