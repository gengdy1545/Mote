import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

let playing: ChildProcess | null = null;

export function playAudio(path: string): void {
  stopAudio();
  playing = spawn("afplay", [path], { stdio: "ignore" });
  const child = playing;
  child.on("exit", () => {
    if (playing === child) playing = null;
  });
}

export function stopAudio(): void {
  if (playing && playing.exitCode === null) playing.kill("SIGTERM");
  playing = null;
}

export class DownloadFailed extends Error {
  constructor(readonly permanent: boolean) {
    super("audio");
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

export async function fetchAudioBytes(fetchImpl: typeof fetch, url: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new DownloadFailed(false);
  }
  if (response.status === 404) throw new DownloadFailed(true);
  if (!response.ok) throw new DownloadFailed(false);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 32) throw new DownloadFailed(true);
  const kind = audioKind(bytes);
  if (!kind) throw new DownloadFailed(false);
  return bytes;
}

export function writeAudioFile(destination: string, bytes: Buffer): void {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}

export function youdaoAudioUrl(spelling: string): string {
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(spelling)}&type=2`;
}
