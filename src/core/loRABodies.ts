/**
 * Pure request-body builders for vLLM's runtime LoRA endpoints. Kept in core
 * (no vscode/fetch) so the payload shapes are unit-testable. The I/O wrapper
 * lives in ../vllm/loRA.
 */

export interface LoadLoraRequest {
  loraName: string;
  loraPath: string; // local dir or HF repo id of the adapter
}

/** The JSON body vLLM expects for POST /v1/load_lora_adapter. */
export function loadBody(req: LoadLoraRequest): { lora_name: string; lora_path: string } {
  const name = (req.loraName || '').trim();
  const path = (req.loraPath || '').trim();
  if (!name || !path) {
    throw new Error('LoRA name and path are both required.');
  }
  return { lora_name: name, lora_path: path };
}

/** The JSON body vLLM expects for POST /v1/unload_lora_adapter. */
export function unloadBody(loraName: string): { lora_name: string } {
  const name = (loraName || '').trim();
  if (!name) {
    throw new Error('LoRA name is required.');
  }
  return { lora_name: name };
}
