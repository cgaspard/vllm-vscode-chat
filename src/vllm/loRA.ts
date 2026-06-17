import { loadBody, LoadLoraRequest, unloadBody } from '../core/loRABodies';
import { logError } from '../logger';

// Re-export the pure shape + body builders so importers keep working while the
// payload logic stays unit-testable in core (no vscode/fetch dependency).
export { loadBody, unloadBody };
export type { LoadLoraRequest };

/**
 * Runtime LoRA adapter management against a vLLM server. Only works when the
 * server was started with `--enable-lora` (and VLLM_ALLOW_RUNTIME_LORA_UPDATING
 * for dynamic updates). vLLM exposes:
 *   POST /v1/load_lora_adapter   { lora_name, lora_path }
 *   POST /v1/unload_lora_adapter { lora_name }
 * Loaded adapters then appear in GET /v1/models as entries whose `parent` is
 * the base model.
 */

const TIMEOUT = (ms: number) => AbortSignal.timeout(ms);

export class LoraClient {
  constructor(private baseUrl: string, private apiKey = '') {}

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) {
      h.authorization = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  async load(req: LoadLoraRequest): Promise<void> {
    const res = await fetch(`${this.baseUrl}/load_lora_adapter`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(loadBody(req)),
      signal: TIMEOUT(120000),
    });
    if (!res.ok) {
      throw new Error(`load_lora_adapter ${res.status}: ${await res.text().catch(() => '')}`);
    }
  }

  async unload(loraName: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/unload_lora_adapter`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(unloadBody(loraName)),
      signal: TIMEOUT(30000),
    });
    if (!res.ok) {
      throw new Error(`unload_lora_adapter ${res.status}: ${await res.text().catch(() => '')}`);
    }
  }

  /** Best-effort load that never throws (for fire-and-forget UI paths). */
  async tryLoad(req: LoadLoraRequest): Promise<string | null> {
    try {
      await this.load(req);
      return null;
    } catch (err) {
      logError('LoRA load failed', err);
      return err instanceof Error ? err.message : String(err);
    }
  }
}
