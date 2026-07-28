import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "../..");

test("keeps GitHub release creation under a single reusable workflow", async () => {
  const [releaseWorkflow, tagWorkflow] = await Promise.all([
    readFile(path.join(projectRoot, ".github/workflows/release.yml"), "utf8"),
    readFile(path.join(projectRoot, ".github/workflows/tag-release.yml"), "utf8")
  ]);

  assert.match(releaseWorkflow, /gh release create/);
  assert.doesNotMatch(tagWorkflow, /gh release create/);
  assert.match(tagWorkflow, /uses: \.\/\.github\/workflows\/release\.yml/);
  assert.match(releaseWorkflow, /workflow_call:/);
  assert.match(releaseWorkflow, /concurrency:[\s\S]+release-\$\{\{ inputs\.release_tag \|\| github\.ref_name \}\}/);
  assert.match(releaseWorkflow, /gh release view/);
  assert.match(releaseWorkflow, /gh release upload[\s\S]+--clobber/);
});

test("fails loudly when main changes without a version bump", async () => {
  const tagWorkflow = await readFile(
    path.join(projectRoot, ".github/workflows/tag-release.yml"),
    "utf8"
  );

  assert.match(tagWorkflow, /TAG_SHA=/);
  assert.match(tagWorkflow, /HEAD_SHA=/);
  assert.match(tagWorkflow, /Version .* already belongs to commit/);
  assert.match(tagWorkflow, /Bump manifest\.json, package\.json, and versions\.json/);
});

test("validates the release tag against all version manifests", async () => {
  const releaseWorkflow = await readFile(
    path.join(projectRoot, ".github/workflows/release.yml"),
    "utf8"
  );

  assert.match(releaseWorkflow, /manifest\.json/);
  assert.match(releaseWorkflow, /package\.json/);
  assert.match(releaseWorkflow, /versions\.json/);
  assert.match(releaseWorkflow, /inputs\.release_tag \|\| github\.ref_name/);
});
