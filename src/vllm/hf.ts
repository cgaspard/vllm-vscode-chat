import { ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildDownloadArgs, cacheDirToRepo, HfDownloadOptions, hubCacheRoot } from '../core/hfArgs';
import { log } from '../logger';

export interface CachedModel {
  repo: string;
  path: string;
}

/**
 * Hugging Face model download + cache enumeration. The pure argv/cache logic
 * lives in ../core/hfArgs; this wraps it with process spawning and fs access.
 */
export class HfManager {
  /**
   * @param hfBin Resolved `hf` / `huggingface-cli` path (from vllmDetect).
   * @param token Optional HF token for gated/private repos.
   */
  constructor(private readonly hfBin: string | null, private readonly token = '') {}

  get available(): boolean {
    return !!this.hfBin;
  }

  /** List cached models by scanning the HF hub cache directory. */
  listCached(): CachedModel[] {
    const root = hubCacheRoot(process.env, os.homedir());
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      return []; // cache dir doesn't exist yet
    }
    const out: CachedModel[] = [];
    for (const name of entries) {
      const repo = cacheDirToRepo(name);
      if (repo) {
        out.push({ repo, path: path.join(root, name) });
      }
    }
    return out.sort((a, b) => a.repo.localeCompare(b.repo));
  }

  /**
   * Download a repo via the HF CLI, streaming progress lines to `onProgress`.
   * Resolves on success; rejects on non-zero exit / spawn error. The HF token,
   * if set, is passed via env so it never lands in the argv/logs.
   */
  download(
    opts: HfDownloadOptions,
    onProgress?: (line: string) => void,
  ): { promise: Promise<void>; cancel: () => void } {
    if (!this.hfBin) {
      return {
        promise: Promise.reject(
          new Error('Hugging Face CLI not found. Install it with `pip install -U "huggingface_hub[cli]"`.'),
        ),
        cancel: () => undefined,
      };
    }
    const args = buildDownloadArgs(opts);
    log(`hf ${args.join(' ')}`);
    const env = { ...process.env, NO_COLOR: '1' } as NodeJS.ProcessEnv;
    if (this.token) {
      env.HF_TOKEN = this.token;
    }
    let child: ChildProcess | undefined;
    const promise = new Promise<void>((resolve, reject) => {
      child = spawn(this.hfBin as string, args, { env });
      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) {
            onProgress?.(line.trim());
          }
        }
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData); // HF prints progress on stderr
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`hf download exited ${code}`));
        }
      });
    });
    return { promise, cancel: () => child?.kill() };
  }
}

/** Resolve the HF token: explicit arg wins, else HF_TOKEN env. */
export function resolveHfToken(configured: string): string {
  const c = (configured || '').trim();
  if (c) {
    return c;
  }
  return (process.env.HF_TOKEN ?? '').trim();
}
