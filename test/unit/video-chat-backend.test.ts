import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildChatApiBody, parseChatApiAnswer, runVideoChatAI, runVideoChatProcess } from "../../src/video-chat-backend";
import type { VideoChatBackendConfig } from "../../src/video-chat-backend";

const frame = { seconds: 12, png: new Uint8Array([137,80,78,71]) };
const config: VideoChatBackendConfig = { backend: 'openai', model: 'test-model', apiKey: 'test-only', timeoutMs: 1000 };

test("OpenAI and Anthropic receive actual image blocks, not just image filenames", () => {
  const openai = JSON.stringify(buildChatApiBody(config, 'question', [frame]));
  assert.match(openai, /data:image\/png;base64,iVBORw==/);
  const anthropic = JSON.stringify(buildChatApiBody({ ...config, backend: 'anthropic' }, 'question', [frame]));
  assert.match(anthropic, /"media_type":"image\/png"/);
  assert.match(anthropic, /"data":"iVBORw=="/);
  assert.equal(parseChatApiAnswer('openai', { choices: [{ message: { content: 'answer' } }] }), 'answer');
  assert.equal(parseChatApiAnswer('anthropic', { content: [{ type: 'text', text: 'answer' }] }), 'answer');
  assert.throws(() => parseChatApiAnswer('openai', { error: { message: 'bad model' } }), /bad model/);
});

test("API cancellation rejects promptly and ignores a late reply", async () => {
  const controller = new AbortController();
  let finish!: (value: { status: number; json: unknown }) => void;
  const result = runVideoChatAI(config, 'question', [], controller.signal, () => new Promise((resolve) => { finish = resolve; }));
  controller.abort();
  await assert.rejects(result, /stopped/);
  finish({ status: 200, json: { choices: [{ message: { content: 'late' } }] } });
});

test("cancelling one CLI request leaves another independent process running", async () => {
  const stop = new AbortController();
  const other = new AbortController();
  const first = runVideoChatProcess(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], '', 15000, stop.signal);
  const second = runVideoChatProcess(process.execPath, ['-e', 'process.stdout.write("unaffected")'], '', 1000, other.signal);
  stop.abort();
  await assert.rejects(first, /stopped/i);
  assert.equal((await second).stdout, 'unaffected');
});

test("Codex receives readable image attachments, isolated working directory, and cleans temporary files", { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chat-backend-test-'));
  try {
    const command = join(dir, 'fake codex');
    await writeFile(command, `#!/usr/bin/env node\nconst fs=require('fs');const a=process.argv.slice(2);let p='';process.stdin.on('data',x=>p+=x);process.stdin.on('end',()=>{const image=a[a.indexOf('--image')+1];const cwd=a[a.indexOf('-C')+1];if(!p.includes('question')||fs.readFileSync(image)[0]!==137||!a.includes('read-only'))process.exit(3);fs.writeFileSync(a[a.indexOf('-o')+1],JSON.stringify({image,cwd}));});\n`, { mode: 0o700 });
    const response = await runVideoChatAI({ ...config, backend: 'codex', command }, 'question', [frame], new AbortController().signal, async () => { throw new Error('No HTTP'); });
    const parsed = JSON.parse(response);
    await assert.rejects(stat(parsed.image), /ENOENT/);
    await assert.rejects(stat(parsed.cwd), /ENOENT/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Claude receives structured multimodal stdin and reads the final result event", { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chat-claude-test-'));
  try {
    const command = join(dir, 'fake-claude');
    await writeFile(command, `#!/usr/bin/env node\nlet p='';process.stdin.on('data',x=>p+=x);process.stdin.on('end',()=>{const m=JSON.parse(p).message;if(m.content[0].source.data!=='iVBORw==')process.exit(3);console.log(JSON.stringify({type:'system'}));console.log(JSON.stringify({type:'result',result:'Image received',is_error:false}));});\n`, { mode: 0o700 });
    assert.equal(await runVideoChatAI({ ...config, backend: 'claude', command }, 'question', [frame], new AbortController().signal, async () => { throw new Error('No HTTP'); }), 'Image received');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("text API requests stay compatible with providers that only accept string content", () => {
  const body = buildChatApiBody(config, "Translate this.", []) as any;
  assert.equal(body.messages[0].content, "Translate this.");
  assert.equal(body.temperature, undefined);
});

test("API configuration trims URL and key, and errors explain image capability requirements", async () => {
  let seen: any;
  const request = async (input: any) => { seen = input; return { status: 401, json: { error: { message: "Invalid test credential" } } }; };
  await assert.rejects(runVideoChatAI({ ...config, baseUrl: " https://example.test/v1/// ", apiKey: " token " }, "question", [frame], new AbortController().signal, request), /vision-capable/);
  assert.equal(seen.url, "https://example.test/v1/chat/completions");
  assert.equal(seen.headers.Authorization, "Bearer token");
  await assert.rejects(runVideoChatAI({ ...config, model: " " }, "q", [], new AbortController().signal, request), /model ID/);
  await assert.rejects(runVideoChatAI({ ...config, apiKey: " " }, "q", [], new AbortController().signal, request), /key is not configured/);
});

test("both API protocols reject empty replies and surface provider errors", () => {
  for (const backend of ["openai", "anthropic"]) {
    assert.throws(() => parseChatApiAnswer(backend, {}), /empty answer/);
    assert.throws(() => parseChatApiAnswer(backend, { error: { message: "Rate limit reached" } }), /Rate limit/);
  }
});
