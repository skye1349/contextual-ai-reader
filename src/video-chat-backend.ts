import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { setTimeout, clearTimeout } from "timers";
import { join } from "path";
import { compactProcessError, spawnProcess } from "./process-runner";
import type { ProcessResult } from "./process-runner";
import type { VideoChatFrame } from "./video-chat";

export interface VideoChatBackendConfig {
  backend: "codex" | "claude" | "openai" | "anthropic";
  model: string;
  command?: string;
  apiKey?: string;
  baseUrl?: string;
  reasoningEffort?: string;
  timeoutMs: number;
}
export interface ChatHttpRequest { url: string; method: string; headers: Record<string, string>; body: string; throw: boolean }
export type ChatHttp = (request: ChatHttpRequest) => Promise<{ status: number; json: unknown }>;

export function checkChatAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Video chat stopped.");
}

export async function runVideoChatProcess(command: string, args: string[], stdin: string, timeoutMs: number, signal: AbortSignal, cwd?: string): Promise<ProcessResult> {
  checkChatAbort(signal);
  const handle = spawnProcess(command, args, stdin, timeoutMs, undefined, { cwd });
  const abort = () => handle.kill();
  signal.addEventListener("abort", abort, { once: true });
  try {
    checkChatAbort(signal);
    const result = await handle.promise;
    checkChatAbort(signal);
    if (result.code !== 0) throw new Error(compactProcessError(result.stderr || result.stdout));
    return result;
  } finally { signal.removeEventListener("abort", abort); }
}

export function buildChatCodexArgs(config: VideoChatBackendConfig, directory: string, outputPath: string, imagePaths: string[]): string[] {
  return ["exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check", "--color", "never", "--json",
    ...["plugins", "tool_suggest", "multi_agent", "browser_use", "computer_use", "image_generation", "workspace_dependencies", "shell_tool"].flatMap((feature) => ["--disable", feature]),
    "-C", directory, "-s", "read-only", "-c", 'approval_policy="never"', "-c", 'web_search="disabled"',
    "-m", config.model, "-c", `model_reasoning_effort=${JSON.stringify(config.reasoningEffort || "low")}`,
    ...imagePaths.flatMap((path) => ["--image", path]), "-o", outputPath, "-"];
}

export function buildAnthropicChatContent(prompt: string, frames: VideoChatFrame[]) {
  return [...frames.map((frame) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from(frame.png).toString("base64") } })), { type: "text", text: prompt }];
}

export function buildChatApiBody(config: VideoChatBackendConfig, prompt: string, frames: VideoChatFrame[]): Record<string, unknown> {
  if (config.backend === "anthropic") return {
    model: config.model, max_tokens: 8192,
    messages: [{ role: "user", content: buildAnthropicChatContent(prompt, frames) }]
  };
  return { model: config.model, messages: [{ role: "user", content: [
    { type: "text", text: prompt },
    ...frames.map((frame) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(frame.png).toString("base64")}`, detail: "auto" } }))
  ] }] };
}

export function parseChatApiAnswer(backend: string, value: unknown): string {
  const data = value as { error?: { message?: string }; content?: Array<{ type?: string; text?: string }>; choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
  if (data?.error) throw new Error(data.error.message || "The AI service returned an error.");
  const content = backend === "anthropic" ? data?.content : data?.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((block) => block.text || "").join("\n") : "";
  if (!text.trim()) throw new Error("The AI returned an empty answer. Check the selected model and image support.");
  return text.trim();
}

// Obsidian's requestUrl has no transport cancellation. Reject promptly and ignore late API replies.
function abortableHttp(request: Promise<{ status: number; json: unknown }>, signal: AbortSignal, timeoutMs: number): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new Error("Video chat stopped.")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Video chat timed out.")); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    signal.addEventListener("abort", abort, { once: true });
    request.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error instanceof Error ? error : new Error(String(error))); });
    if (signal.aborted) abort();
  });
}

export async function runVideoChatAI(config: VideoChatBackendConfig, prompt: string, frames: VideoChatFrame[], signal: AbortSignal, http: ChatHttp): Promise<string> {
  checkChatAbort(signal);
  if (frames.some((frame) => frame.png.byteLength > 7_000_000)) throw new Error("A video frame is too large. Use subtitles only or a smaller video frame.");
  if (config.backend === "codex" || config.backend === "claude") {
    const directory = await mkdtemp(join(tmpdir(), "obsidian-video-chat-"));
    try {
      if (config.backend === "codex") {
        const paths: string[] = [];
        for (const [index, frame] of frames.entries()) {
          const path = join(directory, `frame-${index + 1}.png`);
          await writeFile(path, frame.png, { mode: 0o600 }); paths.push(path);
        }
        const output = join(directory, "answer.txt");
        await runVideoChatProcess(config.command || "codex", buildChatCodexArgs(config, directory, output, paths), prompt, config.timeoutMs, signal);
        const text = (await readFile(output, "utf8")).trim();
        if (!text) throw new Error("Codex returned an empty video chat answer.");
        return text;
      }
      // Stream-JSON user messages accept the same text/image blocks as the Messages API.
      const stdin = JSON.stringify({ type: "user", message: { role: "user", content: buildAnthropicChatContent(prompt, frames) } }) + "\n";
      const result = await runVideoChatProcess(config.command || "claude", ["--print", "--no-session-persistence", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--setting-sources", "", "--model", config.model, "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'], stdin, config.timeoutMs, signal, directory);
      const events = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line) as { type?: string; result?: string; is_error?: boolean });
      const data = events.reverse().find((event) => event.type === "result");
      if (data?.is_error || !data?.result?.trim()) throw new Error(data?.result || "Claude Code returned an empty answer.");
      return data.result.trim();
    } finally { await rm(directory, { force: true, recursive: true }); }
  }
  if (!config.apiKey?.trim()) throw new Error(`${config.backend === "openai" ? "OpenAI" : "Anthropic"} API key is not configured.`);
  const anthropic = config.backend === "anthropic";
  const base = (config.baseUrl || (anthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1")).replace(/\/+$/, "");
  const response = await abortableHttp(http({
    url: `${base}/${anthropic ? "messages" : "chat/completions"}`, method: "POST", throw: false,
    headers: anthropic ? { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" }
      : { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(buildChatApiBody(config, prompt, frames))
  }), signal, config.timeoutMs);
  checkChatAbort(signal);
  if (response.status < 200 || response.status >= 300) {
    const error = response.json as { error?: { message?: string } };
    throw new Error(error?.error?.message || `Video chat API returned HTTP ${response.status}.`);
  }
  return parseChatApiAnswer(config.backend, response.json);
}
