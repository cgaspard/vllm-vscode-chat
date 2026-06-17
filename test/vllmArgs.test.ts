import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildServeArgs,
  serveBaseUrl,
  validateServeConfig,
  VllmServeConfig,
} from '../src/core/vllmArgs';

const base: VllmServeConfig = { model: 'org/Model', port: 8000 };

test('buildServeArgs emits model, host, and port with sensible defaults', () => {
  assert.deepEqual(buildServeArgs(base), [
    'serve',
    'org/Model',
    '--host',
    '127.0.0.1',
    '--port',
    '8000',
  ]);
});

test('buildServeArgs omits optional flags when unset (vLLM uses its own defaults)', () => {
  const args = buildServeArgs(base);
  assert.ok(!args.includes('--max-model-len'));
  assert.ok(!args.includes('--gpu-memory-utilization'));
  assert.ok(!args.includes('--dtype'));
  assert.ok(!args.includes('--enable-lora'));
  assert.ok(!args.includes('--api-key'));
});

test('buildServeArgs includes every provided option in a stable order', () => {
  const args = buildServeArgs({
    model: 'org/Model',
    host: '0.0.0.0',
    port: 8001,
    maxModelLen: 16384,
    gpuMemoryUtilization: 0.85,
    dtype: 'bfloat16',
    quantization: 'awq',
    tensorParallelSize: 2,
    enableLora: true,
    apiKey: 'secret',
    extraArgs: ['--trust-remote-code'],
  });
  assert.deepEqual(args, [
    'serve',
    'org/Model',
    '--host',
    '0.0.0.0',
    '--port',
    '8001',
    '--max-model-len',
    '16384',
    '--gpu-memory-utilization',
    '0.85',
    '--dtype',
    'bfloat16',
    '--quantization',
    'awq',
    '--tensor-parallel-size',
    '2',
    '--enable-lora',
    '--api-key',
    'secret',
    '--trust-remote-code',
  ]);
});

test('buildServeArgs trims the model and drops blank extra args', () => {
  const args = buildServeArgs({ model: '  org/Model  ', port: 8000, extraArgs: ['', '  ', '--x'] });
  assert.equal(args[1], 'org/Model');
  assert.ok(args.includes('--x'));
  assert.equal(args.filter((a) => a === '').length, 0);
});

test('buildServeArgs throws on an invalid config', () => {
  assert.throws(() => buildServeArgs({ model: '', port: 8000 }), /Model is required/);
  assert.throws(() => buildServeArgs({ model: 'm', port: 0 }), /Port must be/);
  assert.throws(() => buildServeArgs({ model: 'm', port: 99999 }), /Port must be/);
});

test('validateServeConfig flags out-of-range numeric options', () => {
  assert.deepEqual(validateServeConfig(base), []);
  assert.match(validateServeConfig({ ...base, gpuMemoryUtilization: 1.5 })[0], /GPU memory/);
  assert.match(validateServeConfig({ ...base, gpuMemoryUtilization: 0 })[0], /GPU memory/);
  assert.match(validateServeConfig({ ...base, maxModelLen: -1 })[0], /Max model length/);
  assert.match(validateServeConfig({ ...base, dtype: 'nope' })[0], /dtype/);
  assert.match(validateServeConfig({ ...base, tensorParallelSize: 0 })[0], /Tensor parallel/);
});

test('serveBaseUrl derives the OpenAI-compatible /v1 endpoint', () => {
  assert.equal(serveBaseUrl({ port: 8000 }), 'http://127.0.0.1:8000/v1');
  assert.equal(serveBaseUrl({ host: '0.0.0.0', port: 8001 }), 'http://0.0.0.0:8001/v1');
});
