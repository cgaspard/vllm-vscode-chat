import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeServerUrl, vllmRestRoot } from '../src/core/url';

test('normalizeServerUrl falls back to the local default on empty input', () => {
  assert.equal(normalizeServerUrl(''), 'http://127.0.0.1:8000/v1');
  assert.equal(normalizeServerUrl('   '), 'http://127.0.0.1:8000/v1');
  assert.equal(normalizeServerUrl('', 'http://custom:8000/v1'), 'http://custom:8000/v1');
});

test('normalizeServerUrl adds a scheme and a /v1 suffix when missing', () => {
  assert.equal(normalizeServerUrl('192.168.1.50:8000'), 'http://192.168.1.50:8000/v1');
  assert.equal(normalizeServerUrl('http://host:8000'), 'http://host:8000/v1');
  assert.equal(normalizeServerUrl('https://remote-vllm'), 'https://remote-vllm/v1');
});

test('normalizeServerUrl preserves an explicit /vN and strips trailing slashes', () => {
  assert.equal(normalizeServerUrl('http://host:8000/v1'), 'http://host:8000/v1');
  assert.equal(normalizeServerUrl('http://host:8000/v1/'), 'http://host:8000/v1');
  assert.equal(normalizeServerUrl('http://host:8000/v2'), 'http://host:8000/v2');
});

test('vllmRestRoot returns the base without a trailing /vN', () => {
  assert.equal(vllmRestRoot('http://host:8000/v1'), 'http://host:8000');
  assert.equal(vllmRestRoot('http://host:8000'), 'http://host:8000');
  assert.equal(vllmRestRoot(''), '');
});
