/**
 * Pure builders/validators for launching a local `vllm serve` process. Kept
 * vscode-free and side-effect-free so the whole argv-construction surface is
 * unit-testable without a GPU or a real vLLM install.
 *
 * A vLLM server serves ONE base model, chosen at launch:
 *   vllm serve <model> --host 127.0.0.1 --port 8000 \
 *     --max-model-len 32768 --gpu-memory-utilization 0.9 [--enable-lora] ...
 */

export interface VllmServeConfig {
  /** HF repo id or local path of the base model to serve (required). */
  model: string;
  /** TCP port for the OpenAI-compatible server. */
  port: number;
  /** Bind host (default 127.0.0.1). */
  host?: string;
  /** --max-model-len: fixed context window for this instance. */
  maxModelLen?: number;
  /** --gpu-memory-utilization: fraction 0..1 (vLLM default 0.9). */
  gpuMemoryUtilization?: number;
  /** --dtype, e.g. 'auto' | 'half' | 'bfloat16' | 'float16'. */
  dtype?: string;
  /** --quantization, e.g. 'awq' | 'gptq' | 'fp8'. */
  quantization?: string;
  /** --tensor-parallel-size: number of GPUs to shard across. */
  tensorParallelSize?: number;
  /** --enable-lora: required for runtime LoRA adapter load/unload. */
  enableLora?: boolean;
  /** --api-key: require this bearer token on requests. */
  apiKey?: string;
  /** A human label for the managed instance (UI only; not passed to vLLM). */
  label?: string;
  /** Escape hatch: extra raw args appended verbatim. */
  extraArgs?: string[];
}

const VALID_DTYPES = ['auto', 'half', 'float16', 'bfloat16', 'float', 'float32'];

/**
 * Validate a serve config. Returns the list of human-readable errors (empty =
 * valid). Pure so the manager UI and tests share one source of truth.
 */
export function validateServeConfig(cfg: VllmServeConfig): string[] {
  const errors: string[] = [];
  if (!cfg.model || !cfg.model.trim()) {
    errors.push('Model is required.');
  }
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    errors.push('Port must be an integer between 1 and 65535.');
  }
  if (cfg.maxModelLen != null && (!Number.isInteger(cfg.maxModelLen) || cfg.maxModelLen < 1)) {
    errors.push('Max model length must be a positive integer.');
  }
  if (
    cfg.gpuMemoryUtilization != null &&
    (!(cfg.gpuMemoryUtilization > 0) || cfg.gpuMemoryUtilization > 1)
  ) {
    errors.push('GPU memory utilization must be between 0 and 1.');
  }
  if (cfg.dtype != null && cfg.dtype !== '' && !VALID_DTYPES.includes(cfg.dtype)) {
    errors.push(`dtype must be one of: ${VALID_DTYPES.join(', ')}.`);
  }
  if (
    cfg.tensorParallelSize != null &&
    (!Number.isInteger(cfg.tensorParallelSize) || cfg.tensorParallelSize < 1)
  ) {
    errors.push('Tensor parallel size must be a positive integer.');
  }
  return errors;
}

/**
 * Build the argument vector (excluding the program name) for `vllm serve`.
 * Throws if the config is invalid so callers never spawn a broken command.
 * Optional fields are omitted entirely when unset — vLLM then uses its own
 * defaults (e.g. gpu-memory-utilization 0.9, dtype auto).
 */
export function buildServeArgs(cfg: VllmServeConfig): string[] {
  const errors = validateServeConfig(cfg);
  if (errors.length) {
    throw new Error(`Invalid vllm serve config: ${errors.join(' ')}`);
  }
  const args: string[] = ['serve', cfg.model.trim()];
  args.push('--host', cfg.host?.trim() || '127.0.0.1');
  args.push('--port', String(cfg.port));
  if (cfg.maxModelLen != null) {
    args.push('--max-model-len', String(cfg.maxModelLen));
  }
  if (cfg.gpuMemoryUtilization != null) {
    args.push('--gpu-memory-utilization', String(cfg.gpuMemoryUtilization));
  }
  if (cfg.dtype) {
    args.push('--dtype', cfg.dtype);
  }
  if (cfg.quantization) {
    args.push('--quantization', cfg.quantization);
  }
  if (cfg.tensorParallelSize != null) {
    args.push('--tensor-parallel-size', String(cfg.tensorParallelSize));
  }
  if (cfg.enableLora) {
    args.push('--enable-lora');
  }
  if (cfg.apiKey) {
    args.push('--api-key', cfg.apiKey);
  }
  if (cfg.extraArgs?.length) {
    args.push(...cfg.extraArgs.filter((a) => a && a.trim()).map((a) => a.trim()));
  }
  return args;
}

/** The OpenAI-compatible base URL a served instance exposes for chat. */
export function serveBaseUrl(cfg: Pick<VllmServeConfig, 'host' | 'port'>): string {
  const host = cfg.host?.trim() || '127.0.0.1';
  return `http://${host}:${cfg.port}/v1`;
}
