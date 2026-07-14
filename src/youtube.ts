import {
  App,
  ItemView,
  Modal,
  Notice,
  Setting,
  WorkspaceLeaf,
  normalizePath,
  requestUrl,
  setIcon
} from "obsidian";

export const YOUTUBE_VIEW_TYPE = "contextual-ai-reader-youtube";

export interface YouTubeSegment {
  duration: number;
  start: number;
  text: string;
  translation?: string;
}

export interface YouTubeVideoData {
  segments: YouTubeSegment[];
  sourceLanguage?: string;
  title: string;
  videoId: string;
}

export interface YouTubeViewHost {
  captureVideoFrame: (view: YouTubeLearningView) => Promise<void>;
  createTranscriptNote: (data: YouTubeVideoData) => Promise<void>;
  fetchTranscriptFallback: (videoId: string, preferredLanguage: string) => Promise<YouTubeVideoData>;
  getCachedVideo: (videoId: string) => Promise<YouTubeVideoData | undefined>;
  saveVideo: (data: YouTubeVideoData) => Promise<void>;
  sourceLanguage: () => string;
  stopTranslation: () => void;
  translateSegments: (
    data: YouTubeVideoData,
    onProgress: (completed: number, total: number, translations: readonly string[]) => void
  ) => Promise<string[]>;
}

interface CaptionTrack {
  baseUrl?: string;
  kind?: string;
  languageCode?: string;
  name?: { simpleText?: string };
  vssId?: string;
}

interface AudioTrack {
  audioTrackId?: string;
}

interface CaptionTrackList {
  audioTracks?: AudioTrack[];
  captionTracks?: CaptionTrack[];
  defaultAudioTrackIndex?: number;
}

interface PlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: CaptionTrackList;
  };
  videoDetails?: {
    title?: string;
  };
}

interface Json3CaptionEvent {
  aAppend?: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string }>;
  tStartMs?: number;
}

interface Json3Captions {
  events?: Json3CaptionEvent[];
}

interface YouTubeMessage {
  event?: string;
  info?: number | {
    currentTime?: number;
    duration?: number;
    playerState?: number;
  };
}

export class YouTubeUrlModal extends Modal {
  private url = "";

  constructor(app: App, private readonly onSubmit: (url: string) => void) {
    super(app);
  }

  onOpen() {
    this.setTitle("Open YouTube learning player");

    new Setting(this.contentEl)
      .setName("YouTube link")
      .setDesc("Paste a youtube.com or youtu.be video link.")
      .addText((text) => {
        text
          .setPlaceholder("https://www.youtube.com/watch?v=...")
          .onChange((value) => { this.url = value.trim(); });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.submit();
          }
        });
        window.setTimeout(() => text.inputEl.focus(), 0);
      });

    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Open").setCta().onClick(() => this.submit()));
  }

  private submit() {
    if (!parseYouTubeVideoId(this.url)) {
      new Notice("Enter a valid YouTube video link.");
      return;
    }

    this.close();
    this.onSubmit(this.url);
  }
}

export class YouTubeLearningView extends ItemView {
  private activeIndex = -1;
  private currentTime = 0;
  private data?: YouTubeVideoData;
  private iframeEl?: HTMLIFrameElement;
  private playerEl?: HTMLElement;
  private requestedStart = 0;
  private segmentEls: HTMLElement[] = [];
  private statusEl?: HTMLElement;
  private transcriptEl?: HTMLElement;
  private translationRunning = false;
  private translationSerial = 0;
  private translationsVisible = true;
  private videoId = "";

  constructor(leaf: WorkspaceLeaf, private readonly host: YouTubeViewHost) {
    super(leaf);
  }

  getViewType() {
    return YOUTUBE_VIEW_TYPE;
  }

  getDisplayText() {
    return this.data?.title || "YouTube learning player";
  }

  getIcon() {
    return "youtube";
  }

  async onOpen() {
    this.containerEl.addClass("contextual-ai-reader-youtube-view");
    this.containerEl.empty();
    this.containerEl.win.addEventListener("message", this.handlePlayerMessage);
    this.renderEmptyState();
  }

  async onClose() {
    this.containerEl.win.removeEventListener("message", this.handlePlayerMessage);
    if (this.translationRunning) {
      this.translationSerial++;
      this.translationRunning = false;
      this.host.stopTranslation();
    }
  }

  getVideoBounds(): DOMRect | null {
    return this.playerEl?.getBoundingClientRect() ?? null;
  }

  getVideoData(): YouTubeVideoData | undefined {
    return this.data;
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  async loadVideo(urlOrId: string, startSeconds = 0, forceRefresh = false) {
    const videoId = parseYouTubeVideoId(urlOrId);
    if (!videoId) {
      new Notice("Could not read a YouTube video ID from that link.");
      return;
    }

    if (this.translationRunning) {
      this.translationSerial++;
      this.translationRunning = false;
      this.host.stopTranslation();
    }
    this.videoId = videoId;
    this.requestedStart = Math.max(0, startSeconds);
    this.data = undefined;
    this.renderLoading();

    try {
      if (!forceRefresh) {
        const cached = await this.host.getCachedVideo(videoId);
        if (cached && this.videoId === videoId) {
          this.data = cached;
          this.refreshTabTitle();
          this.renderPlayer(cached);
          this.setStatus(`${cached.segments.length} subtitle sentences loaded from local cache.`);
          return;
        }
      }

      const data = await fetchYouTubeVideoData(videoId, this.host.sourceLanguage());
      if (this.videoId !== videoId) return;
      await this.host.saveVideo(data);
      this.data = data;
      this.refreshTabTitle();
      this.renderPlayer(data);
    } catch (directError) {
      try {
        const data = await this.host.fetchTranscriptFallback(videoId, this.host.sourceLanguage());
        if (this.videoId !== videoId) return;
        await this.host.saveVideo(data);
        this.data = data;
        this.refreshTabTitle();
        this.renderPlayer(data);
        this.setStatus(`${data.segments.length} subtitle sentences loaded through yt-dlp fallback.`);
      } catch (fallbackError) {
        if (this.videoId !== videoId) return;
        this.data = { title: `YouTube ${videoId}`, videoId, segments: [] };
        this.refreshTabTitle();
        this.renderPlayer(this.data);
        this.setStatus(
          `Subtitles unavailable: ${getErrorMessage(directError)} Fallback: ${getErrorMessage(fallbackError)}`,
          true
        );
      }
    }
  }

  seekTo(seconds: number) {
    this.currentTime = Math.max(0, seconds);
    this.postPlayerCommand("seekTo", [this.currentTime, true]);
    this.postPlayerCommand("playVideo");
    this.updateActiveSegment(this.currentTime, true);
  }

  private renderEmptyState() {
    const empty = this.containerEl.createDiv({ cls: "youtube-reader-empty" });
    empty.createEl("h3", { text: "YouTube learning player" });
    empty.createEl("p", { text: "Use the command palette and run “Open YouTube learning player”." });
  }

  private renderLoading() {
    this.containerEl.empty();
    const loading = this.containerEl.createDiv({ cls: "youtube-reader-empty" });
    loading.createEl("h3", { text: "Loading video and subtitles…" });
    loading.createEl("p", { text: "The video can still open when captions are unavailable." });
  }

  private renderPlayer(data: YouTubeVideoData) {
    this.containerEl.empty();
    const shell = this.containerEl.createDiv({ cls: "youtube-reader-shell" });
    const main = shell.createDiv({ cls: "youtube-reader-main" });
    const toolbar = main.createDiv({ cls: "youtube-reader-toolbar" });
    toolbar.createDiv({ cls: "youtube-reader-title", text: data.title });

    this.addToolbarButton(toolbar, "play", "Play", () => this.postPlayerCommand("playVideo"));
    this.addToolbarButton(toolbar, "pause", "Pause", () => this.postPlayerCommand("pauseVideo"));
    this.addToolbarButton(toolbar, "camera", "Capture video frame to note", () => {
      void this.host.captureVideoFrame(this);
    });
    this.addToolbarButton(toolbar, "file-text", "Create transcript note", () => {
      if (this.data) void this.host.createTranscriptNote(this.data);
    });
    this.addToolbarButton(toolbar, "languages", "Translate transcript with AI", () => {
      void this.translateTranscript();
    });
    const visibilityButton = this.addToolbarButton(
      toolbar,
      this.translationsVisible ? "eye-off" : "eye",
      this.translationsVisible ? "Hide translated subtitles" : "Show translated subtitles",
      () => this.toggleTranslations(visibilityButton)
    );
    this.addToolbarButton(toolbar, "refresh-cw", "Refresh subtitles and cached transcript", () => {
      void this.loadVideo(this.videoId, this.currentTime, true);
    });
    this.addToolbarButton(toolbar, "square", "Stop AI transcript translation", () => {
      this.translationSerial++;
      this.translationRunning = false;
      this.host.stopTranslation();
      this.setStatus("Stopping AI transcript translation…");
    });
    this.addToolbarButton(toolbar, "external-link", "Open on YouTube", () => {
      this.containerEl.win.open(`https://www.youtube.com/watch?v=${this.videoId}&t=${Math.floor(this.currentTime)}s`);
    });

    this.playerEl = main.createDiv({ cls: "youtube-reader-player" });
    const iframe = this.playerEl.createEl("iframe", {
      attr: {
        allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
        allowfullscreen: "true",
        referrerpolicy: "strict-origin-when-cross-origin",
        src: buildEmbedUrl(data.videoId, this.requestedStart),
        title: data.title
      }
    });
    this.iframeEl = iframe;
    iframe.addEventListener("load", () => {
      this.startPlayerListening();
      if (this.requestedStart > 0) {
        window.setTimeout(() => this.seekTo(this.requestedStart), 700);
      }
    });

    this.statusEl = main.createDiv({ cls: "youtube-reader-status" });
    this.setStatus(data.segments.length > 0
      ? `${data.segments.length} subtitle sentences loaded.`
      : "No subtitle track was found for this video.");

    const transcriptPane = shell.createDiv({ cls: "youtube-reader-transcript-pane" });
    const transcriptHeader = transcriptPane.createDiv({ cls: "youtube-reader-transcript-header" });
    transcriptHeader.createEl("strong", { text: "Interactive transcript" });
    transcriptHeader.createSpan({ text: `${data.segments.length} sentences` });
    this.transcriptEl = transcriptPane.createDiv({ cls: "youtube-reader-transcript" });
    this.renderTranscript();
  }

  private addToolbarButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = parent.createEl("button", {
      attr: { "aria-label": label, title: label },
      cls: "clickable-icon youtube-reader-tool"
    });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
    return button;
  }

  private toggleTranslations(button: HTMLButtonElement) {
    this.translationsVisible = !this.translationsVisible;
    this.containerEl.toggleClass("youtube-reader-translations-hidden", !this.translationsVisible);
    const label = this.translationsVisible ? "Hide translated subtitles" : "Show translated subtitles";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.setAttribute("aria-pressed", String(!this.translationsVisible));
    setIcon(button, this.translationsVisible ? "eye-off" : "eye");
  }

  private refreshTabTitle() {
    const leaf = this.leaf as WorkspaceLeaf & { updateHeader?: () => void };
    leaf.updateHeader?.();
  }

  private renderTranscript() {
    const transcript = this.transcriptEl;
    if (!transcript || !this.data) return;
    transcript.empty();
    this.segmentEls = [];

    if (this.data.segments.length === 0) {
      transcript.createDiv({
        cls: "youtube-reader-transcript-empty",
        text: "This video has no accessible captions. You can still watch it and capture frames."
      });
      return;
    }

    this.data.segments.forEach((segment, index) => {
      const row = transcript.createDiv({ cls: "youtube-reader-segment" });
      row.dataset.index = String(index);
      const time = row.createEl("button", {
        cls: "youtube-reader-time",
        text: formatTimestamp(segment.start)
      });
      time.addEventListener("click", () => this.seekTo(segment.start));

      const content = row.createDiv({ cls: "youtube-reader-segment-content" });
      const original = content.createDiv({ cls: "youtube-reader-original", text: segment.text });
      original.addEventListener("click", () => this.seekTo(segment.start));
      if (segment.translation) {
        const translation = content.createDiv({ cls: "youtube-reader-translation", text: segment.translation });
        translation.addEventListener("click", () => this.seekTo(segment.start));
      }
      this.segmentEls.push(row);
    });

    this.updateActiveSegment(this.currentTime, false);
  }

  private async translateTranscript() {
    if (!this.data || this.data.segments.length === 0) return;
    if (this.translationRunning) {
      new Notice("YouTube transcript translation is already running.");
      return;
    }
    const data = this.data;
    const requestId = ++this.translationSerial;
    this.translationRunning = true;
    this.setStatus(`AI translating 0/${data.segments.length} subtitle sentences…`);

    try {
      const translations = await this.host.translateSegments(data, (completed, total, completedTranslations) => {
        if (this.data === data && requestId === this.translationSerial) {
          this.applyTranslations(completedTranslations);
          this.setStatus(`AI translating ${completed}/${total} subtitle sentences…`);
        }
      });
      if (this.data !== data || requestId !== this.translationSerial) return;
      this.applyTranslations(translations);
      this.setStatus(`Translation complete: ${translations.length} subtitle sentences.`);
    } catch (error) {
      if (this.data !== data || requestId !== this.translationSerial) return;
      this.setStatus(`Transcript translation failed: ${getErrorMessage(error)}`, true);
    } finally {
      if (requestId === this.translationSerial) this.translationRunning = false;
    }
  }

  private applyTranslations(translations: readonly string[]) {
    if (!this.data) return;
    translations.forEach((value, index) => {
      const translation = value?.trim();
      const segment = this.data?.segments[index];
      const row = this.segmentEls[index];
      if (!translation || !segment || !row) return;
      segment.translation = translation;
      const content = row.querySelector<HTMLElement>(".youtube-reader-segment-content");
      if (!content) return;
      let element = content.querySelector<HTMLElement>(".youtube-reader-translation");
      if (!element) {
        element = content.createDiv({ cls: "youtube-reader-translation" });
        element.addEventListener("click", () => this.seekTo(segment.start));
      }
      element.setText(translation);
    });
  }

  private setStatus(text: string, error = false) {
    if (!this.statusEl) return;
    this.statusEl.setText(text);
    this.statusEl.toggleClass("is-error", error);
  }

  private startPlayerListening() {
    const target = this.iframeEl?.contentWindow;
    if (!target) return;
    target.postMessage(JSON.stringify({ event: "listening", id: YOUTUBE_VIEW_TYPE }), "*");
    target.postMessage(JSON.stringify({ event: "command", func: "addEventListener", args: ["onStateChange"] }), "*");
  }

  private postPlayerCommand(func: string, args: unknown[] = []) {
    this.iframeEl?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  }

  private readonly handlePlayerMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== this.iframeEl?.contentWindow) return;
    const message = parseYouTubeMessage(event.data);
    if (!message) return;

    if (message.event === "infoDelivery" && typeof message.info === "object") {
      const time = message.info.currentTime;
      if (typeof time === "number" && Number.isFinite(time)) {
        this.currentTime = time;
        this.updateActiveSegment(time, true);
      }
    }
  };

  private updateActiveSegment(time: number, scroll: boolean) {
    const segments = this.data?.segments;
    if (!segments?.length) return;

    let nextIndex = segments.findIndex((segment) => time >= segment.start && time < segment.start + segment.duration);
    if (nextIndex < 0) {
      for (let index = segments.length - 1; index >= 0; index--) {
        if (segments[index].start <= time) {
          nextIndex = index;
          break;
        }
      }
    }
    if (nextIndex < 0 || nextIndex === this.activeIndex) return;

    if (this.activeIndex >= 0) this.segmentEls[this.activeIndex]?.removeClass("is-active");
    this.activeIndex = nextIndex;
    const active = this.segmentEls[nextIndex];
    active?.addClass("is-active");
    if (scroll) active?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

export function parseYouTubeVideoId(input: string): string | null {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;

  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (url.hostname.endsWith("youtube.com") || url.hostname.endsWith("youtube-nocookie.com")) {
      const id = url.searchParams.get("v")
        ?? url.pathname.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/)?.[1];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
  } catch {
    return null;
  }

  return null;
}

export function formatTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function buildYouTubeTimestampUri(videoId: string, seconds: number): string {
  return `obsidian://contextual-ai-reader-youtube?video=${encodeURIComponent(videoId)}&t=${Math.max(0, Math.floor(seconds))}`;
}

export function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "YouTube video";
}

export function normalizeYouTubeFolder(path: string, fallback: string): string {
  return normalizePath(path.trim() || fallback).replace(/\/$/, "");
}

async function fetchYouTubeVideoData(videoId: string, preferredLanguage: string): Promise<YouTubeVideoData> {
  const pageResponse = await requestUrl({
    url: `https://www.youtube.com/watch?v=${videoId}&hl=en`,
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"
    },
    throw: false
  });

  if (pageResponse.status < 200 || pageResponse.status >= 300) {
    throw new Error(`YouTube page returned HTTP ${pageResponse.status}.`);
  }

  const player = extractPlayerResponse(pageResponse.text);
  if (!player) throw new Error("YouTube did not provide playable metadata.");

  const title = player.videoDetails?.title?.trim() || `YouTube ${videoId}`;
  const trackList = player.captions?.playerCaptionsTracklistRenderer;
  const tracks = trackList?.captionTracks ?? [];
  const track = chooseCaptionTrack(tracks, preferredLanguage, getDefaultAudioLanguage(trackList));
  if (!track?.baseUrl) throw new Error("YouTube did not provide an accessible caption track.");

  const captionUrl = `${track.baseUrl.replace(/([?&])fmt=[^&]*/g, "$1")}\u0026fmt=json3`;
  const captionResponse = await requestUrl({ url: captionUrl, throw: false });
  if (captionResponse.status < 200 || captionResponse.status >= 300) {
    throw new Error(`YouTube captions returned HTTP ${captionResponse.status}.`);
  }

  return {
    sourceLanguage: track.languageCode,
    title,
    videoId,
    segments: parseYouTubeJson3(captionResponse.text)
  };
}

function extractPlayerResponse(html: string): PlayerResponse | null {
  const markers = ["ytInitialPlayerResponse =", "var ytInitialPlayerResponse =", '"playerResponse":'];
  for (const marker of markers) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) continue;
    const start = html.indexOf("{", markerIndex + marker.length);
    if (start < 0) continue;
    const json = readBalancedJsonObject(html, start);
    if (!json) continue;
    try {
      const parsed = JSON.parse(json) as PlayerResponse | string;
      if (typeof parsed === "string") {
        return JSON.parse(parsed) as PlayerResponse;
      }
      if (parsed.videoDetails || parsed.captions) return parsed;
    } catch {
      // Try the next known marker.
    }
  }
  return null;
}

function readBalancedJsonObject(input: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < input.length; index++) {
    const char = input[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return input.slice(start, index + 1);
  }
  return null;
}

function chooseCaptionTrack(
  tracks: CaptionTrack[],
  preferredLanguage: string,
  defaultAudioLanguage?: string
): CaptionTrack | undefined {
  if (preferredLanguage === "auto") {
    if (defaultAudioLanguage) {
      const preferred = defaultAudioLanguage.toLowerCase();
      const base = preferred.split("-")[0];
      return tracks.find((track) => track.languageCode?.toLowerCase() === preferred && track.kind !== "asr")
        ?? tracks.find((track) => track.languageCode?.toLowerCase() === base && track.kind !== "asr")
        ?? tracks.find((track) => track.languageCode?.toLowerCase() === preferred)
        ?? tracks.find((track) => track.languageCode?.toLowerCase() === base)
        ?? tracks.find((track) => track.kind !== "asr")
        ?? tracks[0];
    }
    return tracks.find((track) => track.kind !== "asr") ?? tracks[0];
  }
  const preferred = preferredLanguage.toLowerCase();
  const base = preferred.split("-")[0];
  return tracks.find((track) => track.languageCode?.toLowerCase() === preferred && track.kind !== "asr")
    ?? tracks.find((track) => track.languageCode?.toLowerCase() === base && track.kind !== "asr")
    ?? tracks.find((track) => track.languageCode?.toLowerCase() === preferred)
    ?? tracks.find((track) => track.languageCode?.toLowerCase() === base)
    ?? tracks.find((track) => track.languageCode?.toLowerCase() === "en" && track.kind !== "asr")
    ?? tracks.find((track) => track.languageCode?.toLowerCase() === "en")
    ?? tracks[0];
}

function getDefaultAudioLanguage(trackList?: CaptionTrackList): string | undefined {
  const index = trackList?.defaultAudioTrackIndex ?? 0;
  const id = trackList?.audioTracks?.[index]?.audioTrackId;
  return id?.match(/^([A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?)/)?.[1];
}

function mergeCaptionEvents(events: Json3CaptionEvent[]): YouTubeSegment[] {
  const raw = events
    .filter((event) => event.aAppend !== 1 && event.segs?.length)
    .map((event) => ({
      duration: Math.max(0.1, (event.dDurationMs ?? 0) / 1000),
      start: Math.max(0, (event.tStartMs ?? 0) / 1000),
      text: cleanCaptionText(event.segs?.map((segment) => segment.utf8 ?? "").join("") ?? "")
    }))
    .filter((segment) => segment.text.length > 0);

  const deduplicated = raw.filter((segment, index) => {
    if (index === 0) return true;
    const previous = raw[index - 1];
    return segment.text !== previous.text || Math.abs(segment.start - previous.start) > 0.25;
  });

  const merged: YouTubeSegment[] = [];
  let current: YouTubeSegment | undefined;
  const flush = () => {
    if (!current) return;
    current.text = current.text.trim();
    current.duration = Math.max(0.5, current.duration);
    merged.push(current);
    current = undefined;
  };

  for (const segment of deduplicated) {
    if (!current) {
      current = { ...segment };
      continue;
    }

    const currentEnd = current.start + current.duration;
    const gap = segment.start - currentEnd;
    const shouldFlush = endsSentence(current.text)
      || current.text.length >= 180
      || current.duration >= 14
      || gap > 2.2;
    if (shouldFlush) {
      flush();
      current = { ...segment };
      continue;
    }

    current.text = joinCaptionText(current.text, segment.text);
    current.duration = Math.max(currentEnd, segment.start + segment.duration) - current.start;
  }
  flush();
  return merged;
}

export function parseYouTubeJson3(text: string): YouTubeSegment[] {
  let captions: Json3Captions;
  try {
    captions = JSON.parse(text) as Json3Captions;
  } catch {
    throw new Error("YouTube returned an unsupported caption format.");
  }
  return mergeCaptionEvents(captions.events ?? []);
}

function cleanCaptionText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function endsSentence(text: string): boolean {
  return /[.!?。！？]["'’”）)]?$/.test(text) || /^\[[^\]]+\]$/.test(text);
}

function joinCaptionText(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  if (left.endsWith("-") && /^[a-z]/.test(right)) return `${left.slice(0, -1)}${right}`;
  if (/^[,.;:!?，。！？；：'’]/.test(right)) return `${left}${right}`;
  return `${left} ${right}`;
}

function buildEmbedUrl(videoId: string, start: number): string {
  const params = new URLSearchParams({
    autoplay: "0",
    enablejsapi: "1",
    playsinline: "1",
    rel: "0",
    start: String(Math.max(0, Math.floor(start)))
  });
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

function parseYouTubeMessage(value: unknown): YouTubeMessage | null {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as YouTubeMessage;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && value !== null ? value as YouTubeMessage : null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
