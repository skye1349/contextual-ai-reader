import { spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface SharedMemoryDocument {
  domain?: string;
  fingerprint?: string;
  id?: string;
  title?: string;
  type?: string;
  url?: string;
}

export interface SharedMemoryItem {
  contextAfter?: string;
  contextBefore?: string;
  id: string;
  index?: number;
  locator?: {
    domPath?: string;
    order?: number;
    timestamp?: number;
  };
  startTime?: number;
  text: string;
}

export interface SharedMemoryRequest {
  contentType: "selection" | "term-explanation" | "video-subtitles" | "webpage";
  customPrompt?: string;
  document?: SharedMemoryDocument;
  items: SharedMemoryItem[];
  memoryEnabled?: boolean;
  pageUrl?: string;
  provider: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface SharedMemoryLookup {
  metadata: Record<string, SharedMemoryMetadata>;
  misses: string[];
  stats: SharedMemoryStats;
  translations: Record<string, string>;
}

export interface SharedMemoryMetadata {
  confidence?: number;
  memoryId?: string;
  model?: string;
  provenance?: string;
  userState?: string;
  warnings?: string[];
}

export interface SharedMemoryStats {
  exactMemoryHits?: number;
  executedItems?: number;
  fuzzyMemoryHits?: number;
  requestedItems?: number;
  returnedItems?: number;
  trustedMemoryHits?: number;
  warningCount?: number;
}

export interface SharedMemoryStatus {
  databasePath?: string;
  schemaVersion?: number;
  translationRecords?: number;
  trustedRecords?: number;
}

interface SharedMemoryResponse {
  error?: string;
  metadata?: Record<string, SharedMemoryMetadata>;
  misses?: string[];
  ok?: boolean;
  stats?: SharedMemoryStats & SharedMemoryStatus;
  translations?: Record<string, string>;
}

interface SharedMemoryOptions {
  command?: string;
  enabled?: boolean;
  timeoutMs?: number;
}

const DEFAULT_COMMAND = join(
  homedir(),
  "Library",
  "CCLiveTranslator",
  "bin",
  "cclt-shared-memory"
);

export class SharedTranslationMemory {
  private command = DEFAULT_COMMAND;
  private enabled = true;
  private timeoutMs = 15_000;
  private warnedUnavailable = false;

  constructor(options: SharedMemoryOptions = {}) {
    this.configure(options);
  }

  configure(options: SharedMemoryOptions = {}) {
    this.command = options.command?.trim() || DEFAULT_COMMAND;
    this.enabled = options.enabled !== false;
    this.timeoutMs = Math.max(1_000, Number(options.timeoutMs || 15_000));
    this.warnedUnavailable = false;
  }

  get commandPath(): string {
    return this.command;
  }

  get available(): boolean {
    return this.enabled && existsSync(this.command);
  }

  async lookup(request: SharedMemoryRequest): Promise<SharedMemoryLookup | null> {
    const response = await this.request({
      operation: "lookup",
      request
    });
    if (!response) return null;
    return {
      metadata: response.metadata ?? {},
      misses: response.misses ?? request.items.map((item) => item.id),
      stats: response.stats ?? {},
      translations: response.translations ?? {}
    };
  }

  async record(input: {
    model?: string;
    provenance?: string;
    request: SharedMemoryRequest;
    translations: Record<string, string>;
  }): Promise<SharedMemoryResponse | null> {
    return await this.request({
      operation: "record",
      ...input
    });
  }

  async feedback(feedback: {
    contentType: SharedMemoryRequest["contentType"];
    correctedTranslation?: string;
    customPrompt?: string;
    document?: SharedMemoryDocument;
    feedbackType: "accepted" | "edited" | "rejected";
    item: SharedMemoryItem;
    memoryEnabled?: boolean;
    model?: string;
    pageUrl?: string;
    provider: string;
    sourceLanguage: string;
    targetLanguage: string;
    translation: string;
  }): Promise<SharedMemoryResponse | null> {
    return await this.request({
      feedback,
      operation: "feedback"
    });
  }

  async status(): Promise<SharedMemoryStatus | null> {
    const response = await this.request({ operation: "status" });
    return response?.stats ?? null;
  }

  private async request(payload: object): Promise<SharedMemoryResponse | null> {
    if (!this.enabled) return null;
    if (!existsSync(this.command)) {
      this.warnOnce(`Shared translation memory command is not installed: ${this.command}`);
      return null;
    }

    try {
      const result = await runJsonCommand(
        this.command,
        JSON.stringify(payload),
        this.timeoutMs
      );
      const response = JSON.parse(result.stdout || "{}") as SharedMemoryResponse;
      if (result.code !== 0 || response.ok === false) {
        throw new Error(response.error || result.stderr || "Shared translation memory failed.");
      }
      this.warnedUnavailable = false;
      return response;
    } catch (error) {
      this.warnOnce(`Shared translation memory unavailable: ${getErrorMessage(error)}`);
      return null;
    }
  }

  private warnOnce(message: string) {
    if (this.warnedUnavailable) return;
    this.warnedUnavailable = true;
    console.warn(message);
  }
}

function runJsonCommand(
  command: string,
  stdin: string,
  timeoutMs: number
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], {
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true
    });
    let stderr = "";
    let stdout = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`Shared translation memory timed out after ${timeoutMs} ms.`));
        return;
      }
      resolve({ code, stderr, stdout });
    });
    child.stdin.end(stdin);
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
