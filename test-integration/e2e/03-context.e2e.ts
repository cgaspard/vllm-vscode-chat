// Context: the open file rides along (and can be excluded), pasted images are
// attached to the message.
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { ask, freshChat, h, turn, send, until, ws } from './lib';

async function openFile(rel: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(ws(rel)));
  await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false, viewColumn: vscode.ViewColumn.Beside });
  await new Promise((r) => setTimeout(r, 800));
}

/**
 * Close every text editor tab but keep the chat panel. (A "close other groups"
 * command is relative to the active group, which is the file's after
 * showTextDocument — it would close the panel instead.)
 */
async function closeFileEditors(): Promise<void> {
  const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputText);
  await vscode.window.tabGroups.close(tabs);
  await new Promise((r) => setTimeout(r, 500));
}

describe('e2e · context', function () {
  afterEach(closeFileEditors);

  it('the open file is offered as context and attached to the next message', async () => {
    await freshChat();
    await openFile('src/app.txt');
    await until(async () => /app\.txt/.test(String(await h.text('#ctxfile-name'))), 10_000, 'the open-file pill');
    if (!/\bactive\b/.test(String(await h.attr('#ctxfile', 'class')))) {
      await h.click('#ctxfile'); // include it
    }
    const reply = await ask('What is the codeword in the attached file? Do not use any tools.');
    assert.match(reply, /BANANA-17/);
    assert.ok((await h.count('.msg.user .file-chip')) > 0, 'the user bubble shows the attached file');
  });

  it('closing the file drops it from context', async () => {
    await freshChat();
    await openFile('src/app.txt');
    await until(async () => !/hidden/.test(String(await h.attr('#ctxfile', 'class'))), 10_000, 'the open-file pill');
    await closeFileEditors();
    await until(async () => /hidden/.test(String(await h.attr('#ctxfile', 'class'))), 10_000, 'the pill to go');
  });

  it('a pasted image is attached and shown in the conversation', async () => {
    await freshChat();
    const png = fs.readFileSync(ws('red.png')).toString('base64');
    const pending = await h.addImage(`data:image/png;base64,${png}`, 'red.png');
    assert.strictEqual(pending, 1, 'the image is pending as a thumbnail');
    assert.strictEqual(await h.count('#thumbs .thumb'), 1);
    await send('I attached an image. Reply with exactly: IMAGE-RECEIVED');
    await turn();
    assert.strictEqual(await h.count('#thumbs .thumb'), 0, 'the thumbnail left the composer');
    await until(async () => (await h.count('.msg.user .msg-img')) > 0, 10_000, 'the image in the user bubble');
    assert.strictEqual(await h.count('.error-bubble'), 0, `no error (${(await h.allText('.error-bubble')).join(' | ')})`);
  });
});
