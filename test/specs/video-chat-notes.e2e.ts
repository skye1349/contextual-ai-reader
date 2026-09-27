import { browser, expect } from "@wdio/globals";

describe("Video chat note saving", function () {
  it("appends only unsaved messages, survives reload and rename, and preserves existing notes", async () => {
    const result = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const previous = { folder: plugin.settings.videoChatNoteFolder, filename: plugin.settings.videoChatNoteFilename, targets: plugin.settings.videoChatNoteTargets };
      try {
        plugin.settings.videoChatNoteFolder = "Chat export tests";
        plugin.settings.videoChatNoteFilename = "Chosen note.md";
        plugin.settings.videoChatNoteTargets = {};
        const data = { title: "Export lesson", videoId: "export-test", segments: [], localPath: "/tmp/lesson.mp4" };
        const q = { id: "test-q", role: "user", text: "UNIQUE_QUESTION", time: 12, createdAt: 1 };
        const a = { id: "test-a", role: "assistant", text: "UNIQUE_ANSWER", time: 12, createdAt: 2 };
        await app.vault.createFolder("Chat export tests");
        const file = await app.vault.create("Chat export tests/Chosen note.md", "# My existing note\nKeep my writing.\n");
        await Promise.all([plugin.exportVideoChatNote(data, [a]), plugin.exportVideoChatNote(data, [a])]);
        const onlyAnswer = await app.vault.read(file);
        await plugin.exportVideoChatNote(data, [q, a]);
        await app.vault.append(file, "\nMy manual addition.\n");
        await plugin.loadSettings();
        await plugin.exportVideoChatNote(data, [q, a]);
        await app.fileManager.renameFile(file, "Chat export tests/Renamed.md");
        const before = await app.vault.read(file);
        await plugin.exportVideoChatNote(data, [q, a, { ...a, id: "test-a2", text: "SECOND_ANSWER" }]);
        const after = await app.vault.read(file);
        const count = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("Chat export tests/")).length;
        plugin.settings.videoChatNoteFilename = "Another destination.md";
        await plugin.exportVideoChatNote(data, [a]);
        const other = app.vault.getAbstractFileByPath("Chat export tests/Another destination.md");
        return { onlyAnswer, after, preserved: after.startsWith(before), count, other: !!other };
      } finally {
        plugin.settings.videoChatNoteFolder = previous.folder;
        plugin.settings.videoChatNoteFilename = previous.filename;
        plugin.settings.videoChatNoteTargets = previous.targets;
        await plugin.saveSettings();
      }
    });
    expect(result.onlyAnswer).toContain("UNIQUE_ANSWER");
    expect(result.onlyAnswer).not.toContain("UNIQUE_QUESTION");
    expect(result.after.split("UNIQUE_ANSWER").length).toBe(2);
    expect(result.after.split("UNIQUE_QUESTION").length).toBe(2);
    expect(result.after).toContain("SECOND_ANSWER");
    expect(result.after).toContain("Keep my writing.");
    expect(result.after).toContain("My manual addition.");
    expect(result.preserved).toBe(true);
    expect(result.count).toBe(1);
    expect(result.other).toBe(true);
  });
});
