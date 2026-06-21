import { browser, expect } from "@wdio/globals";
import { mkdir } from "fs/promises";

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
});
