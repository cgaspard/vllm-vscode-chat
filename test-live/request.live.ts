// What the embedded engine actually sends to the vLLM server, checked against
// an in-process fake OpenAI-compatible endpoint: deterministic, no model and no
// GPU needed. Covers what a real model can only show indirectly — the panel's
// system text and the agent's tools reach the request, attachments arrive in
// a form the model can read, and the request targets the configured model.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { opencodePermission } from '../src/core/permission';
import { toEngineProviderID } from '../src/core/providerIds';
import { createHost } from '../src/opencode/embedded';
import type { OpencodeEvent } from '../src/opencode/protocol';
import { OpencodeV2Client } from '../src/opencode/v2client';

const MODEL = 'meta-llama/Llama-3.2-3B-Instruct';
const bodies: any[] = [];
let auth: string | undefined;

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: MODEL, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

const server = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    if (req.url?.endsWith('/chat/completions')) {
      bodies.push(JSON.parse(b));
      auth = req.headers.authorization;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(chunk({ role: 'assistant', content: 'ok' }));
      res.write(chunk({}, 'stop'));
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: 'list', data: [] }));
    }
  });
});

const results: boolean[] = [];
function check(name: string, ok: boolean, detail: unknown = ''): void {
  results.push(ok);
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? `  — ${d.slice(0, 220)}` : ''}`);
}

(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-req-'));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-req-ws-'));
  execFileSync('git', ['init', '-q'], { cwd: ws });
  const pid = toEngineProviderID('vllm');
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  // The shape OpencodeServerManager builds (text-only model, optional key).
  const config = {
    enabled_providers: [pid],
    permission: opencodePermission(),
    experimental: { todo: true },
    provider: {
      [pid]: {
        npm: '@ai-sdk/openai-compatible',
        name: 'vLLM',
        options: { baseURL, includeUsage: true, apiKey: 'vllm-secret' },
        models: { [MODEL]: { name: 'Llama', reasoning: true, tool_call: true, modalities: { input: ['text'], output: ['text'] }, limit: { context: 32768, output: 8192 } } },
      },
    },
  };
  const host = await createHost(path.resolve(__dirname, '..'), { root }, JSON.stringify(config));
  const client = new OpencodeV2Client(host, ws, 'live');
  const events: OpencodeEvent[] = [];
  const ac = new AbortController();
  void client.subscribeEvents((e) => events.push(e), ac.signal);
  try {
    const s = await client.createSession('req');
    const png = fs.readFileSync(path.resolve(__dirname, '../test-integration/e2e/workspace/red.png')).toString('base64');
    await client.promptAsync(s.id, {
      model: { providerID: 'vllm', modelID: MODEL },
      agent: 'build',
      system: 'SYSTEM-MARKER-31',
      parts: [
        { type: 'text', text: 'hello' },
        { type: 'file', mime: 'image/png', url: `data:image/png;base64,${png}`, filename: 'red.png' },
        { type: 'file', mime: 'text/plain', url: `file://${ws}/app.txt`, filename: 'src/app.txt', source: { type: 'file', path: `${ws}/app.txt`, text: { value: 'codeword = BANANA-17', start: 0, end: 20 } } } as never,
      ],
    });
    for (let i = 0; i < 200 && !events.some((e) => e.type === 'session.idle' || e.type === 'session.error'); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const req = bodies.find((b) => Array.isArray(b?.messages));
    const msgs = JSON.stringify(req?.messages ?? []);
    const user = JSON.stringify(req?.messages?.filter((m: any) => m.role === 'user') ?? []);
    check('the request reached the vLLM endpoint for the selected model', req?.model === MODEL, req?.model);
    check('the API key is sent as a bearer token', auth === 'Bearer vllm-secret', auth);
    check("the panel's system text is in the request", msgs.includes('SYSTEM-MARKER-31'));
    check('the agent tools are offered', Array.isArray(req?.tools) && req.tools.length > 0, (req?.tools ?? []).map((t: any) => t.function?.name));
    check('usage is requested in the stream (drives the meter)', req?.stream_options?.include_usage === true, req?.stream_options);
    check('the open file arrives as text with where it came from', /Attached file: src\/app\.txt/.test(user) && /BANANA-17/.test(user), user.slice(0, 200));
    check(
      'an image to a text-only model becomes a note the model can relay (as in 1.x)',
      /Cannot read \\"red\.png\\" \(this model does not support image input\)/.test(user),
      user.slice(0, 200),
    );
    const userParts = events.filter((e) => e.type === 'message.part.updated' && (e.properties as any).part?.type === 'file').map((e) => (e.properties as any).part);
    check(
      'the user bubble carries both attachments (image as an image)',
      userParts.some((p) => p.mime === 'image/png' && String(p.url).startsWith('data:image/png')) && userParts.some((p) => p.filename === 'src/app.txt'),
      userParts.map((p) => `${p.filename}:${p.mime}`),
    );
    check('the turn ends idle without an error', events.some((e) => e.type === 'session.idle') && !events.some((e) => e.type === 'session.error'));
  } catch (err) {
    check('unexpected exception', false, String((err as Error)?.stack ?? err));
  } finally {
    ac.abort();
    client.dispose();
    await host.close();
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
})();
