import assert from "node:assert/strict";
import test from "node:test";
import {
  YOUTUBE_FRAME_FORMAT,
  buildYouTubeFrameFfmpegArgs
} from "../../src/youtube-frame";

test("YouTube frame capture requests a video-only stream before muxed fallbacks", () => {
  assert.equal(
    YOUTUBE_FRAME_FORMAT,
    "bestvideo[height<=1080]/best[height<=1080]/bestvideo/best"
  );
});

test("YouTube frame capture maps only video and disables caption-bearing streams", () => {
  const args = buildYouTubeFrameFfmpegArgs(
    "https://video.example/stream",
    69.25,
    "/tmp/frame.png"
  );

  assert.deepEqual(args.slice(args.indexOf("-map"), args.indexOf("-frames:v")), [
    "-map",
    "0:v:0",
    "-an",
    "-sn",
    "-dn"
  ]);
  assert.deepEqual(args.slice(args.indexOf("-frames:v"), args.indexOf("-vf")), [
    "-frames:v",
    "1"
  ]);
  assert.equal(args.at(-1), "/tmp/frame.png");
});
