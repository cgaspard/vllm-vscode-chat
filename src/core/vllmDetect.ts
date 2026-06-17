/**
 * Pure resolution of the host's vLLM / Hugging Face CLI tooling. All OS probes
 * (file existence, PATH lookup) are injected so the precedence logic is fully
 * unit-testable; the thin vscode/Node adapter lives in ../vllm/processManager.
 *
 * vLLM has no native Windows support and is Docker/experimental-only on macOS,
 * so on most non-Linux hosts `canServeLocally` will be false — the extension
 * still works as a pure client against a remote/WSL/Docker vLLM `/v1` endpoint.
 */

export interface DetectProbes {
  /** True if a file exists and is executable-ish at this absolute path. */
  exists: (p: string) => boolean;
  /** Resolve a command on PATH (via which/where), or null if absent. */
  which: (cmd: string) => string | null;
  platform: NodeJS.Platform;
  /** Optional explicit overrides from settings (empty string = unset). */
  vllmPathOverride?: string;
  pythonPathOverride?: string;
  hfPathOverride?: string;
}

export interface DetectResult {
  /** Resolved `vllm` executable, or null. */
  vllm: string | null;
  /** Resolved python interpreter able to run `-m vllm`, or null. */
  python: string | null;
  /** Resolved Hugging Face CLI (`hf` or legacy `huggingface-cli`), or null. */
  hf: string | null;
  /** Whether we can spawn `vllm serve` (or `python -m vllm`) on this host. */
  canServeLocally: boolean;
  /** Whether we can run HF downloads on this host. */
  canDownload: boolean;
}

/**
 * Resolve tooling in precedence order:
 *   vllm: override → PATH `vllm` → null (caller may fall back to python -m vllm)
 *   python: override → PATH python3/python → null
 *   hf: override → PATH `hf` → PATH `huggingface-cli` → null
 */
export function detectTooling(probes: DetectProbes): DetectResult {
  const pick = (override: string | undefined, candidates: string[]): string | null => {
    const o = (override ?? '').trim();
    if (o) {
      return o; // trust an explicit user override even if `exists` can't see it
    }
    for (const c of candidates) {
      const onPath = probes.which(c);
      if (onPath) {
        return onPath;
      }
    }
    return null;
  };

  const vllm = pick(probes.vllmPathOverride, ['vllm']);
  const python = pick(probes.pythonPathOverride, ['python3', 'python']);
  const hf = pick(probes.hfPathOverride, ['hf', 'huggingface-cli']);

  // We can serve locally if vllm is directly available, or python is (since
  // vLLM is importable as `python -m vllm`). On Windows there's no official
  // vLLM, but if a user pointed us at one we still honor it.
  const canServeLocally = !!(vllm || python);
  const canDownload = !!hf;

  return { vllm, python, hf, canServeLocally, canDownload };
}

/**
 * Build the argv to launch a vLLM serve, choosing `vllm <serveArgs>` when a
 * vllm binary exists, else `python -m vllm <serveArgs>`. Returns null if
 * neither is available. Pure: the spawn happens in the process manager.
 */
export function resolveServeCommand(
  result: Pick<DetectResult, 'vllm' | 'python'>,
  serveArgs: string[],
): { command: string; args: string[] } | null {
  if (result.vllm) {
    return { command: result.vllm, args: serveArgs };
  }
  if (result.python) {
    return { command: result.python, args: ['-m', 'vllm', ...serveArgs] };
  }
  return null;
}
