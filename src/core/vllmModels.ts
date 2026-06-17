/**
 * Pure parsing of vLLM's OpenAI-compatible `/v1/models` response. Kept
 * vscode-free in core so it can be unit-tested against captured server JSON
 * without dragging in the fetch/config/logger layers.
 */

export interface VllmModel {
  id: string;
  displayName: string;
  type: string; // llm | lora
  maxContextLength?: number; // from max_model_len when the server reports it
  /** Base model id for a LoRA adapter (vLLM reports it as `parent`/`root`). */
  parent?: string;
  isLora?: boolean;
}

/**
 * Heuristic match for embedding/reranker model ids that can't run chat.
 * vLLM's /v1/models doesn't reliably tag model role, so we filter the
 * well-known embedding families by id (best-effort): anything containing
 * "embed", plus the common bge / gte / e5 / nomic-embed / reranker families.
 */
export function isEmbeddingId(id: string): boolean {
  return /(embed|reranker|\bbge-|\bgte-|\be5-|nomic-embed)/i.test(id);
}

/**
 * Map vLLM `/v1/models` entries to our neutral shape. A model entry looks like
 * `{ id, object:"model", max_model_len?, root?, parent? }`. A LoRA adapter is
 * reported with a non-null `parent` pointing at its base model. Embedding-only
 * models are filtered out by id heuristic (best-effort; see isEmbeddingId).
 */
export function parseModels(data: any[]): VllmModel[] {
  return data
    .filter((m) => m && typeof m.id === 'string')
    .filter((m) => !isEmbeddingId(m.id))
    .map((m): VllmModel => {
      const isLora = m.parent != null && m.parent !== m.id;
      return {
        id: m.id,
        displayName: prettyName(m.id),
        type: isLora ? 'lora' : 'llm',
        maxContextLength: typeof m.max_model_len === 'number' ? m.max_model_len : undefined,
        parent: isLora ? String(m.parent) : undefined,
        isLora,
      };
    });
}

/** vLLM ids are usually HF repo paths (`org/Model-Name`); show the leaf. */
export function prettyName(id: string): string {
  const base = id.split('/').pop() ?? id;
  return base;
}
