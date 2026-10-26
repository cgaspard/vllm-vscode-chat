// OpenCode 2 ships a built-in vLLM plugin that owns the provider id `vllm` —
// the id this panel has always used. Once the plugin discovers the server's
// models (GET /health + /v1/models, models `owned_by: "vllm"`) it merges its
// own view of them over the provider's declared ones — for the same model id,
// its limits replace the panel's. The panel declares its provider
// under the engine id from src/core/providerIds.ts instead. This shows the
// takeover on the raw id and that the mapped id survives it.
//
// Needs no GPU and no model: a fake vLLM answers discovery in-process.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { toEngineProviderID } from '../src/core/providerIds';
import { createHost } from '../src/opencode/embedded';
import { OpencodeV2Client } from '../src/opencode/v2client';

const DECLARED = 'panel/declared-model';
const DISCOVERY_WAIT_MS = 40_000; // the plugins refresh every 30s

/** A vLLM stand-in: just the two discovery endpoints the plugin calls. */
function fakeVllm(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200).end();
    } else if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({ object: 'list', data: [{ id: DECLARED, object: 'model', owned_by: 'vllm', max_model_len: 4096 }] }),
      );
    } else {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function modelsAfterDiscovery(baseURL: string, engineId: string): Promise<Record<string, { limit?: { context?: number } }>> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-res-'));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-res-ws-'));
  execFileSync('git', ['init', '-q'], { cwd: ws });
  const config = {
    enabled_providers: [engineId],
    provider: {
      [engineId]: {
        npm: '@ai-sdk/openai-compatible',
        name: 'vLLM',
        options: { baseURL },
        models: { [DECLARED]: { name: 'Declared', tool_call: true, limit: { context: 32768, output: 4096 } } },
      },
    },
  };
  const host = await createHost(path.resolve(__dirname, '..'), { root }, JSON.stringify(config));
  const client = new OpencodeV2Client(host, ws, 'live');
  try {
    await new Promise((r) => setTimeout(r, DISCOVERY_WAIT_MS));
    const providers = await client.listProviders();
    return (providers.providers.find((x) => x.id === 'vllm')?.models ?? {}) as Record<string, { limit?: { context?: number } }>;
  } finally {
    client.dispose();
    await host.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

(async () => {
  const server = await fakeVllm();
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  let failed = 0;
  try {
    const raw = await modelsAfterDiscovery(baseURL, 'vllm');
    const takenOver = raw[DECLARED]?.limit?.context !== 32768;
    console.log(
      `${takenOver ? 'PASS' : 'NOTE'}  raw "vllm" id: the plugin overrides the declared limit ${JSON.stringify(raw[DECLARED]?.limit)} (the takeover this guards against)`,
    );
    const mapped = await modelsAfterDiscovery(baseURL, toEngineProviderID('vllm'));
    const ok = mapped[DECLARED]?.limit?.context === 32768 && mapped[DECLARED]?.limit?.output === 4096;
    console.log(`${ok ? 'PASS' : 'FAIL'}  mapped id keeps the declared limit ${JSON.stringify(mapped[DECLARED]?.limit)}, reported back as "vllm"`);
    failed += ok ? 0 : 1;
  } finally {
    server.close();
  }
  process.exitCode = failed ? 1 : 0;
})();
