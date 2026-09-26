import { getLanguagePromptName } from "./language";

export interface VocabularyPromptContext {
  filePath?: string;
  paragraph: string;
}

export function buildTranslationPrompt(
  sourceText: string,
  customPrompt: string,
  targetLanguage: string,
  sourceLanguage: string
): string {
  const target = getLanguagePromptName(targetLanguage);
  const source = getLanguagePromptName(sourceLanguage);

  return [
    "You are a precise Markdown translation engine.",
    `Translate the \`text\` field in the JSON payload from ${source} to ${target}.`,
    customPrompt.trim()
      ? `User custom context and preferences:\n${customPrompt.trim()}`
      : "User custom context and preferences: none.",
    "",
    "Rules:",
    "- Return only the translated Markdown text.",
    "- Preserve Markdown structure, headings, lists, tables, links, inline code, and code fences.",
    "- Do not translate code, commands, file paths, URLs, package names, identifiers, or placeholders.",
    "- Do not add explanations, labels, or surrounding quotes.",
    "",
    "JSON payload:",
    JSON.stringify({ text: sourceText })
  ].join("\n");
}

export function buildVocabularyPrompt(
  word: string,
  selectedText: string,
  context: VocabularyPromptContext,
  customPrompt: string,
  targetLanguage: string,
  sourceLanguage: string
): string {
  const target = getLanguagePromptName(targetLanguage);
  const source = getLanguagePromptName(sourceLanguage);

  return [
    `You are a concise bilingual vocabulary coach for a reader learning ${target}.`,
    `Explain the selected word or phrase in ${target} based on the current reading context. The source language is ${source}.`,
    customPrompt.trim()
      ? `User custom context and preferences:\n${customPrompt.trim()}`
      : "User custom context and preferences: none.",
    "",
    "Rules:",
    `- Return only the explanation in ${target}.`,
    "- Keep it concise: 3 to 5 short bullet points.",
    "- Explain the word's meaning in this exact context, not only a generic dictionary meaning.",
    `- Include a natural ${target} rendering of the local phrase if helpful.`,
    "- Mention common word family or confusion points only when useful.",
    "",
    "JSON payload:",
    JSON.stringify({
      word,
      selectedText,
      notePath: context.filePath ?? "",
      paragraph: context.paragraph
    })
  ].join("\n");
}
