import { browser, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ffmpeg = process.env.LOCAL_VIDEO_FFMPEG || (process.platform === "darwin" ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg");

(process.env.LOCAL_VIDEO_E2E ? describe : describe.skip)("Local video learning player", function () {
  let dir: string;
  let videoPath: string;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "reader-local-video-"));
    videoPath = join(dir, "本地 lesson #1.mp4");
    const captions = join(dir, "embedded.srt");
    await writeFile(captions, "1\n00:00:00,000 --> 00:00:02,000\nHello from the embedded captions.\n\n2\n00:00:02,000 --> 00:00:05,000\nA second sentence for notes.\n");
    await writeFile(join(dir, "本地 lesson #1.zh.vtt"), "WEBVTT\n\n00:00.000 --> 00:02.000\n外挂中文字幕。\n");
    execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=6", "-i", captions,
      "-map", "0:v", "-map", "1:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng", "-disposition:s:0", "default", "-y", videoPath]);
  });
  after(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("plays a real local file, extracts CC, translates, captures and exports linked notes", async () => {
    const loaded = await browser.executeObsidian(async ({ app }, path, command) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      plugin.settings.sharedMemoryEnabled = false;
      plugin.configureSharedMemory();
      plugin.settings.youtubeFfmpegCommand = command;
      plugin.settings.sourceLanguage = "en";
      await plugin.openLocalVideoPlayer(path);
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")[0].view;
      const data = view.getVideoData();
      return { count: data?.segments.length, text: data?.segments[0]?.text, tracks: data?.localTracks.length, warning: data?.subtitleWarning, src: view.containerEl.querySelector("video")?.src };
    }, videoPath, ffmpeg);
    expect(loaded.count).toBe(2);
    expect(loaded.text).toContain("embedded captions");
    expect(loaded.tracks).toBe(2);
    await browser.waitUntil(async () => browser.execute(() => {
      const video = document.querySelector(".youtube-reader-player video") as HTMLVideoElement;
      return video?.readyState >= 2;
    }), { timeout: 15000, timeoutMsg: JSON.stringify(loaded) });
    const results = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")[0].view;
      const video = view.containerEl.querySelector("video");
      view.seekTo(2.5);
      video.pause();
      const original = plugin.runAIPrompt;
      let calls = 0;
      plugin.runAIPrompt = async () => { calls++; return JSON.stringify(["内嵌字幕你好。", "第二句用于做笔记。"]); };
      try { await view.translateTranscript(); } finally { plugin.runAIPrompt = original; }
      const data = view.getVideoData();
      const target = await app.vault.create("Local screenshot target.md", "# Screenshots\n");
      const leaf = app.workspace.getLeaf("split", "vertical");
      await leaf.openFile(target, { active: true });
      plugin.lastMarkdownLeaf = leaf;
      plugin.settings.youtubeCaptureInsertIntoActiveNote = true;
      await plugin.captureYouTubeFrame(view);
      const screenshotNote = leaf.view.getViewData();
      await plugin.createYouTubeTranscriptNote(data);
      const note = app.vault.getFiles().find((file) => file.path.endsWith("Transcript.md"));
      const noteText = await app.vault.read(note);
      const pngFile = app.vault.getFiles().find((file) => file.extension === "png");
      const png = pngFile ? new DataView(await app.vault.readBinary(pngFile)) : null;
      const link = noteText.match(/obsidian:\/\/contextual-ai-reader-local-video\?[^)]+&t=2/)[0];
      const uri = new URL(link);
      await plugin.openLocalVideoPlayer(uri.searchParams.get("path"), Number(uri.searchParams.get("t")));
      video.pause();
      view.setWindowedFullscreen(true);
      const fullscreen = view.containerEl.classList.contains("is-windowed-fullscreen");
      view.setWindowedFullscreen(false);
      return {
        calls, translation: data.segments[0].translation, screenshotNote, noteText,
        dimensions: png ? [png.getUint32(16), png.getUint32(20)] : [],
        time: view.getCurrentTime(), leafCount: app.workspace.getLeavesOfType("contextual-ai-reader-youtube").length, fullscreen
      };
    });
    expect(results.calls).toBe(1);
    expect(results.translation).toBe("内嵌字幕你好。");
    expect(results.screenshotNote).toContain("![[");
    expect(results.screenshotNote).toContain("contextual-ai-reader-local-video");
    expect(results.noteText).toContain("type: local-video-transcript");
    expect(results.noteText).toContain("第二句用于做笔记。");
    expect(results.dimensions).toEqual([640, 360]);
    expect(results.time).toBe(2);
    expect(results.leafCount).toBe(1);
    expect(results.fullscreen).toBe(true);
    await mkdir("e2e-artifacts", { recursive: true });
    await browser.saveScreenshot("e2e-artifacts/local-video-learning-player.png");
  });

  it("switches sidecar tracks and reuses translations when switching back", async () => {
    const result = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")[0].view;
      const data = view.getVideoData();
      const sidecar = data.localTracks.find((track) => track.path);
      await view.loadLocalVideo(data.localPath, 0, sidecar.id);
      const text = view.getVideoData().segments[0].text;
      await view.loadLocalVideo(data.localPath, 0, data.localTrackId);
      return { text, translation: view.getVideoData().segments[0].translation };
    });
    expect(result.text).toBe("外挂中文字幕。");
    expect(result.translation).toBe("内嵌字幕你好。");
  });
  it("video chat sends actual frames and conversation history, exports notes, and isolates videos", async () => {
    await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")[0].view;
      plugin.__originalChatPrompt = plugin.runVideoChatPrompt;
      plugin.__chatRequests = [];
      plugin.runVideoChatPrompt = async (prompt, frames) => {
        plugin.__chatRequests.push({ prompt, frameCount: frames.length, validPng: frames.every((f) => f.png[0] === 137 && f.png[1] === 80) });
        return "## Main idea\nThe lesson has two sentences. See [00:00:02].\n\nAsk me a follow-up question.";
      };
      await app.workspace.revealLeaf(view.leaf);
      view.containerEl.querySelector('[aria-label="AI help me understand this video"]').click();
    });
    await browser.waitUntil(async () => browser.execute(() => (document.querySelector(".youtube-reader-player video") as HTMLVideoElement)?.readyState >= 2));
    await browser.$('[aria-label="Ask about this video"]').setValue("What is happening in this frame?");
    await browser.$('.video-chat-actions [aria-label="Send"]').click();
    await browser.waitUntil(async () => (await browser.$$(".video-chat-message.is-assistant")).length === 1);
    await browser.$('[aria-label="Ask about this video"]').setValue("Can you explain that more simply?");
    await browser.$('.video-chat-actions [aria-label="Send"]').click();
    await browser.waitUntil(async () => (await browser.$$(".video-chat-message.is-assistant")).length === 2);
    const result = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")[0].view;
      const data = view.getVideoData();
      const record = plugin.settings.videoChats['local:' + data.localPath];
      await plugin.exportVideoChatNote(data, record.messages);
      const note = app.vault.getFiles().find((file) => file.path.endsWith("AI Chat.md"));
      return { requests: plugin.__chatRequests, messageCount: record.messages.length, note: await app.vault.read(note) };
    });
    expect(result.requests[0].validPng).toBe(true);
    expect(result.requests[0].frameCount).toBe(1);
    expect(result.requests[0].prompt).toContain("Hello from the embedded captions.");
    expect(result.requests[1].prompt).toContain("What is happening in this frame?");
    expect(result.requests[1].prompt).toContain("The lesson has two sentences.");
    expect(result.messageCount).toBe(4);
    expect(result.note).toContain("contextual-ai-reader-local-video");
    expect(result.note).toContain("Can you explain that more simply?");
    await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      await plugin.loadSettings();
      const oldView = app.workspace.getLeavesOfType("contextual-ai-reader-youtube")[0].view;
      const path = oldView.getVideoData().localPath;
      await oldView.loadLocalVideo(path);
    });
    expect((await browser.$$(".video-chat-message.is-assistant")).length).toBe(2);
    await mkdir("e2e-artifacts", { recursive: true });
    await browser.saveScreenshot("e2e-artifacts/local-video-ai-chat.png");
    const isolation = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const videoId = "chatVideo01";
      plugin.settings.youtubeCache[videoId] = { embedAllowed: true, requestedSourceLanguage: "en", sourceLanguage: "en", title: "YouTube chat fixture", videoId,
        segments: [{ start: 10, duration: 5, text: "A different video about the ocean." }], translations: {}, updatedAt: Date.now() };
      await plugin.openYouTubePlayer(videoId);
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube").map((leaf) => leaf.view).find((v) => v.getVideoData()?.videoId === videoId);
      view.containerEl.querySelector('[aria-label="AI help me understand this video"]').click();
      view.containerEl.querySelector('[aria-label="Video chat evidence"]').value = "none";
      view.containerEl.querySelector('textarea').value = "Summarize this video";
      await view.chatPanel.send(true);
      const latest = plugin.__chatRequests[plugin.__chatRequests.length - 1];
      return { prompt: latest.prompt, frames: latest.frameCount, oldMessages: view.containerEl.querySelectorAll(".video-chat-message").length };
    });
    expect(isolation.prompt).toContain("ocean");
    expect(isolation.prompt).not.toContain("embedded captions");
    expect(isolation.prompt).not.toContain("Can you explain that more simply");
    expect(isolation.frames).toBe(0);
    expect(isolation.oldMessages).toBe(2);
    await browser.executeObsidian(({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      plugin.runVideoChatPrompt = plugin.__originalChatPrompt;
    });
  });

  it("video chat samples the local timeline and cancels only its own pending response", async () => {
    const result = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins["contextual-ai-reader"];
      const view = app.workspace.getLeavesOfType("contextual-ai-reader-youtube").map((leaf) => leaf.view).find((v) => v.getVideoData()?.localPath);
      await app.workspace.revealLeaf(view.leaf);
      const original = plugin.runVideoChatPrompt;
      const requests = [];
      let aborted = false;
      plugin.runVideoChatPrompt = async (prompt, frames, signal) => {
        requests.push({ count: frames.length, times: frames.map((f) => f.seconds) });
        if (prompt.endsWith(JSON.stringify('WAIT_FOR_CANCELLATION'))) return new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('Stopped')); }, { once: true }));
        return "Summary [00:00:02].";
      };
      try {
        const panel = view.chatPanel;
        const input = view.containerEl.querySelector('textarea');
        const evidence = view.containerEl.querySelector('[aria-label="Video chat evidence"]');
        evidence.value = 'overview'; input.value = 'Summarize this video';
        const before = view.getCurrentTime();
        await panel.send(true);
        const after = view.getCurrentTime();
        evidence.value = 'none'; input.value = 'WAIT_FOR_CANCELLATION';
        const pending = panel.send(false);
        for (let i = 0; i < 50 && requests.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
        view.containerEl.querySelector('.video-chat-actions [aria-label="Stop"]').click();
        await pending;
        input.value = 'Try another question'; await panel.send(false);
        return { requests, aborted, unchanged: Math.abs(before - after) < 0.1, text: view.containerEl.querySelector('.video-chat-status').textContent, count: view.containerEl.querySelectorAll('.video-chat-message.is-assistant').length };
      } finally { plugin.runVideoChatPrompt = original; }
    });
    expect(result.requests[0].count).toBe(6);
    expect(result.requests[0].times.every((time) => time >= 0 && time < 6)).toBe(true);
    expect(result.aborted).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(result.text).toContain("No frames attached");
    expect(result.count).toBe(4);
  });

});
