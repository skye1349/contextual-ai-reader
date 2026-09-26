import { createHash } from "crypto";
import { readFile, readdir, realpath, stat } from "fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { YouTubeSegment } from "./youtube";
import type { ProcessResult } from "./process-runner";

export interface LocalCaptionTrack {
  id: string;
  label: string;
  language?: string;
  path?: string;
  streamIndex?: number;
  default?: boolean;
}

export interface LocalVideoSource {
  path: string;
  url: string;
  id: string;
  title: string;
  tracks: LocalCaptionTrack[];
  warning?: string;
}

type RunMedia = (command: string, args: string[], timeout: number) => Promise<ProcessResult>;
const TEXT_CODECS = new Set(["subrip", "srt", "webvtt", "ass", "ssa", "mov_text", "text", "microdvd", "subviewer"]);

export async function normalizeLocalVideoPath(input: string): Promise<string> {
  const value = input.trim().replace(/^"(.*)"$/, "$1");
  const path = value.startsWith("file:") ? fileURLToPath(value) : value;
  if (!isAbsolute(path)) throw new Error("Choose a local video or enter its absolute file path.");
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isFile()) throw new Error("The selected path is not a video file.");
  if (!/\.(mp4|m4v|mov|webm|mkv|avi|ogv|ogg|mpeg|mpg|ts|m2ts)$/i.test(canonical)) {
    throw new Error("Choose a video file (MP4, WebM, MOV, MKV, AVI, OGV, MPEG or TS).");
  }
  return canonical;
}

export function parseLocalCaptions(input: string): YouTubeSegment[] {
  const segments: YouTubeSegment[] = [];
  const time = (value: string) => value.replace(",", ".").split(":").reduce((total, part) => total * 60 + Number(part), 0);
  for (const block of input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = block.split("\n");
    if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) continue;
    const index = lines.findIndex((line) => line.includes("-->"));
    if (index < 0) continue;
    const match = lines[index].match(/((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/);
    if (!match) continue;
    const start = time(match[1]);
    const end = time(match[2]);
    const text = lines.slice(index + 1).join("\n")
      .replace(/<[^>]*>/g, "").replace(/\{\\[^}]*\}/g, "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").trim();
    if (text && Number.isFinite(start) && end > start) segments.push({ start, duration: end - start, text });
  }
  return segments.sort((a, b) => a.start - b.start);
}

export async function inspectLocalVideo(path: string, ffmpeg: string, run: RunMedia): Promise<LocalVideoSource> {
  const info = await stat(path);
  const source: LocalVideoSource = {
    path, url: pathToFileURL(path).href, title: basename(path, extname(path)), tracks: [],
    id: `local:${createHash("sha256").update(`${path}\0${info.size}\0${info.mtimeMs}`).digest("hex")}`
  };
  const stem = basename(path, extname(path));
  for (const name of (await readdir(dirname(path))).sort()) {
    if (!/\.(srt|vtt|ass|ssa)$/i.test(name)) continue;
    const subtitleStem = basename(name, extname(name));
    if (subtitleStem !== stem && !subtitleStem.startsWith(`${stem}.`)) continue;
    const subtitlePath = join(dirname(path), name);
    const language = subtitleStem.slice(stem.length + 1).split(".")[0] || undefined;
    source.tracks.push({ id: `file:${name}`, label: name, language, path: subtitlePath });
  }
  try {
    const ffprobe = /ffmpeg(?:\.exe)?$/i.test(ffmpeg) ? ffmpeg.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1") : "ffprobe";
    const result = await run(ffprobe, ["-v", "error", "-show_streams", "-of", "json", path], 30_000);
    const metadata = JSON.parse(result.stdout) as { streams?: Array<{
      index: number; codec_type?: string; codec_name?: string;
      tags?: { language?: string; title?: string }; disposition?: { default?: number };
    }> };
    const subtitles = (metadata.streams ?? []).filter((stream) => stream.codec_type === "subtitle");
    for (const stream of subtitles) {
      if (!TEXT_CODECS.has(stream.codec_name ?? "")) continue;
      source.tracks.push({
        id: `stream:${stream.index}`, streamIndex: stream.index, language: stream.tags?.language,
        default: Boolean(stream.disposition?.default),
        label: `Embedded: ${stream.tags?.title || stream.tags?.language || `track ${stream.index}`} (${stream.codec_name})`
      });
    }
    if (subtitles.some((stream) => !TEXT_CODECS.has(stream.codec_name ?? ""))) {
      source.warning = "Image-based subtitle tracks cannot be extracted as text. Add an SRT/VTT subtitle file or use speech-to-text.";
    }
  } catch (error) {
    source.warning = `Embedded subtitle detection unavailable. Install ffmpeg and ffprobe, or use a matching SRT/VTT file. ${error instanceof Error ? error.message : String(error)}`;
  }
  return source;
}

export function chooseLocalCaptionTrack(tracks: LocalCaptionTrack[], language: string): LocalCaptionTrack | undefined {
  const aliases: Record<string, string> = { eng: "en", zho: "zh", chi: "zh", jpn: "ja", kor: "ko", fra: "fr", fre: "fr", deu: "de", ger: "de", spa: "es" };
  const base = (value: string) => aliases[value.toLowerCase()] ?? value.toLowerCase().split("-")[0];
  return (language !== "auto" ? tracks.find((track) => track.language && base(track.language) === base(language)) : undefined)
    ?? tracks.find((track) => track.default) ?? tracks[0];
}

export async function readLocalCaptionTrack(path: string, track: LocalCaptionTrack, ffmpeg: string, run: RunMedia): Promise<YouTubeSegment[]> {
  let text: string;
  if (track.path && /\.(srt|vtt)$/i.test(track.path)) {
    const bytes = await readFile(track.path);
    text = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.toString("utf16le") : bytes.toString("utf8");
  } else {
    const result = await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", track.path ?? path,
      "-map", track.path ? "0:s:0" : `0:${track.streamIndex}`, "-f", "webvtt", "pipe:1"], 120_000);
    text = result.stdout;
  }
  const segments = parseLocalCaptions(text);
  if (!segments.length) throw new Error("The selected subtitle track has no readable timed text.");
  return segments;
}

export function localVideoTimestampUri(path: string, seconds: number): string {
  return `obsidian://contextual-ai-reader-local-video?path=${encodeURIComponent(path)}&t=${Math.max(0, Number.isFinite(seconds) ? seconds : 0)}`;
}

export function localVideoResourceUrl(path: string, vaultResourceUrl: string): string {
  const resource = new URL(vaultResourceUrl);
  const fileUrl = pathToFileURL(path).href;
  const encodedPath = fileUrl.startsWith("file:///") ? fileUrl.slice(8) : `%5C%5C${fileUrl.slice(7)}`;
  return `${resource.protocol}//${resource.host}/${encodedPath}`;
}
