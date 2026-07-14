import { browser, expect } from "@wdio/globals";
import { copyFile, mkdir } from "fs/promises";

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

    await browser.executeObsidian(({ app }) => {
      app.setting.open();
      app.setting.openTabById("contextual-ai-reader");
    });

    await expect(browser.$("div=Source language")).toExist();
    await expect(browser.$("div=Learning / target language")).toExist();

    await mkdir("e2e-artifacts", { recursive: true });
    await browser.saveScreenshot("e2e-artifacts/contextual-ai-reader-settings.png");
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

  (process.env.YOUTUBE_E2E ? it : it.skip)("opens a real YouTube learning player and extracts sentence-level captions", async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      plugin.settings.youtubeAutoTranslate = false;
      plugin.settings.sourceLanguage = "en";
      await plugin.saveSettings();
      await plugin.openYouTubePlayer("https://www.youtube.com/watch?v=UF8uR6Z6KLc");
      const leaves = app.workspace.getLeavesOfType("contextual-ai-reader-youtube");
      const view = leaves[0]?.view;
      const data = view?.getVideoData();
      view?.seekTo(42);
      return {
        title: data?.title,
        segmentCount: data?.segments?.length ?? 0,
        firstSegment: data?.segments?.[0]?.text ?? "",
        leafCount: leaves.length,
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
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")[0]?.view;
      const data = view?.getVideoData();
      if (view && data) {
        await plugin.captureYouTubeFrame(view);
        await plugin.createYouTubeTranscriptNote(data);
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
    expect(result.segmentCount).toBeGreaterThan(10);
    expect(result.firstSegment.length).toBeGreaterThan(0);
    expect(result.currentTime).toBe(42);
    expect(artifacts.screenshotBytes).toBeGreaterThan(300);
    if (artifacts.screenshotWidth <= 300) {
      throw new Error(`Screenshot diagnostics: ${JSON.stringify(artifacts)}`);
    }
    expect(artifacts.screenshotHeight).toBeGreaterThan(200);
    expect(artifacts.transcriptHasTimestamp).toBe(true);
    await expect(browser.$(".youtube-reader-player iframe")).toExist();
    await expect(browser.$(".youtube-reader-segment")).toExist();
  });
});
