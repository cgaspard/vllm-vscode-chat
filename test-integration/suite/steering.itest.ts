// Steering UI: messages sent while the agent works wait in a pending strip above
// the composer — badged Steering or Queued — until the agent picks them up, and
// can be switched between the two or cancelled. Driven through the live webview
// with the same inbox.* events the host relays from OpenCode.
import * as assert from 'node:assert';
import * as helpers from './helpers';

const { openPanel, post, count, text, attr, click, waitFor, posted, keydown, setInput, readyInit } = helpers;
const ev = (type: string, properties: Record<string, unknown>) => post({ type: 'event', event: { type, properties } } as never);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('steering: pending strip', function () {
  this.timeout(30000);

  before(async () => {
    await openPanel();
    await post({ type: 'inbox', items: [] });
  });

  after(async () => {
    await post({ type: 'inbox', items: [] });
    await post({ type: 'busy', busy: false });
  });

  it('tells you how to steer while the agent works', async () => {
    await post({ type: 'busy', busy: true });
    assert.match(String(await attr('#input', 'placeholder')), /Enter to steer.*Alt\+Enter to queue/);
    await post({ type: 'busy', busy: false });
    assert.doesNotMatch(String(await attr('#input', 'placeholder')), /steer/i);
  });

  it('shows a steered message until the agent picks it up', async () => {
    await ev('inbox.enqueued', { inboxID: 'in1', text: 'also update the README', delivery: 'steer', files: 0 });
    await waitFor('.inbox-item', (n) => n === 1);
    assert.strictEqual(await text('.inbox-item .inbox-badge'), 'Steering');
    assert.match(String(await text('.inbox-item .inbox-text')), /also update the README/);
    assert.strictEqual(await text('.inbox-item .inbox-toggle'), 'Queue instead');
  });

  it('asks the host to queue it instead, and reflects the change', async () => {
    assert.ok(await click('.inbox-item .inbox-toggle'));
    const sent = (await posted('inboxSetDelivery')).at(-1);
    assert.deepStrictEqual(sent, { type: 'inboxSetDelivery', inboxID: 'in1', delivery: 'queue' });
    await ev('inbox.changed', { inboxID: 'in1', delivery: 'queue' });
    await waitFor('.inbox-item.queue', (n) => n === 1);
    assert.strictEqual(await text('.inbox-item .inbox-badge'), 'Queued');
    assert.strictEqual(await text('.inbox-item .inbox-toggle'), 'Steer now');
  });

  it('lists several pending messages and cancels one', async () => {
    await ev('inbox.enqueued', { inboxID: 'in2', text: 'then run the tests', delivery: 'queue', files: 2 });
    await waitFor('.inbox-item', (n) => n === 2);
    assert.match(String(await helpers.allText('.inbox-files')), /\+2 attachments/);
    assert.ok(await click('.inbox-item .inbox-cancel'));
    const sent = (await posted('inboxCancel')).at(-1);
    assert.deepStrictEqual(sent, { type: 'inboxCancel', inboxID: 'in1' });
    await ev('inbox.cancelled', { inboxID: 'in1' });
    await waitFor('.inbox-item', (n) => n === 1);
  });

  it('clears the strip once the agent has everything', async () => {
    await ev('inbox.delivered', { inboxID: 'in2' });
    await waitFor('.inbox-item', (n) => n === 0);
    assert.match(String(await attr('#inbox-strip', 'class')), /hidden/);
  });

  it('does not flash a message that is delivered immediately', async () => {
    await ev('inbox.enqueued', { inboxID: 'fast', text: 'hi', delivery: 'steer', files: 0 });
    await ev('inbox.delivered', { inboxID: 'fast' });
    await sleep(400);
    assert.strictEqual(await count('.inbox-item'), 0);
  });

  it('restores a session’s pending messages when it is shown', async () => {
    await post({ type: 'inbox', items: [{ inboxID: 'r1', text: 'restored', delivery: 'queue', files: 0 }] });
    await waitFor('.inbox-item', (n) => n === 1);
    await post({ type: 'inbox', items: [] });
    await waitFor('.inbox-item', (n) => n === 0);
  });

  it('a new chat clears the strip', async () => {
    await post({ type: 'inbox', items: [{ inboxID: 'c1', text: 'left over', delivery: 'steer', files: 0 }] });
    await waitFor('.inbox-item', (n) => n === 1);
    await post({ type: 'cleared' });
    await waitFor('.inbox-item', (n) => n === 0);
  });

  it('Enter steers and Alt+Enter queues while the agent works', async () => {
    // A ready, connected panel, so onSend goes all the way to posting `send`.
    await post(readyInit());
    await post({ type: 'busy', busy: true });
    const before = (await posted('send')).length;
    await setInput('steer this');
    assert.ok(await keydown('Enter'));
    await setInput('queue this');
    assert.ok(await keydown('Enter', { altKey: true }));
    const sends = (await posted('send')).slice(before);
    await post({ type: 'busy', busy: false });
    assert.deepStrictEqual(
      sends.map((m) => [m.text, m.delivery]),
      [
        ['steer this', 'steer'],
        ['queue this', 'queue'],
      ],
    );
  });

  it('Enter on an empty composer does nothing while busy, and the button still stops', async () => {
    await sleep(1500); // the host answers the sends above with an error + busy:false
    await post({ type: 'busy', busy: true });
    const sendsBefore = (await posted('send')).length;
    const abortsBefore = (await posted('abort')).length;
    await setInput('');
    await keydown('Enter');
    assert.strictEqual((await posted('send')).length, sendsBefore, 'nothing sent');
    assert.ok(await click('#send'));
    assert.strictEqual((await posted('abort')).length, abortsBefore + 1, 'the send button is the stop button while busy');
    await post({ type: 'busy', busy: false });
  });

  it('an agent step starting shows the panel as working (a queued run after idle)', async () => {
    await sleep(1500);
    await post({ type: 'busy', busy: false });
    await ev('message.updated', { info: { id: 'm-queued', sessionID: 's', role: 'assistant', time: { created: Date.now() } } });
    assert.match(String(await attr('#send', 'class')), /busy/);
    await ev('session.idle', { sessionID: 's' });
    assert.doesNotMatch(String(await attr('#send', 'class')), /busy/);
  });

  it('shows provider retries instead of a silent stall', async () => {
    await post({ type: 'busy', busy: true });
    await ev('session.retry', { attempt: 2, message: 'Model unloaded.' });
    let label = '';
    for (let i = 0; i < 20 && !/Retrying/.test(label); i++) {
      label = String(await text('#working .working-label'));
      await sleep(100);
    }
    assert.match(label, /Retrying \(attempt 2\).*Model unloaded/);
    await post({ type: 'busy', busy: false });
  });
});
