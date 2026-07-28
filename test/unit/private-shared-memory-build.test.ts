import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "../..");

test("keeps shared memory private unless the build flag is explicitly true", async () => {
  const [buildConfig, source] = await Promise.all([
    readFile(path.join(projectRoot, "esbuild.config.mjs"), "utf8"),
    readFile(path.join(projectRoot, "src/main.ts"), "utf8")
  ]);

  assert.match(
    buildConfig,
    /process\.env\.CCLT_PRIVATE_SHARED_MEMORY === "true"/
  );
  assert.match(
    source,
    /sharedMemoryEnabled: PRIVATE_SHARED_MEMORY_BUILD/
  );
  assert.match(
    source,
    /enabled: PRIVATE_SHARED_MEMORY_BUILD && this\.settings\.sharedMemoryEnabled/
  );
  assert.match(
    source,
    /if \(PRIVATE_SHARED_MEMORY_BUILD\) \{\s+this\.addCommand\(\{\s+id: "check-shared-translation-memory"/
  );
  assert.match(
    source,
    /if \(PRIVATE_SHARED_MEMORY_BUILD\) \{\s+new Setting\(containerEl\)\s+\.setName\("Private shared translation memory"\)/
  );
});

test("routes every translation surface through the shared-memory wrapper", async () => {
  const source = await readFile(path.join(projectRoot, "src/main.ts"), "utf8");

  assert.match(source, /translateSelectionToPopup[\s\S]+translateItemsWithSharedMemory/);
  assert.match(source, /runAITranslation[\s\S]+translateItemsWithSharedMemory/);
  assert.match(source, /translateYouTubeBatch[\s\S]+translateItemsWithSharedMemory/);
  assert.match(source, /translateBlockBatch[\s\S]+translateItemsWithSharedMemory/);
  assert.match(source, /lookup\?\.guidanceByItem/);
  assert.match(source, /formatSharedCorpusGuidance/);
});
