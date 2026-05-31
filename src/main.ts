import { spawn } from "child_process";
import { existsSync } from "fs";
import { mkdtemp, readFile, rm } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  normalizePath,
  setIcon
} from "obsidian";

type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
type InsertMode = "replace" | "append";
type FullDocumentInsertMode = "append" | "interleave";

interface CodexTranslatorSettings {
  autoTranslate: boolean;
  codexCommand: string;
  customPrompt: string;
  debounceMs: number;
  excerptFilePath: string;
  includeTranslationInExcerpt: boolean;
  minSelectionChars: number;
  model: string;
  openExcerptAfterSave: boolean;
  reasoningEffort: ReasoningEffort;
  requireCommandForAutoTranslate: boolean;
  speechLanguage: string;
  speechRate: number;
  timeoutSeconds: number;
}

const DEFAULT_SETTINGS: CodexTranslatorSettings = {
  autoTranslate: true,
  codexCommand: "",
  customPrompt: "",
  debounceMs: 450,
  excerptFilePath: "Codex Translator Excerpts.md",
  includeTranslationInExcerpt: true,
  minSelectionChars: 2,
  model: "gpt-5.4-mini",
  openExcerptAfterSave: true,
  reasoningEffort: "none",
  requireCommandForAutoTranslate: true,
  speechLanguage: "en-US",
  speechRate: 0.92,
  timeoutSeconds: 90
};

const CODEX_CANDIDATES = [
  "/Applications/Codex.app/Contents/Resources/codex",
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
  "codex"
];

const CODEX_PATH_ENTRIES = [
  "/Applications/Codex.app/Contents/Resources",
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin"
];

interface SourceReference {
  endLine?: number;
  line?: number;
  path: string;
}

interface MarkdownBlock {
  separator: string;
  text: string;
}

export default class CodexLocalTranslatorPlugin extends Plugin {
  settings: CodexTranslatorSettings = DEFAULT_SETTINGS;
  private autoTimer?: number;
  private commandSelectionGestureUntil = 0;
  private isCommandKeyPressed = false;
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

    this.addSettingTab(new CodexTranslatorSettingTab(this.app, this));

    this.registerDomEvent(document, "selectionchange", () => {
      this.handleSelectionChange();
    });
    this.registerDomEvent(window, "keydown", (event) => {
      if (event.key === "Meta" || event.metaKey) {
        this.isCommandKeyPressed = true;
      }
    });
    this.registerDomEvent(window, "keyup", (event) => {
      if (event.key === "Meta") {
        this.isCommandKeyPressed = false;
        this.commandSelectionGestureUntil = Date.now() + 700;
      }
    });
    this.registerDomEvent(window, "blur", () => {
      this.isCommandKeyPressed = false;
      this.commandSelectionGestureUntil = 0;
    });
    this.registerDomEvent(document, "mousedown", (event) => {
      if (event.metaKey) {
        this.commandSelectionGestureUntil = Date.now() + 2_000;
      }
    }, true);
    this.registerDomEvent(document, "mouseup", (event) => {
      if (event.metaKey) {
        this.commandSelectionGestureUntil = Date.now() + 700;
      }
    }, true);
    this.registerDomEvent(window, "scroll", () => {
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

    return this.isCommandKeyPressed || Date.now() <= this.commandSelectionGestureUntil;
  }

  private async translateSelectionToPopup(sourceText: string, rect: DOMRect) {
    const cached = this.translationCache.get(sourceText);
    const requestId = ++this.requestSerial;

    if (cached) {
      this.showPopup(cached, sourceText, rect, "done");
      return;
    }

    this.showPopup("Translating with local Codex...", sourceText, rect, "loading");

    try {
      const translation = (await this.runCodexTranslation(sourceText)).trim();

      if (requestId !== this.requestSerial) {
        return;
      }

      if (!translation) {
        throw new Error("Codex returned an empty translation.");
      }

      this.rememberTranslation(sourceText, translation);
      this.showPopup(translation, sourceText, rect, "done");
    } catch (error) {
      if (requestId !== this.requestSerial) {
        return;
      }

      this.showPopup(`Codex translation failed: ${getErrorMessage(error)}`, sourceText, rect, "error");
      console.error("Codex translation failed", error);
    }
  }

  private async translateSelection(editor: Editor, mode: InsertMode) {
    const selection = editor.getSelection();

    if (!selection.trim()) {
      new Notice("Select some Markdown text first.");
      return;
    }

    this.setStatus("Codex translating...");
    new Notice("Translating with local Codex...");

    try {
      const translation = await this.runCodexTranslation(selection);

      if (!translation.trim()) {
        throw new Error("Codex returned an empty translation.");
      }

      if (mode === "append") {
        editor.replaceSelection(`${selection}\n\n${translation.trim()}`);
      } else {
        editor.replaceSelection(translation.trim());
      }

      new Notice("Translation complete.");
    } catch (error) {
      new Notice(`Codex translation failed: ${getErrorMessage(error)}`);
      console.error("Codex translation failed", error);
    } finally {
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

    this.hidePopup();
    const notice = new Notice("Preparing full-file translation...", 0);
    this.setStatus("Codex translating file...");

    try {
      const translatedContent = await this.translateMarkdownDocument(sourceText, notice, "current file");

      if (!translatedContent.fullText.trim()) {
        throw new Error("Codex returned an empty translation.");
      }

      const nextContent = mode === "append"
        ? appendDocumentTranslation(sourceText, translatedContent.fullText)
        : interleaveDocumentTranslation(sourceText, translatedContent.blocks, translatedContent.translations);

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

      notice.setMessage(mode === "append"
        ? "Chinese translation appended below the current file."
        : "Chinese translation inserted after each paragraph.");
    } catch (error) {
      notice.setMessage(`Codex translation failed: ${getErrorMessage(error)}`);
      console.error("Codex file translation failed", error);
    } finally {
      window.setTimeout(() => notice.hide(), 5000);
      this.setStatus("");
    }
  }

  private async batchTranslateFiles(scopeText: string, mode: FullDocumentInsertMode) {
    const files = this.resolveBatchFiles(scopeText);

    if (files.length === 0) {
      new Notice("No Markdown files matched that batch scope.");
      return;
    }

    this.hidePopup();
    const notice = new Notice(`Batch translating ${files.length} Markdown files...`, 0);
    this.setStatus(`Codex batch translating 0/${files.length}`);

    let changedCount = 0;
    const failures: string[] = [];

    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const file = files[fileIndex];
      const fileLabel = `${fileIndex + 1}/${files.length}: ${file.path}`;

      try {
        notice.setMessage(`Translating file ${fileLabel}`);
        this.setStatus(`Codex batch translating ${fileIndex + 1}/${files.length}`);

        const sourceText = await this.app.vault.read(file);

        if (!sourceText.trim()) {
          continue;
        }

        const translatedContent = await this.translateMarkdownDocument(sourceText, notice, `file ${fileIndex + 1}/${files.length}`);

        if (!translatedContent.fullText.trim()) {
          throw new Error("Codex returned an empty translation.");
        }

        const nextContent = mode === "append"
          ? appendDocumentTranslation(sourceText, translatedContent.fullText)
          : interleaveDocumentTranslation(sourceText, translatedContent.blocks, translatedContent.translations);

        const currentContent = await this.app.vault.read(file);

        if (currentContent !== sourceText) {
          throw new Error("File changed while translating, skipped write.");
        }

        await this.app.vault.modify(file, nextContent);
        changedCount++;
      } catch (error) {
        failures.push(`${file.path}: ${getErrorMessage(error)}`);
        console.error("Codex batch file translation failed", file.path, error);
      }
    }

    const summary = failures.length === 0
      ? `Batch translation complete: ${changedCount}/${files.length} files updated.`
      : `Batch translation finished: ${changedCount}/${files.length} files updated, ${failures.length} failed. Check console for details.`;
    notice.setMessage(summary);
    window.setTimeout(() => notice.hide(), failures.length === 0 ? 5000 : 9000);
    this.setStatus("");
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
      const result = await runProcess(resolveCodexCommand(this.settings.codexCommand), [
        "login",
        "status"
      ], "", 20_000);

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

  private async runCodexTranslation(sourceText: string): Promise<string> {
    return await this.runCodexPrompt(buildTranslationPrompt(sourceText, this.settings.customPrompt));
  }

  private async runCodexPrompt(prompt: string): Promise<string> {
    const tempDir = await mkdtemp(join(tmpdir(), "codex-obsidian-"));
    const outputPath = join(tempDir, "translation.txt");

    try {
      const result = await runProcess(
        resolveCodexCommand(this.settings.codexCommand),
        [
          "exec",
          "--ignore-user-config",
          "--ignore-rules",
          "--ephemeral",
          "--skip-git-repo-check",
          "--color",
          "never",
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

      if (result.code !== 0) {
        throw new Error(compactProcessError(result.stderr || result.stdout));
      }

      return await readFile(outputPath, "utf8");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  }

  private async translateMarkdownDocument(
    sourceText: string,
    notice: Notice,
    progressLabel: string
  ): Promise<{ blocks: MarkdownBlock[]; fullText: string; translations: string[] }> {
    const { body } = extractFrontmatter(sourceText);
    const blocks = splitMarkdownBlocks(body);

    if (blocks.length === 0) {
      return {
        blocks,
        fullText: "",
        translations: []
      };
    }

    const batches = buildBlockBatches(blocks, 3500);
    const translations: string[] = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      notice.setMessage(`Translating ${progressLabel} chunk ${batchIndex + 1}/${batches.length}...`);
      this.setStatus(`Codex translating ${batchIndex + 1}/${batches.length}`);

      const batchTranslations = await this.translateBlockBatch(batch.map((block) => block.text));
      translations.push(...batchTranslations);
    }

    return {
      blocks,
      fullText: joinTranslatedBlocks(blocks, translations),
      translations
    };
  }

  private async translateBlockBatch(blockTexts: string[]): Promise<string[]> {
    const prompt = buildBlockTranslationPrompt(blockTexts, this.settings.customPrompt);
    const rawResult = await this.runCodexPrompt(prompt);

    try {
      return parseTranslationArray(rawResult, blockTexts.length);
    } catch (error) {
      console.warn("Codex block translation was not valid JSON; retrying blocks individually.", error);
      const translations: string[] = [];

      for (const blockText of blockTexts) {
        translations.push((await this.runCodexTranslation(blockText)).trim());
      }

      return translations;
    }
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

    return await this.app.vault.create(path, "# Codex Translator Excerpts\n\n");
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

  private rememberTranslation(sourceText: string, translation: string) {
    this.translationCache.set(sourceText, translation);

    if (this.translationCache.size > 30) {
      const oldestKey = this.translationCache.keys().next().value;
      if (oldestKey) {
        this.translationCache.delete(oldestKey);
      }
    }
  }

  private showPopup(text: string, sourceText: string, rect: DOMRect, state: "loading" | "done" | "error") {
    const popup = this.ensurePopup();
    popup.empty();
    popup.classList.toggle("is-loading", state === "loading");
    popup.classList.toggle("is-error", state === "error");

    const body = document.createElement("div");
    body.className = "codex-local-translator-body";
    body.setText(text);
    popup.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "codex-local-translator-actions";

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
    popup.style.display = "block";
    this.positionPopup(rect);
  }

  private createIconButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "codex-local-translator-button";
    button.ariaLabel = label;
    button.title = label;
    setIcon(button, icon);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
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

    const popup = document.createElement("div");
    popup.className = "codex-local-translator-popover";
    popup.style.display = "none";
    document.body.appendChild(popup);
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

    this.popupEl.style.left = `${left}px`;
    this.popupEl.style.top = `${top}px`;
  }

  private hidePopup() {
    if (!this.popupEl) {
      return;
    }

    this.popupEl.style.display = "none";
  }

  private setStatus(text: string) {
    if (!this.statusBarEl) {
      return;
    }

    this.statusBarEl.setText(text);
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

    const description = document.createElement("p");
    description.className = "codex-local-translator-batch-description";
    description.setText("Enter one Markdown file, folder, or wildcard per line. This command writes directly to the matched files.");
    this.contentEl.appendChild(description);

    const textarea = document.createElement("textarea");
    textarea.className = "codex-local-translator-batch-input";
    textarea.placeholder = [
      "Books/Example Book/",
      "Books/Example Book/08 - Chapter 1.md",
      "Books/Example Book/*.md",
      "Books/Example Book/**/*.md"
    ].join("\n");
    this.contentEl.appendChild(textarea);

    const actions = document.createElement("div");
    actions.className = "codex-local-translator-batch-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.setText("Cancel");
    cancelButton.addEventListener("click", () => {
      this.close();
    });

    const startButton = document.createElement("button");
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

class CodexTranslatorSettingTab extends PluginSettingTab {
  plugin: CodexLocalTranslatorPlugin;

  constructor(app: App, plugin: CodexLocalTranslatorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

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
      .setName("Require Command key for auto translate")
      .setDesc("When enabled, the popup only appears if you hold Command while selecting text.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.requireCommandForAutoTranslate)
          .onChange(async (value) => {
            this.plugin.settings.requireCommandForAutoTranslate = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Codex command")
      .setDesc("Leave empty to auto-detect Codex.app or the local Codex CLI.")
      .addText((text) =>
        text
          .setPlaceholder("/Applications/Codex.app/Contents/Resources/codex")
          .setValue(this.plugin.settings.codexCommand)
          .onChange(async (value) => {
            this.plugin.settings.codexCommand = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("For ChatGPT login, gpt-5.4-mini is a good default.")
      .addText((text) =>
        text
          .setPlaceholder("gpt-5.4-mini")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim() || DEFAULT_SETTINGS.model;
            await this.plugin.saveSettings();
          })
      );

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
        text.inputEl.addClass("codex-local-translator-settings-textarea");
      });

    new Setting(containerEl)
      .setName("Excerpt file")
      .setDesc("Vault path where selected passages are saved.")
      .addText((text) =>
        text
          .setPlaceholder("Codex Translator Excerpts.md")
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

    new Setting(containerEl)
      .setName("Reasoning effort")
      .setDesc("Use none for translation unless you need heavier reasoning.")
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

    new Setting(containerEl)
      .setName("Timeout")
      .setDesc("Maximum seconds to wait for Codex.")
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

function buildBlockTranslationPrompt(blockTexts: string[], customPrompt: string): string {
  return [
    "You are a precise Markdown translation engine.",
    "Translate every string in the `blocks` array to Simplified Chinese.",
    customPrompt.trim()
      ? `User custom context and preferences:\n${customPrompt.trim()}`
      : "User custom context and preferences: none.",
    "",
    "Rules:",
    "- Return only a valid JSON array of strings.",
    "- The returned array must have exactly the same length and order as `blocks`.",
    "- Do not merge, split, remove, or reorder blocks.",
    "- Preserve Markdown structure, headings, lists, tables, links, inline code, and code fences inside each block.",
    "- Do not translate code, commands, file paths, URLs, package names, identifiers, or placeholders.",
    "- Do not add explanations, labels, Markdown fences, or surrounding prose.",
    "",
    "JSON payload:",
    JSON.stringify({ blocks: blockTexts })
  ].join("\n");
}

function parseTranslationArray(rawResult: string, expectedLength: number): string[] {
  let candidate = rawResult.trim();
  const fenced = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

  if (fenced) {
    candidate = fenced[1].trim();
  }

  const firstBracket = candidate.indexOf("[");
  const lastBracket = candidate.lastIndexOf("]");

  if (firstBracket < 0 || lastBracket < firstBracket) {
    throw new Error("Codex did not return a JSON array.");
  }

  const parsed = JSON.parse(candidate.slice(firstBracket, lastBracket + 1)) as unknown;

  if (!Array.isArray(parsed) || parsed.length !== expectedLength) {
    throw new Error("Codex returned a JSON array with the wrong length.");
  }

  return parsed.map((item) => {
    if (typeof item !== "string") {
      throw new Error("Codex returned a non-string translation item.");
    }

    return item.trim();
  });
}

function appendDocumentTranslation(sourceText: string, translatedText: string): string {
  return `${sourceText.trimEnd()}\n\n${translatedText.trim()}\n`;
}

function interleaveDocumentTranslation(
  sourceText: string,
  blocks: MarkdownBlock[],
  translations: string[]
): string {
  const { frontmatter } = extractFrontmatter(sourceText);
  const body = blocks
    .map((block, index) => {
      const translation = translations[index]?.trim();

      if (!translation) {
        return `${block.text.trimEnd()}${block.separator}`;
      }

      return `${block.text.trimEnd()}\n\n${translation}${block.separator}`;
    })
    .join("")
    .trimEnd();

  return `${frontmatter ? `${frontmatter.trimEnd()}\n\n` : ""}${body}\n`;
}

function joinTranslatedBlocks(blocks: MarkdownBlock[], translations: string[]): string {
  return blocks
    .map((block, index) => `${translations[index]?.trimEnd() ?? ""}${block.separator}`)
    .join("")
    .trimEnd();
}

function buildBlockBatches(blocks: MarkdownBlock[], maxCharacters: number): MarkdownBlock[][] {
  const batches: MarkdownBlock[][] = [];
  let currentBatch: MarkdownBlock[] = [];
  let currentSize = 0;

  for (const block of blocks) {
    const blockSize = block.text.length;

    if (currentBatch.length > 0 && currentSize + blockSize > maxCharacters) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }

    currentBatch.push(block);
    currentSize += blockSize;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
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

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runProcess(
  command: string,
  args: string[],
  stdin: string,
  timeoutMs: number
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: buildCodexEnv(),
      shell: false,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = window.setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      window.clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      window.clearTimeout(timeout);

      if (timedOut) {
        reject(new Error(`Codex timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
        return;
      }

      resolve({ code, stdout, stderr });
    });

    child.stdin.end(stdin);
  });
}

function buildCodexEnv(): NodeJS.ProcessEnv {
  const existingPath = process.env.PATH ?? "";
  const mergedPath = [
    ...CODEX_PATH_ENTRIES,
    ...existingPath.split(":").filter(Boolean)
  ].filter((entry, index, entries) => entries.indexOf(entry) === index).join(":");

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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    .replace(/[#>*_~\-]+/g, " ")
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
    ".codex-local-translator-popover"
  ].join(",")));
}

function getSelectionElement(node: Node | null): Element | null {
  if (!node) {
    return null;
  }

  return node instanceof Element ? node : node.parentElement;
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
