export const YOUTUBE_FRAME_FORMAT =
  "bestvideo[height<=1080]/best[height<=1080]/bestvideo/best";

export function buildYouTubeFrameFfmpegArgs(
  streamUrl: string,
  seconds: number,
  outputPath: string
): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(Math.max(0, seconds)),
    "-i",
    streamUrl,
    "-map",
    "0:v:0",
    "-an",
    "-sn",
    "-dn",
    "-frames:v",
    "1",
    "-vf",
    "scale='min(1920,iw)':-2",
    "-y",
    outputPath
  ];
}
