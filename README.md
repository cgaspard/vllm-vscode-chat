# vLLM Code

An agentic coding panel for **your [vLLM](https://docs.vllm.ai) server** — a Claude Code / Codex–style chat experience backed by your own GPU.

Under the hood it drives the open-source [**OpenCode**](https://opencode.ai) agent (Apache/MIT) as a headless server pointed at your vLLM server's OpenAI-compatible `/v1` endpoint. You get a real agent — file edits, shell tools, permissions, multi-step reasoning — running entirely against models you serve.

It also ships a **Model Manager**: start/stop local `vllm serve` instances, download models from Hugging Face, and load/unload LoRA adapters at runtime.

## Why

The official Claude Code and Codex VS Code extensions are **not open source**, so they can't be adapted to self-hosted models. OpenCode, by contrast, ships a headless server that speaks the OpenAI-compatible provider protocol — exactly what vLLM exposes. This extension wraps that server in a native chat panel, fills its model picker from your vLLM server's `/v1/models`, and adds a manager for the local vLLM lifecycle.

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

## Requirements

- **VS Code** 1.104+
- **A reachable [vLLM](https://docs.vllm.ai) server** exposing its OpenAI-compatible API (default `http://127.0.0.1:8000/v1`). vLLM runs on **Linux / WSL / Docker** (and macOS via Docker Model Runner); it has no native Windows build. On Windows/macOS, run vLLM in WSL/Docker or on a remote GPU box and point the extension at its URL — the chat panel works as a pure client on every platform.
- **Optional, for the local Model Manager:** a `vllm` install (or `python -m vllm`) and the Hugging Face CLI (`pip install -U "huggingface_hub[cli]"`) on the same machine as VS Code.

> **[OpenCode](https://opencode.ai) is bundled** — the matching platform binary ships inside the extension, so there's nothing extra to install and it works offline. Power users can point at their own build with `vllmCode.opencodePath`; an install on your `PATH` or in `~/.opencode/bin` is preferred over the bundled copy if present.

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
| `vllmCode.opencodePath` | _(bundled)_ | Override path to an `opencode` binary; empty uses your own install (PATH / `~/.opencode`) or the bundled one |
| `vllmCode.serverPort` | `0` | Embedded OpenCode server port (0 = auto) |
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
        │  HTTP + SSE  (raw fetch)
        ▼
opencode serve  ──@ai-sdk/openai-compatible──▶  vLLM (/v1/chat/completions)
   (OPENCODE_CONFIG_CONTENT injected at launch)
```

The extension enumerates models with vLLM's OpenAI-compatible `GET /v1/models`,
then registers a `vllm` provider in OpenCode with those models (context limit
from `--max-model-len`) via the `OPENCODE_CONFIG_CONTENT` environment variable —
**nothing is written to your workspace or global config.** Chat streams over
`/v1/chat/completions` with usage reporting, which drives the context meter.

The Model Manager spawns `vllm serve` (or `python -m vllm`) for local instances,
parses the startup log for readiness, runs `hf download` for Hugging Face
weights, and calls vLLM's `/v1/load_lora_adapter` / `/v1/unload_lora_adapter`
for runtime LoRA adapters. vLLM serves one base model per process — there is no
runtime base-model swap — so "managing models" means managing **instances**,
**downloads**, and **adapters**.

## Develop from source

```bash
npm install
npm run bundle:opencode      # fetch the pinned OpenCode binary into bin/ for your platform
npm run compile              # type-check + bundle (extension + webview)
npm test                     # run the unit suite
# then press F5 in VS Code to launch the Extension Development Host
npm run package:vsix:bundled # build a platform .vsix with the binary embedded
```

The OpenCode binary is fetched at build time (pinned by `opencodeVersion` in
`package.json`) and is never committed — `bin/` is git-ignored. Bump that field
to upgrade the bundled OpenCode. F5 also resolves the binary from `bin/`, so run
`bundle:opencode` once before launching the dev host.

## License

MIT
