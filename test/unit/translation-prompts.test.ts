import assert from "node:assert/strict";
import test from "node:test";
import { buildTranslationPrompt, buildVocabularyPrompt } from "../../src/translation-prompts";

test("translation prompt keeps payload and language direction explicit", () => {
  const prompt = buildTranslationPrompt("**Hello**", "economics", "zh-CN", "en");
  assert.match(prompt, /from English to Simplified Chinese/);
  assert.match(prompt, /economics/);
  assert.match(prompt, /\{"text":"\*\*Hello\*\*"\}/);
});

test("vocabulary prompt includes note context without changing its interface", () => {
  const prompt = buildVocabularyPrompt(
    "margin",
    "margin expansion",
    { filePath: "Economics.md", paragraph: "The company reported margin expansion." },
    "",
    "zh-CN",
    "en"
  );
  assert.match(prompt, /Economics\.md/);
  assert.match(prompt, /margin expansion/);
});
