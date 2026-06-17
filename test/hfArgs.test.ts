import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDownloadArgs, cacheDirToRepo, hubCacheRoot } from '../src/core/hfArgs';

test('buildDownloadArgs builds the download verb for a repo', () => {
  assert.deepEqual(buildDownloadArgs({ repo: 'org/Model' }), ['download', 'org/Model']);
});

test('buildDownloadArgs appends specific files and a cache dir when given', () => {
  assert.deepEqual(
    buildDownloadArgs({ repo: 'org/Model', files: ['config.json', 'model.safetensors'], cacheDir: '/cache' }),
    ['download', 'org/Model', 'config.json', 'model.safetensors', '--cache-dir', '/cache'],
  );
});

test('buildDownloadArgs trims and ignores blank file entries', () => {
  assert.deepEqual(buildDownloadArgs({ repo: '  org/Model  ', files: ['', '  ', ' a.json '] }), [
    'download',
    'org/Model',
    'a.json',
  ]);
});

test('buildDownloadArgs throws without a repo', () => {
  assert.throws(() => buildDownloadArgs({ repo: '' }), /repo id is required/);
});

test('cacheDirToRepo reverses the HF hub cache naming scheme', () => {
  assert.equal(cacheDirToRepo('models--meta-llama--Llama-3.2-3B-Instruct'), 'meta-llama/Llama-3.2-3B-Instruct');
  assert.equal(cacheDirToRepo('models--gpt2'), 'gpt2');
  assert.equal(cacheDirToRepo('datasets--foo--bar'), null); // not a model entry
  assert.equal(cacheDirToRepo('random-dir'), null);
});

test('hubCacheRoot honors HF_HUB_CACHE > HF_HOME > default', () => {
  assert.equal(hubCacheRoot({ HF_HUB_CACHE: '/explicit' }, '/home/u'), '/explicit');
  assert.equal(hubCacheRoot({ HF_HOME: '/hf' }, '/home/u'), '/hf/hub');
  assert.equal(hubCacheRoot({}, '/home/u'), '/home/u/.cache/huggingface/hub');
});
