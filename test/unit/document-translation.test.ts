import assert from "node:assert/strict";
import test from "node:test";
import {
  appendDocumentTranslation,
  buildBlockBatches,
  buildTranslationUnits,
  extractFrontmatter,
  interleaveDocumentTranslation,
  splitMarkdownBlocks
} from "../../src/document-translation";

test("document translation keeps frontmatter and block correspondence", () => {
  const source = "---\ntitle: Example\n---\n\nFirst paragraph.\n\nSecond paragraph.\n";
  const { body, frontmatter } = extractFrontmatter(source);
  const blocks = splitMarkdownBlocks(body);
  const units = buildTranslationUnits(blocks);

  assert.equal(frontmatter, "---\ntitle: Example\n---\n");
  assert.equal(units.length, 1);
  assert.equal(
    interleaveDocumentTranslation(source, blocks, units, ["第一段。\n\n第二段。"]),
    "---\ntitle: Example\n---\n\nFirst paragraph.\n\nSecond paragraph.\n\n第一段。\n\n第二段。\n"
  );
});

test("document translation batches units without losing order", () => {
  const units = buildTranslationUnits(splitMarkdownBlocks("# Heading\n\nA paragraph.\n\n- Item\n"));
  const batches = buildBlockBatches(units, 12);

  assert.deepEqual(
    batches.flatMap((batch) => batch.units).map((unit) => unit.text),
    units.map((unit) => unit.text)
  );
  assert.equal(appendDocumentTranslation("Source\n", "译文"), "Source\n\n译文\n");
});
