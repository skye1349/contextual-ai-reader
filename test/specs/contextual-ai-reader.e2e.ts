import { browser, expect } from "@wdio/globals";
import { copyFile, mkdir, writeFile } from "fs/promises";
import { Key } from "webdriverio";

const PLUGIN_ID = "contextual-ai-reader";

describe("Contextual AI Reader in Obsidian", function () {
  it("loads the plugin, registers commands, and opens settings", async function () {
    const pluginState = await browser.executeObsidian(({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const commands = Object.keys(app.commands.commands)
        .filter((id) => id.startsWith("contextual-ai-reader:"))
        .sort();

      return {
        commandCount: commands.length,
        commands,
        loaded: Boolean(plugin),
        manifestName: plugin?.manifest?.name,
        settings: plugin?.settings
      };
    });

    expect(pluginState.loaded).toBe(true);
    expect(pluginState.manifestName).toBe("Contextual AI Reader");
    expect(pluginState.commandCount).toBeGreaterThanOrEqual(8);
    expect(pluginState.commands).toContain(`${PLUGIN_ID}:translate-selection-to-chinese`);
    expect(pluginState.commands).toContain(`${PLUGIN_ID}:translate-current-file-interleaved-to-chinese`);
    expect(pluginState.settings.sourceLanguage).toBe("auto");
    expect(pluginState.settings.targetLanguage).toBe("zh-CN");

    const updatedSettings = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      plugin.settings.sourceLanguage = "auto";
      plugin.settings.targetLanguage = "ja";
      await plugin.saveSettings();
      return plugin.settings;
    });

    expect(updatedSettings.targetLanguage).toBe("ja");

    const mainWindow = await browser.getWindowHandle();
    const existingWindows = await browser.getWindowHandles();
    await browser.executeObsidian(({ app }) => {
      app.setting.open();
      app.setting.openTabById("contextual-ai-reader");
    });

    // Obsidian 1.13 opens settings in a separate desktop window.
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length > existingWindows.length || await browser.$("div=Source language").isExisting());
    const settingsWindow = (await browser.getWindowHandles()).find((handle) => !existingWindows.includes(handle));
    if (settingsWindow) await browser.switchToWindow(settingsWindow);
    await expect(browser.$("div=Source language")).toExist();
    await expect(browser.$("div=Learning / target language")).toExist();

    await mkdir("e2e-artifacts", { recursive: true });
    await browser.saveScreenshot("e2e-artifacts/contextual-ai-reader-settings.png");
    if (settingsWindow) {
      await browser.closeWindow();
      await browser.switchToWindow(mainWindow);
    } else {
      await browser.executeObsidian(({ app }) => app.setting.close());
    }
  });

  it("reuses an already-open excerpt note instead of opening duplicate leaves", async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const path = "Contextual AI Reader Excerpts.md";
      let file = app.vault.getAbstractFileByPath(path);

      if (!file) {
        file = await app.vault.create(path, "# Contextual AI Reader Excerpts\n\n");
      }

      await plugin.openExcerptFile(file);
      const afterFirstOpen = app.workspace
        .getLeavesOfType("markdown")
        .filter((leaf) => leaf.view.file?.path === path).length;

      await plugin.openExcerptFile(file);
      const afterSecondOpen = app.workspace
        .getLeavesOfType("markdown")
        .filter((leaf) => leaf.view.file?.path === path).length;

      return { afterFirstOpen, afterSecondOpen };
    });

    expect(result.afterFirstOpen).toBe(1);
    expect(result.afterSecondOpen).toBe(1);
  });

  it("formats vocabulary notes with reusable metadata fields", async function () {
    const note = await browser.executeObsidian(({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      plugin.settings.sourceLanguage = "en";
      plugin.settings.targetLanguage = "ja";
      return plugin.formatVocabularyCard(
        {
          word: "private",
          baseDefinition: "プライベート",
          contextExplanation: "- 現在の文脈では「民間の」という意味です。",
          status: "done"
        },
        {
          filePath: "Books/Test Chapter.md",
          paragraph: "The private sector and the public sector are both mentioned here."
        }
      );
    });

    expect(note).toContain("### Metadata");
    expect(note).toContain("- type:: vocabulary");
    expect(note).toContain("- term:: private");
    expect(note).toContain("- status:: new");
    expect(note).toContain("- source_language:: en");
    expect(note).toContain("- target_language:: ja");
    expect(note).toContain("- source:: [[Books/Test Chapter.md]]");
    expect(note).toContain("- tags:: #vocabulary #language/ja #status/new");
  });

  it("reuses an exact YouTube transcript translation from local cache", async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      plugin.settings.sourceLanguage = "en";
      plugin.settings.targetLanguage = "zh-CN";
      plugin.settings.customPrompt = "Cache test";
      const data = {
        title: "Cache test video",
        videoId: "cacheTest01A",
        segments: [{ start: 3, duration: 2, text: "A durable local cache." }]
      };
      await plugin.cacheYouTubeTranscript(data);
      const key = plugin.getYouTubeTranslationCacheKey(data);
      await plugin.cacheYouTubeTranslation(data, key, ["持久的本地缓存。"]);
      const cached = await plugin.getCachedYouTubeVideo(data.videoId);
      plugin.settings.targetLanguage = "ja";
      const changedLanguage = await plugin.getCachedYouTubeVideo(data.videoId);
      return {
        exact: cached?.segments?.[0]?.translation ?? "",
        changedLanguage: changedLanguage?.segments?.[0]?.translation ?? ""
      };
    });

    expect(result.exact).toBe("持久的本地缓存。");
    expect(result.changedLanguage).toBe("");
  });

  (process.env.CCLT_PRIVATE_SHARED_MEMORY_E2E ? it : it.skip)(
    "reuses an exact shared-memory YouTube translation before calling AI",
    async function () {
      const result = await browser.executeObsidian(async ({ app }) => {
        const plugin = app.plugins.plugins["contextual-ai-reader"];
        const fs = window.require("fs");
        const os = window.require("os");
        const path = window.require("path");
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "contextual-ai-reader-memory-e2e-"));
        const commandPath = path.join(tempDir, "memory-command.js");
        const callLogPath = path.join(tempDir, "calls.log");
        fs.writeFileSync(commandPath, `#!/usr/bin/env node
const fs = require("fs");
const payload = JSON.parse(fs.readFileSync(0, "utf8"));
fs.appendFileSync(${JSON.stringify(callLogPath)}, JSON.stringify(payload) + "\\n");
process.stdout.write(JSON.stringify({
  ok: true,
  translations: { "youtube:sharedMemoryVideo1:0": "来自共享记忆" },
  misses: [],
  guidanceByItem: {},
  metadata: {},
  stats: {}
}));
`);
        fs.chmodSync(commandPath, 0o755);

        const previousCommand = plugin.settings.sharedMemoryCommand;
        const previousEnabled = plugin.settings.sharedMemoryEnabled;
        const previousTranslateRaw = plugin.translateRawYouTubeBatch;
        plugin.settings.sharedMemoryCommand = commandPath;
        plugin.settings.sharedMemoryEnabled = true;
        plugin.configureSharedMemory();
        let aiCallCount = 0;
        plugin.translateRawYouTubeBatch = async () => {
          aiCallCount++;
          return ["重新翻译"];
        };
        const data = {
          segments: [{ duration: 5, start: 12, text: "The exact remembered subtitle." }],
          title: "Shared memory fixture",
          videoId: "sharedMemoryVideo1"
        };

        let translations;
        try {
          translations = await plugin.translateYouTubeBatch(data.segments, "en", data, 0);
        } finally {
          plugin.translateRawYouTubeBatch = previousTranslateRaw;
          plugin.settings.sharedMemoryCommand = previousCommand;
          plugin.settings.sharedMemoryEnabled = previousEnabled;
          plugin.configureSharedMemory();
        }
        const memoryCalls = fs.existsSync(callLogPath)
          ? fs.readFileSync(callLogPath, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse)
          : [];
        fs.rmSync(tempDir, { force: true, recursive: true });
        return {
          aiCallCount,
          memoryCallCount: memoryCalls.length,
          reuseExactMemory: memoryCalls[0]?.request?.reuseExactMemory,
          translations
        };
      });

      expect(result.memoryCallCount).toBe(1);
      expect(result.aiCallCount).toBe(0);
      expect(result.reuseExactMemory).toBe(true);
      expect(result.translations).toEqual(["来自共享记忆"]);
    }
  );

  it("uses an in-Obsidian webview when a YouTube owner disables embedding", async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const videoId = "embedOff01A";
      plugin.settings.sourceLanguage = "en";
      plugin.settings.youtubeCache[videoId] = {
        embedAllowed: false,
        requestedSourceLanguage: "en",
        segments: [{ start: 0, duration: 2, text: "Embedding disabled fixture." }],
        sourceLanguage: "en",
        title: "Embed-disabled YouTube fixture",
        translations: {},
        updatedAt: Date.now(),
        videoId
      };

      await plugin.openYouTubePlayer(videoId);
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === videoId);

      return {
        iframeCount: view?.containerEl?.querySelectorAll(".youtube-reader-player iframe").length ?? -1,
        statusText: view?.containerEl?.querySelector(".youtube-reader-status")?.textContent ?? "",
        webviewCount: view?.containerEl?.querySelectorAll(".youtube-reader-player webview").length ?? -1
      };
    });

    expect(result.webviewCount).toBe(1);
    expect(result.iframeCount).toBe(0);
    expect(result.statusText).toContain("owner disabled embedding");
  });

  it("resizes the video/transcript split and keeps transcript text selectable", async function () {
    await browser.executeObsidian(async ({ app }) => {
      window.require?.("electron")?.remote?.getCurrentWindow?.()?.setSize?.(1440, 900);
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const videoId = "layoutTst1A";
      plugin.settings.sourceLanguage = "en";
      plugin.settings.youtubeCache[videoId] = {
        embedAllowed: false,
        requestedSourceLanguage: "en",
        segments: [
          { start: 42, duration: 4, text: "Selectable transcript text." },
          { start: 67, duration: 4, text: "Another timestamp." }
        ],
        sourceLanguage: "en",
        title: "Resizable transcript fixture",
        translations: {},
        updatedAt: Date.now(),
        videoId
      };
      await plugin.openYouTubePlayer(videoId);
      const leaves = app.workspace.getLeavesOfType("contextual-ai-reader-youtube");
      const target = leaves.find((leaf) => leaf.view.getVideoData?.()?.videoId === videoId);
      leaves
        .filter((leaf) => leaf !== target)
        .forEach((leaf) => leaf.detach());
      // Earlier note tests leave split panes open; give this layout test a full pane.
      app.workspace.getLeavesOfType("markdown").forEach((leaf) => leaf.detach());
      if (target) await app.workspace.revealLeaf(target);
    });
    await browser.pause(300);

    const divider = browser.$('[data-video-id="layoutTst1A"] .youtube-reader-resizer');
    await expect(divider).toExist();
    const before = await browser.executeObsidian(({ app }) => {
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "layoutTst1A");
      return {
        mainWidth: view?.containerEl?.querySelector(".youtube-reader-main")?.getBoundingClientRect().width ?? 0,
        transcriptWidth: view?.containerEl?.querySelector(".youtube-reader-transcript-pane")?.getBoundingClientRect().width ?? 0
      };
    });

    await divider.dragAndDrop({ x: -160, y: 0 }, { duration: 500 });
    const after = await browser.executeObsidian(({ app }) => {
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "layoutTst1A");
      return {
        mainWidth: view?.containerEl?.querySelector(".youtube-reader-main")?.getBoundingClientRect().width ?? 0,
        transcriptWidth: view?.containerEl?.querySelector(".youtube-reader-transcript-pane")?.getBoundingClientRect().width ?? 0
      };
    });

    await mkdir("e2e-artifacts", { recursive: true });
    await browser.saveScreenshot("e2e-artifacts/youtube-resizable-transcript.png");

    expect(before.mainWidth - after.mainWidth).toBeGreaterThan(100);
    expect(after.transcriptWidth - before.transcriptWidth).toBeGreaterThan(100);

    const selection = await browser.executeObsidian(({ app }) => {
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "layoutTst1A");
      const original = view?.containerEl?.querySelector(".youtube-reader-original");
      const textNode = original?.firstChild;
      if (!view || !original || !textNode) return null;

      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, "Selectable transcript".length);
      const selected = window.getSelection();
      selected?.removeAllRanges();
      selected?.addRange(range);
      window.require?.("electron")?.clipboard?.clear?.();
      original.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return {
        selectedText: range.toString(),
        timeAfterSelectionClick: view.getCurrentTime()
      };
    });

    const copyModifier = process.platform === "darwin" ? Key.Command : Key.Ctrl;
    await browser.action("key")
      .down(copyModifier)
      .down("c")
      .up("c")
      .up(copyModifier)
      .perform();
    const copied = await browser.executeObsidian(({ app }) => {
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "layoutTst1A");
      const original = view?.containerEl?.querySelector(".youtube-reader-original");
      const clipboard = window.require?.("electron")?.clipboard?.readText?.() ?? "";
      window.getSelection()?.removeAllRanges();
      original?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return {
        clipboard,
        timeAfterPlainClick: view?.getCurrentTime() ?? -1
      };
    });

    expect(selection?.selectedText).toBe("Selectable transcript");
    expect(copied.clipboard).toBe("Selectable transcript");
    expect(selection?.timeAfterSelectionClick).toBe(0);
    expect(copied.timeAfterPlainClick).toBe(42);
  });

  it("keeps the active transcript highlight and auto-scroll aligned with overlapping caption timings", async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const videoId = "timingTst1A";
      plugin.settings.sourceLanguage = "en";
      plugin.settings.youtubeCache[videoId] = {
        embedAllowed: true,
        requestedSourceLanguage: "en",
        segments: [
          { start: 260, duration: 20, text: "Four twenty." },
          { start: 270, duration: 20, text: "Four thirty." },
          { start: 282, duration: 20, text: "Four forty two." },
          { start: 294, duration: 20, text: "Four fifty four." },
          { start: 307, duration: 20, text: "Five oh seven." }
        ],
        sourceLanguage: "en",
        title: "Overlapping transcript timing fixture",
        translations: {},
        updatedAt: Date.now(),
        videoId
      };

      await plugin.openYouTubePlayer(videoId);
      const leaves = app.workspace.getLeavesOfType("contextual-ai-reader-youtube");
      const target = leaves.find((leaf) => leaf.view.getVideoData?.()?.videoId === videoId);
      leaves.filter((leaf) => leaf !== target).forEach((leaf) => leaf.detach());
      if (target) await app.workspace.revealLeaf(target);
      const view = target?.view;
      const scrolledIndexes: number[] = [];
      view?.containerEl?.querySelectorAll<HTMLElement>(".youtube-reader-segment").forEach((row) => {
        row.scrollIntoView = () => {
          scrolledIndexes.push(Number(row.dataset.index));
        };
      });

      view?.seekTo(270);
      const activeAfterClick = Number(
        view?.containerEl?.querySelector<HTMLElement>(".youtube-reader-segment.is-active")?.dataset.index
      );
      view?.updateActiveSegment(307.1, true);
      const activeAfterPlayback = Number(
        view?.containerEl?.querySelector<HTMLElement>(".youtube-reader-segment.is-active")?.dataset.index
      );

      return { activeAfterClick, activeAfterPlayback, scrolledIndexes };
    });

    expect(result.activeAfterClick).toBe(1);
    expect(result.activeAfterPlayback).toBe(4);
    expect(result.scrolledIndexes).toEqual([1, 4]);
  });

  it("offers windowed fullscreen with synchronized bilingual video subtitles", async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      await app.workspace.leftSplit?.collapse?.();
      await app.workspace.rightSplit?.collapse?.();
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const videoId = "overlayTs1A";
      plugin.settings.sourceLanguage = "en";
      plugin.settings.youtubeCache[videoId] = {
        embedAllowed: true,
        requestedSourceLanguage: "en",
        segments: [
          { start: 42, duration: 8, text: "Original English caption." },
          { start: 67, duration: 8, text: "Second English caption." }
        ],
        sourceLanguage: "en",
        title: "Bilingual overlay fixture",
        translations: {},
        updatedAt: Date.now(),
        videoId
      };

      await plugin.openYouTubePlayer(videoId);
      const leaves = app.workspace.getLeavesOfType("contextual-ai-reader-youtube");
      const target = leaves.find((leaf) => leaf.view.getVideoData?.()?.videoId === videoId);
      leaves.filter((leaf) => leaf !== target).forEach((leaf) => leaf.detach());
      if (target) await app.workspace.revealLeaf(target);
      const view = target?.view;
      view?.applyTranslations([
        "\u7b2c\u4e00\u6761\u4e2d\u6587\u5b57\u5e55\u3002",
        "\u7b2c\u4e8c\u6761\u4e2d\u6587\u5b57\u5e55\u3002"
      ]);
      view?.seekTo(67);

      const originalViewStyle = view?.containerEl?.style.cssText ?? "";
      if (view?.containerEl) {
        view.containerEl.style.width = "1024px";
        view.containerEl.style.minWidth = "1024px";
      }

      const fullscreenButton = view?.containerEl?.querySelector<HTMLButtonElement>(
        '[aria-label="Enter windowed fullscreen"]'
      );
      const subtitlesButton = view?.containerEl?.querySelector<HTMLButtonElement>(
        '[aria-label="Hide video subtitles"]'
      );
      const overlay = view?.containerEl?.querySelector<HTMLElement>(".youtube-reader-video-subtitles");
      const original = overlay?.querySelector<HTMLElement>(".youtube-reader-video-subtitle-original");
      const translation = overlay?.querySelector<HTMLElement>(".youtube-reader-video-subtitle-translation");
      const iframeSrc = view?.containerEl?.querySelector<HTMLIFrameElement>(".youtube-reader-player iframe")?.src ?? "";
      const main = view?.containerEl?.querySelector<HTMLElement>(".youtube-reader-main");
      const transcriptPane = view?.containerEl?.querySelector<HTMLElement>(".youtube-reader-transcript-pane");
      const normalBounds = view?.getVideoBounds?.();
      const mainBounds = main?.getBoundingClientRect();
      const transcriptBoundsBefore = transcriptPane?.getBoundingClientRect();
      const originalCaptureYouTubeFrame = plugin.captureYouTubeFrame;
      let fullscreenCaptureCalls = 0;
      let fullscreenCaptureUsedCurrentView = false;
      plugin.captureYouTubeFrame = async (candidate) => {
        fullscreenCaptureCalls++;
        fullscreenCaptureUsedCurrentView = candidate === view;
      };
      fullscreenButton?.click();
      const fullscreenBounds = view?.getVideoBounds?.();
      const transcriptBoundsDuring = transcriptPane?.getBoundingClientRect();
      const originalStyleDuring = original ? getComputedStyle(original) : null;
      const translationStyleDuring = translation ? getComputedStyle(translation) : null;
      const exitButton = view?.playerEl?.querySelector<HTMLButtonElement>(
        '[aria-label="Exit windowed fullscreen"]'
      );
      const captureButton = view?.playerEl?.querySelector<HTMLButtonElement>(
        '[aria-label="Capture screenshot"]'
      );
      const captureButtonBounds = captureButton?.getBoundingClientRect();
      const exitButtonBounds = exitButton?.getBoundingClientRect();
      const captureButtonVisible = captureButton ? getComputedStyle(captureButton).display !== "none" : false;
      captureButton?.click();
      const fullscreenActive = view?.containerEl?.hasClass("is-windowed-fullscreen") ?? false;
      exitButton?.click();
      const captureButtonHiddenAfterExit = captureButton ? getComputedStyle(captureButton).display === "none" : false;
      plugin.captureYouTubeFrame = originalCaptureYouTubeFrame;
      const restoredBounds = view?.getVideoBounds?.();
      const fullscreenExited = !(view?.containerEl?.hasClass("is-windowed-fullscreen") ?? true);

      const originalStyle = original ? getComputedStyle(original) : null;
      const overlayStyle = overlay ? getComputedStyle(overlay) : null;
      const english = original?.textContent ?? "";
      const translationText = translation?.textContent ?? "";
      const overlayIndex = overlay?.dataset.index ?? "";
      const orderIsEnglishThenChinese = Boolean(
        original
        && translation
        && (original.compareDocumentPosition(translation) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
      subtitlesButton?.click();
      if (view?.containerEl) view.containerEl.style.cssText = originalViewStyle;

      return {
        ccDisabledInEmbed: new URL(iframeSrc).searchParams.get("cc_load_policy"),
        captureButtonBesideExit: Boolean(
          captureButtonBounds
          && exitButtonBounds
          && captureButtonBounds.right <= exitButtonBounds.left
          && exitButtonBounds.left - captureButtonBounds.right <= 12
        ),
        captureButtonHiddenAfterExit,
        captureButtonVisible,
        english,
        fullscreenActive,
        fullscreenBounds: fullscreenBounds ? {
          height: fullscreenBounds.height,
          left: fullscreenBounds.left,
          top: fullscreenBounds.top,
          width: fullscreenBounds.width
        } : null,
        fullscreenStaysInsideMainPane: Boolean(
          fullscreenBounds
          && mainBounds
          && Math.abs(fullscreenBounds.left - mainBounds.left) < 2
          && Math.abs(fullscreenBounds.top - mainBounds.top) < 2
          && Math.abs(fullscreenBounds.width - mainBounds.width) < 2
          && Math.abs(fullscreenBounds.height - mainBounds.height) < 2
        ),
        originalFontSizeDuring: Number.parseFloat(originalStyleDuring?.fontSize ?? "0"),
        transcriptRemainsVisible: Boolean(
          transcriptBoundsBefore
          && transcriptBoundsDuring
          && transcriptPane
          && getComputedStyle(transcriptPane).display !== "none"
          && transcriptBoundsDuring.width > 250
          && Math.abs(transcriptBoundsBefore.left - transcriptBoundsDuring.left) < 2
          && Math.abs(transcriptBoundsBefore.width - transcriptBoundsDuring.width) < 2
          && fullscreenBounds
          && fullscreenBounds.right <= transcriptBoundsDuring.left
        ),
        transcriptBoundsBefore: transcriptBoundsBefore ? {
          height: transcriptBoundsBefore.height,
          left: transcriptBoundsBefore.left,
          top: transcriptBoundsBefore.top,
          width: transcriptBoundsBefore.width
        } : null,
        transcriptBoundsDuring: transcriptBoundsDuring ? {
          height: transcriptBoundsDuring.height,
          left: transcriptBoundsDuring.left,
          top: transcriptBoundsDuring.top,
          width: transcriptBoundsDuring.width
        } : null,
        translationFontSizeDuring: Number.parseFloat(translationStyleDuring?.fontSize ?? "0"),
        fullscreenExited,
        fullscreenCaptureCalls,
        fullscreenCaptureUsedCurrentView,
        normalWasSplit: Boolean(normalBounds && normalBounds.width < window.innerWidth * 0.9),
        orderIsEnglishThenChinese,
        overlayBackground: overlayStyle?.backgroundColor ?? "missing",
        overlayIndex,
        overlayVisibleAfterToggle: overlay ? getComputedStyle(overlay).display !== "none" : true,
        restoredOriginalWidth: Boolean(
          normalBounds
          && restoredBounds
          && Math.abs(normalBounds.width - restoredBounds.width) < 2
        ),
        textColor: originalStyle?.color ?? "missing",
        translation: translationText,
        viewport: { height: window.innerHeight, width: window.innerWidth }
      };
    });

    expect(result.ccDisabledInEmbed).toBe("0");
    expect(result.english).toBe("Second English caption.");
    expect(result.translation).toBe("第二条中文字幕。");
    expect(result.overlayIndex).toBe("1");
    expect(result.orderIsEnglishThenChinese).toBe(true);
    expect(result.overlayBackground).toBe("rgba(0, 0, 0, 0)");
    expect(result.textColor).toBe("rgb(17, 17, 17)");
    expect(result.normalWasSplit).toBe(true);
    expect(result.fullscreenActive).toBe(true);
    expect(result.captureButtonVisible).toBe(true);
    expect(result.captureButtonBesideExit).toBe(true);
    expect(result.fullscreenCaptureCalls).toBe(1);
    expect(result.fullscreenCaptureUsedCurrentView).toBe(true);
    if (!result.fullscreenStaysInsideMainPane || !result.transcriptRemainsVisible) {
      throw new Error(`Left-pane fullscreen bounds mismatch: ${JSON.stringify(result)}`);
    }
    expect(result.originalFontSizeDuring).toBeLessThanOrEqual(16);
    expect(result.translationFontSizeDuring).toBeLessThanOrEqual(15);
    expect(result.fullscreenExited).toBe(true);
    expect(result.captureButtonHiddenAfterExit).toBe(true);
    expect(result.restoredOriginalWidth).toBe(true);
    expect(result.overlayVisibleAfterToggle).toBe(false);
  });

  it("applies configurable sizes and colors to bilingual video subtitles", async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const videoId = "subCfg00001";
      const previousAppearance = {
        originalColor: plugin.settings.youtubeOriginalSubtitleColor,
        originalFontSize: plugin.settings.youtubeOriginalSubtitleFontSize,
        translationColor: plugin.settings.youtubeTranslationSubtitleColor,
        translationFontSize: plugin.settings.youtubeTranslationSubtitleFontSize
      };
      plugin.settings.youtubeCache[videoId] = {
        embedAllowed: true,
        requestedSourceLanguage: "en",
        segments: [{ start: 12, duration: 5, text: "Configurable original subtitle." }],
        sourceLanguage: "en",
        title: "Subtitle appearance fixture",
        translations: {},
        updatedAt: Date.now(),
        videoId
      };

      await plugin.openYouTubePlayer(videoId);
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === videoId);
      view?.applyTranslations(["可配置的翻译字幕。。"]);
      view?.seekTo(12);
      plugin.settings.youtubeOriginalSubtitleFontSize = 23;
      plugin.settings.youtubeOriginalSubtitleColor = "#ff3366";
      plugin.settings.youtubeTranslationSubtitleFontSize = 19;
      plugin.settings.youtubeTranslationSubtitleColor = "#33ccff";
      await plugin.saveSettings();
      const original = view?.containerEl?.querySelector<HTMLElement>(".youtube-reader-video-subtitle-original");
      const translation = view?.containerEl?.querySelector<HTMLElement>(".youtube-reader-video-subtitle-translation");
      const originalStyle = original ? getComputedStyle(original) : null;
      const translationStyle = translation ? getComputedStyle(translation) : null;
      const result = {
        originalColor: originalStyle?.color ?? "",
        originalFontSize: originalStyle?.fontSize ?? "",
        translationColor: translationStyle?.color ?? "",
        translationFontSize: translationStyle?.fontSize ?? ""
      };
      plugin.settings.youtubeOriginalSubtitleColor = previousAppearance.originalColor;
      plugin.settings.youtubeOriginalSubtitleFontSize = previousAppearance.originalFontSize;
      plugin.settings.youtubeTranslationSubtitleColor = previousAppearance.translationColor;
      plugin.settings.youtubeTranslationSubtitleFontSize = previousAppearance.translationFontSize;
      await plugin.saveSettings();
      return result;
    });

    expect(result.originalFontSize).toBe("23px");
    expect(result.originalColor).toBe("rgb(255, 51, 102)");
    expect(result.translationFontSize).toBe("19px");
    expect(result.translationColor).toBe("rgb(51, 204, 255)");
  });

  it("copies a captured YouTube frame without requiring an open note", async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const videoId = "clipboard1A";
      const screenshotFolder = "YouTube Screenshots E2E";
      const previousInsertSetting = plugin.settings.youtubeCaptureInsertIntoActiveNote;
      const previousScreenshotFolder = plugin.settings.youtubeScreenshotFolder;
      plugin.settings.youtubeCaptureInsertIntoActiveNote = false;
      plugin.settings.youtubeScreenshotFolder = screenshotFolder;
      plugin.settings.youtubeCache[videoId] = {
        embedAllowed: true,
        requestedSourceLanguage: "en",
        segments: [{ start: 12, duration: 5, text: "Clipboard frame fixture." }],
        sourceLanguage: "en",
        title: "Clipboard frame fixture",
        translations: {},
        updatedAt: Date.now(),
        videoId
      };
      await plugin.openYouTubePlayer(videoId);
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === videoId);
      if (view) view.currentTime = 12;
      app.workspace.getLeavesOfType("markdown").forEach((leaf) => leaf.detach());
      plugin.lastMarkdownLeaf = undefined;

      const fs = window.require("fs");
      const BufferCtor = window.require("buffer").Buffer;
      const originalCopyPngToClipboard = plugin.copyPngToClipboard;
      let clipboardPngByteLength = 0;
      let clipboardWriteCount = 0;
      plugin.copyPngToClipboard = (png) => {
        clipboardWriteCount++;
        clipboardPngByteLength = png.length;
      };
      const originalRunTrackedProcess = plugin.runTrackedProcess;
      let processCallCount = 0;
      plugin.runTrackedProcess = async (_command, args) => {
        processCallCount++;
        if (args.includes("-g")) {
          return { code: 0, stderr: "", stdout: "https://video.example/frame-stream\n" };
        }
        const outputPath = String(args.at(-1));
        fs.writeFileSync(
          outputPath,
          BufferCtor.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zz30AAAAASUVORK5CYII=",
            "base64"
          )
        );
        return { code: 0, stderr: "", stdout: "" };
      };

      try {
        await plugin.captureYouTubeFrame(view);
      } finally {
        plugin.runTrackedProcess = originalRunTrackedProcess;
        plugin.copyPngToClipboard = originalCopyPngToClipboard;
      }

      const screenshotFiles = app.vault.getFiles().filter((file) => file.path.startsWith(`${screenshotFolder}/`));
      for (const file of screenshotFiles) await app.vault.delete(file);
      plugin.settings.youtubeCaptureInsertIntoActiveNote = previousInsertSetting;
      plugin.settings.youtubeScreenshotFolder = previousScreenshotFolder;
      return {
        clipboardPngByteLength,
        clipboardWriteCount,
        processCallCount,
        screenshotFileCount: screenshotFiles.length
      };
    });

    expect(result.clipboardWriteCount).toBe(1);
    expect(result.clipboardPngByteLength).toBeGreaterThan(40);
    expect(result.processCallCount).toBe(2);
    expect(result.screenshotFileCount).toBe(0);
  });

  it("captures the displayed YouTube frame without starting external tools", async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const videoId = "fastFrame1A";
      const previousInsertSetting = plugin.settings.youtubeCaptureInsertIntoActiveNote;
      plugin.settings.youtubeCaptureInsertIntoActiveNote = false;
      plugin.settings.youtubeCache[videoId] = {
        embedAllowed: false,
        requestedSourceLanguage: "en",
        segments: [{ start: 12, duration: 5, text: "Fast frame fixture." }],
        sourceLanguage: "en",
        title: "Fast frame fixture",
        translations: {},
        updatedAt: Date.now(),
        videoId
      };
      await plugin.openYouTubePlayer(videoId);
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === videoId);
      if (view) view.currentTime = 12;
      app.workspace.getLeavesOfType("markdown").forEach((leaf) => leaf.detach());
      plugin.lastMarkdownLeaf = undefined;

      const fs = window.require("fs");
      const BufferCtor = window.require("buffer").Buffer;
      const fixturePng = BufferCtor.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zz30AAAAASUVORK5CYII=",
        "base64"
      );
      const originalCaptureDisplayedVideoFrame = view.captureDisplayedVideoFrame;
      view.captureDisplayedVideoFrame = async () => fixturePng;
      const originalCopyPngToClipboard = plugin.copyPngToClipboard;
      let clipboardWriteCount = 0;
      plugin.copyPngToClipboard = () => { clipboardWriteCount++; };
      const originalRunTrackedProcess = plugin.runTrackedProcess;
      let processCallCount = 0;
      plugin.runTrackedProcess = async (_command, args) => {
        processCallCount++;
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        if (args.includes("-g")) {
          return { code: 0, stderr: "", stdout: "https://video.example/frame-stream\n" };
        }
        fs.writeFileSync(String(args.at(-1)), fixturePng);
        return { code: 0, stderr: "", stdout: "" };
      };

      const startedAt = performance.now();
      try {
        await plugin.captureYouTubeFrame(view);
      } finally {
        view.captureDisplayedVideoFrame = originalCaptureDisplayedVideoFrame;
        plugin.runTrackedProcess = originalRunTrackedProcess;
        plugin.copyPngToClipboard = originalCopyPngToClipboard;
        plugin.settings.youtubeCaptureInsertIntoActiveNote = previousInsertSetting;
      }

      return {
        clipboardWriteCount,
        elapsedMs: performance.now() - startedAt,
        processCallCount
      };
    });

    expect(result.clipboardWriteCount).toBe(1);
    expect(result.processCallCount).toBe(0);
    expect(result.elapsedMs).toBeLessThan(250);
  });

  it("uses the detected CC language and configured learning language in the YouTube prompt", async function () {
    const prompt = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      plugin.settings.sourceLanguage = "auto";
      plugin.settings.targetLanguage = "zh-CN";
      const original = plugin.runAIPrompt;
      let captured = "";
      plugin.runAIPrompt = async (value) => {
        captured = value;
        return '["你好"]';
      };
      const segments = [{ start: 0, duration: 2, text: "안녕하세요" }];
      await plugin.translateYouTubeBatch(segments, "ko", { videoId: "languageTst", title: "Language test", segments }, 0);
      plugin.runAIPrompt = original;
      return captured;
    });

    expect(prompt).toContain("from Korean into Simplified Chinese");
  });

  (process.env.YOUTUBE_E2E ? it : it.skip)("opens a real YouTube learning player and extracts sentence-level captions", async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      plugin.settings.sourceLanguage = "en";
      await plugin.saveSettings();
      await plugin.openYouTubePlayer("https://www.youtube.com/watch?v=UF8uR6Z6KLc");
      const leaves = app.workspace.getLeavesOfType("contextual-ai-reader-youtube");
      const view = leaves
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "UF8uR6Z6KLc");
      const data = view?.getVideoData();
      view?.seekTo(42);
      return {
        title: data?.title,
        segmentCount: data?.segments?.length ?? 0,
        firstSegment: data?.segments?.[0]?.text ?? "",
        leafCount: leaves.length,
        tabHeaderText: leaves[0]?.tabHeaderEl?.textContent ?? "",
        tabTitle: leaves[0]?.getDisplayText?.() ?? "",
        viewType: view?.getViewType?.() ?? "missing",
        visibleText: view?.containerEl?.innerText?.slice(0, 500) ?? "",
        currentTime: view?.getCurrentTime() ?? -1
      };
    });

    await browser.pause(3000);
    await mkdir("e2e-artifacts", { recursive: true });
    await browser.saveScreenshot("e2e-artifacts/youtube-learning-player.png");
    const artifacts = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "UF8uR6Z6KLc");
      const data = view?.getVideoData();
      let incrementalTranslation = "";
      let initialTranslationCount = 0;
      let hiddenDisplay = "";
      let restoredDisplay = "";
      let closeStoppedTranslation = false;
      let captureNoteText = "";
      if (view && data) {
        initialTranslationCount = view.containerEl.querySelectorAll(".youtube-reader-translation").length;
        view.applyTranslations(["Incremental translation test"]);
        const translation = view.containerEl.querySelector(".youtube-reader-translation");
        incrementalTranslation = translation?.textContent ?? "";
        const visibilityButton = view.containerEl.querySelector('[aria-label="Hide translated subtitles"]');
        visibilityButton?.click();
        hiddenDisplay = translation ? getComputedStyle(translation).display : "missing";
        visibilityButton?.click();
        restoredDisplay = translation ? getComputedStyle(translation).display : "missing";
        const captureNotePath = "YouTube Capture Target E2E.md";
        const existingCaptureNote = app.vault.getAbstractFileByPath(captureNotePath);
        const captureNote = existingCaptureNote ?? await app.vault.create(captureNotePath, "# Capture target\n");
        const noteLeaf = app.workspace.getLeaf("split", "vertical");
        await noteLeaf.openFile(captureNote, { active: true });
        plugin.lastMarkdownLeaf = noteLeaf;
        plugin.settings.youtubeCaptureInsertIntoActiveNote = true;
        await plugin.captureYouTubeFrame(view);
        captureNoteText = noteLeaf.view.getViewData?.() ?? "";
        await plugin.createYouTubeTranscriptNote(data);
        const originalStop = plugin.stopCurrentTranslation;
        plugin.stopCurrentTranslation = () => { closeStoppedTranslation = true; };
        view.translationRunning = true;
        await view.onClose();
        plugin.stopCurrentTranslation = originalStop;
      }
      const noticeText = Array.from(document.querySelectorAll(".notice"))
        .map((element) => element.textContent ?? "")
        .join(" | ");
      const screenshot = app.vault.getFiles().find((file) => file.extension === "png");
      const transcript = app.vault.getFiles().find((file) => file.path.endsWith("Transcript.md"));
      const transcriptText = transcript ? await app.vault.read(transcript) : "";
      const png = screenshot ? await app.vault.readBinary(screenshot) : new ArrayBuffer(0);
      const viewData = png.byteLength >= 24 ? new DataView(png) : null;
      const bounds = view?.getVideoBounds();
      return {
        screenshotBytes: png.byteLength,
        screenshotWidth: viewData?.getUint32(16) ?? 0,
        screenshotHeight: viewData?.getUint32(20) ?? 0,
        screenshotPath: screenshot && typeof app.vault.adapter.getFullPath === "function"
          ? app.vault.adapter.getFullPath(screenshot.path)
          : "",
        bounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        incrementalTranslation,
        initialTranslationCount,
        hiddenDisplay,
        restoredDisplay,
        closeStoppedTranslation,
        captureNoteHasImageEmbed: captureNoteText.includes("![[") && captureNoteText.includes(".png"),
        noticeText,
        transcriptHasTimestamp: transcriptText.includes("obsidian://contextual-ai-reader-youtube?video=")
      };
    });
    if (artifacts.screenshotPath) {
      await copyFile(artifacts.screenshotPath, "e2e-artifacts/youtube-captured-frame.png");
    }

    if (result.leafCount !== 1 || !result.title) {
      throw new Error(`YouTube view diagnostics: ${JSON.stringify(result)}`);
    }
    expect(result.title).toContain("Steve Jobs");
    expect(result.tabTitle).toContain("Steve Jobs");
    expect(result.tabHeaderText).toContain("Steve Jobs");
    expect(result.segmentCount).toBeGreaterThan(10);
    expect(result.firstSegment.length).toBeGreaterThan(0);
    expect(result.currentTime).toBe(42);
    expect(artifacts.screenshotBytes).toBeGreaterThan(300);
    if (artifacts.screenshotWidth <= 300) {
      throw new Error(`Screenshot diagnostics: ${JSON.stringify(artifacts)}`);
    }
    expect(artifacts.screenshotHeight).toBeGreaterThan(200);
    const screenshotAspectRatio = artifacts.screenshotWidth / artifacts.screenshotHeight;
    if (Math.abs(screenshotAspectRatio - (4 / 3)) >= 0.02) {
      throw new Error(`Captured image does not match the source video's 4:3 frame: ${JSON.stringify(artifacts)}`);
    }
    expect(artifacts.incrementalTranslation).toBe("Incremental translation test");
    expect(artifacts.initialTranslationCount).toBe(0);
    expect(artifacts.hiddenDisplay).toBe("none");
    expect(artifacts.restoredDisplay).not.toBe("none");
    expect(artifacts.closeStoppedTranslation).toBe(true);
    expect(artifacts.captureNoteHasImageEmbed).toBe(true);
    expect(artifacts.transcriptHasTimestamp).toBe(true);
    await expect(browser.$(".youtube-reader-player iframe")).toExist();
    await expect(browser.$(".youtube-reader-segment")).toExist();
  });

  (process.env.YOUTUBE_E2E ? it : it.skip)("opens an owner-blocked embed as a YouTube watch page inside Obsidian", async function () {
    const initial = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      plugin.settings.sourceLanguage = "en";
      await plugin.saveSettings();
      await plugin.openYouTubePlayer("https://www.youtube.com/watch?v=XN8tuO4QIRw");
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "XN8tuO4QIRw");
      return {
        embedAllowed: view?.getVideoData?.()?.embedAllowed,
        iframeCount: view?.containerEl?.querySelectorAll(".youtube-reader-player iframe").length ?? -1,
        statusText: view?.containerEl?.querySelector(".youtube-reader-status")?.textContent ?? "",
        webviewCount: view?.containerEl?.querySelectorAll(".youtube-reader-player webview").length ?? -1
      };
    });

    await browser.pause(3000);
    const loaded = await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "XN8tuO4QIRw");
      const webview = view?.webviewEl;
      return {
        hasVideo: webview ? await webview.executeJavaScript("Boolean(document.querySelector('video'))") : false,
        pageTitle: webview ? await webview.executeJavaScript("document.title") : ""
      };
    });

    expect(initial.embedAllowed).toBe(false);
    expect(initial.webviewCount).toBe(1);
    expect(initial.iframeCount).toBe(0);
    expect(initial.statusText).toContain("owner disabled embedding");
    expect(loaded.hasVideo).toBe(true);
    expect(loaded.pageTitle).toContain("ICT Mentorship 2023 Ep 01");
  });

  (process.env.YOUTUBE_E2E ? it : it.skip)("captures a real watch-page frame directly from the webview", async function () {
    await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      await plugin.openYouTubePlayer("https://www.youtube.com/watch?v=XN8tuO4QIRw");
    });
    await browser.waitUntil(async () => await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "XN8tuO4QIRw");
      try {
        return Boolean(await view?.webviewEl?.executeJavaScript(
          "(() => { const video = document.querySelector('video'); return Boolean(video && video.getBoundingClientRect().width > 300); })()"
        ));
      } catch {
        return false;
      }
    }), { timeout: 15_000, timeoutMsg: "The real YouTube watch-page video did not become capturable." });

    const capture = await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "XN8tuO4QIRw");
      view?.setWindowedFullscreen?.(true);
      await view?.syncWebviewPresentation?.();
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      const startedAt = performance.now();
      let png: Uint8Array | undefined;
      try {
        png = await view?.captureDisplayedVideoFrame?.();
      } finally {
        view?.setWindowedFullscreen?.(false);
      }
      const elapsedMs = performance.now() - startedAt;
      const BufferCtor = window.require("buffer").Buffer;
      const buffer = png ? BufferCtor.from(png) : BufferCtor.alloc(0);
      return {
        base64: buffer.toString("base64"),
        byteLength: buffer.length,
        elapsedMs,
        height: buffer.length >= 24 ? buffer.readUInt32BE(20) : 0,
        width: buffer.length >= 24 ? buffer.readUInt32BE(16) : 0
      };
    });

    await mkdir("e2e-artifacts", { recursive: true });
    await writeFile("e2e-artifacts/youtube-webview-fast-capture.png", Buffer.from(capture.base64, "base64"));
    await writeFile("e2e-artifacts/youtube-webview-fast-capture.json", JSON.stringify({
      byteLength: capture.byteLength,
      elapsedMs: capture.elapsedMs,
      height: capture.height,
      width: capture.width
    }, null, 2));
    expect(capture.byteLength).toBeGreaterThan(10_000);
    expect(capture.width).toBeGreaterThan(300);
    expect(capture.height).toBeGreaterThan(200);
    expect(capture.elapsedMs).toBeLessThan(1_500);
  });

  (process.env.YOUTUBE_E2E ? it : it.skip)("keeps the real watch-page transcript synced and scrolled after seeking", async function () {
    const initial = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const videoId = "7WM8qdkanIY";
      plugin.settings.sourceLanguage = "en";
      delete plugin.settings.youtubeCache[videoId];
      await plugin.saveSettings();
      await plugin.openYouTubePlayer(`https://www.youtube.com/watch?v=${videoId}`);
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === videoId);
      return {
        segmentCount: view?.getVideoData?.()?.segments.length ?? 0,
        webviewCount: view?.containerEl?.querySelectorAll(".youtube-reader-player webview").length ?? 0
      };
    });

    expect(initial.segmentCount).toBeGreaterThan(100);
    expect(initial.webviewCount).toBe(1);

    await browser.waitUntil(async () => await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "7WM8qdkanIY");
      try {
        return Boolean(await view?.webviewEl?.executeJavaScript("Boolean(document.querySelector('video'))"));
      } catch {
        return false;
      }
    }), { timeout: 15_000, timeoutMsg: "The real YouTube watch-page video did not become ready." });

    const clicked = await browser.executeObsidian(({ app }) => {
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "7WM8qdkanIY");
      const transcript = view?.containerEl?.querySelector<HTMLElement>(".youtube-reader-transcript");
      if (transcript) transcript.scrollTop = 0;
      view?.seekTo(270.87);
      return view?.containerEl?.querySelector(".youtube-reader-segment.is-active .youtube-reader-time")?.textContent ?? "";
    });
    expect(clicked).toBe("4:30");

    await browser.executeObsidian(({ app }) => {
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "7WM8qdkanIY");
      const webview = view?.webviewEl;
      if (!view || !webview) return;
      view.testOriginalExecuteJavaScript = webview.executeJavaScript.bind(webview);
      webview.executeJavaScript = async (code: string) => {
        if (code.includes("contextualAiReaderPlayback")) {
          return {
            currentTime: 307.8,
            exitWindowedFullscreen: false,
            videoRect: { bottom: 600, height: 600, left: 0, right: 1024, top: 0, width: 1024 },
            viewportHeight: 800,
            viewportWidth: 1024
          };
        }
        return await view.testOriginalExecuteJavaScript(code);
      };
      view.startWebviewListening();
    });
    await browser.pause(800);

    const synced = await browser.executeObsidian(({ app }) => {
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "7WM8qdkanIY");
      const transcript = view?.containerEl?.querySelector<HTMLElement>(".youtube-reader-transcript");
      const active = view?.containerEl?.querySelector<HTMLElement>(".youtube-reader-segment.is-active");
      const transcriptBounds = transcript?.getBoundingClientRect();
      const activeBounds = active?.getBoundingClientRect();
      const result = {
        activeTime: active?.querySelector(".youtube-reader-time")?.textContent ?? "",
        currentTime: view?.getCurrentTime?.() ?? -1,
        rowIsVisible: Boolean(
          transcriptBounds
          && activeBounds
          && activeBounds.top >= transcriptBounds.top
          && activeBounds.bottom <= transcriptBounds.bottom
        ),
        scrollTop: transcript?.scrollTop ?? 0
      };
      if (view?.webviewEl && view.testOriginalExecuteJavaScript) {
        view.stopWebviewListening();
        view.webviewEl.executeJavaScript = view.testOriginalExecuteJavaScript;
        delete view.testOriginalExecuteJavaScript;
        view.startWebviewListening();
      }
      return result;
    });

    expect(synced.currentTime).toBeGreaterThanOrEqual(307.5);
    expect(synced.activeTime).toBe("5:07");
    expect(synced.scrollTop).toBeGreaterThan(0);
    expect(synced.rowIsVisible).toBe(true);
  });

  (process.env.YOUTUBE_E2E ? it : it.skip)("renders bilingual subtitles in windowed fullscreen on a real watch page", async function () {
    const initial = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      plugin.settings.sourceLanguage = "en";
      delete plugin.settings.youtubeCache["7WM8qdkanIY"];
      await plugin.saveSettings();
      await plugin.openYouTubePlayer("https://www.youtube.com/watch?v=7WM8qdkanIY");
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "7WM8qdkanIY");
      const data = view?.getVideoData?.();
      return {
        segmentCount: data?.segments.length ?? 0,
        webviewCount: view?.playerEl?.querySelectorAll("webview").length ?? 0
      };
    });

    expect(initial.segmentCount).toBeGreaterThan(100);
    expect(initial.webviewCount).toBe(1);

    await browser.waitUntil(async () => await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "7WM8qdkanIY");
      try {
        return Boolean(await view?.webviewEl?.executeJavaScript("Boolean(document.querySelector('video'))"));
      } catch {
        return false;
      }
    }), { timeout: 15_000, timeoutMsg: "The real YouTube watch-page video did not become ready." });

    const prepared = await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "7WM8qdkanIY");
      const data = view?.getVideoData?.();
      const index = data?.segments.findIndex((segment) => Math.abs(segment.start - 270.87) < 0.1) ?? -1;
      const translations = new Array(data?.segments.length ?? 0).fill("");
      if (index >= 0) translations[index] = "核心主题是用与散户完全相反的方式思考市场。";
      view?.applyTranslations(translations);
      await view?.webviewEl?.executeJavaScript(
        "(() => { const video = document.querySelector('video'); if (video) { video.pause(); video.currentTime = 270.87; } })()"
      );
      if (view) {
        view.currentTime = 270.87;
        view.updateActiveSegment(270.87, true);
        const webview = view.webviewEl;
        if (webview) {
          view.testOriginalExecuteJavaScript = webview.executeJavaScript.bind(webview);
          webview.executeJavaScript = async (code: string) => {
            if (code.includes("contextualAiReaderPlayback")) {
              const viewportHeight = webview.clientHeight;
              const viewportWidth = webview.clientWidth;
              return {
                currentTime: 270.87,
                exitWindowedFullscreen: false,
                videoRect: {
                  bottom: viewportHeight,
                  height: viewportHeight,
                  left: 0,
                  right: viewportWidth,
                  top: 0,
                  width: viewportWidth
                },
                viewportHeight,
                viewportWidth
              };
            }
            return await view.testOriginalExecuteJavaScript(code);
          };
          view.startWebviewListening();
        }
      }
      const overlay = view?.playerEl?.querySelector<HTMLElement>(".youtube-reader-video-subtitles");
      const result = {
        english: overlay?.querySelector(".youtube-reader-video-subtitle-original")?.textContent ?? "",
        overlayIndex: overlay?.dataset.index ?? "",
        translation: overlay?.querySelector(".youtube-reader-video-subtitle-translation")?.textContent ?? ""
      };
      return result;
    });

    expect(prepared.english).toContain("constant theme");
    expect(prepared.translation).toContain("核心主题");

    await browser.pause(300);
    const normalOverlay = await browser.executeObsidian(({ app }) => {
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "7WM8qdkanIY");
      const overlay = view?.playerEl?.querySelector<HTMLElement>(".youtube-reader-video-subtitles");
      const bounds = overlay?.getBoundingClientRect();
      const mainBounds = view?.containerEl?.querySelector<HTMLElement>(".youtube-reader-main")?.getBoundingClientRect();
      const transcriptBounds = view?.containerEl
        ?.querySelector<HTMLElement>(".youtube-reader-transcript-pane")
        ?.getBoundingClientRect();
      const result = {
        bounds: bounds ? { height: bounds.height, left: bounds.left, top: bounds.top, width: bounds.width } : null,
        mainBounds: mainBounds ? {
          height: mainBounds.height,
          left: mainBounds.left,
          top: mainBounds.top,
          width: mainBounds.width
        } : null,
        transcriptBounds: transcriptBounds ? {
          height: transcriptBounds.height,
          left: transcriptBounds.left,
          top: transcriptBounds.top,
          width: transcriptBounds.width
        } : null,
        visible: overlay ? getComputedStyle(overlay).display !== "none" : false
      };
      view?.setWindowedFullscreen(true);
      return result;
    });
    expect(normalOverlay.visible).toBe(true);
    expect(normalOverlay.bounds?.height).toBeGreaterThan(100);
    expect(normalOverlay.bounds?.width).toBeGreaterThan(200);

    await browser.waitUntil(async () => await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "7WM8qdkanIY");
      try {
        await view?.syncWebviewPresentation();
        return Boolean(await view?.webviewEl?.executeJavaScript(
          "document.documentElement.hasAttribute('data-contextual-ai-reader-windowed-fullscreen')"
        ));
      } catch {
        return false;
      }
    }), { timeout: 15_000, timeoutMsg: "The real watch page did not enter windowed fullscreen." });

    await browser.pause(100);
    await mkdir("e2e-artifacts", { recursive: true });
    await browser.saveScreenshot("e2e-artifacts/youtube-left-pane-fullscreen-bilingual.png");

    const fullscreen = await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "7WM8qdkanIY");
      const bounds = view?.getVideoBounds?.();
      await view?.syncWebviewPresentation();
      const internal = await view?.webviewEl?.executeJavaScript(`(() => {
        const player = document.querySelector('#movie_player');
        const rect = player?.getBoundingClientRect();
        const style = document.getElementById('contextual-ai-reader-video-presentation');
        const pageChromeSelectors = [
          '#masthead-container',
          '#below',
          '#secondary',
          '#comments',
          'ytd-watch-next-secondary-results-renderer'
        ];
        const visiblePageChrome = pageChromeSelectors.filter((selector) => {
          const element = document.querySelector(selector);
          if (!element) return false;
          const elementStyle = getComputedStyle(element);
          const elementRect = element.getBoundingClientRect();
          return elementStyle.display !== 'none'
            && elementStyle.visibility !== 'hidden'
            && elementRect.width > 0
            && elementRect.height > 0;
        });
        return {
          captionRuleApplied: style?.textContent?.includes('ytp-caption-window-container') ?? false,
          height: rect?.height ?? 0,
          styleText: style?.textContent ?? '',
          visiblePageChrome,
          windowedAttribute: document.documentElement.hasAttribute('data-contextual-ai-reader-windowed-fullscreen'),
          width: rect?.width ?? 0,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth
        };
      })()`);
      const overlay = view?.playerEl?.querySelector<HTMLElement>(".youtube-reader-video-subtitles");
      const original = overlay?.querySelector<HTMLElement>(".youtube-reader-video-subtitle-original");
      const translation = overlay?.querySelector<HTMLElement>(".youtube-reader-video-subtitle-translation");
      const mainBounds = view?.containerEl?.querySelector<HTMLElement>(".youtube-reader-main")?.getBoundingClientRect();
      const transcriptBounds = view?.containerEl
        ?.querySelector<HTMLElement>(".youtube-reader-transcript-pane")
        ?.getBoundingClientRect();
      const result = {
        bounds: bounds ? { height: bounds.height, left: bounds.left, top: bounds.top, width: bounds.width } : null,
        english: original?.textContent ?? "",
        internal,
        mainBounds: mainBounds ? {
          height: mainBounds.height,
          left: mainBounds.left,
          top: mainBounds.top,
          width: mainBounds.width
        } : null,
        originalFontSize: Number.parseFloat(original ? getComputedStyle(original).fontSize : "0"),
        overlayVisible: overlay ? getComputedStyle(overlay).display !== "none" : false,
        transcriptBounds: transcriptBounds ? {
          height: transcriptBounds.height,
          left: transcriptBounds.left,
          top: transcriptBounds.top,
          width: transcriptBounds.width
        } : null,
        translation: translation?.textContent ?? "",
        translationFontSize: Number.parseFloat(translation ? getComputedStyle(translation).fontSize : "0"),
        viewport: { height: window.innerHeight, width: window.innerWidth }
      };
      if (view?.webviewEl && view.testOriginalExecuteJavaScript) {
        view.stopWebviewListening();
        view.webviewEl.executeJavaScript = view.testOriginalExecuteJavaScript;
        delete view.testOriginalExecuteJavaScript;
      }
      view?.setWindowedFullscreen(false);
      view?.startWebviewListening();
      return {
        ...result,
        restoredToView: Boolean(view?.playerEl && view.containerEl.contains(view.playerEl))
      };
    });

    expect(Math.abs((fullscreen.bounds?.left ?? 0) - (fullscreen.mainBounds?.left ?? 0))).toBeLessThanOrEqual(2);
    expect(Math.abs((fullscreen.bounds?.top ?? 0) - (fullscreen.mainBounds?.top ?? 0))).toBeLessThanOrEqual(2);
    expect(Math.abs((fullscreen.bounds?.width ?? 0) - (fullscreen.mainBounds?.width ?? 0))).toBeLessThanOrEqual(2);
    expect(Math.abs((fullscreen.bounds?.height ?? 0) - (fullscreen.mainBounds?.height ?? 0))).toBeLessThanOrEqual(2);
    expect(Math.abs(
      (fullscreen.transcriptBounds?.left ?? 0) - (normalOverlay.transcriptBounds?.left ?? 0)
    )).toBeLessThanOrEqual(2);
    expect(Math.abs(
      (fullscreen.transcriptBounds?.top ?? 0) - (normalOverlay.transcriptBounds?.top ?? 0)
    )).toBeLessThanOrEqual(2);
    expect(Math.abs(
      (fullscreen.transcriptBounds?.width ?? 0) - (normalOverlay.transcriptBounds?.width ?? 0)
    )).toBeLessThanOrEqual(2);
    expect(Math.abs(
      (fullscreen.transcriptBounds?.height ?? 0) - (normalOverlay.transcriptBounds?.height ?? 0)
    )).toBeLessThanOrEqual(2);
    expect(Boolean(
      fullscreen.bounds
      && fullscreen.transcriptBounds
      && (
        fullscreen.bounds.left + fullscreen.bounds.width <= fullscreen.transcriptBounds.left
        || fullscreen.bounds.top + fullscreen.bounds.height <= fullscreen.transcriptBounds.top
      )
    )).toBe(true);
    if (!fullscreen.internal?.captionRuleApplied) {
      throw new Error(`WebView presentation style missing: ${JSON.stringify(fullscreen)}`);
    }
    expect(fullscreen.internal?.width).toBe(fullscreen.internal?.viewportWidth);
    expect(fullscreen.internal?.height).toBe(fullscreen.internal?.viewportHeight);
    expect(fullscreen.internal?.visiblePageChrome).toEqual([]);
    expect(fullscreen.overlayVisible).toBe(true);
    expect(fullscreen.originalFontSize).toBeLessThanOrEqual(16);
    expect(fullscreen.translationFontSize).toBeLessThanOrEqual(15);
    expect(fullscreen.english).toContain("constant theme");
    expect(fullscreen.translation).toContain("核心主题");
    expect(fullscreen.restoredToView).toBe(true);
  });

  (process.env.YOUTUBE_E2E ? it : it.skip)("auto-detects the original Korean CC track instead of English", async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      plugin.settings.sourceLanguage = "auto";
      plugin.settings.targetLanguage = "zh-CN";
      await plugin.saveSettings();
      await plugin.openYouTubePlayer("https://www.youtube.com/watch?v=X3ZFj-37TO8");
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")
        .map((leaf) => leaf.view)
        .find((candidate) => candidate.getVideoData?.()?.videoId === "X3ZFj-37TO8");
      const data = view?.getVideoData?.();
      return {
        sourceLanguage: data?.sourceLanguage ?? "",
        sample: data?.segments?.slice(0, 8).map((segment) => segment.text).join(" ") ?? "",
        translationCount: view?.containerEl?.querySelectorAll(".youtube-reader-translation").length ?? -1
      };
    });

    expect(result.sourceLanguage).toBe("ko");
    expect(result.sample).toMatch(/[가-힣]/);
    expect(result.translationCount).toBe(0);
  });
});
