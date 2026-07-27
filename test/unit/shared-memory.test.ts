import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SharedMemoryRequest,
  SharedTranslationMemory
} from "../../src/shared-memory";

test("uses the installed shared-memory command through its small interface", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "obsidian-shared-memory-"));
  const command = path.join(directory, "fake-memory");
  await writeFile(command, `#!/usr/bin/env node
let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  const request = JSON.parse(body);
  if (request.operation === "status") {
    process.stdout.write(JSON.stringify({
      ok: true,
      stats: { databasePath: "/tmp/shared.sqlite3", translationRecords: 12, trustedRecords: 9 }
    }));
    return;
  }
  process.stdout.write(JSON.stringify({
    ok: true,
    metadata: { one: { provenance: "exact-memory" } },
    misses: [],
    stats: { exactMemoryHits: 1 },
    translations: { one: "共享译文" }
  }));
});
`, { mode: 0o755 });
  await chmod(command, 0o755);
  t.after(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  const memory = new SharedTranslationMemory({ command });
  const request: SharedMemoryRequest = {
    contentType: "selection",
    items: [{ id: "one", text: "Shared source" }],
    provider: "local-codex",
    sourceLanguage: "en",
    targetLanguage: "zh-CN"
  };
  const lookup = await memory.lookup(request);
  assert.equal(lookup?.translations.one, "共享译文");
  assert.equal(lookup?.stats.exactMemoryHits, 1);
  assert.equal((await memory.status())?.databasePath, "/tmp/shared.sqlite3");
});

test("fails open when shared memory is not installed", async () => {
  const memory = new SharedTranslationMemory({
    command: "/definitely/missing/cclt-shared-memory"
  });
  const lookup = await memory.lookup({
    contentType: "webpage",
    items: [{ id: "one", text: "Translate me" }],
    provider: "local-codex",
    sourceLanguage: "en",
    targetLanguage: "zh-CN"
  });
  assert.equal(lookup, null);
});
