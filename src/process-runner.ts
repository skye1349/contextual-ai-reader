import { spawn } from "child_process";
import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { delimiter, join } from "path";
import { clearTimeout, setTimeout } from "timers";

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ProcessHandle {
  kill: () => void;
  promise: Promise<ProcessResult>;
}

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const CODEX_CANDIDATES = buildCodexCandidates();
const CODEX_PATH_ENTRIES = buildPathEntries();
const CLAUDE_CANDIDATES = buildClaudeCandidates();
const YT_DLP_CANDIDATES = buildYtDlpCandidates();
const FFMPEG_CANDIDATES = buildFfmpegCandidates();

export function resolveYtDlpCommand(configuredCommand: string): string {
  if (configuredCommand.trim()) return configuredCommand.trim();
  return YT_DLP_CANDIDATES.find((candidate) => candidate === "yt-dlp" || existsSync(candidate)) ?? "yt-dlp";
}

export function resolveFfmpegCommand(configuredCommand: string): string {
  if (configuredCommand.trim()) return configuredCommand.trim();
  return FFMPEG_CANDIDATES.find((candidate) => candidate === "ffmpeg" || existsSync(candidate)) ?? "ffmpeg";
}

export function resolveCodexCommand(configuredCommand: string): string {
  if (configuredCommand) return configuredCommand;
  return CODEX_CANDIDATES.find((candidate) => candidate === "codex" || existsSync(candidate)) ?? "codex";
}

export function hasCodexCommand(configuredCommand: string): boolean {
  if (configuredCommand) return existsSync(configuredCommand) || configuredCommand === "codex";
  return CODEX_CANDIDATES.some((candidate) => candidate !== "codex" && existsSync(candidate));
}

export function resolveClaudeCommand(configuredCommand: string): string {
  if (configuredCommand) return configuredCommand;
  return CLAUDE_CANDIDATES.find((candidate) => candidate === "claude" || existsSync(candidate)) ?? "claude";
}

export function hasClaudeCommand(configuredCommand: string): boolean {
  if (configuredCommand) return existsSync(configuredCommand) || configuredCommand === "claude";
  return CLAUDE_CANDIDATES.some((candidate) => candidate !== "claude" && existsSync(candidate));
}

export function spawnProcess(
  command: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
  onProgress?: (line: string) => void,
  options?: { cwd?: string }
): ProcessHandle {
  let killProcess: () => void = () => {};

  const promise = new Promise<ProcessResult>((resolve, reject) => {
    const useShell = process.platform === "win32" && (
      /\.(?:cmd|bat)$/i.test(command)
      || (!/[\\/]/.test(command) && /^(?:codex|claude)$/i.test(command))
    );
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: buildCodexEnv(),
      shell: useShell,
      windowsHide: true
    });

    killProcess = () => {
      child.kill("SIGTERM");
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already dead */ }
      }, 1000);
    };

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killed = false;
    let lastProgressLine = "";

    const fireProgress = (chunk: string) => {
      if (!onProgress) return;
      for (const line of chunk.split(/\r?\n/)) {
        const trimmed = line.replace(ANSI_ESCAPE_PATTERN, "").trim();
        if (trimmed && trimmed !== lastProgressLine) {
          lastProgressLine = trimmed;
          onProgress(trimmed);
        }
      }
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      fireProgress(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      fireProgress(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`Process timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
        return;
      }
      if (signal === "SIGTERM" || signal === "SIGKILL" || killed) {
        reject(new Error("Translation stopped."));
        return;
      }
      resolve({ code, stdout, stderr });
    });

    child.stdin.end(stdin);
    const originalKill = killProcess;
    killProcess = () => {
      killed = true;
      originalKill();
    };
  });

  return { promise, kill: () => killProcess() };
}

export function compactProcessError(output: string): string {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(-4).join(" ") || "Unknown Codex error.";
}

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function getAppDataDir(): string {
  return process.env.APPDATA || join(getHomeDir(), "AppData", "Roaming");
}

function buildCodexCandidates(): string[] {
  const homeDir = getHomeDir();
  const appDataDir = getAppDataDir();
  return process.platform === "win32"
    ? [
      join(appDataDir, "npm", "codex.cmd"),
      join(homeDir, "AppData", "Local", "Programs", "Codex", "codex.exe"),
      "codex.cmd",
      "codex.exe",
      "codex"
    ]
    : [
      "/Applications/Codex.app/Contents/Resources/codex",
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
      "codex"
    ];
}

function buildPathEntries(): string[] {
  const homeDir = getHomeDir();
  const appDataDir = getAppDataDir();
  return process.platform === "win32"
    ? [
      join(appDataDir, "npm"),
      join(homeDir, "AppData", "Local", "Programs", "Codex"),
      join(homeDir, ".codex", "bin")
    ]
    : [
      "/Applications/Codex.app/Contents/Resources",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin"
    ];
}

function buildClaudeCandidates(): string[] {
  const homeDir = getHomeDir();
  const appDataDir = getAppDataDir();
  const candidates = process.platform === "win32"
    ? [
      join(appDataDir, "npm", "claude.cmd"),
      join(homeDir, ".claude", "local", "claude.cmd"),
      join(homeDir, ".claude", "local", "claude.exe")
    ]
    : [
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      `${homeDir}/.claude/local/claude`
    ];

  if (process.platform === "darwin") {
    const claudeCodeBase = `${homeDir}/Library/Application Support/Claude/claude-code`;
    try {
      for (const version of readdirSync(claudeCodeBase).sort().reverse()) {
        candidates.push(`${claudeCodeBase}/${version}/claude.app/Contents/MacOS/claude`);
      }
    } catch {
      // Optional Claude installation is absent.
    }
  }

  candidates.push(process.platform === "win32" ? "claude.cmd" : "claude", "claude");
  return candidates;
}

function buildYtDlpCandidates(): string[] {
  const homeDir = getHomeDir();
  const appDataDir = getAppDataDir();
  return process.platform === "win32"
    ? [
      join(appDataDir, "Python", "Scripts", "yt-dlp.exe"),
      join(homeDir, "scoop", "shims", "yt-dlp.exe"),
      "yt-dlp.exe",
      "yt-dlp"
    ]
    : ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", `${homeDir}/.local/bin/yt-dlp`, "yt-dlp"];
}

function buildFfmpegCandidates(): string[] {
  const homeDir = getHomeDir();
  return process.platform === "win32"
    ? [join(homeDir, "scoop", "shims", "ffmpeg.exe"), "ffmpeg.exe", "ffmpeg"]
    : ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg", "ffmpeg"];
}

function buildCodexEnv(): NodeJS.ProcessEnv {
  const existingPath = process.env.PATH ?? "";
  const mergedPath = [...CODEX_PATH_ENTRIES, ...existingPath.split(delimiter).filter(Boolean)]
    .filter((entry, index, entries) => entries.indexOf(entry) === index)
    .join(delimiter);

  return {
    ...process.env,
    CODEX_HOME: process.env.CODEX_HOME || join(homedir(), ".codex"),
    HOME: process.env.HOME || homedir(),
    PATH: mergedPath
  };
}
