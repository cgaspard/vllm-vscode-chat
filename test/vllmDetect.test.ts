import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DetectProbes, detectTooling, resolveServeCommand } from '../src/core/vllmDetect';

function probes(over: Partial<DetectProbes> & { path?: Record<string, string> } = {}): DetectProbes {
  const onPath = over.path ?? {};
  return {
    exists: over.exists ?? (() => false),
    which: over.which ?? ((cmd) => onPath[cmd] ?? null),
    platform: over.platform ?? 'linux',
    vllmPathOverride: over.vllmPathOverride,
    pythonPathOverride: over.pythonPathOverride,
    hfPathOverride: over.hfPathOverride,
  };
}

test('detectTooling resolves vllm + hf from PATH and reports full capability', () => {
  const r = detectTooling(probes({ path: { vllm: '/usr/bin/vllm', python3: '/usr/bin/python3', hf: '/usr/bin/hf' } }));
  assert.equal(r.vllm, '/usr/bin/vllm');
  assert.equal(r.python, '/usr/bin/python3');
  assert.equal(r.hf, '/usr/bin/hf');
  assert.equal(r.canServeLocally, true);
  assert.equal(r.canDownload, true);
});

test('detectTooling can serve via python -m vllm when no vllm binary exists', () => {
  const r = detectTooling(probes({ path: { python: '/usr/bin/python' } }));
  assert.equal(r.vllm, null);
  assert.equal(r.python, '/usr/bin/python');
  assert.equal(r.canServeLocally, true);
});

test('detectTooling reports client-only when nothing is found (e.g. a Mac/Windows host)', () => {
  const r = detectTooling(probes({ platform: 'win32', path: {} }));
  assert.equal(r.vllm, null);
  assert.equal(r.python, null);
  assert.equal(r.canServeLocally, false);
  assert.equal(r.canDownload, false);
});

test('detectTooling falls back from hf to the legacy huggingface-cli', () => {
  const r = detectTooling(probes({ path: { 'huggingface-cli': '/usr/bin/huggingface-cli' } }));
  assert.equal(r.hf, '/usr/bin/huggingface-cli');
  assert.equal(r.canDownload, true);
});

test('detectTooling honors explicit overrides over PATH', () => {
  const r = detectTooling(
    probes({ path: { vllm: '/usr/bin/vllm' }, vllmPathOverride: '/opt/custom/vllm', hfPathOverride: '/opt/hf' }),
  );
  assert.equal(r.vllm, '/opt/custom/vllm');
  assert.equal(r.hf, '/opt/hf');
});

test('resolveServeCommand prefers the vllm binary, else python -m vllm, else null', () => {
  assert.deepEqual(resolveServeCommand({ vllm: '/usr/bin/vllm', python: null }, ['serve', 'm']), {
    command: '/usr/bin/vllm',
    args: ['serve', 'm'],
  });
  assert.deepEqual(resolveServeCommand({ vllm: null, python: '/usr/bin/python3' }, ['serve', 'm']), {
    command: '/usr/bin/python3',
    args: ['-m', 'vllm', 'serve', 'm'],
  });
  assert.equal(resolveServeCommand({ vllm: null, python: null }, ['serve', 'm']), null);
});
