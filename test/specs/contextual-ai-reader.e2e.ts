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
});
