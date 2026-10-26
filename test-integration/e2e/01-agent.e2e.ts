// The agent: real tools with cards, edits, plan mode, streaming markdown,
// reasoning blocks and the Thinking toggle, and the context meter.
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import { assistantText, ask, freshChat, h, read, REASONING_MODEL, until, ws } from './lib';

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
    await ask('Create a file named plan-should-not-write.txt containing hello.');
    assert.ok(!fs.existsSync(ws('plan-should-not-write.txt')), 'the plan agent must not write files');
  });

  it('streams markdown with code blocks', async () => {
    await freshChat();
    await ask('Reply with a fenced ```js code block containing exactly: console.log(42)');
    assert.ok((await h.count('.msg.assistant pre code')) > 0, 'a rendered code block');
    assert.match(String(await h.text('.msg.assistant pre code')), /console\.log\(42\)/);
    assert.ok((await h.count('.msg.assistant pre .code-copy')) > 0, 'the block has a Copy button');
  });

  it('a reasoning model shows its thinking, and the Thinking toggle hides it', async () => {
    await freshChat({ model: REASONING_MODEL });
    if (/off/.test(String(await h.attr('#btn-think', 'title')))) {
      await h.click('#btn-think');
    }
    await ask('What is 17 * 23? Think it through, then answer with just the number.', 600_000);
    assert.match(await assistantText(), /391/);
    assert.ok((await h.count('.part-reasoning details.reasoning')) > 0, 'a thinking block rendered');
    await h.click('#btn-think');
    assert.match(String(await h.attr('body', 'class')), /hide-reasoning/, 'Thinking off hides reasoning');
    await h.click('#btn-think');
    assert.doesNotMatch(String(await h.attr('body', 'class')), /hide-reasoning/);
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
