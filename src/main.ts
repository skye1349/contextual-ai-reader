import { spawn } from "child_process";
import { existsSync, readdirSync } from "fs";
import { mkdtemp, readFile, readdir, rm } from "fs/promises";
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
  WorkspaceLeaf,
  normalizePath,
  setIcon
} from "obsidian";
import {
  YOUTUBE_VIEW_TYPE,
  YouTubeLearningView,
  YouTubeSegment,
  YouTubeUrlModal,
  YouTubeVideoData,
  buildYouTubeTimestampUri,
  formatTimestamp,
  normalizeYouTubeFolder,
  parseYouTubeVideoId,
  parseYouTubeJson3,
  sanitizeFileName
} from "./youtube";

type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
type InsertMode = "replace" | "append";
type FullDocumentInsertMode = "append" | "interleave";
type AIBackend = "auto" | "codex" | "claude" | "openai" | "anthropic";
type YouTubeTranscriptionBackend = "auto" | "groq" | "openai" | "off";

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
  sourceLanguage: string;
  targetLanguage: string;
  timeoutSeconds: number;
  vocabularyCache: Record<string, VocabularyCacheEntry>;
  youtubeCache: Record<string, YouTubeCacheEntry>;
  youtubeFfmpegCommand: string;
  youtubeGroqApiKey: string;
  youtubeScreenshotFolder: string;
  youtubeScreenshotWidth: number;
  youtubeTranscriptionBackend: YouTubeTranscriptionBackend;
  youtubeTranscriptFolder: string;
  youtubeYtDlpCommand: string;
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
  sourceLanguage: "auto",
  targetLanguage: "zh-CN",
  timeoutSeconds: 90,
  vocabularyCache: {},
  youtubeCache: {},
  youtubeFfmpegCommand: "",
  youtubeGroqApiKey: "",
  youtubeScreenshotFolder: "Contextual AI Reader/YouTube Screenshots",
  youtubeScreenshotWidth: 720,
  youtubeTranscriptionBackend: "auto",
  youtubeTranscriptFolder: "Contextual AI Reader/YouTube Transcripts",
  youtubeYtDlpCommand: ""
};

const LANGUAGE_OPTIONS: Array<{ code: string; label: string; promptName: string }> = [
  { code: "auto", label: "Auto detect", promptName: "the detected source language" },
  { code: "zh-CN", label: "Simplified Chinese", promptName: "Simplified Chinese" },
  { code: "zh-TW", label: "Traditional Chinese", promptName: "Traditional Chinese" },
  { code: "en", label: "English", promptName: "English" },
  { code: "ja", label: "Japanese", promptName: "Japanese" },
  { code: "ko", label: "Korean", promptName: "Korean" },
  { code: "fr", label: "French", promptName: "French" },
  { code: "de", label: "German", promptName: "German" },
  { code: "es", label: "Spanish", promptName: "Spanish" },
  { code: "it", label: "Italian", promptName: "Italian" },
  { code: "pt", label: "Portuguese", promptName: "Portuguese" },
  { code: "ru", label: "Russian", promptName: "Russian" },
  { code: "ar", label: "Arabic", promptName: "Arabic" }
];

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

function buildYtDlpCandidates(): string[] {
  const home = getHomeDir();
  const appData = getAppDataDir();
  return process.platform === "win32"
    ? [
      join(appData, "Python", "Scripts", "yt-dlp.exe"),
      join(home, "scoop", "shims", "yt-dlp.exe"),
      "yt-dlp.exe",
      "yt-dlp"
    ]
    : ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", `${home}/.local/bin/yt-dlp`, "yt-dlp"];
}

const YT_DLP_CANDIDATES = buildYtDlpCandidates();

function buildFfmpegCandidates(): string[] {
  const home = getHomeDir();
  return process.platform === "win32"
    ? [
      join(home, "scoop", "shims", "ffmpeg.exe"),
      "ffmpeg.exe",
      "ffmpeg"
    ]
    : ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg", "ffmpeg"];
}

const FFMPEG_CANDIDATES = buildFfmpegCandidates();

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

function getLanguageOption(code: string): { code: string; label: string; promptName: string } {
  const normalized = code.toLowerCase();
  const base = normalized.split("-")[0];
  return LANGUAGE_OPTIONS.find((option) => option.code.toLowerCase() === normalized)
    ?? LANGUAGE_OPTIONS.find((option) => option.promptName.toLowerCase() === normalized)
    ?? LANGUAGE_OPTIONS.find((option) => option.code.toLowerCase() === base)
    ?? LANGUAGE_OPTIONS[0];
}

function getLanguagePromptName(code: string): string {
  return getLanguageOption(code).promptName;
}

function getGoogleTranslateLanguageCode(code: string): string {
  return code === "auto" ? "auto" : getLanguageOption(code).code;
}

function isChineseTargetLanguage(code: string): boolean {
  return code === "zh-CN" || code === "zh-TW";
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

interface YtDlpCaptionFormat {
  ext?: string;
  url?: string;
}

interface YtDlpMetadata {
  automatic_captions?: Record<string, YtDlpCaptionFormat[]>;
  language?: string;
  subtitles?: Record<string, YtDlpCaptionFormat[]>;
  title?: string;
}

interface YouTubeCacheEntry {
  requestedSourceLanguage: string;
  segments: Array<{ duration: number; start: number; text: string }>;
  sourceLanguage?: string;
  title: string;
  translations: Record<string, string[]>;
  updatedAt: number;
  videoId: string;
}

interface TranscriptionResult {
  duration?: number;
  language?: string;
  segments?: Array<{ end?: number; start?: number; text?: string }>;
  text?: string;
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
  private lastMarkdownLeaf?: WorkspaceLeaf;

  async onload() {
    await this.loadSettings();

    this.registerView(YOUTUBE_VIEW_TYPE, (leaf) => new YouTubeLearningView(leaf, {
      captureVideoFrame: (view) => this.captureYouTubeFrame(view),
      createTranscriptNote: (data) => this.createYouTubeTranscriptNote(data),
      fetchTranscriptFallback: (videoId, language) => this.fetchYouTubeWithYtDlp(videoId, language),
      getCachedVideo: (videoId) => this.getCachedYouTubeVideo(videoId),
      saveVideo: (data) => this.cacheYouTubeTranscript(data),
      sourceLanguage: () => this.settings.sourceLanguage,
      stopTranslation: () => this.stopCurrentTranslation(),
      translateSegments: (data, onProgress) => this.translateYouTubeSegments(data, onProgress)
    }));

    this.statusBarEl = this.addStatusBarItem();
    this.setStatus("");

    this.addCommand({
      id: "translate-selection-to-chinese",
      name: "Translate selected text",
      editorCallback: (editor: Editor) => {
        void this.translateSelection(editor, "replace");
      }
    });

    this.addCommand({
      id: "append-chinese-translation",
      name: "Insert translation below selected text",
      editorCallback: (editor: Editor) => {
        void this.translateSelection(editor, "append");
      }
    });

    this.addCommand({
      id: "check-codex-login",
      name: "Check Codex CLI login",
      callback: () => {
        void this.checkCodexLogin();
      }
    });

    this.addCommand({
      id: "translate-current-file-to-chinese",
      name: "Translate current Markdown file and append translation",
      callback: () => {
        void this.translateCurrentFile("append");
      }
    });

    this.addCommand({
      id: "translate-current-file-interleaved-to-chinese",
      name: "Translate current Markdown file with interleaved translation",
      callback: () => {
        void this.translateCurrentFile("interleave");
      }
    });

    this.addCommand({
      id: "batch-translate-markdown-files-append",
      name: "Translate multiple Markdown files and append translations",
      callback: () => {
        new BatchScopeModal(this.app, "append", (scopeText) => this.batchTranslateFiles(scopeText, "append")).open();
      }
    });

    this.addCommand({
      id: "batch-translate-markdown-files-interleave",
      name: "Translate multiple Markdown files with interleaved translations",
      callback: () => {
        new BatchScopeModal(this.app, "interleave", (scopeText) => this.batchTranslateFiles(scopeText, "interleave")).open();
      }
    });

    this.addCommand({
      id: "speak-selection",
      name: "Read selected text aloud",
      editorCallback: (editor: Editor) => {
        void this.speakText(editor.getSelection());
      }
    });

    this.addCommand({
      id: "save-selection-to-excerpts",
      name: "Save selected text to excerpt note",
      editorCallback: (editor: Editor) => {
        void this.saveExcerpt(editor.getSelection());
      }
    });

    this.addCommand({
      id: "open-youtube-learning-player",
      name: "Open YouTube video",
      callback: () => {
        new YouTubeUrlModal(this.app, (url) => { void this.openYouTubePlayer(url); }).open();
      }
    });

    this.addCommand({
      id: "capture-youtube-frame-to-note",
      name: "Save current YouTube frame to note",
      callback: () => {
        const view = this.getYouTubeView();
        if (!view) {
          new Notice("Open a YouTube video first.");
          return;
        }
        void this.captureYouTubeFrame(view);
      }
    });

    this.addCommand({
      id: "create-youtube-transcript-note",
      name: "Create transcript note from current YouTube video",
      callback: () => {
        const data = this.getYouTubeView()?.getVideoData();
        if (!data) {
          new Notice("Load a YouTube video first.");
          return;
        }
        void this.createYouTubeTranscriptNote(data);
      }
    });

    this.registerObsidianProtocolHandler("contextual-ai-reader-youtube", (params) => {
      const video = params.video;
      if (!video) return;
      const seconds = Number(params.t ?? 0);
      void this.openYouTubePlayer(video, Number.isFinite(seconds) ? seconds : 0);
    });

    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view instanceof MarkdownView) this.lastMarkdownLeaf = leaf;
    }));

    const initialMarkdown = this.app.workspace.getLeavesOfType("markdown")
      .find((leaf) => leaf.view instanceof MarkdownView);
    if (initialMarkdown) this.lastMarkdownLeaf = initialMarkdown;

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
    this.settings.youtubeCache = { ...(this.settings.youtubeCache ?? {}) };
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
    const vocabularyWord = getVocabularyTerm(sourceText);

    if (vocabularyWord) {
      await this.showVocabularyLookup(sourceText, vocabularyWord, rect, requestId);
      return;
    }

    const translationCacheKey = this.buildTranslationCacheKey(sourceText);
    const cached = this.translationCache.get(translationCacheKey);

    if (cached) {
      this.showPopup(cached, sourceText, rect, "done");
      this.addPopupRefineButton(sourceText, rect, requestId);
      return;
    }

    // Step 1: instant Google Translate (~200ms, 0 tokens)
    this.showPopupLoading("Translating…", rect, () => { this.hidePopup(); });

    try {
      const quickResult = await googleTranslate(sourceText, this.settings.targetLanguage, this.settings.sourceLanguage);
      if (requestId !== this.requestSerial) return;
      if (!quickResult) throw new Error("Empty response from Google Translate.");

      this.rememberTranslation(translationCacheKey, quickResult);
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

    const cacheKey = buildVocabularyCacheKey(word, context.paragraph, this.settings.customPrompt, this.settings.targetLanguage);
    const cached = this.settings.vocabularyCache[cacheKey];
    const cachedBase = cached?.baseDefinition ?? this.findCachedVocabularyBase(word, this.settings.targetLanguage);
    let baseDefinition = cachedBase ?? getLocalVocabularyDefinition(word, this.settings.targetLanguage);

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
        const quickDefinition = await googleTranslate(word, this.settings.targetLanguage, this.settings.sourceLanguage);
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
    const uiText = getVocabularyUiText(this.settings.targetLanguage, backendLabel);
    this.updateVocabularyStatus(uiText.loadingContext);
    this.startOperation();

    try {
      const explanation = (await this.runAIPrompt(
        buildVocabularyPrompt(word, sourceText, context, this.settings.customPrompt, this.settings.targetLanguage, this.settings.sourceLanguage)
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
      this.rememberTranslation(this.buildTranslationCacheKey(sourceText), translation);
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
        ? "Target-language translation appended below the current file."
        : "Target-language translation inserted after each paragraph."}${this.tokenUsageSuffix()}`, 12000);
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
      new Notice("Select some text first.");
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

  private getYouTubeView(): YouTubeLearningView | undefined {
    const active = this.app.workspace.getActiveViewOfType(YouTubeLearningView);
    if (active) return active;
    return this.app.workspace.getLeavesOfType(YOUTUBE_VIEW_TYPE)
      .map((leaf) => leaf.view)
      .find((view): view is YouTubeLearningView => view instanceof YouTubeLearningView);
  }

  private async openYouTubePlayer(urlOrId: string, startSeconds = 0) {
    const videoId = parseYouTubeVideoId(urlOrId);
    if (!videoId) {
      new Notice("Enter a valid YouTube link.");
      return;
    }

    const existing = this.app.workspace.getLeavesOfType(YOUTUBE_VIEW_TYPE)
      .map((leaf) => leaf.view)
      .find((view): view is YouTubeLearningView =>
        view instanceof YouTubeLearningView && view.getVideoData()?.videoId === videoId
      );

    if (existing) {
      this.app.workspace.revealLeaf(existing.leaf);
      existing.seekTo(startSeconds);
      return;
    }

    const workspaceLeaves: WorkspaceLeaf[] = [];
    this.app.workspace.iterateAllLeaves((candidate) => workspaceLeaves.push(candidate));
    const anchorLeaf = workspaceLeaves
      .sort((left, right) => right.view.containerEl.clientWidth - left.view.containerEl.clientWidth)[0]
      ?? this.lastMarkdownLeaf;
    if (anchorLeaf) {
      this.app.workspace.setActiveLeaf(anchorLeaf, { focus: true });
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: YOUTUBE_VIEW_TYPE, active: true });
    const view = leaf.view;
    if (!(view instanceof YouTubeLearningView)) {
      new Notice("Could not open the YouTube video.");
      return;
    }
    await view.loadVideo(videoId, startSeconds);
    this.app.workspace.revealLeaf(leaf);
  }

  private async translateYouTubeSegments(
    data: YouTubeVideoData,
    onProgress: (completed: number, total: number, translations: readonly string[]) => void
  ): Promise<string[]> {
    const segments = data.segments;
    const cacheKey = this.getYouTubeTranslationCacheKey(data);
    const cached = this.settings.youtubeCache[data.videoId]?.translations[cacheKey] ?? [];
    const translations = cached.slice(0, segments.length);
    if (translations.length === segments.length) {
      onProgress(segments.length, segments.length, translations);
      new Notice("Loaded the YouTube translation from local cache. Token usage: 0.");
      return translations;
    }

    if (!this.beginOverlayOperation()) {
      throw new Error("Another full-document or transcript translation is already running.");
    }
    this.startOperation();
    const batchSize = 24;
    onProgress(translations.length, segments.length, translations);

    try {
      for (let start = translations.length; start < segments.length; start += batchSize) {
        if (this.isCancelled) throw new Error("Translation stopped.");
        const batch = segments.slice(start, start + batchSize);
        const translated = await this.translateYouTubeBatch(batch, data.sourceLanguage);
        translations.push(...translated);
        await this.cacheYouTubeTranslation(data, cacheKey, translations);
        onProgress(Math.min(start + batch.length, segments.length), segments.length, translations);
      }

      new Notice(`YouTube transcript translation complete.${this.tokenUsageSuffix()}`, 9000);
      return translations;
    } finally {
      this.finishOverlayOperation();
    }
  }

  private async fetchYouTubeWithYtDlp(videoId: string, preferredLanguage: string): Promise<YouTubeVideoData> {
    const command = resolveYtDlpCommand(this.settings.youtubeYtDlpCommand);
    const handle = spawnProcess(
      command,
      [
        "--no-update",
        "--no-playlist",
        "--skip-download",
        "--dump-single-json",
        `https://www.youtube.com/watch?v=${videoId}`
      ],
      "",
      this.settings.timeoutSeconds * 1000
    );

    this.currentKills.add(handle.kill);
    let result: ProcessResult;
    try {
      result = await handle.promise;
    } catch (error) {
      throw new Error(`yt-dlp is required for this video's protected subtitle URLs. Configure it in plugin settings. ${getErrorMessage(error)}`);
    } finally {
      this.currentKills.delete(handle.kill);
    }
    if (result.code !== 0) throw new Error(compactProcessError(result.stderr || result.stdout));

    let metadata: YtDlpMetadata;
    try {
      metadata = JSON.parse(result.stdout) as YtDlpMetadata;
    } catch {
      throw new Error("yt-dlp returned invalid video metadata.");
    }

    const title = metadata.title?.trim() || `YouTube ${videoId}`;
    const track = chooseYtDlpCaption(metadata, preferredLanguage);
    const format = track?.formats.find((candidate) => candidate.ext === "json3" && candidate.url)
      ?? track?.formats.find((candidate) => candidate.url);
    if (!format?.url) return await this.transcribeYouTubeAudio(videoId, title);

    const response = await requestUrl({ url: format.url, throw: false });
    if (response.status < 200 || response.status >= 300 || !response.text.trim()) {
      throw new Error(`yt-dlp subtitle URL returned HTTP ${response.status} with no usable data.`);
    }
    if (format.ext && format.ext !== "json3") {
      throw new Error(`yt-dlp did not provide JSON3 captions (received ${format.ext}).`);
    }

    const segments = parseYouTubeJson3(response.text);
    if (segments.length === 0) return await this.transcribeYouTubeAudio(videoId, title);
    return {
      sourceLanguage: track?.code,
      title,
      videoId,
      segments
    };
  }

  private async getCachedYouTubeVideo(videoId: string): Promise<YouTubeVideoData | undefined> {
    const entry = this.settings.youtubeCache[videoId];
    if (!entry?.segments.length || entry.requestedSourceLanguage !== this.settings.sourceLanguage) return undefined;
    const data: YouTubeVideoData = {
      sourceLanguage: entry.sourceLanguage,
      title: entry.title,
      videoId,
      segments: entry.segments.map((segment) => ({ ...segment }))
    };
    const translations = entry.translations[this.getYouTubeTranslationCacheKey(data)];
    if (translations?.length === data.segments.length) {
      data.segments.forEach((segment, index) => { segment.translation = translations[index]; });
    }
    entry.updatedAt = Date.now();
    return data;
  }

  private async cacheYouTubeTranscript(data: YouTubeVideoData): Promise<void> {
    if (data.segments.length === 0) return;
    const old = this.settings.youtubeCache[data.videoId];
    const segments = data.segments.map(({ duration, start, text }) => ({ duration, start, text }));
    const sameTranscript = old && hashString(JSON.stringify(old.segments)) === hashString(JSON.stringify(segments));
    this.settings.youtubeCache[data.videoId] = {
      requestedSourceLanguage: this.settings.sourceLanguage,
      segments,
      sourceLanguage: data.sourceLanguage,
      title: data.title,
      translations: sameTranscript ? old.translations : {},
      updatedAt: Date.now(),
      videoId: data.videoId
    };
    this.trimYouTubeCache();
    await this.saveSettings();
  }

  private async cacheYouTubeTranslation(
    data: YouTubeVideoData,
    cacheKey: string,
    translations: string[]
  ): Promise<void> {
    if (!this.settings.youtubeCache[data.videoId]) await this.cacheYouTubeTranscript(data);
    const entry = this.settings.youtubeCache[data.videoId];
    if (!entry) return;
    entry.translations[cacheKey] = [...translations];
    entry.updatedAt = Date.now();
    await this.saveSettings();
  }

  private getYouTubeTranslationCacheKey(data: YouTubeVideoData): string {
    return hashString(JSON.stringify({
      customPrompt: this.settings.customPrompt.trim(),
      requestedSourceLanguage: this.settings.sourceLanguage,
      sourceLanguage: data.sourceLanguage,
      targetLanguage: this.settings.targetLanguage,
      transcript: data.segments.map(({ duration, start, text }) => [duration, start, text])
    }));
  }

  private trimYouTubeCache() {
    const entries = Object.values(this.settings.youtubeCache)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    for (const entry of entries.slice(30)) delete this.settings.youtubeCache[entry.videoId];
  }

  private async transcribeYouTubeAudio(videoId: string, title: string): Promise<YouTubeVideoData> {
    const backend = this.getYouTubeTranscriptionBackend();
    if (backend === "off") {
      throw new Error("This video has no captions and automatic transcription is disabled in plugin settings.");
    }

    const tempDir = await mkdtemp(join(tmpdir(), "contextual-ai-reader-youtube-"));
    const sourceTemplate = join(tempDir, "source.%(ext)s");
    const audioPattern = join(tempDir, "audio-%03d.mp3");
    try {
      new Notice("No captions found. Downloading audio for speech-to-text…", 6000);
      await this.runTrackedProcess(
        resolveYtDlpCommand(this.settings.youtubeYtDlpCommand),
        ["--no-update", "--no-playlist", "-f", "bestaudio/best", "-o", sourceTemplate, `https://www.youtube.com/watch?v=${videoId}`],
        Math.max(this.settings.timeoutSeconds, 600) * 1000
      );
      const sourceName = (await readdir(tempDir)).find((name) => name.startsWith("source.") && !name.endsWith(".part"));
      if (!sourceName) throw new Error("yt-dlp downloaded no usable audio file.");

      new Notice("Preparing audio for accurate timestamped transcription…", 5000);
      await this.runTrackedProcess(
        resolveFfmpegCommand(this.settings.youtubeFfmpegCommand),
        [
          "-hide_banner", "-loglevel", "error", "-i", join(tempDir, sourceName),
          "-vn", "-ac", "1", "-ar", "16000", "-b:a", "24k",
          "-f", "segment", "-segment_time", "1500", "-reset_timestamps", "1", "-y", audioPattern
        ],
        Math.max(this.settings.timeoutSeconds, 600) * 1000
      );

      const audioFiles = (await readdir(tempDir)).filter((name) => /^audio-\d+\.mp3$/.test(name)).sort();
      if (audioFiles.length === 0) throw new Error("ffmpeg produced no transcription audio chunks.");
      const segments: YouTubeSegment[] = [];
      let detectedLanguage: string | undefined;
      for (let index = 0; index < audioFiles.length; index++) {
        new Notice(
          `Transcribing audio ${index + 1}/${audioFiles.length} with ${backend === "groq" ? "Groq Whisper" : "OpenAI Whisper"}…`,
          8000
        );
        const result = await this.requestYouTubeTranscription(await readFile(join(tempDir, audioFiles[index])), backend);
        detectedLanguage ??= result.language;
        const offset = index * 1500;
        for (const segment of result.segments ?? []) {
          const text = segment.text?.trim();
          const start = segment.start;
          const end = segment.end;
          if (text && typeof start === "number") {
            segments.push({
              start: offset + start,
              duration: Math.max(0.5, (typeof end === "number" ? end : start + 3) - start),
              text
            });
          }
        }
      }
      if (segments.length === 0) throw new Error("Speech-to-text returned no timestamped segments.");
      return { title, videoId, sourceLanguage: detectedLanguage, segments };
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  }

  private getYouTubeTranscriptionBackend(): "groq" | "openai" | "off" {
    const configured = this.settings.youtubeTranscriptionBackend;
    if (configured === "off") return "off";
    if (configured === "groq" || (configured === "auto" && this.settings.youtubeGroqApiKey.trim())) {
      if (!this.settings.youtubeGroqApiKey.trim()) throw new Error("Add a Groq API key for no-caption transcription.");
      return "groq";
    }
    if (configured === "openai" || configured === "auto") {
      if (!this.settings.openaiApiKey.trim()) {
        throw new Error("This video has no captions. Add a Groq or OpenAI API key for Whisper transcription, or disable this fallback.");
      }
      return "openai";
    }
    return "off";
  }

  private async requestYouTubeTranscription(
    audio: Buffer,
    backend: "groq" | "openai"
  ): Promise<TranscriptionResult> {
    const model = backend === "groq" ? "whisper-large-v3-turbo" : "whisper-1";
    const fields: Array<[string, string]> = [
      ["model", model],
      ["response_format", "verbose_json"],
      ["timestamp_granularities[]", "segment"]
    ];
    if (this.settings.sourceLanguage !== "auto") {
      fields.push(["language", this.settings.sourceLanguage.split("-")[0]]);
    }
    const multipart = buildMultipartFormData(fields, "file", "audio.mp3", "audio/mpeg", audio);
    const baseUrl = normalizeApiBaseUrl(this.settings.openaiBaseUrl, DEFAULT_SETTINGS.openaiBaseUrl);
    const response = await requestUrl({
      url: backend === "groq"
        ? "https://api.groq.com/openai/v1/audio/transcriptions"
        : `${baseUrl}/audio/transcriptions`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${backend === "groq" ? this.settings.youtubeGroqApiKey.trim() : this.settings.openaiApiKey.trim()}`,
        "Content-Type": `multipart/form-data; boundary=${multipart.boundary}`
      },
      body: toArrayBuffer(multipart.body),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Speech-to-text returned HTTP ${response.status}: ${response.text.slice(0, 300)}`);
    }
    return response.json as TranscriptionResult;
  }

  private async runTrackedProcess(command: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
    const handle = spawnProcess(command, args, "", timeoutMs);
    this.currentKills.add(handle.kill);
    try {
      const result = await handle.promise;
      if (result.code !== 0) throw new Error(compactProcessError(result.stderr || result.stdout));
      return result;
    } finally {
      this.currentKills.delete(handle.kill);
    }
  }

  private async translateYouTubeBatch(segments: YouTubeSegment[], detectedSourceLanguage?: string): Promise<string[]> {
    const target = getLanguagePromptName(this.settings.targetLanguage);
    const source = this.settings.sourceLanguage === "auto" && detectedSourceLanguage
      ? getLanguagePromptName(detectedSourceLanguage)
      : getLanguagePromptName(this.settings.sourceLanguage);
    const transcript = segments.map((segment, index) => ({
      id: index,
      start: Math.round(segment.start * 10) / 10,
      text: segment.text
    }));
    const prompt = [
      `Translate this continuous YouTube transcript from ${source} into ${target}.`,
      "Use the neighboring subtitle sentences as context so pronouns, terminology, tone, and unfinished clauses remain coherent.",
      "Return only one valid JSON array of translated strings in the same order and with exactly the same number of items.",
      "Do not include timestamps, IDs, Markdown, commentary, or code fences.",
      this.settings.customPrompt.trim() ? `Additional context: ${this.settings.customPrompt.trim()}` : "",
      JSON.stringify(transcript)
    ].filter(Boolean).join("\n\n");

    const raw = await this.runAIPrompt(prompt);
    try {
      return parseStringArray(raw, segments.length);
    } catch (error) {
      if (segments.length === 1) {
        return [(await this.runAITranslation(segments[0].text)).trim()];
      }
      console.warn("YouTube transcript batch returned invalid JSON; retrying smaller batches.", error);
      const midpoint = Math.ceil(segments.length / 2);
      const left = await this.translateYouTubeBatch(segments.slice(0, midpoint), detectedSourceLanguage);
      const right = await this.translateYouTubeBatch(segments.slice(midpoint), detectedSourceLanguage);
      return [...left, ...right];
    }
  }

  private async captureYouTubeFrame(view: YouTubeLearningView) {
    const data = view.getVideoData();
    if (!data) {
      new Notice("The YouTube player is not ready yet.");
      return;
    }
    const tempDir = await mkdtemp(join(tmpdir(), "contextual-ai-reader-frame-"));
    try {
      new Notice("Extracting the clean video frame…", 4000);
      const outputPath = join(tempDir, "frame.png");
      let png: Buffer | undefined;
      let lastError: unknown;
      for (let attempt = 0; attempt < 2 && !png; attempt++) {
        try {
          const stream = await this.runTrackedProcess(
            resolveYtDlpCommand(this.settings.youtubeYtDlpCommand),
            ["--no-update", "--no-playlist", "-f", "bestvideo[height<=1080]/best[height<=1080]/bestvideo/best", "-g", `https://www.youtube.com/watch?v=${data.videoId}`],
            Math.max(this.settings.timeoutSeconds, 180) * 1000
          );
          const streamUrl = stream.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
          if (!streamUrl) throw new Error("yt-dlp did not return a playable video stream.");
          await this.runTrackedProcess(
            resolveFfmpegCommand(this.settings.youtubeFfmpegCommand),
            ["-hide_banner", "-loglevel", "error", "-ss", String(Math.max(0, view.getCurrentTime())), "-i", streamUrl, "-frames:v", "1", "-vf", "scale='min(1920,iw)':-2", "-y", outputPath],
            Math.max(this.settings.timeoutSeconds, 180) * 1000
          );
          png = await readFile(outputPath);
        } catch (error) {
          lastError = error;
          if (attempt === 0) await sleep(800);
        }
      }
      if (!png) throw lastError instanceof Error ? lastError : new Error("Could not extract a clean video frame.");
      const folder = normalizeYouTubeFolder(
        this.settings.youtubeScreenshotFolder,
        DEFAULT_SETTINGS.youtubeScreenshotFolder
      );
      await this.ensureParentFolders(`${folder}/placeholder.png`);
      const stamp = formatFileTimestamp(new Date());
      const fileName = `${sanitizeFileName(data.title)} ${formatTimestamp(view.getCurrentTime()).replace(/:/g, "-")} ${stamp}.png`;
      const path = await this.getAvailableVaultPath(`${folder}/${fileName}`);
      await this.app.vault.createBinary(path, toArrayBuffer(png));

      const timestamp = formatTimestamp(view.getCurrentTime());
      const uri = buildYouTubeTimestampUri(data.videoId, view.getCurrentTime());
      const width = clamp(this.settings.youtubeScreenshotWidth, 100, 2000);
      await this.insertIntoLastMarkdown(`\n\n[${timestamp}](${uri})\n\n![[${path}|${width}]]\n`);
      new Notice(`Captured the video frame to ${path}.`);
    } catch (error) {
      new Notice(`Could not capture the video frame: ${getErrorMessage(error)}`);
      console.error("Could not capture YouTube frame", error);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  }

  private async createYouTubeTranscriptNote(data: YouTubeVideoData) {
    try {
      const folder = normalizeYouTubeFolder(
        this.settings.youtubeTranscriptFolder,
        DEFAULT_SETTINGS.youtubeTranscriptFolder
      );
      await this.ensureParentFolders(`${folder}/placeholder.md`);
      const path = await this.getAvailableVaultPath(`${folder}/${sanitizeFileName(data.title)} Transcript.md`);
      const lines = [
        "---",
        "type: youtube-transcript",
        `video_id: ${data.videoId}`,
        `source_language: ${this.settings.sourceLanguage}`,
        `target_language: ${this.settings.targetLanguage}`,
        "---",
        "",
        `# ${data.title}`,
        "",
        `Source: https://www.youtube.com/watch?v=${data.videoId}`,
        "",
        "## Transcript",
        ""
      ];

      for (const segment of data.segments) {
        const timestamp = formatTimestamp(segment.start);
        lines.push(`### [${timestamp}](${buildYouTubeTimestampUri(data.videoId, segment.start)})`);
        lines.push("", segment.text);
        if (segment.translation) lines.push("", segment.translation);
        lines.push("");
      }

      const file = await this.app.vault.create(path, `${lines.join("\n").trimEnd()}\n`);
      const leaf = this.app.workspace.getLeaf("split", "vertical");
      await leaf.openFile(file, { active: true });
      this.lastMarkdownLeaf = leaf;
      new Notice(`Created transcript note: ${path}`);
    } catch (error) {
      new Notice(`Could not create transcript note: ${getErrorMessage(error)}`);
      console.error("Could not create YouTube transcript note", error);
    }
  }

  private async insertIntoLastMarkdown(markdown: string) {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    const view = active
      ?? (this.lastMarkdownLeaf?.view instanceof MarkdownView ? this.lastMarkdownLeaf.view : undefined)
      ?? this.app.workspace.getLeavesOfType("markdown")
        .map((leaf) => leaf.view)
        .find((candidate): candidate is MarkdownView => candidate instanceof MarkdownView);

    if (!view) {
      throw new Error("Open a Markdown note before capturing a frame.");
    }

    const cursor = view.editor.getCursor();
    view.editor.replaceRange(markdown, cursor);
    await view.requestSave();
  }

  private async runAITranslation(sourceText: string, onChunk?: (text: string) => void): Promise<string> {
    return await this.runAIPrompt(
      buildTranslationPrompt(sourceText, this.settings.customPrompt, this.settings.targetLanguage, this.settings.sourceLanguage),
      onChunk
    );
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

    const prompt = buildBlockTranslationPrompt(blockTexts, this.settings.customPrompt, this.settings.targetLanguage, this.settings.sourceLanguage);
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
    const existingLeaf = this.findOpenFileLeaf(file);

    if (existingLeaf) {
      return;
    }

    const leaf = this.app.workspace.getLeaf("split", "vertical");
    await leaf.openFile(file, { active: false });
  }

  private findOpenFileLeaf(file: TFile) {
    return this.app.workspace
      .getLeavesOfType("markdown")
      .find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
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

  private findCachedVocabularyBase(word: string, targetLanguage: string): string | undefined {
    const normalizedWord = normalizeVocabularyWord(word);
    const match = Object.entries(this.settings.vocabularyCache)
      .find(([key, entry]) => key.startsWith(`${targetLanguage}:`) && normalizeVocabularyWord(entry.word) === normalizedWord && entry.baseDefinition);

    return match?.[1].baseDefinition;
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

  private buildTranslationCacheKey(sourceText: string): string {
    return `${this.settings.sourceLanguage}:${this.settings.targetLanguage}:${sourceText}`;
  }

  private rememberTranslation(cacheKey: string, translation: string) {
    this.translationCache.set(cacheKey, translation);

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
    const uiText = getVocabularyUiText(this.settings.targetLanguage, this.getBackendLabel());

    localEl.createDiv("contextual-ai-reader-vocab-label").setText(uiText.baseDefinitionLabel);
    localEl.createDiv("contextual-ai-reader-vocab-text").setText(
      card.baseDefinition || uiText.noLocalDefinition
    );

    const contextEl = body.createDiv("contextual-ai-reader-vocab-section");
    contextEl.createDiv("contextual-ai-reader-vocab-label").setText(uiText.contextLabel);
    contextEl.createDiv("contextual-ai-reader-vocab-text").setText(
      card.contextExplanation ||
      (card.status === "loading"
        ? uiText.loadingParagraph
        : card.errorText || uiText.clickAiHint)
    );

    if (card.status === "loading") {
      const status = body.createDiv("contextual-ai-reader-vocab-status");
      status.setText(uiText.loadingContext);
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
      void this.saveExcerpt(sourceText, this.formatVocabularyCard(card, context));
    }));

    actions.appendChild(this.createIconButton("copy", "Copy vocabulary note", () => {
      void navigator.clipboard.writeText(this.formatVocabularyCard(card, context));
      new Notice("Vocabulary note copied.");
    }));

    popup.appendChild(actions);
    popup.removeClass("is-hidden");
    this.positionPopup(rect);
  }

  private formatVocabularyCard(card: VocabularyCard, context: VocabularyContext): string {
    return formatVocabularyCard(card, context, this.settings.targetLanguage, this.settings.sourceLanguage);
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

    actions.appendChild(this.createIconButton("volume-2", "Read original text", () => {
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
      ? "Batch translate: append target language below"
      : "Batch translate: interleave target-language paragraphs");
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
      .setName("Source language")
      .setDesc("Language of the text you are reading. Auto detect works well for mixed notes.")
      .addDropdown((dropdown) => {
        LANGUAGE_OPTIONS.forEach((option) => dropdown.addOption(option.code, option.label));
        dropdown
          .setValue(this.plugin.settings.sourceLanguage)
          .onChange(async (value) => {
            this.plugin.settings.sourceLanguage = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Learning / target language")
      .setDesc("The language you want translations and vocabulary explanations to use.")
      .addDropdown((dropdown) => {
        LANGUAGE_OPTIONS
          .filter((option) => option.code !== "auto")
          .forEach((option) => dropdown.addOption(option.code, option.label));
        dropdown
          .setValue(this.plugin.settings.targetLanguage === "auto" ? DEFAULT_SETTINGS.targetLanguage : this.plugin.settings.targetLanguage)
          .onChange(async (value) => {
            this.plugin.settings.targetLanguage = value || DEFAULT_SETTINGS.targetLanguage;
            await this.plugin.saveSettings();
          });
      });

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
            .setPlaceholder("I am reading a finance or psychology book. Keep key terms consistent and explain vocabulary in my target language.")
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
      .setName("YouTube screenshot folder")
      .setDesc("Vault folder for captured video frames.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.youtubeScreenshotFolder)
          .setValue(this.plugin.settings.youtubeScreenshotFolder)
          .onChange(async (value) => {
            this.plugin.settings.youtubeScreenshotFolder = value.trim() || DEFAULT_SETTINGS.youtubeScreenshotFolder;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("YouTube screenshot display width")
      .setDesc("Width in pixels used when the clean video frame is embedded in a note. The saved PNG keeps its original resolution.")
      .addText((text) =>
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.youtubeScreenshotWidth))
          .setValue(String(this.plugin.settings.youtubeScreenshotWidth))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.youtubeScreenshotWidth = Number.isFinite(parsed)
              ? clamp(parsed, 100, 2000)
              : DEFAULT_SETTINGS.youtubeScreenshotWidth;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("YouTube transcript folder")
      .setDesc("Vault folder for notes created from interactive transcripts.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.youtubeTranscriptFolder)
          .setValue(this.plugin.settings.youtubeTranscriptFolder)
          .onChange(async (value) => {
            this.plugin.settings.youtubeTranscriptFolder = value.trim() || DEFAULT_SETTINGS.youtubeTranscriptFolder;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("yt-dlp command")
      .setDesc("Used for protected captions, clean frame capture, and no-caption audio. Leave empty to auto-detect yt-dlp.")
      .addText((text) =>
        text
          .setPlaceholder(process.platform === "win32" ? "yt-dlp.exe" : "/opt/homebrew/bin/yt-dlp")
          .setValue(this.plugin.settings.youtubeYtDlpCommand)
          .onChange(async (value) => {
            this.plugin.settings.youtubeYtDlpCommand = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("ffmpeg command")
      .setDesc("Used to extract clean video frames and prepare no-caption audio. Leave empty to auto-detect ffmpeg.")
      .addText((text) =>
        text
          .setPlaceholder(process.platform === "win32" ? "ffmpeg.exe" : "/opt/homebrew/bin/ffmpeg")
          .setValue(this.plugin.settings.youtubeFfmpegCommand)
          .onChange(async (value) => {
            this.plugin.settings.youtubeFfmpegCommand = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("No-caption transcription")
      .setDesc("When a video has no CC track, transcribe its audio with timestamped Whisper segments. Auto prefers Groq, then OpenAI.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "Auto (Groq, then OpenAI)")
          .addOption("groq", "Groq Whisper")
          .addOption("openai", "OpenAI Whisper")
          .addOption("off", "Disabled")
          .setValue(this.plugin.settings.youtubeTranscriptionBackend)
          .onChange(async (value) => {
            this.plugin.settings.youtubeTranscriptionBackend = value as YouTubeTranscriptionBackend;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Groq API key for transcription")
      .setDesc("Optional. Stored only in this plugin's local Obsidian data. Used for videos without captions.")
      .addText((text) => {
        text
          .setPlaceholder("gsk_…")
          .setValue(this.plugin.settings.youtubeGroqApiKey)
          .onChange(async (value) => {
            this.plugin.settings.youtubeGroqApiKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

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

function buildTranslationPrompt(
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

function buildVocabularyPrompt(
  word: string,
  selectedText: string,
  context: VocabularyContext,
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

function getVocabularyTerm(text: string): string | null {
  const cleaned = text
    .trim()
    .replace(/^[“"'([{]+|[”"')\]}.,;:!?]+$/g, "");

  if (cleaned.length < 2 || cleaned.length > 60 || /[\r\n]/.test(cleaned)) {
    return null;
  }

  const isSingleLatinLikeWord = /^[\p{L}][\p{L}\p{M}'’-]{1,39}$/u.test(cleaned);
  const isShortCjkTerm = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー・]{1,20}$/u.test(cleaned);

  if (!isSingleLatinLikeWord && !isShortCjkTerm) {
    return null;
  }

  return cleaned;
}

function normalizeVocabularyWord(word: string): string {
  return word.toLowerCase().replace(/^'+|'+$/g, "");
}

function buildVocabularyCacheKey(word: string, paragraph: string, customPrompt: string, targetLanguage: string): string {
  const normalizedWord = normalizeVocabularyWord(word);
  const contextHash = hashString(normalizeWhitespace(paragraph).slice(0, 1600));
  const promptHash = hashString(customPrompt.trim());
  return `${targetLanguage}:${normalizedWord}:${contextHash}:${promptHash}`;
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

function getLocalVocabularyDefinition(word: string, targetLanguage: string): string | undefined {
  if (!isChineseTargetLanguage(targetLanguage)) {
    return undefined;
  }

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

interface VocabularyUiText {
  baseDefinitionLabel: string;
  clickAiHint: string;
  contextHeading: string;
  contextLabel: string;
  loadingContext: string;
  loadingParagraph: string;
  noLocalDefinition: string;
}

function getVocabularyUiText(targetLanguage: string, backendLabel: string): VocabularyUiText {
  const textByLanguage: Record<string, Omit<VocabularyUiText, "loadingContext" | "loadingParagraph">> = {
    "zh-CN": {
      baseDefinitionLabel: "基础释义",
      clickAiHint: "点击 AI 按钮生成这个词在当前段落里的意思。",
      contextHeading: "当前语境解释",
      contextLabel: "当前语境",
      noLocalDefinition: "本地词典和缓存暂无命中。"
    },
    "zh-TW": {
      baseDefinitionLabel: "基礎釋義",
      clickAiHint: "點擊 AI 按鈕生成這個詞在目前段落裡的意思。",
      contextHeading: "目前語境解釋",
      contextLabel: "目前語境",
      noLocalDefinition: "本地詞典和快取暫無命中。"
    },
    ja: {
      baseDefinitionLabel: "基本の意味",
      clickAiHint: "AI ボタンを押すと、この語が現在の段落でどう使われているかを説明します。",
      contextHeading: "現在の文脈での説明",
      contextLabel: "現在の文脈",
      noLocalDefinition: "ローカル辞書とキャッシュには該当する項目がありません。"
    },
    ko: {
      baseDefinitionLabel: "기본 의미",
      clickAiHint: "AI 버튼을 누르면 이 단어가 현재 문단에서 어떤 의미인지 설명합니다.",
      contextHeading: "현재 문맥 설명",
      contextLabel: "현재 문맥",
      noLocalDefinition: "로컬 사전과 캐시에 일치하는 항목이 없습니다."
    },
    es: {
      baseDefinitionLabel: "Significado básico",
      clickAiHint: "Haz clic en el botón de IA para explicar este término en el párrafo actual.",
      contextHeading: "Explicación en contexto",
      contextLabel: "Contexto actual",
      noLocalDefinition: "No hay coincidencias en el diccionario local ni en la caché."
    },
    fr: {
      baseDefinitionLabel: "Sens de base",
      clickAiHint: "Cliquez sur le bouton IA pour expliquer ce terme dans le paragraphe actuel.",
      contextHeading: "Explication en contexte",
      contextLabel: "Contexte actuel",
      noLocalDefinition: "Aucune entrée trouvée dans le dictionnaire local ni le cache."
    },
    de: {
      baseDefinitionLabel: "Grundbedeutung",
      clickAiHint: "Klicke auf die KI-Schaltfläche, um diesen Begriff im aktuellen Absatz zu erklären.",
      contextHeading: "Erklärung im Kontext",
      contextLabel: "Aktueller Kontext",
      noLocalDefinition: "Kein Treffer im lokalen Wörterbuch oder Cache."
    },
    en: {
      baseDefinitionLabel: "Basic meaning",
      clickAiHint: "Click the AI button to explain this term in the current paragraph.",
      contextHeading: "Context explanation",
      contextLabel: "Current context",
      noLocalDefinition: "No local dictionary or cache match."
    }
  };

  const baseText = textByLanguage[targetLanguage] ?? textByLanguage.en;

  if (targetLanguage === "zh-CN") {
    return {
      ...baseText,
      loadingContext: `${backendLabel} 正在结合上下文解释…`,
      loadingParagraph: `${backendLabel} 正在结合当前段落解释…`
    };
  }

  if (targetLanguage === "zh-TW") {
    return {
      ...baseText,
      loadingContext: `${backendLabel} 正在結合上下文解釋…`,
      loadingParagraph: `${backendLabel} 正在結合目前段落解釋…`
    };
  }

  if (targetLanguage === "ja") {
    return {
      ...baseText,
      loadingContext: `${backendLabel} が文脈に基づいて説明しています…`,
      loadingParagraph: `${backendLabel} が現在の段落に基づいて説明しています…`
    };
  }

  if (targetLanguage === "ko") {
    return {
      ...baseText,
      loadingContext: `${backendLabel}가 문맥을 바탕으로 설명하는 중…`,
      loadingParagraph: `${backendLabel}가 현재 문단을 바탕으로 설명하는 중…`
    };
  }

  if (targetLanguage === "es") {
    return {
      ...baseText,
      loadingContext: `${backendLabel} está explicando con contexto…`,
      loadingParagraph: `${backendLabel} está explicando con el párrafo actual…`
    };
  }

  if (targetLanguage === "fr") {
    return {
      ...baseText,
      loadingContext: `${backendLabel} explique avec le contexte…`,
      loadingParagraph: `${backendLabel} explique avec le paragraphe actuel…`
    };
  }

  if (targetLanguage === "de") {
    return {
      ...baseText,
      loadingContext: `${backendLabel} erklärt mit Kontext…`,
      loadingParagraph: `${backendLabel} erklärt anhand des aktuellen Absatzes…`
    };
  }

  return {
    ...baseText,
    loadingContext: `${backendLabel} is explaining with context…`,
    loadingParagraph: `${backendLabel} is explaining with the current paragraph…`
  };
}

function formatVocabularyCard(
  card: VocabularyCard,
  context: VocabularyContext,
  targetLanguage: string,
  sourceLanguage: string
): string {
  const uiText = getVocabularyUiText(targetLanguage, "AI");
  const created = formatDateOnly(new Date());
  const lines = [
    `**${card.word}**`,
    "",
    "### Metadata",
    "- type:: vocabulary",
    `- term:: ${escapeInlineFieldValue(card.word)}`,
    `- status:: new`,
    `- source_language:: ${sourceLanguage}`,
    `- target_language:: ${targetLanguage}`,
    `- created:: ${created}`,
    context.filePath ? `- source:: [[${context.filePath}]]` : "- source:: Unknown",
    `- tags:: #vocabulary #language/${sanitizeTagSegment(targetLanguage)} #status/new`,
    "",
    `- ${uiText.baseDefinitionLabel}: ${card.baseDefinition || uiText.noLocalDefinition}`
  ];

  if (card.contextExplanation) {
    lines.push("", `### ${uiText.contextHeading}`, card.contextExplanation);
  } else if (card.errorText) {
    lines.push("", `### ${uiText.contextHeading}`, card.errorText);
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

function buildBlockTranslationPrompt(
  blockTexts: string[],
  customPrompt: string,
  targetLanguage: string,
  sourceLanguage: string
): string {
  const numberedBlocks = blockTexts
    .map((text, i) => `#${i + 1}\n${text}`)
    .join(`\n${BLOCK_SEP}\n`);
  const target = getLanguagePromptName(targetLanguage);
  const source = getLanguagePromptName(sourceLanguage);

  return [
    `Translate each block from ${source} to ${target}.`,
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

function chooseYtDlpCaption(
  metadata: YtDlpMetadata,
  preferredLanguage: string
): { code: string; formats: YtDlpCaptionFormat[] } | undefined {
  const detected = metadata.language?.toLowerCase();
  const preferred = (preferredLanguage === "auto" ? detected ?? "auto" : preferredLanguage).toLowerCase();
  const base = preferred.split("-")[0];
  const sources = [metadata.subtitles ?? {}, metadata.automatic_captions ?? {}];

  for (const source of sources) {
    const keys = Object.keys(source);
    const code = preferredLanguage === "auto" && !detected
      ? keys[0]
      : keys.find((key) => key.toLowerCase() === preferred)
      ?? keys.find((key) => key.toLowerCase() === base)
      ?? keys.find((key) => key.toLowerCase().startsWith(`${base}-`))
      ?? keys.find((key) => key.toLowerCase() === "en")
      ?? keys.find((key) => key.toLowerCase().startsWith("en-"))
      ?? keys[0];
    if (code && source[code]?.length) return { code, formats: source[code] };
  }
  return undefined;
}

function resolveYtDlpCommand(configuredCommand: string): string {
  if (configuredCommand.trim()) return configuredCommand.trim();
  return YT_DLP_CANDIDATES.find((candidate) => candidate === "yt-dlp" || existsSync(candidate)) ?? "yt-dlp";
}

function resolveFfmpegCommand(configuredCommand: string): string {
  if (configuredCommand.trim()) return configuredCommand.trim();
  return FFMPEG_CANDIDATES.find((candidate) => candidate === "ffmpeg" || existsSync(candidate)) ?? "ffmpeg";
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

function buildMultipartFormData(
  fields: Array<[string, string]>,
  fileField: string,
  fileName: string,
  contentType: string,
  file: Buffer
): { body: Buffer; boundary: string } {
  const boundary = `----ContextualAIReader${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of fields) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      "utf8"
    ));
  }
  chunks.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    "utf8"
  ));
  chunks.push(file, Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"));
  return { body: Buffer.concat(chunks), boundary };
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
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
    const useShell = process.platform === "win32" && (
      /\.(?:cmd|bat)$/i.test(command)
      || (!/[\\/]/.test(command) && /^(?:codex|claude)$/i.test(command))
    );
    const child = spawn(command, args, {
      env: buildCodexEnv(),
      shell: useShell,
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

function parseStringArray(raw: string, expectedLength: number): string[] {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("AI response did not contain a JSON array.");
  const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
  if (!Array.isArray(parsed) || parsed.length !== expectedLength || parsed.some((value) => typeof value !== "string")) {
    throw new Error(`Expected ${expectedLength} translated subtitle strings.`);
  }
  return parsed as string[];
}

function formatFileTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
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

function formatDateOnly(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate())
  ].join("");
}

function escapeInlineFieldValue(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[|\[\]]/g, "").trim();
}

function sanitizeTagSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
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

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function googleTranslate(text: string, targetLanguage: string, sourceLanguage: string): Promise<string> {
  const targetLang = getGoogleTranslateLanguageCode(targetLanguage);
  const sourceLang = getGoogleTranslateLanguageCode(sourceLanguage);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
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
