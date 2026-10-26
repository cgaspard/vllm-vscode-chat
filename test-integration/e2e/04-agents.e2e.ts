// Agents defined in the workspace (.opencode/agents) are available to the
// model: it can delegate to a subagent.
import * as assert from 'node:assert';
import { ask, freshChat, h } from './lib';

describe('e2e · agents', function () {
  it('the model can delegate to a workspace subagent', async () => {
    await freshChat();
    await ask('Use the subagent tool to delegate to the "reviewer" agent: ask it to review src/app.txt. Then tell me what it said.', 600_000);
    // The delegation runs as the `task` tool; its card carries the subagent's report.
    const names = await h.allText('.msg.assistant .part-tool .tool-name');
    const i = names.indexOf('task');
    assert.ok(i >= 0, `a delegation card (cards: ${names.join(', ')})`);
    assert.match(String((await h.classes('.msg.assistant .part-tool .tool-card'))[i]), /status-completed/, 'the subagent finished');
    assert.match(String((await h.allText('.msg.assistant .part-tool'))[i]), /<subagent[^>]*state="completed"/, 'the card holds the subagent report');
  });
});
