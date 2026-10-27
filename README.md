# vLLM Code

An agentic coding panel for **your [vLLM](https://docs.vllm.ai) server** — a Claude Code / Codex–style chat experience backed by your own GPU.

Under the hood it runs the open-source [**OpenCode**](https://opencode.ai) agent (MIT) inside the extension, pointed at your vLLM server's OpenAI-compatible `/v1` endpoint. You get a real agent — file edits, shell tools, permissions, multi-step reasoning — running entirely against models you serve.

It also ships a **Model Manager**: start/stop local `vllm serve` instances, download models from Hugging Face, and load/unload LoRA adapters at runtime.

## Why

The official Claude Code and Codex VS Code extensions are **not open source**, so they can't be adapted to self-hosted models. OpenCode, by contrast, is an embeddable agent that speaks the OpenAI-compatible provider protocol — exactly what vLLM exposes. This extension wraps it in a native chat panel, fills its model picker from your vLLM server's `/v1/models`, and adds a manager for the local vLLM lifecycle.

## Features

- **Chat panel** in the Activity Bar / secondary side bar (and "Open in Editor Tab" for parallel conversations)
- **Streaming** responses with a Claude-style timeline — thinking, tool steps, answer
- **Agent tools** — file reads/edits, shell, search — surfaced as collapsible tool cards
- **Permission prompts** — Allow once / Allow always / Deny, inline
- **Model picker** sourced from your vLLM server's `/v1/models` (base models + loaded LoRA adapters)
- **Model Manager** — start/stop local `vllm serve` instances (model, `--max-model-len`, `--gpu-memory-utilization`, dtype, quantization, tensor-parallel, `--enable-lora`), download models from Hugging Face, and load/unload LoRA adapters at runtime
- **Multi-server** — register, switch, and remove vLLM servers (local, WSL, Docker, or remote GPU box); offline mode with a connection banner
- **Context meter** (uses vLLM's real token usage), **thinking toggle**, **image attachments** for vision models, and the **open file** attached as excludable context
- **Session history** — persistent, resumable, auto-named; delete one or clear all
- **Steer it mid-flight** — type while the agent works: **Enter** hands your message to it at its next step, **⌥/Alt+Enter** queues it for when the turn finishes

## Requirements

- **VS Code** 1.104+
- **A reachable [vLLM](https://docs.vllm.ai) server** exposing its OpenAI-compatible API (default `http://127.0.0.1:8000/v1`). vLLM runs on **Linux / WSL / Docker** (and macOS via Docker Model Runner); it has no native Windows build. On Windows/macOS, run vLLM in WSL/Docker or on a remote GPU box and point the extension at its URL — the chat panel works as a pure client on every platform.
- **Optional, for the local Model Manager:** a `vllm` install (or `python -m vllm`) and the Hugging Face CLI (`pip install -U "huggingface_hub[cli]"`) on the same machine as VS Code.

> **[OpenCode](https://opencode.ai) 2 runs inside the extension** — there is no separate server to install, start or stop, no port, and nothing left running when VS Code closes. An OpenCode install elsewhere on your machine (yours, Homebrew's) is never used and never affected: the panel keeps its own sessions and settings, and chats from earlier versions carry over.
>
> OpenCode is MIT-licensed by [anomalyco/opencode](https://github.com/anomalyco/opencode); its notice ships with the extension as `opencode-sdk/LICENSE.opencode`. This extension is an independent project and is not affiliated with or endorsed by the OpenCode maintainers.

## Steer it mid-flight

Type while the agent is working and hit **Enter** — your message is handed to it at its next step, so it adjusts work already in progress instead of you stopping and starting over. Hit **⌥/Alt+Enter** instead to **queue** it for when the current turn finishes.

Messages waiting to be picked up sit above the composer, marked *Steering* or *Queued*: switch one between the two, or cancel it before the agent ever sees it. Each lands in the conversation at the moment the agent actually reads it, so the transcript stays in the order the model saw things. The stop button still stops.

## Quick start

1. Start a vLLM server, e.g. `vllm serve meta-llama/Llama-3.2-3B-Instruct --max-model-len 32768`.
2. Install this extension (or run it from source — see below).
3. Click the vLLM icon in the Activity Bar.
4. If your server isn't at `http://127.0.0.1:8000/v1`, open the server menu and add its URL.
5. Pick a model, type a task, hit Enter.

To manage models locally, run **vLLM Code: Manage Local Models** (toolbar button on the chat panel).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `vllmCode.serverUrl` | `http://127.0.0.1:8000/v1` | OpenAI-compatible vLLM base URL (`/v1` added if omitted) |
| `vllmCode.apiKey` | _(none)_ | Bearer token for a server started with `--api-key` |
| `vllmCode.defaultModel` | _(first)_ | Default model id (must match `/v1/models`) |
| `vllmCode.agent` | `build` | `build` (can edit) or `plan` (read-only) |
| `vllmCode.minContextLength` | `32768` | OpenCode compaction budget + meter denominator (clamped to the model's `--max-model-len`) |
| `vllmCode.pythonPath` | _(auto)_ | Python interpreter for `python -m vllm` when no `vllm` binary is on PATH |
| `vllmCode.vllmPath` | _(auto)_ | Override path to the `vllm` executable |
| `vllmCode.hfPath` | _(auto)_ | Override path to the Hugging Face CLI |
| `vllmCode.hfToken` | _(none)_ | HF token for gated/private downloads (falls back to `HF_TOKEN`) |
| `vllmCode.defaultMaxModelLen` | `32768` | Default `--max-model-len` pre-filled in the Model Manager |
| `vllmCode.defaultGpuMemoryUtilization` | `0.9` | Default `--gpu-memory-utilization` pre-filled in the Model Manager |

## How it works

```
VS Code webview (chat UI + Model Manager)
        │  postMessage
        ▼
Extension host (bridge + process/HF/LoRA managers)
        │  in-process calls + event stream
        ▼
OpenCode 2 (@opencode/sdk,   ──@ai-sdk/openai-compatible──▶  vLLM (/v1/chat/completions)
  embedded, no server)
```

OpenCode runs inside the extension host through its embedding SDK — no
process, no port, no password. The extension enumerates models with vLLM's
OpenAI-compatible `GET /v1/models` and hands OpenCode a `vllm` provider with
those models (context limit from `--max-model-len`) in memory when it starts —
**nothing is written to your workspace or global config**, and it is the only
provider enabled (a key exported in your shell, or OpenCode's own vLLM
auto-discovery, is never picked up behind your back). Chat streams over
`/v1/chat/completions` with usage reporting, which drives the context meter.
Its sessions, database and settings live in the extension's own storage,
isolated from any OpenCode you run yourself; chats from earlier versions carry
over.

The Model Manager spawns `vllm serve` (or `python -m vllm`) for local instances,
parses the startup log for readiness, runs `hf download` for Hugging Face
weights, and calls vLLM's `/v1/load_lora_adapter` / `/v1/unload_lora_adapter`
for runtime LoRA adapters. vLLM serves one base model per process — there is no
runtime base-model swap — so "managing models" means managing **instances**,
**downloads**, and **adapters**.

## Develop from source

```bash
npm install
npm run bundle:opencode-sdk  # build the embedded OpenCode engine into opencode-sdk/ for your platform
npm run compile              # type-check + bundle (extension + webview)
# then press F5 in VS Code to launch the Extension Development Host
npm test                     # unit tests
npm run test:integration     # drives the real webview in a VS Code instance
npm run test:live            # the engine against a model server (default LM Studio on :1234; any OpenAI-compatible /v1)
npm run test:e2e             # the whole panel against a real model, through the UI
npm run package:vsix:bundled # build a platform .vsix with the engine embedded
```

The engine is built from `@opencode/sdk`, pinned to an exact version in
`devDependencies` — its API is still marked experimental, so upgrades are
deliberate. `opencode-sdk/` is generated and git-ignored; run
`bundle:opencode-sdk` once before launching the dev host, and again after
changing the pinned version. The live and e2e suites default to LM Studio's
OpenAI-compatible endpoint as a stand-in for vLLM (override with
`LIVE_BASE_URL` / `E2E_BASE_URL` and `LIVE_MODEL` / `E2E_MODEL`).

## License

MIT
