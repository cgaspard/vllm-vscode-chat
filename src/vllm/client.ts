import { vllmRestRoot } from '../config';
import { parseModels, VllmModel } from '../core/vllmModels';
import { logError } from '../logger';

// Re-export the pure shape + parser so existing importers keep working while
// the parsing logic stays unit-testable in core (no vscode/fetch dependency).
export { parseModels };
export type { VllmModel };

const TIMEOUT = (ms: number) => AbortSignal.timeout(ms);

/**
 * Discovery helper for an OpenAI-compatible vLLM server.
 *
 * Unlike Ollama, vLLM has no model pull / load / unload / keep_alive: a server
 * process serves a single base model chosen at launch, and context length is
 * fixed via `--max-model-len`. So this client only does discovery + a health
 * check. Process lifecycle and LoRA/HF management live in ../vllm/* and the
 * model-manager panel. vLLM needs no auth by default; an optional bearer token
 * supports servers started with `--api-key`.
 */
export class VllmClient {
  constructor(private baseUrl: string, private apiKey = '') {}

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }
  getBaseUrl(): string {
    return this.baseUrl;
  }
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /** The vLLM REST root (base without a trailing /vN); kept for parity. */
  get rest(): string {
    return vllmRestRoot(this.baseUrl);
  }

  private get headers(): Record<string, string> {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
  }

  async checkConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers,
        signal: TIMEOUT(4000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** List served models (and any loaded LoRA adapters) via GET /v1/models. */
  async listModels(): Promise<VllmModel[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers,
        signal: TIMEOUT(8000),
      });
      if (!res.ok) {
        return [];
      }
      const json = (await res.json()) as { data?: any[] };
      return parseModels(json.data ?? []);
    } catch (err) {
      logError('listModels /v1/models failed', err);
      return [];
    }
  }

  async getModel(modelId: string): Promise<VllmModel | undefined> {
    return (await this.listModels()).find((m) => m.id === modelId);
  }
}
