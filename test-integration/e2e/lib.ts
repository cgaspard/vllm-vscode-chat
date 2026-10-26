// Shared steps for the e2e suite: connect the panel to a real model server,
// start fresh chats, type and send, and read what came back.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import * as h from '../suite/helpers';

// vLLM speaks the OpenAI-compatible /v1 API; any server that does can stand in
// for it (default: LM Studio, since vLLM needs a GPU host).
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:1234/v1';
export const MODEL = process.env.E2E_MODEL ?? 'qwen3-vl-30b-a3b-instruct-mlx';
export const REASONING_MODEL = process.env.E2E_REASONING_MODEL ?? 'qwen/qwen3.8-27b';
export const WORKSPACE = process.env.E2E_WORKSPACE ?? '';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const cfg = () => vscode.workspace.getConfiguration('vllmCode');
export const ws = (...p: string[]) => path.join(WORKSPACE, ...p);
export const read = (...p: string[]) => fs.readFileSync(ws(...p), 'utf8');

/** What the model chip and picker call a model (vLLM ids are org/name). */
export const shortName = (model: string) => model.split('/').pop() ?? model;

export async function until(pred: () => Promise<boolean> | boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`timed out after ${ms}ms waiting for ${what}`);
}

/** Point the extension at the model server and open a ready panel. Once per run. */
let connected = false;
export async function connect(): Promise<void> {
  if (connected) {
    return;
  }
  assert(WORKSPACE, 'E2E_WORKSPACE is not set — run via npm run test:e2e');
  await cfg().update('defaultModel', MODEL, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('vllmCode._test.useServer', BASE_URL, 'E2E server');
  await h.openPanel({ quiesce: false });
  await until(async () => String(await h.text('#model-btn .model-btn-label')).startsWith(shortName(MODEL)), 120_000, 'the model chip');
  connected = true;
}

/** Pick a model through the panel's model menu, as a user clicks it. */
export async function pickModel(model: string): Promise<void> {
  if (String(await h.text('#model-btn .model-btn-label')).startsWith(shortName(model))) {
    return;
  }
  await h.click('#model-btn');
  await until(async () => (await h.count('#model-menu .model-row')) > 0, 15_000, 'the model menu');
  const names = await h.allText('#model-menu .model-row .model-name');
  const i = names.findIndex((n) => n === shortName(model));
  assert(i >= 0, `${model} is in the model menu (${names.join(', ')})`);
  await h.click('#model-menu .model-row', i);
  await until(async () => String(await h.text('#model-btn .model-btn-label')).startsWith(shortName(model)), 5_000, 'the chip to follow');
}

/** A clean conversation on `model` (default MODEL) with `agent` (default build). */
export async function freshChat(opts: { model?: string; agent?: 'build' | 'plan' } = {}): Promise<void> {
  await connect();
  await until(async () => !(await busy()), 120_000, 'the previous turn to settle');
  // The editor-tab panel has no New chat button of its own (the toolbar
  // command targets the sidebar view); this is the message that command sends.
  await h.postToHost({ type: 'newChat' });
  await until(async () => (await h.count('.msg, .error-bubble, .perm-card, .question-card')) === 0, 15_000, 'the conversation to clear');
  await pickModel(opts.model ?? MODEL);
  await h.setSelect('#agent-select', opts.agent ?? 'build');
  await sleep(300);
}

export async function busy(): Promise<boolean> {
  return /\bbusy\b/.test(String(await h.attr('#send', 'class')));
}

/** Type `text` into the composer and press Enter (Alt+Enter with `queue`). */
export async function send(text: string, opts: { queue?: boolean } = {}): Promise<void> {
  await h.setInput(text);
  await h.keydown('Enter', { altKey: !!opts.queue });
}

/** Wait for the panel to start and then finish a turn. */
export async function turn(ms = 240_000): Promise<void> {
  await until(busy, 30_000, 'the turn to start').catch(() => undefined); // a fast turn may already be over
  await until(async () => !(await busy()), ms, 'the turn to end');
}

/** Send and wait for the reply. */
export async function ask(text: string, ms = 240_000): Promise<string> {
  const before = await assistantText();
  await send(text);
  await turn(ms);
  const reply = (await assistantText()).slice(before.length);
  if (!reply.trim()) {
    console.log(`      [diag] empty reply to: ${text.slice(0, 60)}\n${await panelState()}`);
  }
  return reply;
}

/** What the panel shows right now, for failure diagnostics. */
export async function panelState(): Promise<string> {
  const lines = [
    `working: ${await h.text('#working .working-label')} (${await h.attr('#working', 'class')})`,
    `status: ${await h.text('#status')}`,
    `model chip: ${await h.text('#model-btn .model-btn-label')}`,
    `input: ${await h.attr('#input', 'value')}`,
    `messages: ${(await h.allText('.msg')).map((t) => t.slice(0, 160)).join(' || ')}`,
    `errors: ${(await h.allText('.error-bubble')).join(' || ')}`,
    `cards: ${(await h.allText('.perm-card, .question-card')).map((t) => t.slice(0, 80)).join(' || ')}`,
    `banner: ${await h.text('#conn-banner')}`,
    `server: ${await h.text('#server-name')} (menu ${await h.attr('#server-menu', 'class')})`,
    `last posted: ${(await h.posted()).slice(-8).map((m) => JSON.stringify(m).slice(0, 90)).join(' ')}`,
  ];
  return lines.map((l) => `        ${l}`).join('\n');
}

export async function assistantText(): Promise<string> {
  return (await h.allText('.msg.assistant .part-text')).join('\n');
}

export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    throw new Error(message);
  }
}

export { h };
