import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseModels } from '../src/core/vllmModels';

// A representative vLLM GET /v1/models payload: one base model (with
// max_model_len), plus a loaded LoRA adapter (parent points at the base).
const SAMPLE = [
  { id: 'meta-llama/Llama-3.2-3B-Instruct', object: 'model', max_model_len: 131072, root: 'meta-llama/Llama-3.2-3B-Instruct', parent: null },
  { id: 'my-sql-adapter', object: 'model', parent: 'meta-llama/Llama-3.2-3B-Instruct' },
  { id: 'BAAI/bge-small-en-v1.5', object: 'model', max_model_len: 512 },
];

test('parseModels maps a base model and reads max_model_len', () => {
  const models = parseModels(SAMPLE);
  const base = models.find((m) => m.id === 'meta-llama/Llama-3.2-3B-Instruct');
  assert.ok(base);
  assert.equal(base!.type, 'llm');
  assert.equal(base!.isLora, false);
  assert.equal(base!.maxContextLength, 131072);
  assert.equal(base!.displayName, 'Llama-3.2-3B-Instruct'); // leaf of the repo path
});

test('parseModels flags LoRA adapters with their parent base model', () => {
  const lora = parseModels(SAMPLE).find((m) => m.id === 'my-sql-adapter');
  assert.ok(lora);
  assert.equal(lora!.isLora, true);
  assert.equal(lora!.type, 'lora');
  assert.equal(lora!.parent, 'meta-llama/Llama-3.2-3B-Instruct');
});

test('parseModels filters out embedding models by id heuristic', () => {
  const data = [
    ...SAMPLE,
    { id: 'org/text-embedding-3', object: 'model' },
    { id: 'thenlper/gte-base', object: 'model' },
  ];
  const ids = parseModels(data).map((m) => m.id);
  assert.ok(!ids.includes('BAAI/bge-small-en-v1.5'));
  assert.ok(!ids.includes('org/text-embedding-3'));
  assert.ok(!ids.includes('thenlper/gte-base'));
  // A real chat model is kept.
  assert.ok(ids.includes('meta-llama/Llama-3.2-3B-Instruct'));
});

test('parseModels leaves maxContextLength undefined when the server omits it', () => {
  const models = parseModels([{ id: 'org/NoLen', object: 'model' }]);
  assert.equal(models[0].maxContextLength, undefined);
});

test('parseModels tolerates junk entries (missing/non-string id)', () => {
  const models = parseModels([null, {}, { id: 42 }, { id: 'org/Good' }] as any[]);
  assert.deepEqual(models.map((m) => m.id), ['org/Good']);
});
