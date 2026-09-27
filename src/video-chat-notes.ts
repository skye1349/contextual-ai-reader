import { createHash } from "crypto";
import type { VideoChatMessage } from "./video-chat";

export function chatMessageId(message: VideoChatMessage): string {
  return message.id || createHash("sha256").update(JSON.stringify([message.role, message.createdAt, message.time, message.text])).digest("hex");
}

export function chatNotePath(folder: string, filename: string, title: string): string {
  const safeTitle = title.replace(/[\\/:*?"<>|\r\n]/g, " ").trim().slice(0, 120) || "Video";
  const name = (filename.trim() || "{video} AI Chat.md").replaceAll("{video}", safeTitle);
  const parts = [...folder.trim().replace(/\\/g, "/").split("/"), ...name.replace(/\\/g, "/").split("/")].filter(Boolean);
  if (parts.some((part) => part === "." || part === ".." || part.startsWith(".") || /[:*?"<>|\r\n]/.test(part))) {
    throw new Error("Choose a Markdown note inside your vault, outside hidden folders.");
  }
  const path = parts.join("/");
  if (!path) throw new Error("Choose a note filename.");
  return /\.md$/i.test(path) ? path : `${path}.md`;
}

/** Markers live beside the saved content so retries and plugin reloads cannot duplicate it. */
export function appendChatMessages(existing: string, sourceKey: string, messages: VideoChatMessage[], header: string, render: (message: VideoChatMessage) => string): { text: string; count: number } {
  let text = existing;
  let count = 0;
  const source = createHash("sha256").update(sourceKey).digest("hex");
  const legacyMarker = `<!-- video-chat-legacy:${source} -->`;
  const legacy = existing.includes(legacyMarker) || (!existing.includes("<!-- video-chat:") && existing.startsWith(`${header}\n`));
  if (legacy && !existing.includes(legacyMarker)) text += `\n${legacyMarker}\n`;
  for (const message of messages) {
    const id = createHash("sha256").update(chatMessageId(message)).digest("hex");
    const marker = `<!-- video-chat:${source}:${id} -->`;
    if (text.includes(marker)) continue;
    // Recognize exact blocks from the old exporter without replacing any user edits.
    if (legacy && !message.id && existing.includes(`${render(message)}\n`)) {
      text += `\n${marker}\n`;
      continue;
    }
    if (!count) text += `${text && !text.endsWith("\n") ? "\n" : ""}\n${header}\n\n`;
    text += `${render(message)}\n${marker}\n\n`;
    count++;
  }
  return { text, count };
}
