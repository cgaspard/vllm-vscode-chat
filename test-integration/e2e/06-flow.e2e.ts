// Turn control: steer, queue, cancel a pending message, stop, and answer the
// agent's questions.
import * as assert from 'node:assert';
import { assistantText, ask, busy, freshChat, h, send, turn, until } from './lib';

describe('e2e · steering, stopping, questions', function () {
  it('a message sent mid-turn steers the running task', async () => {
    await freshChat();
    // Steering lands at the agent's next step, so the task must take several
    // steps that cannot be batched: each file names the next one (steps/1..5,
    // with a short sleep between), ten tool calls in all. A small model would
    // batch "five sleeps" into one step, leaving no boundary for a steer.
    await send('Use the read tool on steps/1.txt and do what it says.');
    await until(async () => (await h.count('.msg.assistant .part-tool')) > 0, 240_000, 'the first tool call');
    await send('Stop. Run no more commands and read no more files. Reply with exactly: STEERED-OK');
    await until(async () => /STEERED-OK/.test(await assistantText()), 240_000, 'the steer to take effect');
    await turn();
    const tools = await h.count('.msg.assistant .part-tool');
    assert.ok(tools < 10, `the steer cut the task short (${tools} of 10 tool calls)`);
    assert.doesNotMatch(await assistantText(), /ALL-FIVE-DONE/);
    assert.ok((await h.count('.msg.user')) >= 2, 'the steered message is in the transcript');
  });

  it('Alt+Enter queues a message for after the turn', async () => {
    await freshChat();
    await send('Count from 1 to 30, one number per line.');
    await until(busy, 60_000, 'the turn to start');
    await send('Then reply with exactly: QUEUED-RAN', { queue: true });
    await until(async () => /QUEUED-RAN/.test(await assistantText()), 300_000, 'the queued message to run');
    await turn();
    assert.strictEqual(await h.count('.inbox-item'), 0);
  });

  it('a queued message can be cancelled from the pending strip', async () => {
    await freshChat();
    await send('Count from 1 to 60, one number per line.');
    await until(busy, 60_000, 'the turn to start');
    await send('Reply with exactly: SHOULD-NOT-RUN', { queue: true });
    await until(async () => (await h.count('.inbox-item.queue')) === 1, 30_000, 'the queued message in the strip');
    await h.click('.inbox-item .inbox-cancel');
    await until(async () => (await h.count('.inbox-item')) === 0, 15_000, 'the strip to clear');
    await turn(300_000);
    await new Promise((r) => setTimeout(r, 3000));
    assert.ok(!(await busy()), 'nothing else ran');
    assert.doesNotMatch(await assistantText(), /SHOULD-NOT-RUN/, 'the cancelled message never reached the model');
    assert.strictEqual(await h.count('.msg.user'), 1, 'only the first message is in the transcript');
  });

  it('the stop button stops a turn', async () => {
    await freshChat();
    await send('Write a 1500-word essay about the history of compilers.');
    await until(async () => (await assistantText()).length > 40, 240_000, 'streaming to begin');
    await h.click('#send'); // the send button is the stop button while busy
    await until(async () => !(await busy()), 60_000, 'the turn to stop');
    const before = (await assistantText()).length;
    await new Promise((r) => setTimeout(r, 2000));
    assert.strictEqual((await assistantText()).length, before, 'nothing streams after the stop');
  });

  it('the agent can ask a question and gets the picked answer', async () => {
    await freshChat();
    await send('Use the question tool to ask me to choose between the options "Red" and "Blue". After I answer, reply with "You chose" followed by my choice.');
    await until(async () => (await h.count('.question-card .question-opt')) > 0, 240_000, 'the question card');
    const opts = await h.allText('.question-card .question-opt');
    const blue = opts.findIndex((o) => /Blue/.test(o));
    assert.ok(blue >= 0, `Blue is offered (${opts.join(', ')})`);
    await h.click('.question-card .question-opt', blue);
    if ((await h.count('.question-card:not(.resolved) .question-submit')) > 0) {
      await h.click('.question-card .question-submit');
    }
    await turn();
    assert.match(await assistantText(), /You chose.*Blue/i);
  });

  it('answers keep flowing after all of that', async () => {
    await freshChat();
    assert.match(await ask('Reply with exactly: STILL-OK'), /STILL-OK/);
  });
});
