import { spawn } from "child_process";
import { existsSync, readdirSync } from "fs";
import { mkdtemp, readFile, rm } from "fs/promises";
import { homedir, tmpdir } from "os";
import { delimiter, join } from "path";
import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
  TFile,
  TFolder,
  normalizePath,
  setIcon
} from "obsidian";

type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
type InsertMode = "replace" | "append";
type FullDocumentInsertMode = "append" | "interleave";
type AIBackend = "auto" | "codex" | "claude" | "openai" | "anthropic";

interface ContextualAIReaderSettings {
  aiBackend: AIBackend;
  autoTranslate: boolean;
  batchChunkChars: number;
  claudeCommand: string;
  claudeModel: string;
  codexCommand: string;
  customPrompt: string;
  debounceMs: number;
  excerptFilePath: string;
  includeTranslationInExcerpt: boolean;
  minSelectionChars: number;
  model: string;
  openExcerptAfterSave: boolean;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  anthropicApiKey: string;
  anthropicBaseUrl: string;
  anthropicModel: string;
  reasoningEffort: ReasoningEffort;
  requireCommandForAutoTranslate: boolean;
  singleShotMaxChars: number;
  speechLanguage: string;
  speechRate: number;
  timeoutSeconds: number;
  vocabularyCache: Record<string, VocabularyCacheEntry>;
}

const DEFAULT_SETTINGS: ContextualAIReaderSettings = {
  aiBackend: "auto",
  autoTranslate: true,
  batchChunkChars: 30000,
  claudeCommand: "",
  claudeModel: "claude-sonnet-4-5",
  codexCommand: "",
  customPrompt: "",
  debounceMs: 450,
  excerptFilePath: "Contextual AI Reader Excerpts.md",
  includeTranslationInExcerpt: true,
  minSelectionChars: 2,
  model: "gpt-5.4-mini",
  openExcerptAfterSave: true,
  openaiApiKey: "",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4.1-mini",
  anthropicApiKey: "",
  anthropicBaseUrl: "https://api.anthropic.com/v1",
  anthropicModel: "claude-sonnet-4-5",
  reasoningEffort: "none",
  singleShotMaxChars: 60000,
  requireCommandForAutoTranslate: true,
  speechLanguage: "en-US",
  speechRate: 0.92,
  timeoutSeconds: 90,
  vocabularyCache: {}
};

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function getAppDataDir(): string {
  return process.env.APPDATA || join(getHomeDir(), "AppData", "Roaming");
}

function buildCodexCandidates(): string[] {
  const home = getHomeDir();
  const appData = getAppDataDir();

  return process.platform === "win32"
    ? [
      join(appData, "npm", "codex.cmd"),
      join(home, "AppData", "Local", "Programs", "Codex", "codex.exe"),
      "codex.cmd",
      "codex.exe",
      "codex"
    ]
    : [
      "/Applications/Codex.app/Contents/Resources/codex",
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
      "codex"
    ];
}

function buildPathEntries(): string[] {
  const home = getHomeDir();
  const appData = getAppDataDir();

  return process.platform === "win32"
    ? [
      join(appData, "npm"),
      join(home, "AppData", "Local", "Programs", "Codex"),
      join(home, ".codex", "bin")
    ]
    : [
      "/Applications/Codex.app/Contents/Resources",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin"
    ];
}

const CODEX_CANDIDATES = buildCodexCandidates();
const CODEX_PATH_ENTRIES = buildPathEntries();

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function buildClaudeCandidates(): string[] {
  const home = getHomeDir();
  const appData = getAppDataDir();
  const candidates: string[] = [
    ...(process.platform === "win32"
      ? [
        join(appData, "npm", "claude.cmd"),
        join(home, ".claude", "local", "claude.cmd"),
        join(home, ".claude", "local", "claude.exe")
      ]
      : [
        "/opt/homebrew/bin/claude",
        "/usr/local/bin/claude",
        `${home}/.claude/local/claude`
      ])
  ];

  if (process.platform === "darwin") {
    const claudeCodeBase = `${home}/Library/Application Support/Claude/claude-code`;
    try {
      const versions = readdirSync(claudeCodeBase).sort().reverse();
      for (const version of versions) {
        candidates.push(`${claudeCodeBase}/${version}/claude.app/Contents/MacOS/claude`);
      }
    } catch {
      // directory doesn't exist
    }
  }

  candidates.push(process.platform === "win32" ? "claude.cmd" : "claude");
  candidates.push("claude");
  return candidates;
}

const CLAUDE_CANDIDATES = buildClaudeCandidates();

interface SourceReference {
  endLine?: number;
  line?: number;
  path: string;
}

function getPrimaryModifierLabel(): string {
  return process.platform === "darwin" ? "Command" : "Ctrl";
}

function isPrimaryModifierEvent(event: KeyboardEvent | MouseEvent): boolean {
  return process.platform === "darwin" ? event.metaKey : event.ctrlKey;
}

function isPrimaryModifierKey(event: KeyboardEvent): boolean {
  return process.platform === "darwin" ? event.key === "Meta" : event.key === "Control";
}

interface MarkdownBlock {
  separator: string;
  text: string;
}

interface MarkdownBlockBatch {
  charCount: number;
  endUnit: number;
  startUnit: number;
  units: TranslationUnit[];
}

interface TranslationUnit {
  endBlock: number;
  startBlock: number;
  text: string;
}

interface ClaudeJsonResult {
  result: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

interface OpenAIChatCompletionResult {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; type?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
  usage?: {
    cached_tokens?: number;
    completion_tokens?: number;
    prompt_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
}

interface AnthropicMessageResult {
  content?: Array<{
    text?: string;
    type?: string;
  }>;
  error?: {
    message?: string;
  };
  usage?: {
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface TokenUsage {
  cachedInput: number;
  input: number;
  output: number;
  reasoningOutput: number;
}

interface VocabularyCacheEntry {
  baseDefinition?: string;
  contextExplanation?: string;
  updatedAt: number;
  word: string;
}

interface VocabularyContext {
  filePath?: string;
  paragraph: string;
}

interface VocabularyCard {
  baseDefinition?: string;
  contextExplanation?: string;
  errorText?: string;
  status: "idle" | "loading" | "done" | "error";
  tokenUsage?: TokenUsage;
  word: string;
}

export default class ContextualAIReaderPlugin extends Plugin {
  settings: ContextualAIReaderSettings = DEFAULT_SETTINGS;
  private autoTimer?: number;
  private commandSelectionGestureUntil = 0;
  private currentKills = new Set<() => void>();
  private overlayOperationRunning = false;
  private operationCancelled = false;
  private sessionTokens: TokenUsage = createEmptyTokenUsage();
  private onTokensUpdate?: (tokens: TokenUsage) => void;
  private isModifierKeyPressed = false;
  private popupEl?: HTMLDivElement;
  private popupRect?: DOMRect;
  private requestSerial = 0;
  private statusBarEl?: HTMLElement;
  private translationCache = new Map<string, string>();

  async onload() {
    await this.loadSettings();

    this.statusBarEl = this.addStatusBarItem();
    this.setStatus("");

    this.addCommand({
      id: "translate-selection-to-chinese",
      name: "Translate selection to Chinese",
      editorCallback: (editor: Editor) => {
        void this.translateSelection(editor, "replace");
      }
    });

    this.addCommand({
      id: "append-chinese-translation",
      name: "Append Chinese translation below selection",
      editorCallback: (editor: Editor) => {
        void this.translateSelection(editor, "append");
      }
    });

    this.addCommand({
      id: "check-codex-login",
      name: "Check Codex login",
      callback: () => {
        void this.checkCodexLogin();
      }
    });

    this.addCommand({
      id: "translate-current-file-to-chinese",
      name: "Translate current Markdown file: append Chinese below",
      callback: () => {
        void this.translateCurrentFile("append");
      }
    });

    this.addCommand({
      id: "translate-current-file-interleaved-to-chinese",
      name: "Translate current Markdown file: interleave Chinese paragraphs",
      callback: () => {
        void this.translateCurrentFile("interleave");
      }
    });

    this.addCommand({
      id: "batch-translate-markdown-files-append",
      name: "Batch translate Markdown files: append Chinese below",
      callback: () => {
        new BatchScopeModal(this.app, "append", (scopeText) => this.batchTranslateFiles(scopeText, "append")).open();
      }
    });

    this.addCommand({
      id: "batch-translate-markdown-files-interleave",
      name: "Batch translate Markdown files: interleave Chinese paragraphs",
      callback: () => {
        new BatchScopeModal(this.app, "interleave", (scopeText) => this.batchTranslateFiles(scopeText, "interleave")).open();
      }
    });

    this.addCommand({
      id: "speak-selection",
      name: "Speak selected English text",
      editorCallback: (editor: Editor) => {
        void this.speakText(editor.getSelection());
      }
    });

    this.addCommand({
      id: "save-selection-to-excerpts",
      name: "Save selection to excerpts",
      editorCallback: (editor: Editor) => {
        void this.saveExcerpt(editor.getSelection());
      }
    });

    this.addSettingTab(new ContextualAIReaderSettingTab(this.app, this));

    this.registerDomEvent(activeDocument, "selectionchange", () => {
      this.handleSelectionChange();
    });
    this.registerDomEvent(window, "keydown", (event) => {
      if (isPrimaryModifierEvent(event)) {
        this.isModifierKeyPressed = true;
      }
    });
    this.registerDomEvent(window, "keyup", (event) => {
      if (isPrimaryModifierKey(event)) {
        this.isModifierKeyPressed = false;
        this.commandSelectionGestureUntil = Date.now() + 700;
      }
    });
    this.registerDomEvent(window, "blur", () => {
      this.isModifierKeyPressed = false;
      this.commandSelectionGestureUntil = 0;
    });
    this.registerDomEvent(activeDocument, "mousedown", (event) => {
      if (isPrimaryModifierEvent(event)) {
        this.commandSelectionGestureUntil = Date.now() + 2_000;
      }
    }, true);
    this.registerDomEvent(activeDocument, "mouseup", (event) => {
      if (isPrimaryModifierEvent(event)) {
        this.commandSelectionGestureUntil = Date.now() + 700;
      }
    }, true);
    this.registerDomEvent(window, "scroll", (event) => {
      if (this.popupEl && eventTargetInside(event, this.popupEl)) {
        return;
      }

      this.hidePopup();
    }, true);
    this.registerDomEvent(window, "resize", () => {
      this.hidePopup();
    });
  }

  onunload() {
    this.requestSerial++;
    if (this.autoTimer) {
      window.clearTimeout(this.autoTimer);
    }
    this.hidePopup();
    this.setStatus("");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.vocabularyCache = { ...(this.settings.vocabularyCache ?? {}) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private handleSelectionChange() {
    if (!this.settings.autoTranslate) {
      return;
    }

    if (this.autoTimer) {
      window.clearTimeout(this.autoTimer);
    }

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() ?? "";

    if (selection && this.popupEl && selectionWithinElement(selection, this.popupEl)) {
      return;
    }

    if (
      !selection ||
      selection.rangeCount === 0 ||
      !this.isAutoTranslateGestureActive() ||
      selectedText.length < this.settings.minSelectionChars ||
      shouldIgnoreSelection(selection, this.popupEl)
    ) {
      this.requestSerial++;
      this.hidePopup();
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = getRangeRect(range);

    if (!rect) {
      this.requestSerial++;
      this.hidePopup();
      return;
    }

    this.popupRect = rect;
    this.autoTimer = window.setTimeout(() => {
      void this.translateSelectionToPopup(selectedText, rect);
    }, this.settings.debounceMs);
  }

  private isAutoTranslateGestureActive(): boolean {
    if (!this.settings.requireCommandForAutoTranslate) {
      return true;
    }

    return this.isModifierKeyPressed || Date.now() <= this.commandSelectionGestureUntil;
  }

  private async translateSelectionToPopup(sourceText: string, rect: DOMRect) {
    const requestId = ++this.requestSerial;
    const vocabularyWord = getSingleEnglishWord(sourceText);

    if (vocabularyWord) {
      await this.showVocabularyLookup(sourceText, vocabularyWord, rect, requestId);
      return;
    }

    const cached = this.translationCache.get(sourceText);

    if (cached) {
      this.showPopup(cached, sourceText, rect, "done");
      this.addPopupRefineButton(sourceText, rect, requestId);
      return;
    }

    // Step 1: instant Google Translate (~200ms, 0 tokens)
    this.showPopupLoading("Translating…", rect, () => { this.hidePopup(); });

    try {
      const quickResult = await googleTranslate(sourceText);
      if (requestId !== this.requestSerial) return;
      if (!quickResult) throw new Error("Empty response from Google Translate.");

      this.rememberTranslation(sourceText, quickResult);
      this.showPopup(quickResult, sourceText, rect, "done");
      this.addPopupRefineButton(sourceText, rect, requestId);
    } catch {
      // Google Translate unavailable — fall back to AI directly
      if (requestId !== this.requestSerial) return;
      void this.translateSelectionToPopupWithAI(sourceText, rect, requestId);
    }
  }

  private async showVocabularyLookup(sourceText: string, word: string, rect: DOMRect, requestId: number) {
    const context = await this.getVocabularyContext(sourceText);
    if (requestId !== this.requestSerial) return;

    const cacheKey = buildVocabularyCacheKey(word, context.paragraph, this.settings.customPrompt);
    const cached = this.settings.vocabularyCache[cacheKey];
    const cachedBase = cached?.baseDefinition ?? this.findCachedVocabularyBase(word);
    let baseDefinition = cachedBase ?? getLocalVocabularyDefinition(word);

    if (cached?.contextExplanation) {
      this.showVocabularyPopup({
        word,
        baseDefinition,
        contextExplanation: cached.contextExplanation,
        status: "done"
      }, sourceText, context, rect, requestId, cacheKey);
      return;
    }

    this.showVocabularyPopup({
      word,
      baseDefinition,
      status: "loading"
    }, sourceText, context, rect, requestId, cacheKey);

    if (!baseDefinition) {
      try {
        const quickDefinition = await googleTranslate(word);
        if (requestId !== this.requestSerial) return;
        if (quickDefinition && quickDefinition.toLowerCase() !== word.toLowerCase()) {
          baseDefinition = quickDefinition;
          await this.rememberVocabulary(cacheKey, {
            word,
            baseDefinition,
            updatedAt: Date.now()
          });
          this.showVocabularyPopup({
            word,
            baseDefinition,
            status: "loading"
          }, sourceText, context, rect, requestId, cacheKey);
        }
      } catch {
        if (requestId !== this.requestSerial) return;
      }
    }

    void this.enhanceVocabularyWithAI(sourceText, word, context, rect, requestId, cacheKey, baseDefinition);
  }

  private async enhanceVocabularyWithAI(
    sourceText: string,
    word: string,
    context: VocabularyContext,
    rect: DOMRect,
    requestId: number,
    cacheKey: string,
    baseDefinition?: string
  ) {
    const backendLabel = this.getBackendLabel();
    this.updateVocabularyStatus(`${backendLabel} 正在结合上下文解释…`);
    this.startOperation();

    try {
      const explanation = (await this.runAIPrompt(
        buildVocabularyPrompt(word, sourceText, context, this.settings.customPrompt)
      )).trim();

      if (requestId !== this.requestSerial) return;
      if (!explanation) throw new Error(`${backendLabel} returned an empty explanation.`);

      await this.rememberVocabulary(cacheKey, {
        word,
        baseDefinition,
        contextExplanation: explanation,
        updatedAt: Date.now()
      });
      this.showVocabularyPopup({
        word,
        baseDefinition,
        contextExplanation: explanation,
        status: "done",
        tokenUsage: this.getCurrentTokenUsage()
      }, sourceText, context, rect, requestId, cacheKey);
    } catch (error) {
      if (requestId !== this.requestSerial) return;
      this.showVocabularyPopup({
        word,
        baseDefinition,
        errorText: `AI explanation failed: ${getErrorMessage(error)}`,
        status: "error"
      }, sourceText, context, rect, requestId, cacheKey);
      console.error("Vocabulary explanation failed", error);
    }
  }

  private async translateSelectionToPopupWithAI(sourceText: string, rect: DOMRect, requestId: number) {
    const backendLabel = this.getBackendLabel();
    this.showPopupLoading(backendLabel, rect, () => {
      this.stopCurrentTranslation();
      this.hidePopup();
    });
    this.startOperation((tokens) => {
      if (requestId !== this.requestSerial) return;
      this.updatePopupTokens(tokens);
    });
    const startTime = Date.now();
    const timerInterval = window.setInterval(() => {
      if (requestId !== this.requestSerial) { window.clearInterval(timerInterval); return; }
      this.updatePopupTimer(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    try {
      const translation = (await this.runAITranslation(sourceText)).trim();
      window.clearInterval(timerInterval);
      if (requestId !== this.requestSerial) return;
      if (!translation) throw new Error(`${backendLabel} returned an empty translation.`);
      this.rememberTranslation(sourceText, translation);
      this.showPopup(translation, sourceText, rect, "done", this.getCurrentTokenUsage());
      this.addPopupRefineButton(sourceText, rect, requestId);
    } catch (error) {
      window.clearInterval(timerInterval);
      if (requestId !== this.requestSerial) return;
      this.showPopup(`Translation failed: ${getErrorMessage(error)}`, sourceText, rect, "error");
      console.error("Translation failed", error);
    }
  }

  private addPopupRefineButton(sourceText: string, rect: DOMRect, requestId: number) {
    const popup = this.popupEl;
    if (!popup) return;
    const actions = popup.querySelector<HTMLElement>(".contextual-ai-reader-actions");
    if (!actions) return;

    const refineBtn = this.createIconButton("sparkles", `Refine translation with ${this.getBackendLabel()}`, () => {
      refineBtn.remove();
      void this.translateSelectionToPopupWithAI(sourceText, rect, requestId);
    });

    actions.insertBefore(refineBtn, actions.firstChild);
  }

  private async translateSelection(editor: Editor, mode: InsertMode) {
    const selection = editor.getSelection();

    if (!selection.trim()) {
      new Notice("Select some Markdown text first.");
      return;
    }

    if (!this.beginOverlayOperation()) {
      return;
    }

    const backendLabel = this.getBackendLabel();
    const overlay = new TranslationProgressOverlay(
      this.app.workspace.containerEl,
      backendLabel,
      () => { this.stopCurrentTranslation(); }
    );
    this.startOperation((tokens) => overlay.setTokens(tokens));
    this.setStatus(`${backendLabel} translating...`);

    const startTime = Date.now();
    const timerInterval = window.setInterval(() => {
      overlay.setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    try {
      const translation = await this.runAITranslation(selection, (chunk) => {
        overlay.appendChunk(chunk);
      });

      window.clearInterval(timerInterval);
      overlay.remove();

      if (!translation.trim()) {
        throw new Error(`${backendLabel} returned an empty translation.`);
      }

      if (mode === "append") {
        editor.replaceSelection(`${selection}\n\n${translation.trim()}`);
      } else {
        editor.replaceSelection(translation.trim());
      }

      new Notice(`Translation complete.${this.tokenUsageSuffix()}`, 9000);
    } catch (error) {
      window.clearInterval(timerInterval);
      overlay.remove();
      new Notice(isStoppedError(error) ? "Translation stopped. Running AI process was killed." : `Translation failed: ${getErrorMessage(error)}`);
      console.error("Translation failed", error);
    } finally {
      this.finishOverlayOperation();
      this.setStatus("");
    }
  }

  private async translateCurrentFile(mode: FullDocumentInsertMode) {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = activeView?.file;

    if (!activeView || !file) {
      new Notice("Open a Markdown file first.");
      return;
    }

    const sourceText = activeView.getViewData();

    if (!sourceText.trim()) {
      new Notice("Current Markdown file is empty.");
      return;
    }

    if (!this.beginOverlayOperation()) {
      return;
    }

    this.hidePopup();
    const backendLabel = this.getBackendLabel();
    const overlay = new TranslationProgressOverlay(
      this.app.workspace.containerEl,
      backendLabel,
      () => { this.stopCurrentTranslation(); }
    );
    this.startOperation((tokens) => overlay.setTokens(tokens));
    const startTime = Date.now();
    const timerInterval = window.setInterval(() => {
      overlay.setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    this.setStatus(`${backendLabel} translating file...`);

    try {
      const translatedContent = await this.translateMarkdownDocument(sourceText, overlay, "current file");

      if (!translatedContent.fullText.trim()) {
        throw new Error("AI returned an empty translation.");
      }

      const nextContent = mode === "append"
        ? appendDocumentTranslation(sourceText, translatedContent.fullText)
        : interleaveDocumentTranslation(sourceText, translatedContent.blocks, translatedContent.units, translatedContent.translations);

      const currentView = this.app.workspace.getActiveViewOfType(MarkdownView);
      const currentContent = currentView?.file?.path === file.path
        ? currentView.getViewData()
        : await this.app.vault.read(file);

      if (currentContent !== sourceText) {
        throw new Error("The file changed while translating, so the translated text was not inserted.");
      }

      if (currentView?.file?.path === file.path) {
        currentView.setViewData(nextContent, false);
        currentView.requestSave();
      } else {
        await this.app.vault.modify(file, nextContent);
      }

      new Notice(`${mode === "append"
        ? "Chinese translation appended below the current file."
        : "Chinese translation inserted after each paragraph."}${this.tokenUsageSuffix()}`, 12000);
    } catch (error) {
      new Notice(isStoppedError(error)
        ? `Translation stopped. Running AI process was killed.${this.tokenUsageSuffix()}`
        : `Translation failed: ${getErrorMessage(error)}`);
      console.error("File translation failed", error);
    } finally {
      window.clearInterval(timerInterval);
      overlay.remove();
      this.finishOverlayOperation();
      this.setStatus("");
    }
  }

  private async batchTranslateFiles(scopeText: string, mode: FullDocumentInsertMode) {
    const files = this.resolveBatchFiles(scopeText);

    if (files.length === 0) {
      new Notice("No Markdown files matched that batch scope.");
      return;
    }

    if (!this.beginOverlayOperation()) {
      return;
    }

    this.hidePopup();
    const backendLabel = this.getBackendLabel();
    const overlay = new TranslationProgressOverlay(
      this.app.workspace.containerEl,
      backendLabel,
      () => { this.stopCurrentTranslation(); }
    );
    this.startOperation((tokens) => overlay.setTokens(tokens));
    const startTime = Date.now();
    const timerInterval = window.setInterval(() => {
      overlay.setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    this.setStatus(`${backendLabel} batch translating 0/${files.length}`);

    let changedCount = 0;
    const failures: string[] = [];

    try {
      for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        if (this.isCancelled) break;

        const file = files[fileIndex];
        const fileLabel = `${fileIndex + 1}/${files.length}`;

        try {
          overlay.setStatus(`File ${fileLabel}: ${file.name}`);
          this.setStatus(`${backendLabel} batch translating ${fileIndex + 1}/${files.length}`);

          const sourceText = await this.app.vault.read(file);

          if (!sourceText.trim()) {
            continue;
          }

          const translatedContent = await this.translateMarkdownDocument(sourceText, overlay, fileLabel);

          if (!translatedContent.fullText.trim()) {
            throw new Error(`${backendLabel} returned an empty translation.`);
          }

          const nextContent = mode === "append"
            ? appendDocumentTranslation(sourceText, translatedContent.fullText)
            : interleaveDocumentTranslation(sourceText, translatedContent.blocks, translatedContent.units, translatedContent.translations);

          const currentContent = await this.app.vault.read(file);

          if (currentContent !== sourceText) {
            throw new Error("File changed while translating, skipped write.");
          }

          await this.app.vault.modify(file, nextContent);
          changedCount++;
        } catch (error) {
          if (this.isCancelled) break;
          failures.push(`${file.path}: ${getErrorMessage(error)}`);
          console.error("Batch file translation failed", file.path, error);
        }
      }

      const stopped = this.isCancelled;
      const summary = stopped
        ? `Batch translation stopped: ${changedCount}/${files.length} files updated. Running AI process was killed.`
        : failures.length === 0
          ? `Batch translation complete: ${changedCount}/${files.length} files updated.`
          : `Batch translation finished: ${changedCount}/${files.length} files updated, ${failures.length} failed.`;
      new Notice(`${summary}${this.tokenUsageSuffix()}`, stopped || failures.length > 0 ? 12000 : 9000);
    } finally {
      window.clearInterval(timerInterval);
      overlay.remove();
      this.finishOverlayOperation();
      this.setStatus("");
    }
  }

  private resolveBatchFiles(scopeText: string): TFile[] {
    const entries = parseScopeEntries(scopeText);
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const result = new Map<string, TFile>();

    for (const entry of entries) {
      const normalizedEntry = normalizePath(entry);
      const candidates = getPathCandidates(normalizedEntry);
      let matched = false;

      for (const candidate of candidates) {
        const existing = this.app.vault.getAbstractFileByPath(candidate);

        if (existing instanceof TFile && existing.extension === "md") {
          result.set(existing.path, existing);
          matched = true;
        } else if (existing instanceof TFolder) {
          const folderPrefix = existing.path ? `${existing.path}/` : "";
          for (const file of markdownFiles) {
            if (file.path.startsWith(folderPrefix)) {
              result.set(file.path, file);
              matched = true;
            }
          }
        }
      }

      if (!matched && hasWildcard(normalizedEntry)) {
        const matcher = wildcardToRegExp(normalizedEntry);
        for (const file of markdownFiles) {
          if (matcher.test(file.path)) {
            result.set(file.path, file);
          }
        }
      }
    }

    return Array.from(result.values()).sort((left, right) => left.path.localeCompare(right.path));
  }

  private async checkCodexLogin() {
    try {
      const result = await spawnProcess(resolveCodexCommand(this.settings.codexCommand), [
        "login",
        "status"
      ], "", 20_000).promise;

      if (result.code === 0) {
        new Notice("Codex login is configured.");
      } else {
        new Notice("Codex login check failed. Run `codex login` in Terminal.");
      }
    } catch (error) {
      new Notice(`Codex login check failed: ${getErrorMessage(error)}`);
    }
  }

  private async speakText(sourceText: string) {
    const text = cleanSpeechText(sourceText);

    if (!text) {
      new Notice("Select some English text first.");
      return;
    }

    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      new Notice("Speech synthesis is not available in this Obsidian environment.");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.settings.speechLanguage || DEFAULT_SETTINGS.speechLanguage;
    utterance.rate = this.settings.speechRate || DEFAULT_SETTINGS.speechRate;

    const voice = await getPreferredVoice(utterance.lang);
    if (voice) {
      utterance.voice = voice;
    }

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  private async saveExcerpt(sourceText: string, translation?: string) {
    const trimmedSource = sourceText.trim();

    if (!trimmedSource) {
      new Notice("Select some text first.");
      return;
    }

    try {
      const targetFile = await this.ensureExcerptFile();
      const sourceReference = await this.getSourceReference(trimmedSource);
      const entry = formatExcerptEntry(
        trimmedSource,
        translation?.trim(),
        sourceReference,
        this.settings.includeTranslationInExcerpt
      );

      await this.app.vault.append(targetFile, entry);

      if (this.settings.openExcerptAfterSave) {
        await this.openExcerptFile(targetFile);
      }

      new Notice("Saved to excerpts.");
    } catch (error) {
      new Notice(`Could not save excerpt: ${getErrorMessage(error)}`);
      console.error("Could not save excerpt", error);
    }
  }

  private async runAITranslation(sourceText: string, onChunk?: (text: string) => void): Promise<string> {
    return await this.runAIPrompt(buildTranslationPrompt(sourceText, this.settings.customPrompt), onChunk);
  }

  private async runAIPrompt(prompt: string, onChunk?: (text: string) => void): Promise<string> {
    const backend = this.getEffectiveBackend();

    if (backend === "claude") {
      return await this.runClaudePrompt(prompt, onChunk);
    }

    if (backend === "openai") {
      return await this.runOpenAIPrompt(prompt);
    }

    if (backend === "anthropic") {
      return await this.runAnthropicPrompt(prompt);
    }

    return await this.runCodexPrompt(prompt);
  }

  private async runClaudePrompt(prompt: string, _onChunk?: (text: string) => void): Promise<string> {
    const command = resolveClaudeCommand(this.settings.claudeCommand);
    const model = this.settings.claudeModel || DEFAULT_SETTINGS.claudeModel;
    // --no-session-persistence: prevents loading project CLAUDE.md/memory (saves ~80k tokens and ~10-20s per call).
    // --output-format json: gives token usage info.
    const args = ["--print", "--no-session-persistence", "--output-format", "json", "--model", model];

    const handle = spawnProcess(command, args, prompt, this.settings.timeoutSeconds * 1000);
    this.currentKills.add(handle.kill);

    try {
      const result = await handle.promise;
      if (result.code !== 0) {
        throw new Error(compactProcessError(result.stderr || result.stdout));
      }

      try {
        const parsed = JSON.parse(result.stdout) as ClaudeJsonResult;
        if (parsed.usage) {
          const cachedInput = parsed.usage.cache_read_input_tokens ?? 0;
          this.recordTokenUsage({
            cachedInput,
            input: (parsed.usage.input_tokens ?? 0)
              + (parsed.usage.cache_creation_input_tokens ?? 0)
              + cachedInput,
            output: parsed.usage.output_tokens ?? 0,
            reasoningOutput: 0
          });
        }
        return parsed.result ?? result.stdout;
      } catch {
        return result.stdout;
      }
    } finally {
      this.currentKills.delete(handle.kill);
    }
  }

  private async runCodexPrompt(prompt: string): Promise<string> {
    const tempDir = await mkdtemp(join(tmpdir(), "codex-obsidian-"));
    const outputPath = join(tempDir, "translation.txt");

    try {
      const handle = spawnProcess(
        resolveCodexCommand(this.settings.codexCommand),
        [
          "exec",
          "--ignore-user-config",
          "--ignore-rules",
          "--ephemeral",
          "--skip-git-repo-check",
          "--color",
          "never",
          "--json",
          "--disable",
          "plugins",
          "--disable",
          "tool_suggest",
          "--disable",
          "multi_agent",
          "--disable",
          "browser_use",
          "--disable",
          "computer_use",
          "--disable",
          "image_generation",
          "--disable",
          "workspace_dependencies",
          "-C",
          tmpdir(),
          "-s",
          "read-only",
          "-m",
          this.settings.model,
          "-c",
          `model_reasoning_effort="${this.settings.reasoningEffort}"`,
          "-o",
          outputPath,
          "-"
        ],
        prompt,
        this.settings.timeoutSeconds * 1000
      );
      this.currentKills.add(handle.kill);

      try {
        const result = await handle.promise;

        if (result.code !== 0) {
          throw new Error(compactProcessError(result.stderr || result.stdout));
        }

        const codexUsage = parseCodexJsonUsage(result.stdout);
        if (codexUsage) {
          this.recordTokenUsage(codexUsage);
        }

        return await readFile(outputPath, "utf8");
      } finally {
        this.currentKills.delete(handle.kill);
      }
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  }

  private async runOpenAIPrompt(prompt: string): Promise<string> {
    const apiKey = this.settings.openaiApiKey.trim();
    if (!apiKey) {
      throw new Error("OpenAI API key is not configured.");
    }

    const baseUrl = normalizeApiBaseUrl(this.settings.openaiBaseUrl, DEFAULT_SETTINGS.openaiBaseUrl);
    const model = this.settings.openaiModel.trim() || DEFAULT_SETTINGS.openaiModel;
    const response = await requestUrl({
      url: `${baseUrl}/chat/completions`,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Follow the user prompt exactly. Return only the requested content." },
          { role: "user", content: prompt }
        ],
        temperature: 0.2
      }),
      throw: false
    });

    const data = parseOpenAIChatCompletionResult(response.json);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(data?.error?.message || `OpenAI API HTTP ${response.status}`);
    }

    const usage = data?.usage;
    if (usage) {
      const cachedInput = usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens ?? 0;
      this.recordTokenUsage({
        cachedInput,
        input: usage.prompt_tokens ?? 0,
        output: usage.completion_tokens ?? 0,
        reasoningOutput: 0
      });
    }

    const content = data?.choices?.[0]?.message?.content;
    return normalizeAITextContent(content);
  }

  private async runAnthropicPrompt(prompt: string): Promise<string> {
    const apiKey = this.settings.anthropicApiKey.trim();
    if (!apiKey) {
      throw new Error("Anthropic API key is not configured.");
    }

    const baseUrl = normalizeApiBaseUrl(this.settings.anthropicBaseUrl, DEFAULT_SETTINGS.anthropicBaseUrl);
    const model = this.settings.anthropicModel.trim() || DEFAULT_SETTINGS.anthropicModel;
    const response = await requestUrl({
      url: `${baseUrl}/messages`,
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        temperature: 0.2,
        system: "Follow the user prompt exactly. Return only the requested content.",
        messages: [
          { role: "user", content: prompt }
        ]
      }),
      throw: false
    });

    const data = parseAnthropicMessageResult(response.json);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(data?.error?.message || `Anthropic API HTTP ${response.status}`);
    }

    const usage = data?.usage;
    if (usage) {
      const cachedInput = usage.cache_read_input_tokens ?? 0;
      this.recordTokenUsage({
        cachedInput,
        input: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + cachedInput,
        output: usage.output_tokens ?? 0,
        reasoningOutput: 0
      });
    }

    return normalizeAITextContent(data?.content);
  }

  stopCurrentTranslation() {
    this.operationCancelled = true;
    this.currentKills.forEach((k) => k());
    this.currentKills.clear();
    this.requestSerial++;
  }

  private startOperation(onTokensUpdate?: (tokens: TokenUsage) => void) {
    this.operationCancelled = false;
    this.sessionTokens = createEmptyTokenUsage();
    this.onTokensUpdate = onTokensUpdate;
  }

  private recordTokenUsage(delta: TokenUsage) {
    this.sessionTokens = addTokenUsage(this.sessionTokens, delta);
    this.onTokensUpdate?.({ ...this.sessionTokens });
  }

  private getCurrentTokenUsage(): TokenUsage {
    return { ...this.sessionTokens };
  }

  private tokenUsageSuffix(): string {
    const usage = this.getCurrentTokenUsage();
    return hasTokenUsage(usage) ? ` Token usage: ${formatTokenUsage(usage)}.` : "";
  }

  private beginOverlayOperation(): boolean {
    if (this.overlayOperationRunning) {
      new Notice("Another translation is already running. Stop it before starting a new one.");
      return false;
    }

    this.overlayOperationRunning = true;
    return true;
  }

  private finishOverlayOperation() {
    this.overlayOperationRunning = false;
  }

  private get isCancelled() {
    return this.operationCancelled;
  }

  private async translateMarkdownDocument(
    sourceText: string,
    overlay: TranslationProgressOverlay,
    progressLabel: string
  ): Promise<{ blocks: MarkdownBlock[]; fullText: string; translations: string[]; units: TranslationUnit[] }> {
    const backendLabel = this.getBackendLabel();
    const { body } = extractFrontmatter(sourceText);
    const blocks = splitMarkdownBlocks(body);
    const units = buildTranslationUnits(blocks);

    if (blocks.length === 0) {
      return { blocks, fullText: "", translations: [], units: [] };
    }

    const totalChars = blocks.reduce((sum, b) => sum + b.text.length, 0);
    overlay.setDetail([
      `${blocks.length} paragraphs · ${units.length} translation units · ${formatCharacterCount(totalChars)} characters`,
      previewBlockText(blocks[0]?.text ?? "")
    ].filter(Boolean).join("\n\n"));
    const effectiveSingleShotMaxChars = Math.max(this.settings.singleShotMaxChars, DEFAULT_SETTINGS.singleShotMaxChars);
    const effectiveBatchChunkChars = Math.max(this.settings.batchChunkChars, DEFAULT_SETTINGS.batchChunkChars);
    const useSingleShot = totalChars <= effectiveSingleShotMaxChars;

    let translations: string[];

    if (useSingleShot) {
      // Small file: single AI call
      const onChunk = (chunk: string) => overlay.appendChunk(chunk);
      overlay.setStatus(`${progressLabel} · 0/${units.length} units · single request`);
      this.setStatus(`${backendLabel} ${progressLabel} 0/${units.length}`);
      translations = await this.translateBlockBatch(units.map((unit) => unit.text), onChunk);
      if (this.isCancelled) throw new Error("Translation stopped.");
      overlay.setStatus(`${progressLabel} · ${units.length}/${units.length} units · inserting`);
    } else {
      // Large file: parallel AI batches (3 concurrent)
      const batches = buildBlockBatches(units, effectiveBatchChunkChars);
      const results = new Array<string[]>(batches.length);
      let completed = 0;
      let completedUnits = 0;
      let completedParagraphs = 0;
      const CONCURRENCY = 3;

      let inFlight = 0;
      const updateStatus = (activeBatch?: MarkdownBlockBatch) => {
        const label = inFlight > 0
          ? `${progressLabel} · batch ${completed}/${batches.length} done · ${completedUnits}/${units.length} units · ${completedParagraphs}/${blocks.length} paragraphs · ${inFlight} running`
          : `${progressLabel} · batch ${completed}/${batches.length} done · ${completedUnits}/${units.length} units · ${completedParagraphs}/${blocks.length} paragraphs`;
        overlay.setStatus(label);
        if (activeBatch) {
          overlay.setDetail([
            `Current batch: units ${activeBatch.startUnit + 1}-${activeBatch.endUnit} · ${formatCharacterCount(activeBatch.charCount)} chars`,
            previewBlockText(activeBatch.units[0]?.text ?? "")
          ].filter(Boolean).join("\n\n"));
        }
        this.setStatus(`${backendLabel} ${completed}/${batches.length} batches · ${completedUnits}/${units.length} units`);
      };

      const queue = batches.map((batch, i) => ({ batch, i }));
      const workers = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
        while (queue.length > 0 && !this.isCancelled) {
          const item = queue.shift();
          if (!item) break;
          inFlight++;
          updateStatus(item.batch);
          results[item.i] = await this.translateBlockBatch(item.batch.units.map((unit) => unit.text));
          inFlight--;
          completed++;
          completedUnits += item.batch.units.length;
          completedParagraphs += item.batch.units.reduce((sum, unit) => sum + unit.endBlock - unit.startBlock, 0);
          updateStatus(item.batch);
        }
      });

      await Promise.all(workers);
      if (this.isCancelled) throw new Error("Translation stopped.");
      translations = results.filter(Boolean).flat();
    }

    return {
      blocks,
      fullText: joinTranslatedBlocks(units, translations),
      translations,
      units
    };
  }

  private async translateBlockBatch(blockTexts: string[], onChunk?: (chunk: string) => void): Promise<string[]> {
    if (this.isCancelled) throw new Error("Translation stopped.");

    const prompt = buildBlockTranslationPrompt(blockTexts, this.settings.customPrompt);
    const rawResult = await this.runAIPrompt(prompt, onChunk);

    if (this.isCancelled) throw new Error("Translation stopped.");

    try {
      return parseTranslationArray(rawResult, blockTexts.length);
    } catch (error) {
      if (this.isCancelled) throw new Error("Translation stopped.");
      console.warn("Block translation had the wrong delimiter count; retrying with smaller batches.", error);

      if (blockTexts.length === 1) {
        return [(await this.runAITranslation(blockTexts[0])).trim()];
      }

      const midpoint = Math.ceil(blockTexts.length / 2);
      const left = await this.translateBlockBatch(blockTexts.slice(0, midpoint), onChunk);
      const right = await this.translateBlockBatch(blockTexts.slice(midpoint), onChunk);
      return [...left, ...right];
    }
  }

  private getEffectiveBackend(): Exclude<AIBackend, "auto"> {
    if (this.settings.aiBackend === "claude") {
      return "claude";
    }

    if (this.settings.aiBackend === "codex") {
      return "codex";
    }

    if (this.settings.aiBackend === "openai") {
      return "openai";
    }

    if (this.settings.aiBackend === "anthropic") {
      return "anthropic";
    }

    if (hasCodexCommand(this.settings.codexCommand)) {
      return "codex";
    }

    if (hasClaudeCommand(this.settings.claudeCommand)) {
      return "claude";
    }

    return "codex";
  }

  private getBackendLabel(): string {
    const backend = this.getEffectiveBackend();
    if (backend === "claude") return "Claude Code";
    if (backend === "openai") return "OpenAI API";
    if (backend === "anthropic") return "Anthropic API";
    return "Codex";
  }

  private async ensureExcerptFile(): Promise<TFile> {
    const path = normalizeExcerptPath(this.settings.excerptFilePath);
    await this.ensureParentFolders(path);

    const existing = this.app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFile) {
      return existing;
    }

    if (existing) {
      throw new Error(`Excerpt path exists but is not a file: ${path}`);
    }

    return await this.app.vault.create(path, "# Contextual AI Reader Excerpts\n\n");
  }

  private async ensureParentFolders(filePath: string) {
    const folders = filePath.split("/").slice(0, -1);
    let currentPath = "";

    for (const folder of folders) {
      currentPath = currentPath ? `${currentPath}/${folder}` : folder;
      const existing = this.app.vault.getAbstractFileByPath(currentPath);

      if (existing instanceof TFolder) {
        continue;
      }

      if (existing) {
        throw new Error(`Cannot create folder because a file already exists: ${currentPath}`);
      }

      await this.app.vault.createFolder(currentPath);
    }
  }

  private async getSourceReference(sourceText: string): Promise<SourceReference | null> {
    const file = this.app.workspace.getActiveFile();

    if (!file) {
      return null;
    }

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView?.file?.path === file.path && sameNormalized(activeView.editor.getSelection(), sourceText)) {
      const from = activeView.editor.getCursor("from");
      const to = activeView.editor.getCursor("to");
      return {
        path: file.path,
        line: from.line + 1,
        endLine: to.line + 1
      };
    }

    if (file.extension !== "md") {
      return { path: file.path };
    }

    const content = await this.app.vault.cachedRead(file);
    const range = findSelectionRange(content, sourceText);

    if (!range) {
      return { path: file.path };
    }

    return {
      path: file.path,
      line: getLineNumberAtOffset(content, range.start),
      endLine: getLineNumberAtOffset(content, Math.max(range.start, range.end - 1))
    };
  }

  private async openExcerptFile(file: TFile) {
    const leaf = this.app.workspace.getLeaf("split", "vertical");
    await leaf.openFile(file, { active: false });
  }

  private async getAvailableVaultPath(path: string): Promise<string> {
    const normalized = normalizePath(path);
    const dotIndex = normalized.lastIndexOf(".");
    const base = dotIndex >= 0 ? normalized.slice(0, dotIndex) : normalized;
    const extension = dotIndex >= 0 ? normalized.slice(dotIndex) : "";
    let candidate = normalized;
    let counter = 2;

    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${base} ${counter}${extension}`;
      counter++;
    }

    return candidate;
  }

  private async getVocabularyContext(sourceText: string): Promise<VocabularyContext> {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = activeView?.file;

    if (!activeView || !file) {
      return { paragraph: "" };
    }

    const content = activeView.getViewData();
    const range = findSelectionRange(content, sourceText);
    const paragraph = range
      ? extractParagraphAround(content, range.start, range.end)
      : "";

    return {
      filePath: file.path,
      paragraph
    };
  }

  private findCachedVocabularyBase(word: string): string | undefined {
    const normalizedWord = normalizeVocabularyWord(word);

    return Object.values(this.settings.vocabularyCache)
      .find((entry) => normalizeVocabularyWord(entry.word) === normalizedWord && entry.baseDefinition)
      ?.baseDefinition;
  }

  private async rememberVocabulary(cacheKey: string, entry: VocabularyCacheEntry) {
    this.settings.vocabularyCache[cacheKey] = entry;

    const entries = Object.entries(this.settings.vocabularyCache);
    if (entries.length > 300) {
      entries
        .sort((left, right) => left[1].updatedAt - right[1].updatedAt)
        .slice(0, entries.length - 300)
        .forEach(([key]) => delete this.settings.vocabularyCache[key]);
    }

    await this.saveSettings();
  }

  private rememberTranslation(sourceText: string, translation: string) {
    this.translationCache.set(sourceText, translation);

    if (this.translationCache.size > 30) {
      const oldestKey = this.translationCache.keys().next().value as string | undefined;
      if (oldestKey) {
        this.translationCache.delete(oldestKey);
      }
    }
  }

  private showPopupLoading(backendLabel: string, rect: DOMRect, onStop: () => void) {
    const popup = this.ensurePopup();
    popup.empty();
    popup.classList.remove("is-error");
    popup.classList.add("is-loading");

    const statusRow = activeDocument.createElement("div");
    statusRow.className = "ai-reader-status-row";

    const spinner = activeDocument.createElement("span");
    spinner.className = "ai-reader-spin";
    spinner.setText("⟳");
    statusRow.appendChild(spinner);

    const label = activeDocument.createElement("span");
    label.className = "ai-reader-status-label";
    label.setText(`${backendLabel} · 0s`);
    statusRow.appendChild(label);

    const stopBtn = activeDocument.createElement("button");
    stopBtn.type = "button";
    stopBtn.className = "contextual-ai-reader-stop-btn";
    stopBtn.setText("■ Stop");
    stopBtn.addEventListener("mousedown", (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); });
    stopBtn.addEventListener("click", (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); onStop(); });
    statusRow.appendChild(stopBtn);

    popup.appendChild(statusRow);

    const streamBody = activeDocument.createElement("div");
    streamBody.className = "ai-reader-stream-body";
    popup.appendChild(streamBody);

    popup.removeClass("is-hidden");
    this.positionPopup(rect);
  }

  private updatePopupTimer(secs: number) {
    const popup = this.popupEl;
    if (!popup) return;
    const label = popup.querySelector<HTMLElement>(".ai-reader-status-label");
    if (label) {
      const text = label.getText();
      const base = text.replace(/ · \d+s$/, "");
      label.setText(`${base} · ${secs}s`);
    }
  }

  private updatePopupTokens(tokens: TokenUsage) {
    const popup = this.popupEl;
    if (!popup) return;
    let tokensEl = popup.querySelector<HTMLElement>(".ai-reader-popup-tokens");
    if (!tokensEl) {
      tokensEl = popup.querySelector<HTMLElement>(".ai-reader-status-row")
        ?.createSpan({ cls: "ai-reader-popup-tokens" }) ?? null;
    }
    if (tokensEl) {
      tokensEl.setText(formatTokenUsageCompact(tokens));
    }
  }

  private updatePopupStreamText(text: string) {
    const popup = this.popupEl;
    if (!popup) return;
    const body = popup.querySelector<HTMLElement>(".ai-reader-stream-body");
    if (body) body.setText(text);
  }

  private updateVocabularyStatus(text: string) {
    const popup = this.popupEl;
    if (!popup) return;
    const status = popup.querySelector<HTMLElement>(".contextual-ai-reader-vocab-status");
    if (status) status.setText(text);
  }

  private showVocabularyPopup(
    card: VocabularyCard,
    sourceText: string,
    context: VocabularyContext,
    rect: DOMRect,
    requestId: number,
    cacheKey: string
  ) {
    const popup = this.ensurePopup();
    popup.empty();
    popup.classList.toggle("is-loading", card.status === "loading");
    popup.classList.toggle("is-error", card.status === "error");

    const body = activeDocument.createElement("div");
    body.className = "contextual-ai-reader-vocab";

    const wordEl = body.createDiv("contextual-ai-reader-vocab-word");
    wordEl.setText(card.word);

    const localEl = body.createDiv("contextual-ai-reader-vocab-section");
    localEl.createDiv("contextual-ai-reader-vocab-label").setText("基础释义");
    localEl.createDiv("contextual-ai-reader-vocab-text").setText(
      card.baseDefinition || "本地词典和缓存暂无命中。"
    );

    const contextEl = body.createDiv("contextual-ai-reader-vocab-section");
    contextEl.createDiv("contextual-ai-reader-vocab-label").setText("当前语境");
    contextEl.createDiv("contextual-ai-reader-vocab-text").setText(
      card.contextExplanation ||
      (card.status === "loading"
        ? `${this.getBackendLabel()} 正在结合当前段落解释…`
        : card.errorText || "点击 AI 按钮生成这个词在当前段落里的意思。")
    );

    if (card.status === "loading") {
      const status = body.createDiv("contextual-ai-reader-vocab-status");
      status.setText(`${this.getBackendLabel()} 正在结合上下文解释…`);
    }

    if (card.tokenUsage && hasTokenUsage(card.tokenUsage)) {
      const usageEl = body.createDiv("contextual-ai-reader-usage");
      usageEl.setText(`Token usage: ${formatTokenUsage(card.tokenUsage)}`);
    }

    popup.appendChild(body);

    const actions = activeDocument.createElement("div");
    actions.className = "contextual-ai-reader-actions";

    actions.appendChild(this.createIconButton("volume-2", "Read selected word", () => {
      void this.speakText(sourceText);
    }));

    const aiButton = this.createIconButton("sparkles", `Explain in context with ${this.getBackendLabel()}`, () => {
      void this.enhanceVocabularyWithAI(
        sourceText,
        card.word,
        context,
        rect,
        requestId,
        cacheKey,
        card.baseDefinition
      );
    });
    aiButton.disabled = card.status === "loading";
    actions.appendChild(aiButton);

    actions.appendChild(this.createIconButton("book-plus", "Save word to excerpts", () => {
      void this.saveExcerpt(sourceText, formatVocabularyCard(card, context));
    }));

    actions.appendChild(this.createIconButton("copy", "Copy vocabulary note", () => {
      void navigator.clipboard.writeText(formatVocabularyCard(card, context));
      new Notice("Vocabulary note copied.");
    }));

    popup.appendChild(actions);
    popup.removeClass("is-hidden");
    this.positionPopup(rect);
  }

  private showPopup(
    text: string,
    sourceText: string,
    rect: DOMRect,
    state: "loading" | "done" | "error",
    tokenUsage?: TokenUsage
  ) {
    const popup = this.ensurePopup();
    popup.empty();
    popup.classList.toggle("is-loading", state === "loading");
    popup.classList.toggle("is-error", state === "error");

    const body = activeDocument.createElement("div");
    body.className = "contextual-ai-reader-body";
    body.setText(text);
    popup.appendChild(body);

    if (tokenUsage && hasTokenUsage(tokenUsage)) {
      const usageEl = activeDocument.createElement("div");
      usageEl.className = "contextual-ai-reader-usage";
      usageEl.setText(`Token usage: ${formatTokenUsage(tokenUsage)}`);
      popup.appendChild(usageEl);
    }

    const actions = activeDocument.createElement("div");
    actions.className = "contextual-ai-reader-actions";

    actions.appendChild(this.createIconButton("volume-2", "Read original English", () => {
      void this.speakText(sourceText);
    }));

    actions.appendChild(this.createIconButton("book-plus", "Save excerpt", () => {
      void this.saveExcerpt(sourceText, state === "done" ? text : undefined);
    }));

    if (state === "done") {
      actions.appendChild(this.createIconButton("copy", "Copy translation", () => {
        void navigator.clipboard.writeText(text);
        new Notice("Translation copied.");
      }));
    }

    popup.appendChild(actions);
    popup.removeClass("is-hidden");
    this.positionPopup(rect);
  }

  private createIconButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = activeDocument.createElement("button");
    button.type = "button";
    button.className = "contextual-ai-reader-button";
    button.ariaLabel = label;
    button.title = label;
    setIcon(button, icon);
    button.addEventListener("mousedown", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });

    return button;
  }

  private ensurePopup(): HTMLDivElement {
    if (this.popupEl) {
      return this.popupEl;
    }

    const popup = activeDocument.createElement("div");
    popup.className = "contextual-ai-reader-popover";
    popup.addClass("is-hidden");
    popup.addEventListener("wheel", (event: WheelEvent) => event.stopPropagation(), { passive: true });
    popup.addEventListener("touchmove", (event: TouchEvent) => event.stopPropagation(), { passive: true });
    activeDocument.body.appendChild(popup);
    this.popupEl = popup;

    return popup;
  }

  private positionPopup(rect: DOMRect) {
    if (!this.popupEl) {
      return;
    }

    const gap = 8;
    const margin = 12;
    const popupBox = this.popupEl.getBoundingClientRect();
    const maxLeft = window.scrollX + window.innerWidth - popupBox.width - margin;
    const minLeft = window.scrollX + margin;
    const belowTop = window.scrollY + rect.bottom + gap;
    const aboveTop = window.scrollY + rect.top - popupBox.height - gap;
    const bottomLimit = window.scrollY + window.innerHeight - margin;

    const left = clamp(window.scrollX + rect.left, minLeft, Math.max(minLeft, maxLeft));
    const top = belowTop + popupBox.height > bottomLimit ? Math.max(window.scrollY + margin, aboveTop) : belowTop;

    this.popupEl.setCssProps({
      "--ai-reader-popover-left": `${left}px`,
      "--ai-reader-popover-top": `${top}px`
    });
  }

  private hidePopup() {
    if (!this.popupEl) {
      return;
    }

    this.popupEl.addClass("is-hidden");
  }

  private setStatus(text: string) {
    if (!this.statusBarEl) {
      return;
    }

    this.statusBarEl.setText(text);
  }
}

class TranslationProgressOverlay {
  private el: HTMLDivElement;
  private labelEl: HTMLSpanElement;
  private tokensEl: HTMLSpanElement;
  private textEl: HTMLDivElement;
  private accumulated = "";
  private readonly backendLabel: string;
  private elapsedSecs = 0;
  private statusText = "";

  constructor(
    container: HTMLElement,
    backendLabel: string,
    private readonly onStop: () => void
  ) {
    this.backendLabel = backendLabel;
    this.el = container.createDiv("ai-reader-overlay");

    const header = this.el.createDiv("ai-reader-overlay-header");

    const spinner = header.createSpan("ai-reader-overlay-spinner");
    spinner.setText("⟳");

    this.labelEl = header.createSpan({ cls: "ai-reader-overlay-title" });
    this.labelEl.setText(`${backendLabel} · 0s`);

    this.tokensEl = header.createSpan({ cls: "ai-reader-overlay-tokens" });

    const stopBtn = header.createEl("button", { cls: "ai-reader-overlay-stop" });
    stopBtn.setText("■ Stop");
    stopBtn.addEventListener("click", () => {
      this.setStatus("Stopping...");
      this.setDetail("Stopping running AI process. This prevents queued batches from starting and kills active local CLI processes.");
      this.onStop();
    });

    this.textEl = this.el.createDiv("ai-reader-overlay-text");
    this.textEl.setText("Waiting for response…");
  }

  private refreshLabel() {
    this.labelEl.setText(
      this.statusText
        ? `${this.statusText} · ${this.elapsedSecs}s`
        : `${this.backendLabel} · ${this.elapsedSecs}s`
    );
  }

  setElapsed(secs: number) {
    this.elapsedSecs = secs;
    this.refreshLabel();
  }

  setStatus(text: string) {
    this.statusText = text;
    this.refreshLabel();
  }

  setDetail(text: string) {
    this.accumulated = "";
    this.textEl.setText(text || "Waiting for response…");
  }

  setTokens(tokens: TokenUsage) {
    this.tokensEl.setText(formatTokenUsageCompact(tokens));
  }

  appendChunk(chunk: string) {
    this.accumulated += chunk;
    this.textEl.setText(this.accumulated.slice(-400));
  }

  clearChunks() {
    this.accumulated = "";
    this.textEl.setText("Waiting for response…");
  }

  remove() {
    this.el.remove();
  }
}

class BatchScopeModal extends Modal {
  constructor(
    app: App,
    private readonly mode: FullDocumentInsertMode,
    private readonly onSubmitScope: (scopeText: string) => Promise<void>
  ) {
    super(app);
  }

  onOpen() {
    this.setTitle(this.mode === "append"
      ? "Batch translate: append Chinese below"
      : "Batch translate: interleave Chinese paragraphs");
    this.contentEl.empty();

    const description = activeDocument.createElement("p");
    description.className = "contextual-ai-reader-batch-description";
    description.setText("Enter one Markdown file, folder, or wildcard per line. This command writes directly to the matched files.");
    this.contentEl.appendChild(description);

    const textarea = activeDocument.createElement("textarea");
    textarea.className = "contextual-ai-reader-batch-input";
    textarea.placeholder = [
      "Books/Example Book/",
      "Books/Example Book/08 - Chapter 1.md",
      "Books/Example Book/*.md",
      "Books/Example Book/**/*.md"
    ].join("\n");
    this.contentEl.appendChild(textarea);

    const actions = activeDocument.createElement("div");
    actions.className = "contextual-ai-reader-batch-actions";

    const cancelButton = activeDocument.createElement("button");
    cancelButton.type = "button";
    cancelButton.setText("Cancel");
    cancelButton.addEventListener("click", () => {
      this.close();
    });

    const startButton = activeDocument.createElement("button");
    startButton.type = "button";
    startButton.className = "mod-cta";
    startButton.setText("Start");
    startButton.addEventListener("click", () => {
      const scopeText = textarea.value.trim();

      if (!scopeText) {
        new Notice("Enter at least one Markdown file, folder, or wildcard.");
        return;
      }

      this.close();
      void this.onSubmitScope(scopeText);
    });

    actions.appendChild(cancelButton);
    actions.appendChild(startButton);
    this.contentEl.appendChild(actions);

    window.setTimeout(() => textarea.focus(), 0);
  }
}

class ContextualAIReaderSettingTab extends PluginSettingTab {
  plugin: ContextualAIReaderPlugin;

  constructor(app: App, plugin: ContextualAIReaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const modifierLabel = getPrimaryModifierLabel();

    new Setting(containerEl)
      .setName("AI backend")
      .setDesc("Auto uses local Codex when available, then falls back to local Claude Code. API modes use the token configured below.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "Auto (Codex if available)")
          .addOption("codex", "Codex (ChatGPT plan)")
          .addOption("claude", "Claude Code (Claude plan)")
          .addOption("openai", "OpenAI API token")
          .addOption("anthropic", "Anthropic API token")
          .setValue(this.plugin.settings.aiBackend)
          .onChange(async (value) => {
            this.plugin.settings.aiBackend = value as AIBackend;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.aiBackend === "auto" || this.plugin.settings.aiBackend === "claude") {
      new Setting(containerEl)
        .setName("Claude command")
        .setDesc("Used by Claude or Auto mode. Leave empty to auto-detect the Claude Code CLI.")
        .addText((text) =>
          text
            .setPlaceholder(process.platform === "win32" ? "claude.cmd" : "/opt/homebrew/bin/claude")
            .setValue(this.plugin.settings.claudeCommand)
            .onChange(async (value) => {
              this.plugin.settings.claudeCommand = value.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Claude model")
        .setDesc("Used by Claude or Auto mode when Claude Code is available.")
        .addText((text) =>
          text
            .setPlaceholder("claude-sonnet-4-5")
            .setValue(this.plugin.settings.claudeModel)
            .onChange(async (value) => {
              this.plugin.settings.claudeModel = value.trim() || DEFAULT_SETTINGS.claudeModel;
              await this.plugin.saveSettings();
            })
        );
    }

    if (this.plugin.settings.aiBackend === "openai") {
      new Setting(containerEl)
        .setName("OpenAI API key")
        .setDesc("Stored in this plugin's local Obsidian settings. Required only for OpenAI API mode.")
        .addText((text) => {
          text.inputEl.type = "password";
          text
            .setPlaceholder("sk-...")
            .setValue(this.plugin.settings.openaiApiKey)
            .onChange(async (value) => {
              this.plugin.settings.openaiApiKey = value.trim();
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName("OpenAI model")
        .setDesc("Used by OpenAI API mode.")
        .addText((text) =>
          text
            .setPlaceholder("gpt-4.1-mini")
            .setValue(this.plugin.settings.openaiModel)
            .onChange(async (value) => {
              this.plugin.settings.openaiModel = value.trim() || DEFAULT_SETTINGS.openaiModel;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("OpenAI base URL")
        .setDesc("Keep the default for OpenAI, or set an OpenAI-compatible endpoint.")
        .addText((text) =>
          text
            .setPlaceholder("https://api.openai.com/v1")
            .setValue(this.plugin.settings.openaiBaseUrl)
            .onChange(async (value) => {
              this.plugin.settings.openaiBaseUrl = value.trim() || DEFAULT_SETTINGS.openaiBaseUrl;
              await this.plugin.saveSettings();
            })
        );
    }

    if (this.plugin.settings.aiBackend === "anthropic") {
      new Setting(containerEl)
        .setName("Anthropic API key")
        .setDesc("Stored in this plugin's local Obsidian settings. Required only for Anthropic API mode.")
        .addText((text) => {
          text.inputEl.type = "password";
          text
            .setPlaceholder("sk-ant-...")
            .setValue(this.plugin.settings.anthropicApiKey)
            .onChange(async (value) => {
              this.plugin.settings.anthropicApiKey = value.trim();
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName("Anthropic model")
        .setDesc("Used by Anthropic API mode.")
        .addText((text) =>
          text
            .setPlaceholder("claude-sonnet-4-5")
            .setValue(this.plugin.settings.anthropicModel)
            .onChange(async (value) => {
              this.plugin.settings.anthropicModel = value.trim() || DEFAULT_SETTINGS.anthropicModel;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Anthropic base URL")
        .setDesc("Keep the default unless you use a compatible proxy.")
        .addText((text) =>
          text
            .setPlaceholder("https://api.anthropic.com/v1")
            .setValue(this.plugin.settings.anthropicBaseUrl)
            .onChange(async (value) => {
              this.plugin.settings.anthropicBaseUrl = value.trim() || DEFAULT_SETTINGS.anthropicBaseUrl;
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("Auto translate selection")
      .setDesc("Show a translation popup shortly after text is selected.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoTranslate)
          .onChange(async (value) => {
            this.plugin.settings.autoTranslate = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(`Require ${modifierLabel} key for auto translate`)
      .setDesc(`When enabled, the popup only appears if you hold ${modifierLabel} while selecting text.`)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.requireCommandForAutoTranslate)
          .onChange(async (value) => {
            this.plugin.settings.requireCommandForAutoTranslate = value;
            await this.plugin.saveSettings();
          })
      );

    if (this.plugin.settings.aiBackend === "auto" || this.plugin.settings.aiBackend === "codex") {
      new Setting(containerEl)
        .setName("Codex command")
        .setDesc("Used by Codex or Auto fallback. Leave empty to auto-detect Codex.app or the local Codex CLI.")
        .addText((text) =>
          text
            .setPlaceholder(process.platform === "win32" ? "codex.cmd" : "/Applications/Codex.app/Contents/Resources/codex")
            .setValue(this.plugin.settings.codexCommand)
            .onChange(async (value) => {
              this.plugin.settings.codexCommand = value.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Codex model")
        .setDesc("Used by Codex or Auto fallback. For ChatGPT login, gpt-5.4-mini is a good default.")
        .addText((text) =>
          text
            .setPlaceholder("gpt-5.4-mini")
            .setValue(this.plugin.settings.model)
            .onChange(async (value) => {
              this.plugin.settings.model = value.trim() || DEFAULT_SETTINGS.model;
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("Custom prompt / context")
      .setDesc("Add translation background or preferences, for example the book or domain you are reading.")
      .addTextArea((text) => {
        text
          .setPlaceholder("我正在阅读《穷查理宝典》。请结合投资、商业、心理学和芒格语境翻译，保持中文自然准确。")
          .setValue(this.plugin.settings.customPrompt)
          .onChange(async (value) => {
            this.plugin.settings.customPrompt = value.trim();
            await this.plugin.saveSettings();
          });

        text.inputEl.rows = 6;
        text.inputEl.addClass("contextual-ai-reader-settings-textarea");
      });

    new Setting(containerEl)
      .setName("Excerpt file")
      .setDesc("Vault path where selected passages are saved.")
      .addText((text) =>
        text
          .setPlaceholder("Contextual AI Reader Excerpts.md")
          .setValue(this.plugin.settings.excerptFilePath)
          .onChange(async (value) => {
            this.plugin.settings.excerptFilePath = value.trim() || DEFAULT_SETTINGS.excerptFilePath;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Open excerpt file after saving")
      .setDesc("Open the excerpt note in a right-side split after saving.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openExcerptAfterSave)
          .onChange(async (value) => {
            this.plugin.settings.openExcerptAfterSave = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Include translation in excerpts")
      .setDesc("When available, save the popup translation under the original text.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeTranslationInExcerpt)
          .onChange(async (value) => {
            this.plugin.settings.includeTranslationInExcerpt = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Speech language")
      .setDesc("Language tag used by the system text-to-speech voice.")
      .addText((text) =>
        text
          .setPlaceholder("en-US")
          .setValue(this.plugin.settings.speechLanguage)
          .onChange(async (value) => {
            this.plugin.settings.speechLanguage = value.trim() || DEFAULT_SETTINGS.speechLanguage;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Speech rate")
      .setDesc("Use a value between 0.5 and 1.5.")
      .addText((text) =>
        text
          .setPlaceholder("0.92")
          .setValue(String(this.plugin.settings.speechRate))
          .onChange(async (value) => {
            const parsed = Number.parseFloat(value);
            this.plugin.settings.speechRate = Number.isFinite(parsed)
              ? clamp(parsed, 0.5, 1.5)
              : DEFAULT_SETTINGS.speechRate;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto translate delay")
      .setDesc("Milliseconds to wait after selection changes.")
      .addText((text) =>
        text
          .setPlaceholder("450")
          .setValue(String(this.plugin.settings.debounceMs))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.debounceMs = Number.isFinite(parsed)
              ? clamp(parsed, 150, 3000)
              : DEFAULT_SETTINGS.debounceMs;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Minimum selection length")
      .setDesc("Shorter selections will not trigger automatic translation.")
      .addText((text) =>
        text
          .setPlaceholder("2")
          .setValue(String(this.plugin.settings.minSelectionChars))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.minSelectionChars = Number.isFinite(parsed)
              ? clamp(parsed, 1, 200)
              : DEFAULT_SETTINGS.minSelectionChars;
            await this.plugin.saveSettings();
          })
      );

    if (this.plugin.settings.aiBackend === "auto" || this.plugin.settings.aiBackend === "codex") {
      new Setting(containerEl)
        .setName("Reasoning effort")
        .setDesc("Used by Codex or Auto fallback. Use none for translation unless you need heavier reasoning.")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("none", "none")
            .addOption("low", "low")
            .addOption("medium", "medium")
            .addOption("high", "high")
            .addOption("xhigh", "xhigh")
            .setValue(this.plugin.settings.reasoningEffort)
            .onChange(async (value) => {
              this.plugin.settings.reasoningEffort = value as ReasoningEffort;
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("Timeout")
      .setDesc("Maximum seconds to wait for the AI.")
      .addText((text) =>
        text
          .setPlaceholder("90")
          .setValue(String(this.plugin.settings.timeoutSeconds))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.timeoutSeconds = Number.isFinite(parsed)
              ? Math.max(10, parsed)
              : DEFAULT_SETTINGS.timeoutSeconds;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Single-shot translation limit (characters)")
      .setDesc("Documents under this length are sent to the AI in one request for better context. Saved lower values are treated as at least 60000.")
      .addText((text) =>
        text
          .setPlaceholder("60000")
          .setValue(String(this.plugin.settings.singleShotMaxChars))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.singleShotMaxChars = Number.isFinite(parsed) && parsed > 0
              ? parsed
              : DEFAULT_SETTINGS.singleShotMaxChars;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Batch chunk size (characters)")
      .setDesc("When falling back to batch mode, how many characters per chunk. Saved lower values are treated as at least 30000.")
      .addText((text) =>
        text
          .setPlaceholder("30000")
          .setValue(String(this.plugin.settings.batchChunkChars))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.batchChunkChars = Number.isFinite(parsed) && parsed >= 500
              ? parsed
              : DEFAULT_SETTINGS.batchChunkChars;
            await this.plugin.saveSettings();
          })
      );
  }
}

function buildTranslationPrompt(sourceText: string, customPrompt: string): string {
  return [
    "You are a precise Markdown translation engine.",
    "Translate the `text` field in the JSON payload to Simplified Chinese.",
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

function buildVocabularyPrompt(
  word: string,
  selectedText: string,
  context: VocabularyContext,
  customPrompt: string
): string {
  return [
    "You are a concise bilingual vocabulary coach for a Chinese reader.",
    "Explain the selected English word in Simplified Chinese based on the current reading context.",
    customPrompt.trim()
      ? `User custom context and preferences:\n${customPrompt.trim()}`
      : "User custom context and preferences: none.",
    "",
    "Rules:",
    "- Return only the explanation in Simplified Chinese.",
    "- Keep it concise: 3 to 5 short bullet points.",
    "- Explain the word's meaning in this exact context, not only a generic dictionary meaning.",
    "- Include a natural Chinese rendering of the local phrase if helpful.",
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

function getSingleEnglishWord(text: string): string | null {
  const cleaned = text
    .trim()
    .replace(/^[“"'([{]+|[”"')\]}.,;:!?]+$/g, "");

  if (!/^[A-Za-z][A-Za-z'-]{1,39}$/.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function normalizeVocabularyWord(word: string): string {
  return word.toLowerCase().replace(/^'+|'+$/g, "");
}

function buildVocabularyCacheKey(word: string, paragraph: string, customPrompt: string): string {
  const normalizedWord = normalizeVocabularyWord(word);
  const contextHash = hashString(normalizeWhitespace(paragraph).slice(0, 1600));
  const promptHash = hashString(customPrompt.trim());
  return `${normalizedWord}:${contextHash}:${promptHash}`;
}

function extractParagraphAround(content: string, start: number, end: number): string {
  const before = content.slice(0, start);
  const after = content.slice(end);
  const paragraphStartMatch = before.match(/\n\s*\n(?![\s\S]*\n\s*\n)/);
  const paragraphStart = paragraphStartMatch ? before.lastIndexOf(paragraphStartMatch[0]) + paragraphStartMatch[0].length : 0;
  const afterBreak = after.search(/\n\s*\n/);
  const paragraphEnd = afterBreak >= 0 ? end + afterBreak : content.length;

  return content
    .slice(paragraphStart, paragraphEnd)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1800);
}

function getLocalVocabularyDefinition(word: string): string | undefined {
  const normalizedWord = normalizeVocabularyWord(word);
  const candidates = getVocabularyLookupCandidates(normalizedWord);

  for (const candidate of candidates) {
    const definition = LOCAL_EN_ZH_DICTIONARY[candidate];
    if (definition) return definition;
  }

  return undefined;
}

function getVocabularyLookupCandidates(word: string): string[] {
  const candidates = new Set<string>([word]);

  if (word.endsWith("'s")) candidates.add(word.slice(0, -2));
  if (word.endsWith("ies") && word.length > 4) candidates.add(`${word.slice(0, -3)}y`);
  if (word.endsWith("es") && word.length > 3) candidates.add(word.slice(0, -2));
  if (word.endsWith("s") && word.length > 3) candidates.add(word.slice(0, -1));
  if (word.endsWith("ing") && word.length > 5) {
    candidates.add(word.slice(0, -3));
    candidates.add(`${word.slice(0, -3)}e`);
  }
  if (word.endsWith("ed") && word.length > 4) {
    candidates.add(word.slice(0, -2));
    candidates.add(`${word.slice(0, -1)}`);
  }

  return Array.from(candidates);
}

function formatVocabularyCard(card: VocabularyCard, context: VocabularyContext): string {
  const lines = [
    `**${card.word}**`,
    "",
    `- 基础释义：${card.baseDefinition || "本地词典和缓存暂无命中。"}`
  ];

  if (card.contextExplanation) {
    lines.push("", "### 当前语境解释", card.contextExplanation);
  } else if (card.errorText) {
    lines.push("", `### 当前语境解释`, card.errorText);
  }

  if (context.filePath) {
    lines.push("", `Source: [[${context.filePath}]]`);
  }

  if (context.paragraph) {
    lines.push("", "### Context", blockquote(context.paragraph));
  }

  return lines.join("\n");
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const LOCAL_EN_ZH_DICTIONARY: Record<string, string> = {
  ability: "能力；才能",
  abstract: "抽象的；摘要",
  accept: "接受；认可",
  achieve: "实现；达成",
  action: "行动；行为",
  adapt: "适应；调整",
  advantage: "优势；有利条件",
  affect: "影响；情感",
  analysis: "分析",
  appear: "出现；显得",
  appropriate: "合适的；恰当的",
  assume: "假设；承担",
  attention: "注意力；关注",
  attitude: "态度",
  behavior: "行为",
  belief: "信念；看法",
  benefit: "好处；受益",
  bias: "偏见；倾向",
  capability: "能力；性能",
  chapter: "章节",
  characteristic: "特征；特点",
  circumstance: "情形；环境",
  combine: "结合；合并",
  common: "常见的；共同的",
  concept: "概念",
  conclusion: "结论",
  condition: "条件；状态",
  confidence: "信心；确信",
  consider: "考虑；认为",
  considerable: "相当大的；值得注意的",
  consistent: "一致的；稳定的",
  context: "语境；背景",
  decision: "决定；决策",
  define: "定义；界定",
  discipline: "纪律；自律；学科",
  edge: "优势；边缘",
  emotion: "情绪",
  environment: "环境",
  evidence: "证据",
  expectation: "预期；期待",
  experience: "经验；经历",
  extensive: "广泛的；大量的",
  failure: "失败",
  feedback: "反馈",
  fundamental: "根本的；基础的",
  habit: "习惯",
  hypothesis: "假设",
  impact: "影响；冲击",
  imply: "暗示；意味着",
  interpret: "解释；理解",
  judgment: "判断",
  judgement: "判断",
  material: "材料；素材；重要的",
  mental: "心理的；精神的",
  misjudgement: "误判；判断错误",
  misjudgment: "误判；判断错误",
  opportunity: "机会",
  paragraph: "段落",
  perceive: "感知；理解",
  perspective: "视角；观点",
  phrase: "短语；表达",
  principle: "原则；原理",
  probability: "概率；可能性",
  process: "过程；处理",
  psychology: "心理学；心理",
  reaction: "反应",
  recognize: "识别；认识到",
  reference: "引用；参考",
  reinforce: "强化；加强",
  responsibility: "责任",
  revision: "修订；修改",
  risk: "风险",
  selection: "选择；选集；节选",
  source: "来源；源头",
  sponsorship: "赞助；主办",
  strategy: "策略",
  survey: "调查；概览",
  tendency: "倾向",
  theory: "理论",
  trade: "交易；买卖",
  trader: "交易者",
  trading: "交易；交易活动",
  uncertainty: "不确定性",
  understand: "理解",
  version: "版本；说法",
  vocabulary: "词汇"
};

function parseScopeEntries(scopeText: string): string[] {
  const rawEntries = scopeText.includes("\n")
    ? scopeText.split(/\r?\n/)
    : scopeText.split(",");

  return rawEntries
    .map((entry) => cleanScopeEntry(entry))
    .filter(Boolean);
}

function cleanScopeEntry(entry: string): string {
  let cleaned = entry
    .trim()
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^["']|["']$/g, "");

  const wikiLinkMatch = cleaned.match(/^\[\[([^\]]+)]]$/);
  if (wikiLinkMatch) {
    cleaned = wikiLinkMatch[1].split(/[|#]/)[0].trim();
  }

  return cleaned.replace(/^\/+/, "");
}

function getPathCandidates(path: string): string[] {
  const candidates = new Set<string>([path]);

  if (!hasWildcard(path) && !path.endsWith(".md") && !path.endsWith("/")) {
    candidates.add(`${path}.md`);
  }

  if (path.endsWith("/")) {
    candidates.add(path.slice(0, -1));
  }

  return Array.from(candidates).filter(Boolean);
}

function hasWildcard(path: string): boolean {
  return /[*?]/.test(path);
}

function wildcardToRegExp(pattern: string): RegExp {
  let source = "^";

  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    const nextChar = pattern[index + 1];

    if (char === "*" && nextChar === "*") {
      source += ".*";
      index++;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }

  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

const BLOCK_SEP = "§§§BLOCK§§§";
const SHORT_PROSE_UNIT_TARGET_CHARS = 1200;
const SHORT_PROSE_UNIT_MAX_CHARS = 1800;

function buildBlockTranslationPrompt(blockTexts: string[], customPrompt: string): string {
  const numberedBlocks = blockTexts
    .map((text, i) => `#${i + 1}\n${text}`)
    .join(`\n${BLOCK_SEP}\n`);

  return [
    "Translate each block to Simplified Chinese.",
    customPrompt.trim()
      ? `Context:\n${customPrompt.trim()}`
      : "",
    "",
    `Return only translations in the same order, separated by this exact line: ${BLOCK_SEP}`,
    "Keep Markdown. Do not translate code, commands, paths, URLs, package names, identifiers, or placeholders. No labels or explanations.",
    "",
    "Blocks:",
    numberedBlocks
  ].filter(Boolean).join("\n");
}

function parseTranslationArray(rawResult: string, expectedLength: number): string[] {
  const parts = rawResult
    .split(BLOCK_SEP)
    .map((s) => s.replace(/^\s*(?:\[\d+\]|#\d+)\s*/m, "").trim());

  if (parts.length === expectedLength) {
    return parts;
  }

  // Fallback: try to strip any leading/trailing fluff and re-split
  const trimmed = rawResult.trim().replace(/^.*?(?=§§§BLOCK§§§|\[1\]|#1)/s, "");
  const parts2 = trimmed
    .split(BLOCK_SEP)
    .map((s) => s.replace(/^\s*(?:\[\d+\]|#\d+)\s*/m, "").trim())
    .filter((s) => s.length > 0);

  if (parts2.length === expectedLength) {
    return parts2;
  }

  throw new Error(`Expected ${expectedLength} blocks but got ${parts.length}.`);
}

function appendDocumentTranslation(sourceText: string, translatedText: string): string {
  return `${sourceText.trimEnd()}\n\n${translatedText.trim()}\n`;
}

function interleaveDocumentTranslation(
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
      body += `${block.text.trimEnd()}${block.separator}`;
      cursor++;
    }

    if (translation) {
      body = `${body.trimEnd()}\n\n${translation}${blocks[unit.endBlock - 1]?.separator ?? "\n\n"}`;
    }
  }

  while (cursor < blocks.length) {
    const block = blocks[cursor];
    body += `${block.text.trimEnd()}${block.separator}`;
    cursor++;
  }

  return `${frontmatter ? `${frontmatter.trimEnd()}\n\n` : ""}${body.trimEnd()}\n`;
}

function joinTranslatedBlocks(units: TranslationUnit[], translations: string[]): string {
  return units
    .map((unit, index) => `${translations[index]?.trimEnd() ?? ""}${getUnitTrailingSeparator(unit)}`)
    .join("")
    .trimEnd();
}

function buildBlockBatches(units: TranslationUnit[], maxCharacters: number): MarkdownBlockBatch[] {
  const batches: MarkdownBlockBatch[] = [];
  let currentBatch: TranslationUnit[] = [];
  let currentSize = 0;
  let startUnit = 0;

  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    const unitSize = unit.text.length;

    if (currentBatch.length > 0 && currentSize + unitSize > maxCharacters) {
      batches.push({
        charCount: currentSize,
        endUnit: index,
        startUnit,
        units: currentBatch
      });
      currentBatch = [];
      currentSize = 0;
      startUnit = index;
    }

    currentBatch.push(unit);
    currentSize += unitSize;
  }

  if (currentBatch.length > 0) {
    batches.push({
      charCount: currentSize,
      endUnit: units.length,
      startUnit,
      units: currentBatch
    });
  }

  return batches;
}

function buildTranslationUnits(blocks: MarkdownBlock[]): TranslationUnit[] {
  const units: TranslationUnit[] = [];
  let pendingStart = -1;
  let pendingText = "";

  const flush = (endBlock: number) => {
    if (pendingStart < 0) return;
    units.push({
      startBlock: pendingStart,
      endBlock,
      text: pendingText.trimEnd()
    });
    pendingStart = -1;
    pendingText = "";
  };

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const mergeable = isMergeableProseBlock(block);
    const nextSize = pendingText.length + block.text.length + block.separator.length;

    if (
      !mergeable ||
      (pendingStart >= 0 && pendingText.length >= SHORT_PROSE_UNIT_TARGET_CHARS) ||
      (pendingStart >= 0 && nextSize > SHORT_PROSE_UNIT_MAX_CHARS)
    ) {
      flush(index);
    }

    if (!mergeable) {
      units.push({
        startBlock: index,
        endBlock: index + 1,
        text: block.text.trimEnd()
      });
      continue;
    }

    if (pendingStart < 0) {
      pendingStart = index;
    }

    pendingText += `${block.text.trimEnd()}${block.separator || "\n\n"}`;
  }

  flush(blocks.length);
  return units;
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

function extractFrontmatter(sourceText: string): { body: string; frontmatter: string } {
  if (!sourceText.startsWith("---\n") && !sourceText.startsWith("---\r\n")) {
    return { body: sourceText, frontmatter: "" };
  }

  const match = sourceText.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);

  if (!match) {
    return { body: sourceText, frontmatter: "" };
  }

  return {
    body: sourceText.slice(match[0].length),
    frontmatter: match[0]
  };
}

function splitMarkdownBlocks(sourceText: string): MarkdownBlock[] {
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

function resolveCodexCommand(configuredCommand: string): string {
  if (configuredCommand) {
    return configuredCommand;
  }

  return CODEX_CANDIDATES.find((candidate) => candidate === "codex" || existsSync(candidate)) ?? "codex";
}

function hasCodexCommand(configuredCommand: string): boolean {
  if (configuredCommand) {
    return existsSync(configuredCommand) || configuredCommand === "codex";
  }

  return CODEX_CANDIDATES.some((candidate) => candidate !== "codex" && existsSync(candidate));
}

function resolveClaudeCommand(configuredCommand: string): string {
  if (configuredCommand) {
    return configuredCommand;
  }

  return CLAUDE_CANDIDATES.find((candidate) => candidate === "claude" || existsSync(candidate)) ?? "claude";
}

function hasClaudeCommand(configuredCommand: string): boolean {
  if (configuredCommand) {
    return existsSync(configuredCommand) || configuredCommand === "claude";
  }

  return CLAUDE_CANDIDATES.some((candidate) => candidate !== "claude" && existsSync(candidate));
}

function parseOpenAIChatCompletionResult(value: unknown): OpenAIChatCompletionResult | undefined {
  return typeof value === "object" && value !== null
    ? value as OpenAIChatCompletionResult
    : undefined;
}

function parseAnthropicMessageResult(value: unknown): AnthropicMessageResult | undefined {
  return typeof value === "object" && value !== null
    ? value as AnthropicMessageResult
    : undefined;
}

function normalizeApiBaseUrl(value: string, fallback: string): string {
  return (value.trim() || fallback).replace(/\/+$/, "");
}

function normalizeAITextContent(
  content: string | Array<{ text?: string; type?: string }> | undefined
): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part.text ?? "")
      .join("")
      .trim();
  }

  return "";
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface ProcessHandle {
  kill: () => void;
  promise: Promise<ProcessResult>;
}

function spawnProcess(
  command: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
  onProgress?: (line: string) => void
): ProcessHandle {
  let killFn: () => void = () => {};

  const promise = new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, args, {
      env: buildCodexEnv(),
      shell: process.platform === "win32",
      windowsHide: true
    });

    killFn = () => {
      child.kill("SIGTERM");
      window.setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* already dead */ } }, 1000);
    };

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killed = false;
    let lastProgressLine = "";

    const fireProgress = (chunk: string) => {
      if (!onProgress) return;
      const lines = chunk.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.replace(ANSI_ESCAPE_PATTERN, "").trim();
        if (trimmed && trimmed !== lastProgressLine) {
          lastProgressLine = trimmed;
          onProgress(trimmed);
        }
      }
    };

    const timeout = window.setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      fireProgress(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      fireProgress(chunk);
    });

    child.on("error", (error) => {
      window.clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code, signal) => {
      window.clearTimeout(timeout);

      if (timedOut) {
        reject(new Error(`Process timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
        return;
      }

      if (signal === "SIGTERM" || signal === "SIGKILL" || killed) {
        reject(new Error("Translation stopped."));
        return;
      }

      resolve({ code, stdout, stderr });
    });

    child.stdin.end(stdin);

    // track kill calls so close handler knows it was intentional
    const origKill = killFn;
    killFn = () => { killed = true; origKill(); };
  });

  return { promise, kill: () => killFn() };
}

function buildCodexEnv(): NodeJS.ProcessEnv {
  const existingPath = process.env.PATH ?? "";
  const mergedPath = [
    ...CODEX_PATH_ENTRIES,
    ...existingPath.split(":").filter(Boolean)
  ].filter((entry, index, entries) => entries.indexOf(entry) === index).join(delimiter);

  return {
    ...process.env,
    CODEX_HOME: process.env.CODEX_HOME || join(homedir(), ".codex"),
    HOME: process.env.HOME || homedir(),
    PATH: mergedPath
  };
}

function compactProcessError(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.slice(-4).join(" ") || "Unknown Codex error.";
}

function parseCodexJsonUsage(output: string): TokenUsage | null {
  let usage: TokenUsage | null = null;

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;

    try {
      const event = JSON.parse(trimmed) as {
        type?: string;
        usage?: {
          cached_input_tokens?: number;
          input_tokens?: number;
          output_tokens?: number;
          reasoning_output_tokens?: number;
        };
      };

      if (event.type === "turn.completed" && event.usage) {
        usage = {
          cachedInput: event.usage.cached_input_tokens ?? 0,
          input: event.usage.input_tokens ?? 0,
          output: event.usage.output_tokens ?? 0,
          reasoningOutput: event.usage.reasoning_output_tokens ?? 0
        };
      }
    } catch {
      // Ignore non-event output lines.
    }
  }

  return usage;
}

function createEmptyTokenUsage(): TokenUsage {
  return {
    cachedInput: 0,
    input: 0,
    output: 0,
    reasoningOutput: 0
  };
}

function addTokenUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    cachedInput: left.cachedInput + right.cachedInput,
    input: left.input + right.input,
    output: left.output + right.output,
    reasoningOutput: left.reasoningOutput + right.reasoningOutput
  };
}

function hasTokenUsage(tokens: TokenUsage): boolean {
  return tokens.input > 0 || tokens.output > 0 || tokens.cachedInput > 0 || tokens.reasoningOutput > 0;
}

function formatTokenUsage(tokens: TokenUsage): string {
  const parts = [
    `input ${formatTokenCount(tokens.input)}`,
    `output ${formatTokenCount(tokens.output)}`
  ];

  if (tokens.cachedInput > 0) {
    parts.splice(1, 0, `cached ${formatTokenCount(tokens.cachedInput)}`);
  }

  if (tokens.reasoningOutput > 0) {
    parts.push(`reasoning ${formatTokenCount(tokens.reasoningOutput)}`);
  }

  parts.push(`total ${formatTokenCount(tokens.input + tokens.output)}`);
  return parts.join(", ");
}

function formatTokenUsageCompact(tokens: TokenUsage): string {
  const total = tokens.input + tokens.output;
  const cached = tokens.cachedInput > 0 ? `, ${formatTokenCount(tokens.cachedInput)} cached` : "";
  const reasoning = tokens.reasoningOutput > 0 ? `, ${formatTokenCount(tokens.reasoningOutput)} reasoning` : "";
  return `${formatTokenCount(tokens.input)}↑ ${formatTokenCount(tokens.output)}↓ (${formatTokenCount(total)} total${cached}${reasoning})`;
}

function formatTokenCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isStoppedError(error: unknown): boolean {
  return getErrorMessage(error).toLowerCase().includes("translation stopped");
}

function formatCharacterCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

function previewBlockText(text: string): string {
  const preview = normalizeWhitespace(text)
    .replace(/^#+\s*/, "")
    .slice(0, 180)
    .trim();

  return preview ? `Preview: ${preview}${preview.length >= 180 ? "..." : ""}` : "";
}

function formatExcerptEntry(
  sourceText: string,
  translation: string | undefined,
  source: SourceReference | null,
  includeTranslation: boolean
): string {
  const parts = [
    "",
    `## ${formatDateTime(new Date())}`,
    source ? `- Source: [[${source.path}]]${formatLineSuffix(source)}` : "- Source: Unknown",
    "",
    "### Original",
    blockquote(sourceText)
  ];

  if (includeTranslation && translation) {
    parts.push("", "### Translation", translation);
  }

  return `${parts.join("\n")}\n`;
}

function formatLineSuffix(source: SourceReference): string {
  if (!source.line) {
    return "";
  }

  if (source.endLine && source.endLine !== source.line) {
    return `:L${source.line}-L${source.endLine}`;
  }

  return `:L${source.line}`;
}

function formatDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    " ",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes())
  ].join("");
}

function blockquote(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function normalizeExcerptPath(path: string): string {
  const normalized = normalizePath(path.trim() || DEFAULT_SETTINGS.excerptFilePath);
  return normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;
}

function cleanSpeechText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getPreferredVoice(language: string): Promise<SpeechSynthesisVoice | null> {
  const voices = await getSpeechVoices();
  const preferredLanguage = language.toLowerCase();
  const preferredNames = /samantha|alex|daniel|google us english|microsoft aria|ava/i;

  return (
    voices.find((voice) => voice.lang.toLowerCase() === preferredLanguage && preferredNames.test(voice.name)) ??
    voices.find((voice) => voice.lang.toLowerCase() === preferredLanguage) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en-us")) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ??
    null
  );
}

function getSpeechVoices(): Promise<SpeechSynthesisVoice[]> {
  const voices = window.speechSynthesis.getVoices();

  if (voices.length > 0) {
    return Promise.resolve(voices);
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    }, 500);

    const handleVoicesChanged = () => {
      window.clearTimeout(timeout);
      window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    };

    window.speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);
  });
}

function findSelectionRange(content: string, selection: string): { end: number; start: number } | null {
  const needle = selection.trim();
  const exactIndex = content.indexOf(needle);

  if (exactIndex >= 0) {
    return { start: exactIndex, end: exactIndex + needle.length };
  }

  const normalizedContent = buildWhitespaceIndex(content);
  const normalizedNeedle = normalizeWhitespace(needle);
  const normalizedIndex = normalizedContent.text.indexOf(normalizedNeedle);

  if (normalizedIndex < 0 || !normalizedNeedle) {
    return null;
  }

  const start = normalizedContent.map[normalizedIndex];
  const end = normalizedContent.map[normalizedIndex + normalizedNeedle.length - 1] + 1;

  return { start, end };
}

function buildWhitespaceIndex(input: string): { map: number[]; text: string } {
  const map: number[] = [];
  const output: string[] = [];
  let previousWasWhitespace = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    const isWhitespace = /\s/.test(char);

    if (isWhitespace) {
      if (!previousWasWhitespace) {
        output.push(" ");
        map.push(index);
      }
    } else {
      output.push(char);
      map.push(index);
    }

    previousWasWhitespace = isWhitespace;
  }

  while (output[0] === " ") {
    output.shift();
    map.shift();
  }

  while (output[output.length - 1] === " ") {
    output.pop();
    map.pop();
  }

  return { text: output.join(""), map };
}

function getLineNumberAtOffset(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length;
}

function sameNormalized(left: string, right: string): boolean {
  return normalizeWhitespace(left) === normalizeWhitespace(right);
}

function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function selectionWithinElement(selection: Selection, element: HTMLElement): boolean {
  const anchorEl = getSelectionElement(selection.anchorNode);
  const focusEl = getSelectionElement(selection.focusNode);

  return Boolean(
    (anchorEl && (anchorEl === element || element.contains(anchorEl))) ||
    (focusEl && (focusEl === element || element.contains(focusEl)))
  );
}

function shouldIgnoreSelection(selection: Selection, popupEl?: HTMLElement): boolean {
  const anchorEl = getSelectionElement(selection.anchorNode);
  const focusEl = getSelectionElement(selection.focusNode);
  const selectedEl = anchorEl ?? focusEl;

  if (!selectedEl) {
    return true;
  }

  if (popupEl && (popupEl.contains(selectedEl) || selectedEl === popupEl)) {
    return true;
  }

  return Boolean(selectedEl.closest([
    "input",
    "textarea",
    "select",
    "button",
    ".modal-container",
    ".suggestion-container",
    ".menu",
    ".prompt",
    ".contextual-ai-reader-popover"
  ].join(",")));
}

function eventTargetInside(event: Event, element: HTMLElement): boolean {
  const path = event.composedPath?.() ?? [];
  if (path.includes(element)) {
    return true;
  }

  const target = event.target;
  return target instanceof Node && element.contains(target);
}

function getSelectionElement(node: Node | null): Element | null {
  if (!node) {
    return null;
  }

  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
}

function getRangeRect(range: Range): DOMRect | null {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);

  if (rects.length > 0) {
    return rects[rects.length - 1];
  }

  const rect = range.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function googleTranslate(text: string, targetLang = "zh-CN"): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
  const response = await requestUrl({ url, throw: false });
  if (response.status < 200 || response.status >= 300) throw new Error(`Google Translate HTTP ${response.status}`);
  const data = parseGoogleTranslateResponse(response.json);
  return data.map((item) => item[0] ?? "").join("");
}

function parseGoogleTranslateResponse(value: unknown): string[][] {
  if (!Array.isArray(value) || !Array.isArray(value[0])) {
    return [];
  }

  return value[0]
    .filter((item): item is unknown[] => Array.isArray(item))
    .map((item) => item.map((part) => typeof part === "string" ? part : ""));
}
