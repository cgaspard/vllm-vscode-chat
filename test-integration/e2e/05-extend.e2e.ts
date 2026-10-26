// Extending it: an MCP server from .mcp.json is started and its tool runs;
// skills from .opencode/skills reach the agent.
import * as assert from 'node:assert';
import { ask, freshChat, h } from './lib';

describe('e2e · MCP and skills', function () {
  it('an MCP tool from .mcp.json runs and its result reaches the model', async () => {
    await freshChat();
    const reply = await ask('Call the secret_number tool and tell me the token it returns.');
    assert.match(reply, /MCP-SECRET-4242/);
    const names = (await h.allText('.msg.assistant .part-tool .tool-name')).join(' ');
    assert.match(names, /secret_number/, `an MCP tool card (${names})`);
  });

  it('a project skill can be loaded by the agent', async () => {
    await freshChat();
    const reply = await ask('Use the skill tool to load the "codeword" skill, then tell me in which file the codeword lives according to it.');
    assert.match(reply, /src\/app\.txt|app\.txt/);
    const names = (await h.allText('.msg.assistant .part-tool .tool-name')).join(' ');
    assert.match(names, /skill/, `a skill tool card (${names})`);
  });
});
