import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type PlayResult =
  | { kind: "ok" }
  | { kind: "missing-player" }
  | { kind: "failed"; code: number | null };

export type AudioFailure = "请求失败" | "没有读音" | "文件无效";

type PlayerAttempt = {
  command: string;
  args: string[];
};

type PlayerChild = {
  exitCode: number | null;
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal: NodeJS.Signals): unknown;
};

type SpawnPlayer = (attempt: PlayerAttempt) => PlayerChild;

const stopped = new WeakSet<object>();
let playing: PlayerChild | null = null;

function playerAttempts(platform: NodeJS.Platform, file: string): PlayerAttempt[] {
  if (platform === "darwin") return [{ command: "afplay", args: [file] }];
  return [
    { command: "ffplay", args: ["-nodisp", "-autoexit", "-loglevel", "error", file] },
    { command: "mpv", args: ["--no-video", "--really-quiet", file] },
  ];
}

export function playAudio(path: string, done: (result: PlayResult) => void): void {
  stopAudio();
  runPlayer(playerAttempts(process.platform, path), (attempt) => {
    return spawn(attempt.command, attempt.args, { stdio: "ignore" }) as PlayerChild;
  }, done);
}

function runPlayer(attempts: PlayerAttempt[], spawnPlayer: SpawnPlayer, done: (result: PlayResult) => void): void {
  const tryAt = (index: number) => {
    const attempt = attempts[index];
    if (!attempt) {
      done({ kind: "missing-player" });
      return;
    }
    const child = spawnPlayer(attempt);
    playing = child;
    let reported = false;
    const finish = (result: PlayResult) => {
      if (reported || stopped.has(child)) return;
      reported = true;
      if (playing === child) playing = null;
      done(result);
    };
    child.on("error", (error) => {
      if (playing === child) playing = null;
      if (reported || stopped.has(child)) return;
      reported = true;
      if (error.code === "ENOENT") {
        tryAt(index + 1);
        return;
      }
      done({ kind: "failed", code: null });
    });
    child.on("exit", (code) => {
      finish(code === 0 ? { kind: "ok" } : { kind: "failed", code });
    });
  };
  tryAt(0);
}

export function stopAudio(): void {
  const child = playing;
  playing = null;
  if (child && child.exitCode === null) {
    stopped.add(child);
    child.kill("SIGTERM");
  }
}

export class DownloadFailed extends Error {
  readonly reason: AudioFailure;

  constructor(readonly permanent: boolean, reason?: AudioFailure) {
    super("audio");
    this.name = "DownloadFailed";
    this.reason = reason ?? (permanent ? "没有读音" : "请求失败");
  }
}

export function audioKind(bytes: Buffer): "mp3" | "wav" | "" {
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE") return "wav";
  if (bytes.length >= 3 && bytes.toString("ascii", 0, 3) === "ID3") return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3";
  return "";
}

export function isPlayableAudioFile(path: string): boolean {
  if (!existsSync(path)) return false;
  let bytes: Buffer;
  try {
    bytes = readFileSync(path).subarray(0, 16);
  } catch {
    return false;
  }
  const kind = audioKind(bytes);
  return (kind === "mp3" && path.endsWith(".mp3")) || (kind === "wav" && path.endsWith(".wav"));
}

export async function fetchAudioBytes(url: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new DownloadFailed(false);
  }
  if (response.status === 404) throw new DownloadFailed(true);
  if (!response.ok) throw new DownloadFailed(false);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 32) throw new DownloadFailed(true);
  const kind = audioKind(bytes);
  if (!kind) throw new DownloadFailed(false, "文件无效");
  return bytes;
}

export function writeAudioFile(destination: string, bytes: Buffer): void {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}

export function youdaoAudioUrl(spelling: string): string {
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(spelling)}&type=2`;
}
