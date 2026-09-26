import { VideoChatHost, VideoChatPanel } from "./video-chat-panel";
import { Buffer } from "buffer";
import { LocalCaptionTrack, localVideoTimestampUri } from "./local-video";
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
import { findActiveYouTubeSegmentIndex } from "./youtube-timing";
import {
  YOUTUBE_WEBVIEW_CANVAS_FRAME_CAPTURE_SCRIPT,
  YOUTUBE_WEBVIEW_FRAME_CAPTURE_CLEANUP_SCRIPT,
  YOUTUBE_WEBVIEW_FRAME_CAPTURE_PREPARE_SCRIPT,
  YOUTUBE_WEBVIEW_PLAYBACK_PROBE_SCRIPT,
  YouTubeVideoRect,
  buildYouTubeWebviewPresentationScript,
  parseYouTubeCanvasFrame,
  parseYouTubeCaptureRect,
  parseYouTubeWebviewPlaybackSnapshot
} from "./youtube-presentation";

export const YOUTUBE_VIEW_TYPE = "contextual-ai-reader-youtube";

export interface YouTubeSegment {
  duration: number;
  start: number;
  text: string;
  translation?: string;
}

export interface YouTubeVideoData {
  localPath?: string;
  localTracks?: LocalCaptionTrack[];
  localTrackId?: string;
  subtitleWarning?: string;
  embedAllowed?: boolean;
  segments: YouTubeSegment[];
  sourceLanguage?: string;
  title: string;
  videoId: string;
}

export interface YouTubeSubtitleAppearance {
  originalColor: string;
  originalFontSize: number;
  translationColor: string;
  translationFontSize: number;
}

export interface YouTubeViewHost {
  createVideoChatHost?: (view: YouTubeLearningView) => VideoChatHost;
  loadLocalVideo?: (path: string, trackId?: string, transcribe?: boolean) => Promise<YouTubeVideoData>;
  localResourceUrl?: (path: string) => string;
  openLocalExternally?: (path: string) => void;
  captureVideoFrame: (view: YouTubeLearningView) => Promise<void>;
  createTranscriptNote: (data: YouTubeVideoData) => Promise<void>;
  fetchTranscriptFallback: (videoId: string, preferredLanguage: string) => Promise<YouTubeVideoData>;
  getCachedVideo: (videoId: string) => Promise<YouTubeVideoData | undefined>;
  saveVideo: (data: YouTubeVideoData) => Promise<void>;
  sourceLanguage: () => string;
  stopTranslation: () => void;
  subtitleAppearance: () => YouTubeSubtitleAppearance;
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
  playabilityStatus?: {
    playableInEmbed?: boolean;
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

interface YouTubeWebviewElement extends HTMLElement {
  allowpopups: boolean;
  capturePage?: (rect?: { height: number; width: number; x: number; y: number }) => Promise<{
    isEmpty?: () => boolean;
    toPNG: () => Uint8Array;
  }>;
  executeJavaScript: (code: string) => Promise<unknown>;
  partition: string;
}

export class YouTubeUrlModal extends Modal {
  private url = "";

  constructor(app: App, private readonly onSubmit: (url: string) => void) {
    super(app);
  }

  onOpen() {
    this.setTitle("Open YouTube video");

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

export class LocalVideoModal extends Modal {
  private path = "";
  constructor(app: App, private readonly onSubmit: (path: string) => void) { super(app); }
  onOpen() {
    this.setTitle("Open local video");
    new Setting(this.contentEl).setName("Video file path")
      .setDesc("Choose a video, or paste an absolute file path. Matching subtitle files are detected automatically.")
      .addText((text) => {
        text.setPlaceholder("/path/to/video.mp4").onChange((value) => { this.path = value; });
        text.inputEl.addEventListener("keydown", (event) => { if (event.key === "Enter") this.submit(); });
      });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Browse…").onClick(() => {
        const input = this.contentEl.createEl("input", { attr: { type: "file", accept: "video/*,.mkv,.avi,.m4v,.ts,.m2ts" } });
        input.hidden = true;
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) return;
          const electron = (window as Window & { require?: (id: string) => { webUtils?: { getPathForFile: (file: File) => string } } }).require?.("electron");
          this.path = electron?.webUtils?.getPathForFile(file) || (file as File & { path?: string }).path || "";
          if (!this.path) { new Notice("Paste the full video file path in the field above."); return; }
          this.submit();
        });
        input.click();
      }))
      .addButton((button) => button.setButtonText("Open").setCta().onClick(() => this.submit()));
  }
  private submit() {
    if (!this.path.trim()) { new Notice("Choose a video file first."); return; }
    this.onSubmit(this.path.trim());
    this.close();
  }
}

export function videoTimestampUri(data: YouTubeVideoData, seconds: number): string {
  return data.localPath ? localVideoTimestampUri(data.localPath, seconds) : buildYouTubeTimestampUri(data.videoId, seconds);
}

export function videoSourceUrl(data: YouTubeVideoData): string {
  return data.localPath ? localVideoTimestampUri(data.localPath, 0) : `https://www.youtube.com/watch?v=${data.videoId}`;
}

export class YouTubeLearningView extends ItemView {
  private chatPanel?: VideoChatPanel;
  private chatOpen = false;
  private duration = 0;
  private localVideoEl?: HTMLVideoElement;
  private loadSerial = 0;
  private activeIndex = -1;
  private currentTime = 0;
  private data?: YouTubeVideoData;
  private iframeEl?: HTMLIFrameElement;
  private panelResizerCleanup?: () => void;
  private playerEl?: HTMLElement;
  private playerPollTimer?: number;
  private requestedStart = 0;
  private segmentEls: HTMLElement[] = [];
  private splitRatio = 0.6875;
  private statusEl?: HTMLElement;
  private transcriptEl?: HTMLElement;
  private translationRunning = false;
  private translationSerial = 0;
  private translationsVisible = true;
  private videoSubtitleEl?: HTMLElement;
  private videoSubtitleOriginalEl?: HTMLElement;
  private videoSubtitlesButton?: HTMLButtonElement;
  private videoSubtitlesVisible = true;
  private videoSubtitleTranslationEl?: HTMLElement;
  private videoId = "";
  private webviewEl?: YouTubeWebviewElement;
  private windowedFullscreen = false;
  private windowedFullscreenButton?: HTMLButtonElement;

  constructor(leaf: WorkspaceLeaf, private readonly host: YouTubeViewHost) {
    super(leaf);
  }

  getViewType() {
    return YOUTUBE_VIEW_TYPE;
  }

  getDisplayText() {
    return this.data?.title || "YouTube video";
  }

  getIcon() {
    return this.data?.localPath ? "file-video" : "youtube";
  }

  async onOpen() {
    this.containerEl.addClass("contextual-ai-reader-youtube-view");
    this.containerEl.empty();
    this.refreshSubtitleAppearance();
    this.containerEl.win.addEventListener("message", this.handlePlayerMessage);
    this.containerEl.win.addEventListener("keydown", this.handleViewKeydown, true);
    this.renderEmptyState();
  }

  async onClose() {
    this.chatPanel?.unload();
    this.chatPanel = undefined;
    this.loadSerial++;
    this.disposeLocalPlayer();
    this.setWindowedFullscreen(false);
    this.containerEl.win.removeEventListener("message", this.handlePlayerMessage);
    this.containerEl.win.removeEventListener("keydown", this.handleViewKeydown, true);
    this.panelResizerCleanup?.();
    this.panelResizerCleanup = undefined;
    this.stopWebviewListening();
    this.webviewEl?.remove();
    this.webviewEl = undefined;
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
    return this.localVideoEl?.currentTime ?? this.currentTime;
  }

  getDuration(): number {
    const duration = this.localVideoEl?.duration || this.duration;
    return Number.isFinite(duration) && duration > 0 ? duration : (this.data?.segments ?? []).reduce((end, segment) => Math.max(end, segment.start + segment.duration), 0);
  }

  async captureDisplayedVideoFrame(): Promise<Uint8Array | undefined> {
    const video = this.localVideoEl;
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      const canvas = this.containerEl.doc.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(video, 0, 0);
        return Buffer.from(canvas.toDataURL("image/png").split(",")[1], "base64");
      }
    }
    const webview = this.webviewEl;
    if (!webview) return undefined;
    try {
      const value = await webview.executeJavaScript(YOUTUBE_WEBVIEW_CANVAS_FRAME_CAPTURE_SCRIPT);
      const frame = parseYouTubeCanvasFrame(value);
      if (frame) {
        const buffer = Buffer.from(frame.base64, "base64");
        if (buffer?.byteLength > 0) return buffer;
      }
    } catch {
      // Canvas capture can be blocked by protected media; capturePage remains available below.
    }
    if (!webview.capturePage) return undefined;
    try {
      const value = await webview.executeJavaScript(YOUTUBE_WEBVIEW_FRAME_CAPTURE_PREPARE_SCRIPT);
      const rect = parseYouTubeCaptureRect(value);
      if (!rect) return undefined;
      const image = await webview.capturePage(rect);
      if (image.isEmpty?.()) return undefined;
      const png = image.toPNG();
      return png.byteLength > 0 ? png : undefined;
    } finally {
      void webview.executeJavaScript(YOUTUBE_WEBVIEW_FRAME_CAPTURE_CLEANUP_SCRIPT).catch(() => undefined);
    }
  }

  refreshSubtitleAppearance() {
    const appearance = this.host.subtitleAppearance();
    this.containerEl.style.setProperty(
      "--youtube-reader-original-subtitle-size",
      `${clampSubtitleFontSize(appearance.originalFontSize, 16)}px`
    );
    this.containerEl.style.setProperty(
      "--youtube-reader-translation-subtitle-size",
      `${clampSubtitleFontSize(appearance.translationFontSize, 15)}px`
    );
    this.containerEl.style.setProperty(
      "--youtube-reader-original-subtitle-color",
      normalizeSubtitleColor(appearance.originalColor, "#111111")
    );
    this.containerEl.style.setProperty(
      "--youtube-reader-translation-subtitle-color",
      normalizeSubtitleColor(appearance.translationColor, "#111111")
    );
  }

  async loadVideo(urlOrId: string, startSeconds = 0, forceRefresh = false) {
    const loadSerial = ++this.loadSerial;
    this.disposeLocalPlayer();
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
        if (cached && this.videoId === videoId && loadSerial === this.loadSerial) {
          if (cached.embedAllowed === undefined) {
            try {
              cached.embedAllowed = await fetchYouTubeEmbedAllowed(videoId);
              await this.host.saveVideo(cached);
            } catch {
              // Preserve offline cache behavior when YouTube cannot be reached.
            }
          }
          if (loadSerial !== this.loadSerial) return;
          this.data = cached;
          this.refreshTabTitle();
          this.renderPlayer(cached);
          this.setTranscriptStatus(cached, `${cached.segments.length} subtitle sentences loaded from local cache.`);
          return;
        }
      }

      const data = await fetchYouTubeVideoData(videoId, this.host.sourceLanguage());
      if (this.videoId !== videoId || loadSerial !== this.loadSerial) return;
      await this.host.saveVideo(data);
      this.data = data;
      this.refreshTabTitle();
      this.renderPlayer(data);
    } catch (directError) {
      try {
        const data = await this.host.fetchTranscriptFallback(videoId, this.host.sourceLanguage());
        if (this.videoId !== videoId || loadSerial !== this.loadSerial) return;
        await this.host.saveVideo(data);
        this.data = data;
        this.refreshTabTitle();
        this.renderPlayer(data);
        this.setTranscriptStatus(data, `${data.segments.length} subtitle sentences loaded through yt-dlp fallback.`);
      } catch (fallbackError) {
        if (this.videoId !== videoId || loadSerial !== this.loadSerial) return;
        this.data = { title: `YouTube ${videoId}`, videoId, segments: [] };
        this.refreshTabTitle();
        this.renderPlayer(this.data);
        this.setTranscriptStatus(
          this.data,
          `Subtitles unavailable: ${getErrorMessage(directError)} Fallback: ${getErrorMessage(fallbackError)}`,
          true
        );
      }
    }
  }

  async loadLocalVideo(path: string, startSeconds = 0, trackId?: string, transcribe = false) {
    if (!this.host.loadLocalVideo) return;
    const serial = ++this.loadSerial;
    if (this.translationRunning) {
      this.translationSerial++;
      this.translationRunning = false;
      this.host.stopTranslation();
    }
    this.disposeLocalPlayer();
    this.stopWebviewListening();
    this.webviewEl?.remove();
    this.webviewEl = undefined;
    this.iframeEl = undefined;
    this.videoId = "";
    this.data = undefined;
    this.requestedStart = Math.max(0, Number.isFinite(startSeconds) ? startSeconds : 0);
    this.renderLoading();
    try {
      const data = await this.host.loadLocalVideo(path, trackId, transcribe);
      if (serial !== this.loadSerial) return;
      this.videoId = data.videoId;
      this.data = data;
      this.refreshTabTitle();
      this.renderPlayer(data);
      if (data.subtitleWarning) this.setStatus(data.subtitleWarning, true);
    } catch (error) {
      if (serial !== this.loadSerial) return;
      this.containerEl.empty();
      this.containerEl.createDiv({ cls: "youtube-reader-empty", text: `Could not open local video: ${getErrorMessage(error)}` });
      new Notice(getErrorMessage(error));
    }
  }

  private disposeLocalPlayer() {
    if (!this.localVideoEl) return;
    this.localVideoEl.pause();
    this.localVideoEl.removeAttribute("src");
    this.localVideoEl.load();
    this.localVideoEl.remove();
    this.localVideoEl = undefined;
  }

  private renderLocalPlayer(data: YouTubeVideoData) {
    if (!this.playerEl || !data.localPath) return;
    this.playerEl.addClass("youtube-reader-local-player");
    const video = this.playerEl.createEl("video", { attr: { controls: "", preload: "metadata", "aria-label": data.title } });
    this.localVideoEl = video;
    video.addEventListener("loadedmetadata", () => {
      if (this.localVideoEl !== video) return;
      video.currentTime = Math.min(this.requestedStart, Number.isFinite(video.duration) ? video.duration : this.requestedStart);
    });
    video.addEventListener("timeupdate", () => {
      if (this.localVideoEl !== video) return;
      this.currentTime = video.currentTime;
      this.updateActiveSegment(video.currentTime, true);
    });
    video.addEventListener("error", () => {
      if (this.localVideoEl === video) this.setStatus("This video could not be played. Check that the file still exists; unsupported codecs need conversion to H.264/AAC MP4 or WebM. Subtitles and notes remain available.", true);
    });
    video.src = this.host.localResourceUrl?.(data.localPath) ?? "";
  }

  seekTo(seconds: number) {
    this.currentTime = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    this.postPlayerCommand("seekTo", [this.currentTime, true]);
    this.postPlayerCommand("playVideo");
    this.updateActiveSegment(this.currentTime, true);
  }

  private renderEmptyState() {
    const empty = this.containerEl.createDiv({ cls: "youtube-reader-empty" });
    empty.createEl("h3", { text: "Open a YouTube video" });
    empty.createEl("p", { text: "Use the command palette and run “Open YouTube video”." });
  }

  private renderLoading() {
    this.chatPanel?.unload();
    this.chatPanel = undefined;
    this.duration = 0;
    this.containerEl.empty();
    const loading = this.containerEl.createDiv({ cls: "youtube-reader-empty" });
    loading.createEl("h3", { text: "Loading video and subtitles…" });
    loading.createEl("p", { text: "The video can still open when captions are unavailable." });
  }

  private renderPlayer(data: YouTubeVideoData) {
    this.chatPanel?.unload();
    this.chatPanel = undefined;
    this.setWindowedFullscreen(false);
    this.disposeLocalPlayer();
    this.activeIndex = -1;
    this.currentTime = this.requestedStart;
    this.panelResizerCleanup?.();
    this.panelResizerCleanup = undefined;
    this.stopWebviewListening();
    this.iframeEl = undefined;
    this.webviewEl?.remove();
    this.webviewEl = undefined;
    this.containerEl.empty();
    const shell = this.containerEl.createDiv({ cls: "youtube-reader-shell" });
    shell.dataset.videoId = data.videoId;
    const main = shell.createDiv({ cls: "youtube-reader-main" });
    const toolbar = main.createDiv({ cls: "youtube-reader-toolbar" });
    toolbar.createDiv({ cls: "youtube-reader-title", text: data.title });

    this.addToolbarButton(toolbar, "play", "Play", () => this.postPlayerCommand("playVideo"));
    this.addToolbarButton(toolbar, "pause", "Pause", () => this.postPlayerCommand("pauseVideo"));
    this.windowedFullscreenButton = this.addToolbarButton(
      toolbar,
      "maximize-2",
      "Enter windowed fullscreen",
      () => this.setWindowedFullscreen(!this.windowedFullscreen)
    );
    this.addToolbarButton(toolbar, "camera", "Copy current video frame", () => {
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
    this.videoSubtitlesButton = this.addToolbarButton(
      toolbar,
      "captions",
      this.videoSubtitlesVisible ? "Hide video subtitles" : "Show video subtitles",
      () => this.toggleVideoSubtitles()
    );
    this.addToolbarButton(toolbar, "refresh-cw", "Refresh subtitles and cached transcript", () => {
      if (data.localPath) void this.loadLocalVideo(data.localPath, this.getCurrentTime(), data.localTrackId);
      else void this.loadVideo(this.videoId, this.currentTime, true);
    });
    this.addToolbarButton(toolbar, "square", "Stop AI transcript translation", () => {
      this.translationSerial++;
      this.translationRunning = false;
      this.host.stopTranslation();
      this.setStatus("Stopping AI transcript translation…");
    });
    this.addToolbarButton(toolbar, "external-link", data.localPath ? "Open in default video app" : "Open on YouTube", () => {
      if (data.localPath) this.host.openLocalExternally?.(data.localPath);
      else this.containerEl.win.open(`https://www.youtube.com/watch?v=${this.videoId}&t=${Math.floor(this.currentTime)}s`);
    });
    if (data.localPath) {
      if (data.localTracks?.length) {
        const select = toolbar.createEl("select", { attr: { "aria-label": "Subtitle track", title: "Subtitle track" } });
        for (const track of data.localTracks) select.createEl("option", { value: track.id, text: track.label });
        select.value = data.localTrackId ?? "";
        select.addEventListener("change", () => { void this.loadLocalVideo(data.localPath!, this.getCurrentTime(), select.value); });
      }
      if (!data.segments.length) this.addToolbarButton(toolbar, "mic", "Transcribe audio with configured Whisper service", () => {
        void this.loadLocalVideo(data.localPath!, this.getCurrentTime(), undefined, true);
      });
    }

    this.playerEl = main.createDiv({ cls: "youtube-reader-player" });
    if (data.localPath) {
      this.renderLocalPlayer(data);
    } else if (data.embedAllowed === false) {
      this.renderWebviewPlayer(data);
    } else {
      this.renderIframePlayer(data);
    }
    this.renderVideoSubtitleOverlay();

    this.statusEl = main.createDiv({ cls: "youtube-reader-status" });
    this.setTranscriptStatus(data, data.segments.length > 0
      ? `${data.segments.length} subtitle sentences loaded.`
      : "No subtitle track was found for this video.");

    const resizer = shell.createDiv({
      attr: {
        "aria-label": "Resize video and transcript panels",
        "aria-orientation": "vertical",
        role: "separator",
        tabindex: "0",
        title: "Drag to resize video and transcript panels"
      },
      cls: "youtube-reader-resizer"
    });
    this.setupPanelResizer(shell, resizer);

    const transcriptPane = shell.createDiv({ cls: "youtube-reader-transcript-pane" });
    const transcriptHeader = transcriptPane.createDiv({ cls: "youtube-reader-transcript-header" });
    const transcriptButton = transcriptHeader.createEl("button", { text: "Transcript", cls: "video-chat-tab", attr: { "aria-label": "Show video transcript" } });
    transcriptHeader.createSpan({ text: `${data.segments.length} sentences` });
    const chatButton = transcriptHeader.createEl("button", { text: "AI help", cls: "video-chat-open", attr: { title: "AI help me understand this video", "aria-label": "AI help me understand this video" } });
    this.transcriptEl = transcriptPane.createDiv({ cls: "youtube-reader-transcript" });
    this.renderTranscript();
    const chatElement = transcriptPane.createDiv();
    const showChat = (open: boolean) => {
      this.chatOpen = open;
      this.transcriptEl?.toggleClass("video-chat-transcript-hidden", open);
      chatElement.toggleClass("is-hidden", !open);
      chatButton.toggleClass("mod-cta", open);
      chatButton.setAttribute("aria-pressed", String(open));
      transcriptButton.setAttribute("aria-pressed", String(!open));
      if (open && !this.chatPanel && this.host.createVideoChatHost) {
        this.chatPanel = new VideoChatPanel(this.app, chatElement, data, this.host.createVideoChatHost(this), () => this.getCurrentTime(), (seconds) => this.seekTo(seconds));
      }
      if (open) this.chatPanel?.focus();
    };
    chatElement.addClass("video-chat-panel");
    chatButton.disabled = !this.host.createVideoChatHost;
    chatButton.addEventListener("click", () => showChat(true));
    transcriptButton.addEventListener("click", () => showChat(false));
    showChat(this.chatOpen);
  }

  private renderIframePlayer(data: YouTubeVideoData) {
    if (!this.playerEl) return;
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
  }

  private renderWebviewPlayer(data: YouTubeVideoData) {
    if (!this.playerEl) return;
    const webview = this.containerEl.doc.createElement("webview") as YouTubeWebviewElement;
    const appWithWebviewPartition = this.app as App & { getWebviewPartition?: () => string };
    webview.allowpopups = true;
    const partition = appWithWebviewPartition.getWebviewPartition?.();
    if (partition) webview.partition = partition;
    webview.setAttribute("aria-label", `${data.title} on YouTube`);
    webview.setAttribute("src", buildWatchUrl(data.videoId, this.requestedStart));
    webview.addEventListener("dom-ready", () => {
      this.startWebviewListening();
      void this.syncWebviewPresentation();
      if (this.requestedStart > 0) this.seekTo(this.requestedStart);
    });
    webview.addEventListener("did-fail-load", () => {
      if (this.data === data) {
        this.setTranscriptStatus(data, "The YouTube watch page could not be loaded.", true);
      }
    });
    this.webviewEl = webview;
    this.playerEl.appendChild(webview);
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

  private renderVideoSubtitleOverlay() {
    const player = this.playerEl;
    if (!player) return;
    const overlay = player.createDiv({ cls: "youtube-reader-video-subtitles" });
    overlay.dataset.index = "";
    if (this.webviewEl) overlay.addClass("is-position-pending");
    this.videoSubtitleEl = overlay;
    this.videoSubtitleOriginalEl = overlay.createDiv({ cls: "youtube-reader-video-subtitle-original" });
    this.videoSubtitleTranslationEl = overlay.createDiv({ cls: "youtube-reader-video-subtitle-translation" });
    const captureButton = player.createEl("button", {
      attr: {
        "aria-label": "Capture screenshot",
        title: "Capture screenshot"
      },
      cls: "clickable-icon youtube-reader-windowed-fullscreen-capture"
    });
    setIcon(captureButton, "camera");
    captureButton.addEventListener("click", () => {
      captureButton.disabled = true;
      void this.host.captureVideoFrame(this).finally(() => {
        captureButton.disabled = false;
      });
    });
    const exitButton = player.createEl("button", {
      attr: {
        "aria-label": "Exit windowed fullscreen",
        title: "Exit windowed fullscreen"
      },
      cls: "clickable-icon youtube-reader-windowed-fullscreen-exit"
    });
    setIcon(exitButton, "minimize-2");
    exitButton.addEventListener("click", () => this.setWindowedFullscreen(false));
    this.containerEl.toggleClass("youtube-reader-video-subtitles-hidden", !this.videoSubtitlesVisible);
    this.updateVideoSubtitleOverlay(this.activeIndex);
  }

  private updateVideoSubtitleOverlay(index: number) {
    const overlay = this.videoSubtitleEl;
    const original = this.videoSubtitleOriginalEl;
    const translation = this.videoSubtitleTranslationEl;
    const segment = index >= 0 ? this.data?.segments[index] : undefined;
    if (!overlay || !original || !translation || !segment || !this.videoSubtitlesVisible) {
      overlay?.removeClass("has-caption");
      if (overlay) overlay.dataset.index = "";
      original?.setText("");
      translation?.setText("");
      return;
    }

    const translatedText = this.translationsVisible ? segment.translation?.trim() ?? "" : "";
    overlay.dataset.index = String(index);
    overlay.addClass("has-caption");
    overlay.toggleClass("has-translation", Boolean(translatedText));
    original.setText(segment.text);
    translation.setText(translatedText);
  }

  private setWindowedFullscreen(enabled: boolean) {
    const player = this.playerEl;
    this.windowedFullscreen = enabled;
    this.containerEl.toggleClass("is-windowed-fullscreen", enabled);
    player?.toggleClass("is-windowed-fullscreen", enabled);
    const label = enabled ? "Exit windowed fullscreen" : "Enter windowed fullscreen";
    this.windowedFullscreenButton?.setAttribute("aria-label", label);
    this.windowedFullscreenButton?.setAttribute("title", label);
    this.windowedFullscreenButton?.setAttribute("aria-pressed", String(enabled));
    if (this.windowedFullscreenButton) {
      setIcon(this.windowedFullscreenButton, enabled ? "minimize-2" : "maximize-2");
    }
    if (!enabled && this.webviewEl) this.videoSubtitleEl?.addClass("is-position-pending");
    void this.syncWebviewPresentation();
  }

  private async syncWebviewPresentation(): Promise<void> {
    const webview = this.webviewEl;
    if (!webview) return;
    const script = buildYouTubeWebviewPresentationScript(
      this.windowedFullscreen,
      this.videoSubtitlesVisible
    );
    try {
      await webview.executeJavaScript(script);
    } catch {
      // The webview may be navigating between YouTube documents.
    }
  }

  private updateVideoSubtitleBounds(
    videoRect?: YouTubeVideoRect,
    viewportWidth?: number,
    viewportHeight?: number
  ) {
    const overlay = this.videoSubtitleEl;
    if (!overlay || !this.webviewEl) return;
    if (this.windowedFullscreen) {
      overlay.removeClass("is-position-pending", "is-video-offscreen");
      overlay.style.removeProperty("left");
      overlay.style.removeProperty("top");
      overlay.style.removeProperty("width");
      overlay.style.removeProperty("height");
      return;
    }
    if (!videoRect || !viewportWidth || !viewportHeight || videoRect.width <= 0 || videoRect.height <= 0) {
      overlay.addClass("is-position-pending");
      return;
    }

    const visibleLeft = Math.max(0, videoRect.left);
    const visibleTop = Math.max(0, videoRect.top);
    const visibleRight = Math.min(viewportWidth, videoRect.right);
    const visibleBottom = Math.min(viewportHeight, videoRect.bottom);
    const visibleWidth = Math.max(0, visibleRight - visibleLeft);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    overlay.removeClass("is-position-pending");
    overlay.toggleClass("is-video-offscreen", visibleWidth < 80 || visibleHeight < 60);
    overlay.style.left = `${visibleLeft}px`;
    overlay.style.top = `${visibleTop}px`;
    overlay.style.width = `${visibleWidth}px`;
    overlay.style.height = `${visibleHeight}px`;
  }

  private toggleTranslations(button: HTMLButtonElement) {
    this.translationsVisible = !this.translationsVisible;
    this.containerEl.toggleClass("youtube-reader-translations-hidden", !this.translationsVisible);
    const label = this.translationsVisible ? "Hide translated subtitles" : "Show translated subtitles";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.setAttribute("aria-pressed", String(!this.translationsVisible));
    setIcon(button, this.translationsVisible ? "eye-off" : "eye");
    this.updateVideoSubtitleOverlay(this.activeIndex);
  }

  private toggleVideoSubtitles() {
    this.videoSubtitlesVisible = !this.videoSubtitlesVisible;
    this.containerEl.toggleClass("youtube-reader-video-subtitles-hidden", !this.videoSubtitlesVisible);
    const label = this.videoSubtitlesVisible ? "Hide video subtitles" : "Show video subtitles";
    this.videoSubtitlesButton?.setAttribute("aria-label", label);
    this.videoSubtitlesButton?.setAttribute("title", label);
    this.videoSubtitlesButton?.setAttribute("aria-pressed", String(this.videoSubtitlesVisible));
    if (this.videoSubtitlesButton) {
      setIcon(this.videoSubtitlesButton, this.videoSubtitlesVisible ? "captions" : "captions-off");
    }
    this.updateVideoSubtitleOverlay(this.activeIndex);
    void this.syncWebviewPresentation();
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
      this.addTranscriptSeekHandler(original, segment.start);
      if (segment.translation) {
        const translation = content.createDiv({ cls: "youtube-reader-translation", text: segment.translation });
        this.addTranscriptSeekHandler(translation, segment.start);
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
        this.addTranscriptSeekHandler(element, segment.start);
      }
      element.setText(translation);
    });
    this.updateVideoSubtitleOverlay(this.activeIndex);
  }

  private addTranscriptSeekHandler(element: HTMLElement, seconds: number) {
    element.addEventListener("click", () => {
      if (this.hasTranscriptSelection()) return;
      this.seekTo(seconds);
    });
  }

  private hasTranscriptSelection(): boolean {
    const transcript = this.transcriptEl;
    const selection = this.containerEl.win.getSelection();
    if (!transcript || !selection || selection.isCollapsed || !selection.toString()) return false;
    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    return Boolean(
      (anchor && transcript.contains(anchor))
      || (focus && transcript.contains(focus))
    );
  }

  private setupPanelResizer(shell: HTMLElement, resizer: HTMLElement) {
    const setRatio = (ratio: number) => {
      this.splitRatio = Math.min(0.82, Math.max(0.28, ratio));
      shell.style.setProperty("--youtube-reader-main-width", `${this.splitRatio * 100}%`);
      resizer.setAttribute("aria-valuenow", String(Math.round(this.splitRatio * 100)));
    };
    const setFromClientX = (clientX: number) => {
      const bounds = shell.getBoundingClientRect();
      const dividerWidth = resizer.getBoundingClientRect().width || 8;
      if (bounds.width <= dividerWidth) return;
      const usableWidth = bounds.width - dividerWidth;
      const minimumMain = Math.min(320, usableWidth * 0.45);
      const minimumTranscript = Math.min(280, usableWidth * 0.45);
      const width = Math.min(
        usableWidth - minimumTranscript,
        Math.max(minimumMain, clientX - bounds.left)
      );
      setRatio(width / bounds.width);
    };

    setRatio(this.splitRatio);
    let dragging = false;
    const viewWindow = this.containerEl.win;
    resizer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      shell.addClass("is-resizing");
      setFromClientX(event.clientX);
    });
    const handlePointerMove = (event: PointerEvent) => {
      if (dragging) setFromClientX(event.clientX);
    };
    const finishDragging = () => {
      if (!dragging) return;
      dragging = false;
      shell.removeClass("is-resizing");
    };
    viewWindow.addEventListener("pointermove", handlePointerMove);
    viewWindow.addEventListener("pointerup", finishDragging);
    viewWindow.addEventListener("pointercancel", finishDragging);
    viewWindow.addEventListener("blur", finishDragging);
    this.panelResizerCleanup = () => {
      finishDragging();
      viewWindow.removeEventListener("pointermove", handlePointerMove);
      viewWindow.removeEventListener("pointerup", finishDragging);
      viewWindow.removeEventListener("pointercancel", finishDragging);
      viewWindow.removeEventListener("blur", finishDragging);
    };
    resizer.addEventListener("dblclick", () => setRatio(0.6875));
    resizer.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const bounds = shell.getBoundingClientRect();
      const delta = event.key === "ArrowLeft" ? -24 : 24;
      setFromClientX(bounds.left + bounds.width * this.splitRatio + delta);
    });
  }

  private setStatus(text: string, error = false) {
    if (!this.statusEl) return;
    this.statusEl.setText(text);
    this.statusEl.toggleClass("is-error", error);
  }

  private setTranscriptStatus(data: YouTubeVideoData, text: string, error = false) {
    const prefix = data.embedAllowed === false
      ? "The video owner disabled embedding. Playing the YouTube watch page inside Obsidian. "
      : "";
    this.setStatus(`${prefix}${text}`, error);
  }

  private startPlayerListening() {
    const target = this.iframeEl?.contentWindow;
    if (!target) return;
    target.postMessage(JSON.stringify({ event: "listening", id: YOUTUBE_VIEW_TYPE }), "*");
    target.postMessage(JSON.stringify({ event: "command", func: "addEventListener", args: ["onStateChange"] }), "*");
  }

  private postPlayerCommand(func: string, args: unknown[] = []) {
    if (this.localVideoEl) {
      const video = this.localVideoEl;
      if (func === "playVideo") void video.play().catch((error: unknown) => {
        if (video !== this.localVideoEl || (error instanceof Error && error.name === "AbortError")) return;
        this.setStatus(getErrorMessage(error), true);
      });
      else if (func === "pauseVideo") video.pause();
      else if (func === "seekTo" && typeof args[0] === "number" && Number.isFinite(args[0])) {
        const target = Math.max(0, args[0]);
        video.currentTime = Number.isFinite(video.duration) ? Math.min(target, video.duration) : target;
      }
      return;
    }
    if (this.webviewEl) {
      let script: string | undefined;
      if (func === "playVideo") script = "document.querySelector('video')?.play()";
      else if (func === "pauseVideo") script = "document.querySelector('video')?.pause()";
      else if (func === "seekTo" && typeof args[0] === "number" && Number.isFinite(args[0])) {
        script = `(() => { const video = document.querySelector('video'); if (video) video.currentTime = ${Math.max(0, args[0])}; })()`;
      }
      if (script) void this.webviewEl.executeJavaScript(script).catch(() => undefined);
      return;
    }
    this.iframeEl?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  }

  private startWebviewListening() {
    this.stopWebviewListening();
    const poll = async () => {
      const webview = this.webviewEl;
      if (!webview) return;
      try {
        await this.syncWebviewPresentation();
        const value = await webview.executeJavaScript(YOUTUBE_WEBVIEW_PLAYBACK_PROBE_SCRIPT);
        const snapshot = parseYouTubeWebviewPlaybackSnapshot(value);
        if (!snapshot) return;
        if (snapshot.exitWindowedFullscreen && this.windowedFullscreen) {
          this.setWindowedFullscreen(false);
        }
        this.currentTime = snapshot.currentTime;
        if (snapshot.duration) this.duration = snapshot.duration;
        this.updateVideoSubtitleBounds(
          snapshot.videoRect,
          snapshot.viewportWidth,
          snapshot.viewportHeight
        );
        this.updateActiveSegment(snapshot.currentTime, true);
      } catch {
        // The webview may be navigating or closing between polling ticks.
      }
    };
    void poll();
    this.playerPollTimer = this.containerEl.win.setInterval(() => { void poll(); }, 250);
  }

  private stopWebviewListening() {
    if (this.playerPollTimer !== undefined) {
      this.containerEl.win.clearInterval(this.playerPollTimer);
      this.playerPollTimer = undefined;
    }
  }

  private readonly handlePlayerMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== this.iframeEl?.contentWindow) return;
    const message = parseYouTubeMessage(event.data);
    if (!message) return;

    if (message.event === "infoDelivery" && typeof message.info === "object") {
      const time = message.info.currentTime;
      if (typeof message.info.duration === "number" && Number.isFinite(message.info.duration)) this.duration = message.info.duration;
      if (typeof time === "number" && Number.isFinite(time)) {
        this.currentTime = time;
        this.updateActiveSegment(time, true);
      }
    }
  };

  private readonly handleViewKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !this.windowedFullscreen) return;
    event.preventDefault();
    this.setWindowedFullscreen(false);
  };

  private updateActiveSegment(time: number, scroll: boolean) {
    const segments = this.data?.segments;
    if (!segments?.length) return;

    const nextIndex = findActiveYouTubeSegmentIndex(segments, time);
    if (nextIndex < 0) {
      this.updateVideoSubtitleOverlay(-1);
      return;
    }
    if (nextIndex === this.activeIndex) {
      this.updateVideoSubtitleOverlay(nextIndex);
      return;
    }

    if (this.activeIndex >= 0) this.segmentEls[this.activeIndex]?.removeClass("is-active");
    this.activeIndex = nextIndex;
    const active = this.segmentEls[nextIndex];
    active?.addClass("is-active");
    this.updateVideoSubtitleOverlay(nextIndex);
    if (scroll && !this.hasTranscriptSelection()) {
      active?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
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

function clampSubtitleFontSize(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(48, Math.max(10, Math.round(value))) : fallback;
}

function normalizeSubtitleColor(value: string, fallback: string): string {
  const trimmed = value?.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : fallback;
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

async function fetchYouTubePlayerResponse(videoId: string): Promise<PlayerResponse> {
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
  return player;
}

async function fetchYouTubeEmbedAllowed(videoId: string): Promise<boolean> {
  const player = await fetchYouTubePlayerResponse(videoId);
  return player.playabilityStatus?.playableInEmbed !== false;
}

async function fetchYouTubeVideoData(videoId: string, preferredLanguage: string): Promise<YouTubeVideoData> {
  const player = await fetchYouTubePlayerResponse(videoId);

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
    embedAllowed: player.playabilityStatus?.playableInEmbed,
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
    cc_load_policy: "0",
    enablejsapi: "1",
    playsinline: "1",
    rel: "0",
    start: String(Math.max(0, Math.floor(start)))
  });
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

function buildWatchUrl(videoId: string, start: number): string {
  const params = new URLSearchParams({
    t: `${Math.max(0, Math.floor(start))}s`
  });
  return `https://www.youtube.com/watch?v=${videoId}&${params.toString()}`;
}

function parseYouTubeMessage(value: unknown): YouTubeMessage | null {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as YouTubeMessage;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && value !== null ? value : null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
