import { browser, expect } from "@wdio/globals";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";

// Exercise real Obsidian requestUrl HTTP requests; no CLI stubs and no paid credentials.
describe("API feature parity", function () {
  let server: Server;
  let base: string;
  const requests: Array<{ path: string; body: any; auth?: string; key?: string }> = [];
  before(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        if (req.url!.endsWith("/audio/transcriptions")) {
          requests.push({ path: req.url!, body: { raw }, auth: req.headers.authorization });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ language: "english", segments: [{ start: 0, end: 2, text: "Timestamped audio." }] }));
          return;
        }
        const body = JSON.parse(raw);
        requests.push({ path: req.url!, body, auth: req.headers.authorization, key: req.headers["x-api-key"] as string });
        const prompt = JSON.stringify(body.messages);
        const text = prompt.includes("§§§BLOCK§§§") ? "译文一\n§§§BLOCK§§§\n译文二" : prompt.includes("valid JSON array") ? '["译文一","译文二"]' : "API answer [00:00:01]";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(req.url!.endsWith("/messages")
          ? { content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } }
          : { choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

  for (const backend of ["openai", "anthropic"] as const) {
    it(`${backend} supports translation, vocabulary, document batches, subtitles, image chat and connection tests without a CLI`, async () => {
      requests.length = 0;
      const result = await browser.executeObsidian(async ({ app }, backend, base) => {
        const p = app.plugins.plugins["contextual-ai-reader"];
        p.settings.aiBackend = backend;
        p.settings.openaiApiKey = "test-openai";
        p.settings.anthropicApiKey = "test-anthropic";
        p.settings.openaiBaseUrl = base;
        p.settings.anthropicBaseUrl = base;
        p.settings.openaiModel = "test-vision-model";
        p.settings.anthropicModel = "test-vision-model";
        p.settings.codexCommand = "/not-installed/codex";
        p.settings.claudeCommand = "/not-installed/claude";
        p.settings.sharedMemoryEnabled = false;
        p.configureSharedMemory();
        p.startOperation();
        const selection = await p.runAITranslation("A selected sentence.", undefined, true);
        await p.enhanceVocabularyWithAI("She sat by the river bank.", "bank", { paragraph: "She sat by the river bank.", filePath: "Welcome.md" }, new DOMRect(0, 0, 10, 10), p.requestSerial, "api-test-bank", "bank");
        const vocabulary = p.settings.vocabularyCache["api-test-bank"].contextExplanation;
        p.hidePopup();
        const blocks = await p.translateRawBlockBatch(["First paragraph.", "Second paragraph."]);
        const subtitles = await p.translateRawYouTubeBatch([{ start: 0, duration: 2, text: "First cue." }, { start: 2, duration: 2, text: "Second cue." }], "en");
        const first = await p.runVideoChatPrompt("Summarize these captions: First cue. Second cue.", [], new AbortController().signal);
        const second = await p.runVideoChatPrompt(`Previous answer: ${first}\nExplain the attached frame.`, [{ seconds: 1, png: new Uint8Array([137,80,78,71]) }], new AbortController().signal);
        const textCheck = await p.testApiConnection(false);
        const imageCheck = await p.testApiConnection(true);
        return { selection, vocabulary, blocks, subtitles, first, second, textCheck, imageCheck, usage: p.getCurrentTokenUsage() };
      }, backend, base);
      expect(result.selection).toContain("API answer");
      expect(result.vocabulary).toContain("API answer");
      expect(result.blocks).toEqual(["译文一", "译文二"]);
      expect(result.subtitles).toEqual(["译文一", "译文二"]);
      expect(result.second).toContain("API answer");
      expect(result.textCheck).toContain("succeeded");
      expect(result.imageCheck).toContain("accepted");
      expect(requests.length).toBe(8);
      expect(requests.every((r) => r.path === (backend === "openai" ? "/v1/chat/completions" : "/v1/messages"))).toBe(true);
      expect(requests.every((r) => backend === "openai" ? r.auth === "Bearer test-openai" : r.key === "test-anthropic")).toBe(true);
      const image = requests[5].body.messages[0].content;
      expect(JSON.stringify(image)).toContain(backend === "openai" ? "image_url" : "base64");
      expect(JSON.stringify(requests[5].body)).toContain(result.first);
      expect(requests.every((r) => r.body.temperature === undefined)).toBe(true);
    });
  }

  it("auto selects API keys and transcription credentials never cross providers", async () => {
    const state = await browser.executeObsidian(({ app }) => {
      const p = app.plugins.plugins["contextual-ai-reader"];
      p.settings.aiBackend = "auto";
      p.settings.openaiApiKey = "openai-only";
      p.settings.anthropicApiKey = "claude-only";
      const first = p.getEffectiveBackend();
      p.settings.openaiApiKey = "";
      const second = p.getEffectiveBackend();
      p.settings.openaiApiKey = "gemini-only";
      p.settings.openaiBaseUrl = "https://generativelanguage.googleapis.com/v1beta/openai";
      p.settings.transcriptionBaseUrl = "https://api.openai.com/v1";
      p.settings.transcriptionApiKey = "";
      const noLeak = p.getTranscriptionApiKey();
      p.settings.transcriptionApiKey = "audio-only";
      return { first, second, noLeak, explicit: p.getTranscriptionApiKey() };
    });
    expect(state).toEqual({ first: "openai", second: "anthropic", noLeak: "", explicit: "audio-only" });
  });
  it("Claude chat can use a separate timestamped transcription API without leaking its chat key", async () => {
    requests.length = 0;
    const response = await browser.executeObsidian(async ({ app }, base) => {
      const p = app.plugins.plugins["contextual-ai-reader"];
      p.settings.aiBackend = "anthropic";
      p.settings.transcriptionApiKey = "dedicated-audio-key";
      p.settings.transcriptionBaseUrl = base;
      p.settings.transcriptionModel = "test-audio-model";
      return p.requestYouTubeTranscription(window.require("buffer").Buffer.from("synthetic audio bytes"), "openai");
    }, base);
    expect(response.segments[0].text).toBe("Timestamped audio.");
    expect(requests[0].path).toBe("/v1/audio/transcriptions");
    expect(requests[0].auth).toBe("Bearer dedicated-audio-key");
    expect(requests[0].body.raw).toContain("test-audio-model");
    expect(requests[0].body.raw).toContain("verbose_json");
    expect(requests[0].body.raw).not.toContain("claude-only");
  });

  it("renaming preserves the plugin ID, saved output paths and video history", async () => {
    const result = await browser.executeObsidian(async ({ app }) => {
      const p = app.plugins.plugins["contextual-ai-reader"];
      p.settings.excerptFilePath = "Contextual AI Reader Excerpts.md";
      p.settings.youtubeTranscriptFolder = "Contextual AI Reader/YouTube Transcripts";
      p.settings.videoChats = { "youtube:legacy": { title: "Previous video", updatedAt: 1,
        messages: [{ role: "user", text: "Keep this conversation", time: 3, createdAt: 1 }] } };
      await p.saveSettings(); await p.loadSettings();
      return { id: p.manifest.id, name: p.manifest.name, path: p.settings.excerptFilePath,
        folder: p.settings.youtubeTranscriptFolder, message: p.settings.videoChats["youtube:legacy"].messages[0].text };
    });
    expect(result).toEqual({ id: "contextual-ai-reader", name: "Read and Watch with AI", path: "Contextual AI Reader Excerpts.md",
      folder: "Contextual AI Reader/YouTube Transcripts", message: "Keep this conversation" });
  });

});
