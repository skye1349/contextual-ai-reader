import { SharedMemoryItem } from "./shared-memory";
import { getLanguagePromptName } from "./language";

export interface MarkdownBlock {
  separator: string;
  text: string;
}

export interface MarkdownBlockBatch {
  charCount: number;
  endUnit: number;
  startUnit: number;
  units: TranslationUnit[];
}

export interface TranslationUnit {
  endBlock: number;
  startBlock: number;
  text: string;
}

const BLOCK_SEPARATOR = "§§§BLOCK§§§";
const SHORT_PROSE_UNIT_TARGET_CHARS = 1200;
const SHORT_PROSE_UNIT_MAX_CHARS = 1800;

export function buildBlockTranslationPrompt(
  blockTexts: string[],
  customPrompt: string,
  targetLanguage: string,
  sourceLanguage: string
): string {
  const numberedBlocks = blockTexts
    .map((text, index) => `#${index + 1}\n${text}`)
    .join(`\n${BLOCK_SEPARATOR}\n`);
  const target = getLanguagePromptName(targetLanguage);
  const source = getLanguagePromptName(sourceLanguage);

  return [
    `Translate each block from ${source} to ${target}.`,
    customPrompt.trim() ? `Context:\n${customPrompt.trim()}` : "",
    "",
    `Return only translations in the same order, separated by this exact line: ${BLOCK_SEPARATOR}`,
    "Keep Markdown. Do not translate code, commands, paths, URLs, package names, identifiers, or placeholders. No labels or explanations.",
    "",
    "Blocks:",
    numberedBlocks
  ].filter(Boolean).join("\n");
}

export function parseTranslationArray(rawResult: string, expectedLength: number): string[] {
  const parts = rawResult
    .split(BLOCK_SEPARATOR)
    .map((value) => value.replace(/^\s*(?:\[\d+\]|#\d+)\s*/m, "").trim());

  if (parts.length === expectedLength) return parts;

  const trimmed = rawResult.trim().replace(/^.*?(?=§§§BLOCK§§§|\[1\]|#1)/s, "");
  const fallbackParts = trimmed
    .split(BLOCK_SEPARATOR)
    .map((value) => value.replace(/^\s*(?:\[\d+\]|#\d+)\s*/m, "").trim())
    .filter(Boolean);

  if (fallbackParts.length === expectedLength) return fallbackParts;
  throw new Error(`Expected ${expectedLength} blocks but got ${parts.length}.`);
}

export function groupConsecutiveMemoryItems(items: SharedMemoryItem[]): SharedMemoryItem[][] {
  const groups: SharedMemoryItem[][] = [];
  items.forEach((item) => {
    const current = groups[groups.length - 1];
    const previous = current?.[current.length - 1];
    if (!current || !previous || Number(item.index) !== Number(previous.index) + 1) {
      groups.push([item]);
    } else {
      current.push(item);
    }
  });
  return groups;
}

export function appendDocumentTranslation(sourceText: string, translatedText: string): string {
  return `${sourceText.trimEnd()}\n\n${translatedText.trim()}\n`;
}

export function interleaveDocumentTranslation(
  sourceText: string,
  blocks: MarkdownBlock[],
  units: TranslationUnit[],
  translations: string[]
): string {
  const { frontmatter } = extractFrontmatter(sourceText);
  let body = "";
  let cursor = 0;

  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    const translation = translations[index]?.trim();

    while (cursor < unit.endBlock) {
      const block = blocks[cursor];
      body += `${block.text}${block.separator}`;
      cursor++;
    }

    if (translation) {
      body = `${body.trimEnd()}\n\n${translation}${blocks[unit.endBlock - 1]?.separator ?? "\n\n"}`;
    }
  }

  while (cursor < blocks.length) {
    const block = blocks[cursor];
    body += `${block.text}${block.separator}`;
    cursor++;
  }

  const normalizedBody = frontmatter ? body.replace(/^(?:\r?\n)+/, "") : body;
  return `${frontmatter ? `${frontmatter.trimEnd()}\n\n` : ""}${normalizedBody.trimEnd()}\n`;
}

export function joinTranslatedBlocks(units: TranslationUnit[], translations: string[]): string {
  return units
    .map((unit, index) => `${translations[index]?.trimEnd() ?? ""}${getUnitTrailingSeparator(unit)}`)
    .join("")
    .trimEnd();
}

export function buildBlockBatches(
  units: TranslationUnit[],
  maxCharacters: number
): MarkdownBlockBatch[] {
  const batches: MarkdownBlockBatch[] = [];
  let currentBatch: TranslationUnit[] = [];
  let currentSize = 0;
  let startUnit = 0;

  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    const unitSize = unit.text.length;

    if (currentBatch.length > 0 && currentSize + unitSize > maxCharacters) {
      batches.push({ charCount: currentSize, endUnit: index, startUnit, units: currentBatch });
      currentBatch = [];
      currentSize = 0;
      startUnit = index;
    }

    currentBatch.push(unit);
    currentSize += unitSize;
  }

  if (currentBatch.length > 0) {
    batches.push({ charCount: currentSize, endUnit: units.length, startUnit, units: currentBatch });
  }

  return batches;
}

export function buildTranslationUnits(blocks: MarkdownBlock[]): TranslationUnit[] {
  const units: TranslationUnit[] = [];
  let pendingStart = -1;
  let pendingText = "";

  const flush = (endBlock: number) => {
    if (pendingStart < 0) return;
    units.push({ startBlock: pendingStart, endBlock, text: pendingText.trimEnd() });
    pendingStart = -1;
    pendingText = "";
  };

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const mergeable = isMergeableProseBlock(block);
    const nextSize = pendingText.length + block.text.length + block.separator.length;

    if (
      !mergeable
      || (pendingStart >= 0 && pendingText.length >= SHORT_PROSE_UNIT_TARGET_CHARS)
      || (pendingStart >= 0 && nextSize > SHORT_PROSE_UNIT_MAX_CHARS)
    ) {
      flush(index);
    }

    if (!mergeable) {
      units.push({ startBlock: index, endBlock: index + 1, text: block.text.trimEnd() });
      continue;
    }

    if (pendingStart < 0) pendingStart = index;
    pendingText += `${block.text.trimEnd()}${block.separator || "\n\n"}`;
  }

  flush(blocks.length);
  return units;
}

export function extractFrontmatter(sourceText: string): { body: string; frontmatter: string } {
  if (!sourceText.startsWith("---\n") && !sourceText.startsWith("---\r\n")) {
    return { body: sourceText, frontmatter: "" };
  }

  const match = sourceText.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { body: sourceText, frontmatter: "" };

  return { body: sourceText.slice(match[0].length), frontmatter: match[0] };
}

export function splitMarkdownBlocks(sourceText: string): MarkdownBlock[] {
  const lines = sourceText.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const blocks: MarkdownBlock[] = [];
  let current = "";
  let separator = "";
  let fenceMarker = "";
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inFence && current && trimmed === "") {
      separator += line;
      continue;
    }

    if (current && separator) {
      blocks.push({ text: current, separator });
      current = "";
      separator = "";
    }

    current += line;
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1].slice(0, 3);
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
    }
  }

  if (current.trim()) {
    blocks.push({ text: current, separator });
  } else if (blocks.length > 0 && separator) {
    blocks[blocks.length - 1].separator += separator;
  }

  return blocks;
}

function isMergeableProseBlock(block: MarkdownBlock): boolean {
  const text = block.text.trim();
  if (!text) return false;
  if (/^(```|~~~)/.test(text)) return false;
  if (/^#{1,6}\s/.test(text)) return false;
  if (/^>\s?/.test(text)) return false;
  if (/^([-*+]|\d+[.)])\s+/.test(text)) return false;
  if (/^\|.*\|$/.test(text)) return false;
  if (/^<\w+[\s>]/.test(text)) return false;
  return true;
}

function getUnitTrailingSeparator(unit: TranslationUnit): string {
  return unit.text.endsWith("\n") ? "" : "\n\n";
}
