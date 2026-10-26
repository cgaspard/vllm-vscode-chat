// Sessions and servers: titled history, reopen, delete, several panels at
// once, a server restart, and switching vLLM servers from the server menu.
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { ask, BASE_URL, freshChat, h, sleep, until } from './lib';

async function openHistory(): Promise<string[]> {
  // The editor-tab panel has no history button of its own; this is the message
  // the "Session History" command sends a panel.
  await h.post({ type: 'command', command: 'history' });
  await until(async () => (await h.count('.history-row')) > 0, 15_000, 'the history list');
  await sleep(500); // the host answers loadSessions with the fresh list
  return h.allText('.history-row .history-title');
}

describe('e2e · sessions and servers', function () {
  it('a conversation is listed in history with its title and can be reopened', async () => {
    await freshChat();
    await ask('Remember the word KIWI-31. Reply with OK.');
    await freshChat();
    await ask('Reply with exactly: SECOND-CHAT');
    const titles = await openHistory();
    const first = titles.findIndex((t) => /KIWI|Remember/i.test(t));
    assert.ok(first >= 0, `the first chat is in history (${titles.join(' | ')})`);
    await h.click('.history-row .history-open', first);
    await until(async () => /KIWI-31/.test((await h.allText('.msg.user')).join(' ')), 15_000, 'the old chat to load');
    assert.match(await ask('What word did I ask you to remember? Answer with just the word.'), /KIWI-31/);
  });

  it('a deleted conversation leaves history', async () => {
    await freshChat();
    await ask('Reply with exactly: DELETE-ME-77');
    await freshChat();
    let titles = await openHistory();
    const i = titles.findIndex((t) => /DELETE-ME|Reply with exactly/i.test(t));
    assert.ok(i >= 0, `listed before delete (${titles.join(' | ')})`);
    const before = titles.length;
    await h.click('.history-row .history-del', i);
    await until(async () => (await h.count('.history-row')) === before - 1, 15_000, 'the row to go');
    titles = await h.allText('.history-row .history-title');
    assert.ok(!titles.some((t) => /DELETE-ME/.test(t)));
    await h.click('#history-close');
  });

  it('a second panel works alongside the first, on the same engine', async () => {
    await freshChat();
    await ask('Reply with exactly: FIRST-PANEL');
    await h.openPanel({ quiesce: false }); // a second editor-tab panel; the test hook now drives it
    await until(async () => (await h.count('#model-menu')) === 1, 10_000, 'the second panel');
    await freshChat();
    assert.match(await ask('Reply with exactly: TAB-OK'), /TAB-OK/);
  });

  it('keeps working after "Restart OpenCode Server"', async () => {
    await vscode.commands.executeCommand('vllmCode.restartServer');
    await freshChat();
    assert.match(await ask('Reply with exactly: AFTER-RESTART'), /AFTER-RESTART/);
  });

  it('an unreachable server shows the banner; switching back reconnects', async () => {
    await freshChat();
    await h.click('#server-btn');
    await until(async () => !/hidden/.test(String(await h.attr('#server-menu', 'class'))), 5_000, 'the server menu');
    await h.setValue('#server-add-name', 'Nowhere');
    await h.setValue('#server-add-url', 'http://127.0.0.1:9/v1');
    await h.click('#server-add-btn');
    await until(async () => (await h.allText('#server-menu .model-row .model-name')).some((n) => /Nowhere/.test(n)), 10_000, 'the new server row');
    let names = await h.allText('#server-menu .model-row .model-name');
    await h.click('#server-menu .model-row', names.findIndex((n) => /Nowhere/.test(n)));
    await until(async () => !/hidden/.test(String(await h.attr('#conn-banner', 'class'))), 30_000, 'the offline banner');
    assert.match(String(await h.text('#conn-banner')), /127\.0\.0\.1:9/);

    // Back to the e2e server from the banner's own Servers button.
    await h.click('#conn-servers');
    await until(async () => !/hidden/.test(String(await h.attr('#server-menu', 'class'))), 5_000, 'the server menu');
    names = await h.allText('#server-menu .model-row .model-name');
    const back = names.findIndex((n) => /E2E server/.test(n));
    assert.ok(back >= 0, `the e2e server is listed (${names.join(', ')})`);
    await h.click('#server-menu .model-row', back);
    await until(async () => /hidden/.test(String(await h.attr('#conn-banner', 'class'))), 60_000, 'the banner to clear');
    // Then remove the dead server with its ✕ (it is no longer the active one).
    await h.click('#server-btn');
    await until(async () => !/hidden/.test(String(await h.attr('#server-menu', 'class'))), 5_000, 'the server menu');
    names = await h.allText('#server-menu .model-row .model-name');
    await h.click('#server-menu .model-row .model-action', names.findIndex((n) => /Nowhere/.test(n)));
    await until(async () => !(await h.allText('#server-menu .model-row .model-name')).some((n) => /Nowhere/.test(n)), 10_000, 'the removed server to go');
    await h.click('#server-btn'); // close the menu
    assert.match(String(await h.text('#server-name')), /E2E server/);
    await freshChat();
    assert.match(await ask('Reply with exactly: BACK-ONLINE'), /BACK-ONLINE/);
  });

  it('a server added from the menu is switched to, and chat runs against it', async () => {
    await freshChat();
    await h.click('#server-btn');
    await until(async () => !/hidden/.test(String(await h.attr('#server-menu', 'class'))), 5_000, 'the server menu');
    await h.setValue('#server-add-name', 'Second box');
    await h.setValue('#server-add-url', BASE_URL.replace('127.0.0.1', 'localhost'));
    await h.click('#server-add-btn');
    await until(async () => (await h.allText('#server-menu .model-row .model-name')).some((n) => /Second box/.test(n)), 10_000, 'the new server row');
    const names = await h.allText('#server-menu .model-row .model-name');
    await h.click('#server-menu .model-row', names.findIndex((n) => /Second box/.test(n)));
    await until(async () => /Second box/.test(String(await h.text('#server-name'))), 30_000, 'the switch');
    await until(async () => (await h.count('#model-btn .model-dot.loaded')) === 1, 120_000, 'the new server to connect');
    await freshChat();
    assert.match(await ask('Reply with exactly: SECOND-SERVER-OK'), /SECOND-SERVER-OK/);
  });
});
