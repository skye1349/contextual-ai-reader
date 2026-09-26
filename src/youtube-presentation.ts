export interface YouTubeVideoRect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

export interface YouTubeCaptureRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface YouTubeCanvasFrame {
  base64: string;
  height: number;
  width: number;
}

export interface YouTubeWebviewPlaybackSnapshot {
  duration?: number;
  currentTime: number;
  exitWindowedFullscreen: boolean;
  videoRect?: YouTubeVideoRect;
  viewportHeight?: number;
  viewportWidth?: number;
}

const PRESENTATION_STATE = "__contextualAiReaderPresentation";
const PRESENTATION_STYLE_ID = "contextual-ai-reader-video-presentation";
const FRAME_CAPTURE_ATTRIBUTE = "data-contextual-ai-reader-frame-capture";
const WINDOWED_FULLSCREEN_ATTRIBUTE = "data-contextual-ai-reader-windowed-fullscreen";

export const YOUTUBE_WEBVIEW_CANVAS_FRAME_CAPTURE_SCRIPT = `(() => {
  const video = document.querySelector('video');
  if (!video || video.readyState < 2 || video.videoWidth < 1 || video.videoHeight < 1) return null;
  const scale = Math.min(1, 1920 / video.videoWidth);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return null;
  context.drawImage(video, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/png');
  const separator = dataUrl.indexOf(',');
  if (separator < 0) return null;
  return {
    base64: dataUrl.slice(separator + 1),
    contextualAiReaderCanvasFrame: true,
    height,
    width
  };
})()`;

export const YOUTUBE_WEBVIEW_FRAME_CAPTURE_PREPARE_SCRIPT = `(() => new Promise((resolve) => {
  const video = document.querySelector('video');
  if (!video) {
    resolve(null);
    return;
  }
  document.documentElement.setAttribute(${JSON.stringify(FRAME_CAPTURE_ATTRIBUTE)}, '');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const rect = video.getBoundingClientRect();
    const x = Math.max(0, Math.floor(rect.left));
    const y = Math.max(0, Math.floor(rect.top));
    const right = Math.min(window.innerWidth, Math.ceil(rect.right));
    const bottom = Math.min(window.innerHeight, Math.ceil(rect.bottom));
    resolve({
      contextualAiReaderCapture: true,
      height: Math.max(0, bottom - y),
      width: Math.max(0, right - x),
      x,
      y
    });
  }));
}))()`;

export const YOUTUBE_WEBVIEW_FRAME_CAPTURE_CLEANUP_SCRIPT = `(() => {
  document.documentElement.removeAttribute(${JSON.stringify(FRAME_CAPTURE_ATTRIBUTE)});
})()`;

export const YOUTUBE_WEBVIEW_PLAYBACK_PROBE_SCRIPT = `(() => {
  const video = document.querySelector('video');
  const rect = video?.getBoundingClientRect();
  const state = window.${PRESENTATION_STATE};
  const exitWindowedFullscreen = Boolean(state?.exitWindowedFullscreen);
  if (state) state.exitWindowedFullscreen = false;
  return {
    contextualAiReaderPlayback: true,
    currentTime: video?.currentTime ?? null,
    duration: Number.isFinite(video?.duration) ? video.duration : null,
    exitWindowedFullscreen,
    videoRect: rect ? {
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.width
    } : null,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth
  };
})()`;

export function buildYouTubeWebviewPresentationScript(
  windowedFullscreen: boolean,
  hideNativeCaptions: boolean
): string {
  const rules = [
    `html[${FRAME_CAPTURE_ATTRIBUTE}] .ytp-chrome-bottom,
html[${FRAME_CAPTURE_ATTRIBUTE}] .ytp-chrome-top,
html[${FRAME_CAPTURE_ATTRIBUTE}] .ytp-gradient-bottom,
html[${FRAME_CAPTURE_ATTRIBUTE}] .ytp-gradient-top,
html[${FRAME_CAPTURE_ATTRIBUTE}] .ytp-pause-overlay,
html[${FRAME_CAPTURE_ATTRIBUTE}] .ytp-cards-teaser,
html[${FRAME_CAPTURE_ATTRIBUTE}] .ytp-ce-element,
html[${FRAME_CAPTURE_ATTRIBUTE}] .ytp-ad-player-overlay,
html[${FRAME_CAPTURE_ATTRIBUTE}] .ytp-ad-overlay-container,
html[${FRAME_CAPTURE_ATTRIBUTE}] .ytp-watermark { opacity: 0 !important; visibility: hidden !important; }`,
    hideNativeCaptions
      ? ".ytp-caption-window-container, .caption-window { display: none !important; }"
      : "",
    windowedFullscreen
      ? [
        "html, body { overflow: hidden !important; background: #000 !important; }",
        "#masthead-container, #below, #secondary, #comments, #chat-container, ytd-watch-next-secondary-results-renderer { display: none !important; }",
        "ytd-watch-flexy #player { position: fixed !important; inset: 0 !important; z-index: 2147483644 !important; width: 100vw !important; height: 100vh !important; margin: 0 !important; }",
        "#player-container-outer, #player-container-inner, #player-container, ytd-player { width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important; }",
        "#movie_player { position: fixed !important; inset: 0 !important; z-index: 2147483645 !important; width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important; background: #000 !important; }",
        "#movie_player video { object-fit: contain !important; }"
      ].join("\n")
      : ""
  ].filter(Boolean).join("\n");

  return `(() => {
    let style = document.getElementById(${JSON.stringify(PRESENTATION_STYLE_ID)});
    if (!style) {
      style = document.createElement('style');
      style.id = ${JSON.stringify(PRESENTATION_STYLE_ID)};
      document.documentElement.appendChild(style);
    }
    style.textContent = ${JSON.stringify(rules)};
    document.documentElement.toggleAttribute(${JSON.stringify(WINDOWED_FULLSCREEN_ATTRIBUTE)}, ${JSON.stringify(windowedFullscreen)});
    if (!window.${PRESENTATION_STATE}) {
      window.${PRESENTATION_STATE} = { exitWindowedFullscreen: false };
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && document.documentElement.hasAttribute(${JSON.stringify(WINDOWED_FULLSCREEN_ATTRIBUTE)})) {
          event.preventDefault();
          window.${PRESENTATION_STATE}.exitWindowedFullscreen = true;
        }
      }, true);
    }
    return {
      hideNativeCaptions: ${JSON.stringify(hideNativeCaptions)},
      windowedFullscreen: ${JSON.stringify(windowedFullscreen)}
    };
  })()`;
}

export function parseYouTubeCaptureRect(value: unknown): YouTubeCaptureRect | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const height = finiteNumber(candidate.height);
  const width = finiteNumber(candidate.width);
  const x = finiteNumber(candidate.x);
  const y = finiteNumber(candidate.y);
  if ([height, width, x, y].some((item) => item === undefined)) return null;
  if ((height as number) < 1 || (width as number) < 1 || (x as number) < 0 || (y as number) < 0) return null;
  return {
    height: Math.round(height as number),
    width: Math.round(width as number),
    x: Math.round(x as number),
    y: Math.round(y as number)
  };
}

export function parseYouTubeCanvasFrame(value: unknown): YouTubeCanvasFrame | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const base64 = typeof candidate.base64 === "string" ? candidate.base64 : "";
  const height = finiteNumber(candidate.height);
  const width = finiteNumber(candidate.width);
  if (!base64 || height === undefined || width === undefined || height < 1 || width < 1) return null;
  return { base64, height: Math.round(height), width: Math.round(width) };
}

export function parseYouTubeWebviewPlaybackSnapshot(
  value: unknown
): YouTubeWebviewPlaybackSnapshot | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { currentTime: value, exitWindowedFullscreen: false };
  }
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.currentTime !== "number" || !Number.isFinite(candidate.currentTime)) return null;
  const videoRect = parseVideoRect(candidate.videoRect);
  return {
    currentTime: candidate.currentTime,
    ...(finiteNumber(candidate.duration) !== undefined ? { duration: finiteNumber(candidate.duration) } : {}),
    exitWindowedFullscreen: candidate.exitWindowedFullscreen === true,
    videoRect,
    viewportHeight: finiteNumber(candidate.viewportHeight),
    viewportWidth: finiteNumber(candidate.viewportWidth)
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseVideoRect(value: unknown): YouTubeVideoRect | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const bottom = finiteNumber(candidate.bottom);
  const height = finiteNumber(candidate.height);
  const left = finiteNumber(candidate.left);
  const right = finiteNumber(candidate.right);
  const top = finiteNumber(candidate.top);
  const width = finiteNumber(candidate.width);
  if ([bottom, height, left, right, top, width].some((item) => item === undefined)) return undefined;
  return {
    bottom: bottom as number,
    height: height as number,
    left: left as number,
    right: right as number,
    top: top as number,
    width: width as number
  };
}
