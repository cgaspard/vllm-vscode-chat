import assert from 'node:assert/strict';
import { test } from 'node:test';
import { opencodePermission } from '../src/core/permission';

test('the question picker never sits behind an approval gate', () => {
  assert.equal(opencodePermission().question, 'allow');
});

test('leaving the workspace asks first, as it did under OpenCode 1.x', () => {
  // OpenCode 2 allows external_directory by default; the panel keeps the 1.x promise.
  assert.equal(opencodePermission().external_directory, 'ask');
});

test('nothing is denied outright (a deny would remove tools from the model)', () => {
  assert.ok(!Object.values(opencodePermission()).includes('deny' as never));
});
