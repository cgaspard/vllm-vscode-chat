/**
 * Pure helpers for Hugging Face CLI invocation + cache scanning. The newer
 * `hf` CLI and the legacy `huggingface-cli` share the same `download` verb;
 * both honor HF_HOME / the default ~/.cache/huggingface cache. Kept pure so
 * the argv and cache-path parsing are unit-testable without spawning anything.
 */

export interface HfDownloadOptions {
  repo: string; // e.g. 'meta-llama/Llama-3.2-3B-Instruct'
  /** Restrict to specific files (default: whole snapshot). */
  files?: string[];
  /** Override cache dir; otherwise the CLI uses HF_HOME / default. */
  cacheDir?: string;
}

/** Build the `download` argv (excluding the program name) for the HF CLI. */
export function buildDownloadArgs(opts: HfDownloadOptions): string[] {
  const repo = (opts.repo || '').trim();
  if (!repo) {
    throw new Error('A Hugging Face repo id is required.');
  }
  const args = ['download', repo];
  for (const f of opts.files ?? []) {
    if (f && f.trim()) {
      args.push(f.trim());
    }
  }
  if (opts.cacheDir && opts.cacheDir.trim()) {
    args.push('--cache-dir', opts.cacheDir.trim());
  }
  return args;
}

/**
 * The HF hub cache stores each repo as `models--<org>--<name>` under
 * `<cacheRoot>/hub`. Convert a cache directory name back to a repo id, or null
 * if it isn't a model cache entry.
 */
export function cacheDirToRepo(dirName: string): string | null {
  const m = /^models--(.+)$/.exec(dirName);
  if (!m) {
    return null;
  }
  return m[1].replace(/--/g, '/');
}

/**
 * Resolve the hub cache root from an env-like map: HF_HUB_CACHE wins, else
 * HF_HOME/hub, else <home>/.cache/huggingface/hub.
 */
export function hubCacheRoot(env: { HF_HUB_CACHE?: string; HF_HOME?: string }, home: string): string {
  if (env.HF_HUB_CACHE && env.HF_HUB_CACHE.trim()) {
    return env.HF_HUB_CACHE.trim();
  }
  if (env.HF_HOME && env.HF_HOME.trim()) {
    return `${env.HF_HOME.trim()}/hub`;
  }
  return `${home}/.cache/huggingface/hub`;
}
