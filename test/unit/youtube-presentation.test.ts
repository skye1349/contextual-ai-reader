import assert from "node:assert/strict";
import test from "node:test";
import {
  YOUTUBE_WEBVIEW_CANVAS_FRAME_CAPTURE_SCRIPT,
  YOUTUBE_WEBVIEW_FRAME_CAPTURE_CLEANUP_SCRIPT,
  YOUTUBE_WEBVIEW_FRAME_CAPTURE_PREPARE_SCRIPT,
  YOUTUBE_WEBVIEW_PLAYBACK_PROBE_SCRIPT,
  buildYouTubeWebviewPresentationScript,
  parseYouTubeCanvasFrame,
  parseYouTubeCaptureRect,
  parseYouTubeWebviewPlaybackSnapshot
} from "../../src/youtube-presentation";

test("windowed fullscreen presentation fills the YouTube player and hides native captions", () => {
  const script = buildYouTubeWebviewPresentationScript(true, true);
  assert.match(script, /#movie_player/);
  assert.match(script, /position: fixed !important/);
  assert.match(script, /#masthead-container/);
  assert.match(script, /#below/);
  assert.match(script, /#secondary/);
  assert.match(script, /ytd-watch-next-secondary-results-renderer/);
  assert.match(script, /ytp-caption-window-container/);
  assert.match(script, /display: none !important/);
  assert.match(script, /exitWindowedFullscreen/);
});

test("playback probe carries time, video bounds, and the Escape request", () => {
  assert.match(YOUTUBE_WEBVIEW_PLAYBACK_PROBE_SCRIPT, /getBoundingClientRect/);
  assert.deepEqual(parseYouTubeWebviewPlaybackSnapshot({
    currentTime: 67,
    exitWindowedFullscreen: true,
    videoRect: { bottom: 720, height: 720, left: 0, right: 1280, top: 0, width: 1280 },
    viewportHeight: 720,
    viewportWidth: 1280
  }), {
    currentTime: 67,
    exitWindowedFullscreen: true,
    videoRect: { bottom: 720, height: 720, left: 0, right: 1280, top: 0, width: 1280 },
    viewportHeight: 720,
    viewportWidth: 1280
  });
});

test("frame capture prepares a clean visible video rectangle", () => {
  assert.match(YOUTUBE_WEBVIEW_FRAME_CAPTURE_PREPARE_SCRIPT, /requestAnimationFrame/);
  assert.match(YOUTUBE_WEBVIEW_FRAME_CAPTURE_PREPARE_SCRIPT, /getBoundingClientRect/);
  assert.match(YOUTUBE_WEBVIEW_FRAME_CAPTURE_CLEANUP_SCRIPT, /removeAttribute/);
  assert.deepEqual(parseYouTubeCaptureRect({ height: 719.6, width: 1280.4, x: 0, y: 20 }), {
    height: 720,
    width: 1280,
    x: 0,
    y: 20
  });
  assert.equal(parseYouTubeCaptureRect({ height: 0, width: 1280, x: 0, y: 0 }), null);
  assert.match(buildYouTubeWebviewPresentationScript(true, true), /frame-capture/);
  assert.match(buildYouTubeWebviewPresentationScript(true, true), /ytp-chrome-bottom/);
});

test("canvas capture reads the already-decoded video frame", () => {
  assert.match(YOUTUBE_WEBVIEW_CANVAS_FRAME_CAPTURE_SCRIPT, /drawImage\(video/);
  assert.match(YOUTUBE_WEBVIEW_CANVAS_FRAME_CAPTURE_SCRIPT, /toDataURL\('image\/png'\)/);
  assert.deepEqual(parseYouTubeCanvasFrame({ base64: "iVBORw0KGgo=", height: 1080, width: 1920 }), {
    base64: "iVBORw0KGgo=",
    height: 1080,
    width: 1920
  });
  assert.equal(parseYouTubeCanvasFrame({ base64: "", height: 1080, width: 1920 }), null);
});
