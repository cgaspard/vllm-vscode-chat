# vLLM Code — prototype status

Forked from `ollama-vscode-chat` and re-targeted at **vLLM** + a new **local model
manager**. This file summarizes what's verified vs. what still needs a real vLLM
server (which couldn't run in the build environment — no GPU/Linux).

## ✅ Verified in-session (no GPU needed)

- **Typecheck** — `npm run check-types` and `npm run check-types:test` both pass (extension + tests).
- **Unit tests** — `npm test` → **101 passing**, covering the pure logic that carries the risk:
  - `test/url.test.ts` — the inverted vLLM `/v1` URL contract (default `:8000/v1`, `/v1` added/preserved).
  - `test/vllmArgs.test.ts` — `vllm serve` argv building/validation (ordering, omitted optionals, bad input).
  - `test/vllmDetect.test.ts` — CLI resolution precedence + client-only detection (the Mac/Windows case).
  - `test/vllmClient.test.ts` — `/v1/models` parsing incl. LoRA adapters, missing `max_model_len`, embedding filter, junk.
  - `test/hfArgs.test.ts` — `hf download` argv + HF cache path/repo parsing.
  - `test/loRA.test.ts` — load/unload request bodies.
  - `test/prompts.test.ts` — vLLM Code identity + question-tool/plan-mode guards.
  - Plus the inherited pure-core suites (context/models/title/backoff/binary/question/errors/health/reconnect).
- **Production build** — `npm run package` (esbuild bundles extension host + webview) succeeds.
- **Package validity** — `npx vsce ls` confirms a clean file list (no source/map/test leakage); manifest is valid.
- **Branding** — no `ollamaCode` namespace, `OLLAMA_HOST`, or functional `num_ctx`/`keep_alive` remain; new purple-V icon generated.

## ⏳ Needs a real vLLM server to confirm (do this on your GPU box / WSL / Docker)

1. **Chat path:** start `vllm serve <model> --max-model-len 32768`, set `vllmCode.serverUrl`
   to its `/v1`, open the panel — confirm the model list populates and a prompt streams a reply
   with the context meter tracking real token usage.
2. **Model Manager → Instances** (Linux/WSL with vLLM installed): Start an instance from the form,
   confirm it reaches "ready", chat against it (it auto-registers as a server), then Stop.
3. **Model Manager → Models (HF):** `hf download` a small repo, confirm it appears in the cache list,
   and "Use in Instances" pre-fills the start form.
4. **Model Manager → LoRA:** against an instance started with `--enable-lora`, load an adapter by
   name+path, confirm it appears in `/v1/models`, then unload it.
5. **Secured server:** start vLLM with `--api-key KEY`, set `vllmCode.apiKey`, confirm chat + discovery work.

## Architecture (what changed vs. the Ollama fork)

- **Chat** still runs through the bundled **OpenCode** agent, now via its `@ai-sdk/openai-compatible`
  provider (`provider.vllm`) pointed at the server's `/v1` base — see `src/opencode/serverManager.ts`.
- **Discovery** is `GET /v1/models` (`src/vllm/client.ts` + pure parser `src/core/vllmModels.ts`).
  No model pull/load/unload/keep_alive — those Ollama concepts don't exist in vLLM and were removed.
- **New model-manager subsystem** (`src/vllm/`): `processManager.ts` (spawn/track `vllm serve`),
  `hf.ts` (Hugging Face downloads), `loRA.ts` (runtime adapters). Pure, tested logic lives in
  `src/core/`: `vllmArgs.ts`, `vllmDetect.ts`, `hfArgs.ts`, `loRABodies.ts`, `vllmModels.ts`.
- **Manager UI**: `src/panel/managerPanel.ts` + `src/panel/managerHtml.ts` (tabs: Instances / Models / LoRA).
  Local-spawn controls disable themselves with a notice on hosts without vLLM (covers Mac/Windows).
- **URL seam inverted** (`src/core/url.ts`): vLLM lives under `/v1` (default port 8000), the opposite
  of Ollama's host-root assumption.

## Run from source

```bash
npm install
npm run bundle:opencode   # fetch the OpenCode binary into bin/ for your platform (needed for F5)
npm run compile
npm test
# F5 in VS Code → Extension Development Host
```

## Known follow-ups / ideas

- The embedding filter in `src/core/vllmModels.ts` is a best-effort id heuristic (bge/gte/e5/embed/reranker);
  vLLM's `/v1/models` doesn't reliably tag model role.
- Consider auto-selecting a just-started local instance as the active chat server (currently it's
  registered and offered in the server menu; the user switches to it).
- Screenshots/GIF in `media/` are still the inherited ones — recapture once running.
