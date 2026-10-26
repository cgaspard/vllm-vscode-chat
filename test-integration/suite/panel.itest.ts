// The vLLM panel's own UI, driven through the live webview with injected host
// messages and 1.x-shaped events (what the v2 translator emits): the model
// picker with LoRA adapters, the offline banner, tool / approval / question
// cards and the history overlay.
import * as assert from 'node:assert';
import * as helpers from './helpers';

const { openPanel, post, count, text, allText, attr, click, waitFor, posted, readyInit, vllmModel } = helpers;
const ev = (type: string, properties: Record<string, unknown>) => post({ type: 'event', event: { type, properties } } as never);

describe('panel: vLLM UI', function () {
  this.timeout(30000);

  before(async () => {
    await openPanel();
  });

  afterEach(async () => {
    await post({ type: 'cleared' });
    await post({ type: 'busy', busy: false });
  });

  it('the model chip and picker show served models and LoRA adapters', async () => {
    const models = [
      vllmModel({ id: 'meta-llama/Llama-3.2-3B-Instruct', name: 'Llama-3.2-3B-Instruct', maxContextLength: 32768 }),
      vllmModel({ id: 'sql-lora', name: 'sql-lora', isLora: true, parent: 'meta-llama/Llama-3.2-3B-Instruct' }),
    ];
    await post(readyInit({ models, currentModel: models[0].id }));
    assert.match(String(await text('#model-btn .model-btn-label')), /Llama-3\.2-3B-Instruct · 32K/);
    assert.ok(await click('#model-btn'));
    await waitFor('#model-menu .model-row', (n) => n === 2);
    const rows = await allText('#model-menu .model-row');
    assert.match(rows[1], /adapter · meta-llama\/Llama-3\.2-3B-Instruct/);
    assert.ok(await click('#model-menu .model-row', 1));
    assert.deepStrictEqual((await posted('selectModel')).at(-1), { type: 'selectModel', modelID: 'sql-lora' });
    assert.match(String(await attr('#model-menu', 'class')), /hidden/);
  });

  it('an unreachable server shows the banner, with Retry', async () => {
    await post({ type: 'servers', servers: [{ id: 'a', name: 'GPU box', url: 'http://10.0.0.5:8000/v1' }], activeId: 'a', connected: false });
    assert.doesNotMatch(String(await attr('#conn-banner', 'class')), /hidden/);
    assert.match(String(await text('#conn-banner')), /10\.0\.0\.5:8000/);
    assert.ok(await click('#conn-retry'));
    assert.ok((await posted('retryConnect')).length > 0);
    await post({ type: 'servers', servers: [{ id: 'a', name: 'GPU box', url: 'http://10.0.0.5:8000/v1' }], activeId: 'a', connected: true });
    assert.match(String(await attr('#conn-banner', 'class')), /hidden/);
  });

  it('a tool call renders as a card that expands to its output', async () => {
    await post(readyInit());
    await ev('message.updated', { info: { id: 'm1', sessionID: 's', role: 'assistant', time: { created: 1 } } });
    await ev('message.part.updated', {
      part: { id: 'm1:tool:c1', sessionID: 's', messageID: 'm1', type: 'tool', tool: 'read', callID: 'c1', state: { status: 'completed', input: { filePath: 'src/app.txt' }, output: 'codeword = BANANA-17' } },
    });
    await waitFor('.part-tool .tool-card.status-completed', (n) => n === 1);
    assert.match(String(await text('.part-tool .tool-title')), /src\/app\.txt/);
    assert.match(String(await attr('.part-tool .tool-card', 'class')), /collapsed/);
    assert.ok(await click('.part-tool .tool-head'));
    assert.doesNotMatch(String(await attr('.part-tool .tool-card', 'class')), /collapsed/);
    assert.match(String(await text('.part-tool .tool-output')), /BANANA-17/);
  });

  it('an approval card replies with the chosen answer', async () => {
    await ev('permission.asked', { id: 'p1', sessionID: 's', permission: 'read', patterns: ['/tmp/x'], metadata: { filePath: '/tmp/x' } });
    await waitFor('.perm-card', (n) => n === 1);
    assert.match(String(await text('.perm-card .perm-head')), /read/);
    assert.ok(await click('.perm-card .perm-btn.allow-once'));
    assert.deepStrictEqual((await posted('permission')).at(-1), { type: 'permission', sessionID: 's', permissionID: 'p1', response: 'once' });
    assert.match(String(await attr('.perm-card', 'class')), /resolved/);
  });

  it('a question card replies with the picked option', async () => {
    await ev('question.asked', {
      id: 'q1',
      sessionID: 's',
      questions: [{ question: 'Which color?', header: 'Color', options: [{ label: 'Red', description: '' }, { label: 'Blue', description: '' }], multiple: false, custom: false }],
    });
    await waitFor('.question-card .question-opt', (n) => n === 2);
    assert.ok(await click('.question-card .question-opt', 1));
    assert.ok(await click('.question-card .question-submit'));
    assert.deepStrictEqual((await posted('questionReply')).at(-1), { type: 'questionReply', requestID: 'q1', answers: [['Blue']] });
  });

  it('a stop surfaces as an error bubble and ends the turn', async () => {
    await post({ type: 'busy', busy: true });
    await ev('session.error', { sessionID: 's', error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } });
    await waitFor('.error-bubble', (n) => n === 1);
    assert.doesNotMatch(String(await attr('#send', 'class')), /busy/);
  });

  it('the history overlay lists, opens and deletes sessions', async () => {
    await post({ type: 'command', command: 'history' });
    await post({
      type: 'sessions',
      sessions: [
        { id: 's1', title: 'First chat', updated: Date.now() },
        { id: 's2', title: 'Second chat', updated: Date.now() - 120000 },
      ],
      currentSessionID: 's1',
    });
    await waitFor('.history-row', (n) => n === 2);
    assert.deepStrictEqual(await allText('.history-row .history-title'), ['First chat', 'Second chat']);
    assert.ok(await click('.history-row .history-del', 1));
    assert.deepStrictEqual((await posted('deleteSession')).at(-1), { type: 'deleteSession', sessionID: 's2' });
    assert.ok(await click('.history-row .history-open', 0));
    assert.deepStrictEqual((await posted('loadSession')).at(-1), { type: 'loadSession', sessionID: 's1' });
    assert.match(String(await attr('#history-overlay', 'class')), /hidden/);
  });

  it('a loaded session renders its history, one bubble per turn', async () => {
    await post({
      type: 'sessionLoaded',
      sessionID: 's1',
      title: 'First chat',
      messages: [
        { info: { id: 'u1', sessionID: 's1', role: 'user', time: { created: 1 } }, parts: [{ id: 'u1:text', sessionID: 's1', messageID: 'u1', type: 'text', text: 'hello there' }] },
        {
          info: { id: 'a1', sessionID: 's1', role: 'assistant', time: { created: 2, completed: 3 }, tokens: { input: 1948, output: 100, reasoning: 0 } },
          parts: [
            { id: 'a1:text:0', sessionID: 's1', messageID: 'a1', type: 'text', text: 'general kenobi' },
            { id: 'a1:tool:c', sessionID: 's1', messageID: 'a1', type: 'tool', tool: 'bash', callID: 'c', state: { status: 'completed', input: { command: 'ls' }, output: 'x' } },
            { id: 'a1:text:1', sessionID: 's1', messageID: 'a1', type: 'text', text: 'done' },
          ],
        },
      ],
    });
    assert.strictEqual(await count('.msg.user'), 1);
    assert.strictEqual(await count('.msg.assistant'), 1);
    assert.match(String(await text('.msg.assistant')), /general kenobi[\s\S]*done/);
    assert.match(String(await text('#ctx-meter .ctx-label')), /^2K \/ 32K context/);
  });
});
