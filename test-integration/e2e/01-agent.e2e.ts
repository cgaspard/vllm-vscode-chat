// The agent: real tools with cards, edits, plan mode, streaming markdown,
// reasoning blocks and the Thinking toggle, and the context meter.
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FakeThinker, THINKER_MODEL } from './fakeThinker';
import { ask, busy, freshChat, h, read, restoreServer, send, until, useServer, ws } from './lib';

describe('e2e · the agent', function () {
  it('answers a prompt typed into the panel', async () => {
    await freshChat();
    assert.match(await ask('Reply with exactly: HELLO-VLLM'), /HELLO-VLLM/);
    assert.match((await h.allText('.msg.user')).join(' '), /HELLO-VLLM/, 'the user bubble shows what was sent');
  });

  it('reads a file with a tool and answers from it', async () => {
    await freshChat();
    const reply = await ask('Use the read tool on src/app.txt and tell me the codeword it contains.');
    assert.match(reply, /BANANA-17/);
    const titles = await h.allText('.msg.assistant .part-tool .tool-title');
    assert.ok(titles.some((t) => /app\.txt/.test(t)), `a tool card names the file (cards: ${titles.join(' | ')})`);
    assert.ok((await h.count('.part-tool .tool-card.status-completed')) > 0, 'the tool card rendered as completed');
  });

  it('edits a file and its card expands to the result', async () => {
    await freshChat();
    await ask('Use the edit tool to change "version = v1" to "version = v2" in src/app.txt. Change nothing else.');
    assert.match(read('src', 'app.txt'), /version = v2/);
    assert.match(read('src', 'app.txt'), /codeword = BANANA-17/, 'the rest of the file is intact');
    const names = await h.allText('.msg.assistant .part-tool .tool-name');
    const edit = names.lastIndexOf('edit');
    assert.ok(edit >= 0, `an edit card (cards: ${names.join(', ')})`);
    await h.click('.msg.assistant .part-tool .tool-head', edit);
    assert.doesNotMatch(String((await h.classes('.msg.assistant .part-tool .tool-card'))[edit]), /collapsed/, 'the card expanded');
    const body = (await h.allText('.msg.assistant .part-tool .tool-body'))[edit];
    assert.match(String(body), /app\.txt/, `the expanded card names the edited file (${body})`);
  });

  it('plan mode stays read-only', async () => {
    await freshChat({ agent: 'plan' });
    // v2's plan agent may write plan notes to ~/.opencode/plan, which is outside
    // the workspace and so asks first: deny those (a test must not write into
    // the real home directory) and let the turn finish.
    await send('Create a file named plan-should-not-write.txt containing hello.');
    await until(busy, 30_000, 'the turn to start').catch(() => undefined);
    const asked: string[] = [];
    await until(
      async () => {
        if ((await h.count('.perm-card:not(.resolved)')) > 0) {
          asked.push(String(await h.text('.perm-card:not(.resolved) .perm-detail')));
          await h.click('.perm-card:not(.resolved) .perm-btn.reject');
        }
        return !(await busy());
      },
      240_000,
      'the turn to end',
    );
    assert.ok(!fs.existsSync(ws('plan-should-not-write.txt')), 'the plan agent must not write files');
    assert.ok(
      asked.every((d) => d.includes(path.join('.opencode', 'plan'))),
      `the only writes it may ask for are plan notes (asked: ${asked.join(' | ')})`,
    );
  });

  it('streams markdown with code blocks', async () => {
    await freshChat();
    await ask('Reply with a fenced ```js code block containing exactly: console.log(42)');
    assert.ok((await h.count('.msg.assistant pre code')) > 0, 'a rendered code block');
    assert.match(String(await h.text('.msg.assistant pre code')), /console\.log\(42\)/);
    assert.ok((await h.count('.msg.assistant pre .code-copy')) > 0, 'the block has a Copy button');
  });

  it('a reasoning model shows its thinking, and the Thinking toggle hides it', async () => {
    // A scripted vLLM-shaped server that streams reasoning_content before its
    // answer: proves the whole thinking path without a large reasoning model.
    const fake = new FakeThinker();
    await fake.start();
    const back = String(await h.text('#server-name'));
    const state = await useServer(fake.url, 'E2E thinker');
    try {
      await freshChat({ model: THINKER_MODEL });
      if (/off/.test(String(await h.attr('#btn-think', 'title')))) {
        await h.click('#btn-think');
      }
      const reply = await ask('What is 17 * 23?');
      assert.match(reply, /391/);
      await until(async () => (await h.count('.part-reasoning details.reasoning')) > 0, 10_000, 'the thinking block');
      assert.match(String(await h.text('.part-reasoning')), /17 times 20/, 'the reasoning text streamed into the block');
      await h.click('#btn-think');
      assert.match(String(await h.attr('body', 'class')), /hide-reasoning/, 'Thinking off hides reasoning');
      await h.click('#btn-think');
      assert.doesNotMatch(String(await h.attr('body', 'class')), /hide-reasoning/);
    } finally {
      await restoreServer(state, back);
      await fake.stop();
    }
  });

  it('the context meter switches to real token counts', async () => {
    await freshChat();
    await ask('Count from 1 to 20, separated by spaces.');
    await until(async () => !/^~/.test(String(await h.text('#ctx-meter .ctx-label'))), 10_000, 'exact counts');
    const label = String(await h.text('#ctx-meter .ctx-label'));
    assert.match(label, /^\d+(\.\d+)?K? \/ \d+K context · \d+%/, label);
    const meter = String(await h.attr('#ctx-meter .ctx-fill', 'style'));
    assert.match(meter, /width:\s*[0-9.]+%/, `the context meter moved (${meter})`);
  });
});
