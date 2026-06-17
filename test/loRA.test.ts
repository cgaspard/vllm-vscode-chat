import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBody, unloadBody } from '../src/core/loRABodies';

test('loadBody builds the vLLM load_lora_adapter payload', () => {
  assert.deepEqual(loadBody({ loraName: 'sql', loraPath: 'org/sql-adapter' }), {
    lora_name: 'sql',
    lora_path: 'org/sql-adapter',
  });
});

test('loadBody trims and requires both name and path', () => {
  assert.deepEqual(loadBody({ loraName: '  sql  ', loraPath: '  /p  ' }), {
    lora_name: 'sql',
    lora_path: '/p',
  });
  assert.throws(() => loadBody({ loraName: '', loraPath: '/p' }), /both required/);
  assert.throws(() => loadBody({ loraName: 'sql', loraPath: '' }), /both required/);
});

test('unloadBody builds the unload payload and requires a name', () => {
  assert.deepEqual(unloadBody('sql'), { lora_name: 'sql' });
  assert.deepEqual(unloadBody('  sql  '), { lora_name: 'sql' });
  assert.throws(() => unloadBody(''), /name is required/);
});
