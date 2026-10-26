// Approvals: the agent asks before reading a .env file and before leaving the
// workspace; Allow once and Deny reach the agent.
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { freshChat, h, send, turn, until } from './lib';

/** Approval cards still waiting for an answer (answered ones stay, marked resolved). */
const card = () => h.count('.perm-card:not(.resolved)');

describe('e2e · permissions', function () {
  const outside = path.join(os.tmpdir(), `vllm-e2e-outside-${process.pid}.txt`);

  before(() => fs.writeFileSync(outside, 'OUTSIDE-TOKEN-55\n'));
  after(() => fs.rmSync(outside, { force: true }));

  it('asks before reading a .env file, and Allow once lets it through', async () => {
    await freshChat();
    await send('Use the read tool to read the .env file in the workspace root and tell me the value of E2E_SECRET.');
    await until(async () => (await card()) > 0, 180_000, 'the approval card');
    await h.click('.perm-card:not(.resolved) .perm-btn.allow-once');
    await turn();
    assert.match((await h.allText('.msg.assistant .part-text')).join(' '), /do-not-read-me/);
  });

  it('asks before reading outside the workspace, and Deny stops it', async () => {
    await freshChat();
    await send(`Use the read tool to read ${outside} and tell me the token in it.`);
    await until(async () => (await card()) > 0, 180_000, 'the approval card');
    await h.click('.perm-card:not(.resolved) .perm-btn.reject');
    await turn();
    assert.doesNotMatch((await h.allText('.msg.assistant .part-text')).join(' '), /OUTSIDE-TOKEN-55/, 'denied content never reached the model');
  });

  it('an ordinary workspace read runs without asking', async () => {
    await freshChat();
    await send('Use the read tool to read src/app.txt and tell me the codeword.');
    await turn();
    assert.strictEqual(await h.count('.perm-card'), 0, 'no approval card for a workspace read');
    assert.match((await h.allText('.msg.assistant .part-text')).join(' '), /BANANA-17/);
  });
});
