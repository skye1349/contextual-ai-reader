import { randomUUID } from "crypto";
import { App, Component, MarkdownRenderer, Notice, setIcon } from "obsidian";
import type { YouTubeVideoData } from "./youtube";
import { chatTimestamp, VideoChatAnswer, VideoChatMessage, VideoChatRequest, VideoChatVisualMode } from "./video-chat";

export interface VideoChatHost {
  backendLabel: () => string;
  getMessages: (data: YouTubeVideoData) => VideoChatMessage[];
  saveMessages: (data: YouTubeVideoData, messages: VideoChatMessage[]) => Promise<void>;
  ask: (request: VideoChatRequest, signal: AbortSignal, progress: (text: string) => void) => Promise<VideoChatAnswer>;
  exportNote: (data: YouTubeVideoData, messages: VideoChatMessage[]) => Promise<void>;
}

export class VideoChatPanel extends Component {
  private messages: VideoChatMessage[];
  private controller?: AbortController;
  private serial = 0;
  private disposed = false;
  private input!: HTMLTextAreaElement;
  private log!: HTMLElement;
  private status!: HTMLElement;
  private sendButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;
  private visualSelect!: HTMLSelectElement;
  private quickButtons: HTMLButtonElement[] = [];
  private readonly renders = new Component();
  private draft = "";

  constructor(
    private readonly app: App,
    private readonly element: HTMLElement,
    private readonly data: YouTubeVideoData,
    private readonly host: VideoChatHost,
    private readonly getTime: () => number,
    private readonly seek: (seconds: number) => void
  ) {
    super();
    this.messages = host.getMessages(data).map((m) => ({ ...m }));
    this.addChild(this.renders);
    this.load();
    this.render();
  }

  onunload() { this.disposed = true; this.stop(); }

  focus() { this.input.focus(); }

  private render() {
    this.element.addClass("video-chat-panel");
    const info = this.element.createDiv({ cls: "video-chat-info" });
    info.createEl("strong", { text: "Understand this video" });
    info.createDiv({ text: `${this.host.backendLabel()} · ${this.data.segments.length ? `${this.data.segments.length} subtitle cues` : "No subtitles yet"}` });
    info.createEl("p", { text: "Ask about the video, or add frames to explain what is on screen. Sending shares the selected evidence with your configured AI provider." });
    const quick = this.element.createDiv({ cls: "video-chat-quick-actions" });
    this.quickButtons.push(this.button(quick, "Summarize video", () => {
      this.input.value = "Summarize this video in my learning language. Explain the main ideas and give a timestamped outline.";
      void this.send(true);
    }));
    this.quickButtons.push(this.button(quick, "Explain this moment", () => {
      this.input.value = "Explain what is happening at the current playback position in my learning language, using the nearby subtitles and attached frame if available.";
      this.visualSelect.value = "current";
      void this.send(false);
    }));
    this.log = this.element.createDiv({ cls: "video-chat-messages", attr: { role: "log", "aria-label": "Video chat messages", "aria-live": "polite" } });
    this.renderMessages();
    this.status = this.element.createDiv({ cls: "video-chat-status", attr: { role: "status" } });
    this.status.setText("Ready. Chat history is saved locally for this video.");
    const composer = this.element.createDiv({ cls: "video-chat-composer" });
    const options = composer.createDiv({ cls: "video-chat-options" });
    options.createSpan({ text: "Video evidence" });
    this.visualSelect = options.createEl("select", { attr: { "aria-label": "Video chat evidence" } });
    this.visualSelect.createEl("option", { value: "current", text: "Subtitles + current frame" });
    this.visualSelect.createEl("option", { value: "overview", text: "Subtitles + 6 sampled frames" });
    this.visualSelect.createEl("option", { value: "none", text: "Subtitles only" });
    this.input = composer.createEl("textarea", { attr: { "aria-label": "Ask about this video", placeholder: "Ask a question about this video…", rows: "3", maxlength: "12000" } });
    this.input.value = this.draft;
    this.input.addEventListener("input", () => { this.draft = this.input.value; });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault(); void this.send(false);
      }
    });
    const actions = composer.createDiv({ cls: "video-chat-actions" });
    this.sendButton = this.button(actions, "Send", () => { void this.send(false); });
    this.sendButton.addClass("mod-cta");
    this.stopButton = this.button(actions, "Stop", () => this.stop());
    this.stopButton.disabled = true;
    const exportButton = this.button(actions, "Save chat to note", () => { void this.host.exportNote(this.data, this.messages).catch((error: unknown) => new Notice(String(error))); });
    exportButton.setAttribute("title", "Save all chat messages; later saves append only new messages to the same note");
    this.button(actions, "Clear chat", () => {
      this.stop(); this.messages = []; this.renderMessages(); void this.persist();
      this.status.setText("Chat cleared for this video.");
    });
    composer.createDiv({ cls: "video-chat-hint", text: "Enter to send · Shift+Enter for a new line · Frame sampling does not watch every moment" });
  }

  private button(parent: HTMLElement, text: string, action: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { text, attr: { "aria-label": text } });
    button.addEventListener("click", action); return button;
  }

  private renderMessages() {
    this.renders.unload(); this.renders.load();
    this.log.empty();
    if (!this.messages.length) {
      const empty = this.log.createDiv({ cls: "video-chat-empty" });
      setIcon(empty.createDiv(), "messages-square");
      empty.createEl("p", { text: "Ask for a summary, a simpler explanation, or details about a specific moment." });
      return;
    }
    for (const message of this.messages) {
      const row = this.log.createDiv({ cls: `video-chat-message is-${message.role}` });
      const label = row.createDiv({ cls: "video-chat-message-label" });
      label.createEl("strong", { text: message.role === "user" ? "You" : "AI" });
      this.button(label, chatTimestamp(message.time), () => this.seek(message.time));
      if (message.role === "assistant") {
        const save = this.button(label, "Save answer", () => {
          save.disabled = true;
          void this.host.exportNote(this.data, [{ ...message }])
            .catch((error: unknown) => new Notice(String(error)))
            .finally(() => { save.disabled = false; });
        });
        save.setAttribute("title", "Append only this AI answer to your configured chat note");
      }
      const body = row.createDiv({ cls: "video-chat-message-body" });
      if (message.role === "user") { body.setText(message.text); body.addClass("is-plain-text"); }
      else {
        // Keep AI replies readable without loading images/HTML embedded in generated output.
        const markdown = message.text.replace(/</g, "&lt;").replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/!\[\[/g, "[[")
          .replace(/\[(\d{1,3}:\d{2}(?::\d{2})?)\](?!\()/g, (_match, stamp: string) => `[${stamp}](#video-chat-time-${stamp.split(":").reduce((t, part) => t * 60 + Number(part), 0)})`);
        void MarkdownRenderer.render(this.app, markdown, body, "", this.renders).catch(() => body.setText(message.text));
        body.addEventListener("click", (event) => {
          const target = event.target as HTMLElement;
          const href = target.closest("a")?.getAttribute("href");
          const match = href?.match(/^#video-chat-time-(\d+)$/);
          if (match) { event.preventDefault(); event.stopPropagation(); this.seek(Number(match[1])); }
        });
      }
      if (message.context) row.createDiv({ cls: "video-chat-message-context", text: message.context });
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  private async persist() {
    try { await this.host.saveMessages(this.data, this.messages.map((m) => ({ ...m }))); }
    catch (error) { if (!this.disposed) this.status.setText(`Could not save chat history: ${String(error)}`); }
  }

  private setBusy(busy: boolean) {
    this.sendButton.disabled = busy; this.stopButton.disabled = !busy;
    this.visualSelect.disabled = busy;
    this.quickButtons.forEach((button) => { button.disabled = busy; });
    this.element.toggleClass("is-busy", busy);
  }

  private stop() {
    const running = Boolean(this.controller);
    this.serial++;
    this.controller?.abort(); this.controller = undefined;
    if (this.sendButton) this.setBusy(false);
    if (running && this.status && !this.disposed) this.status.setText("Stopped. You can send another question.");
  }

  async send(summarize = false) {
    const question = this.input.value.trim();
    if (!question || this.controller || this.disposed) return;
    const serial = ++this.serial;
    const controller = new AbortController(); this.controller = controller;
    const history = this.messages.map((m) => ({ ...m }));
    const time = this.getTime();
    const visualMode = this.visualSelect.value as VideoChatVisualMode;
    this.messages.push({ id: randomUUID(), role: "user", text: question, time, createdAt: Date.now() });
    this.messages = this.messages.slice(-200);
    this.input.value = ""; this.draft = ""; this.renderMessages();
    this.setBusy(true); this.status.setText("Preparing video context…");
    await this.persist();
    try {
      if (controller.signal.aborted) return;
      const answer = await this.host.ask({ question, history, time, visualMode, summarize }, controller.signal, (text) => {
        if (serial === this.serial && !this.disposed) this.status.setText(text);
      });
      if (serial !== this.serial || controller.signal.aborted || this.disposed) return;
      this.messages.push({ id: randomUUID(), role: "assistant", text: answer.text, time, createdAt: Date.now(), context: answer.context });
      this.messages = this.messages.slice(-200);
      this.renderMessages(); await this.persist();
      this.status.setText(answer.context);
    } catch (error) {
      if (serial !== this.serial || this.disposed) return;
      this.status.setText(error instanceof Error ? error.message : String(error));
      this.input.value = question; this.draft = question;
    } finally {
      if (serial === this.serial && !this.disposed) { this.controller = undefined; this.setBusy(false); }
    }
  }
}
