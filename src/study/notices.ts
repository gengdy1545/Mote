export const GLOSS_DOWNLOAD_ERROR = "释义没有下载下来。请检查网络。";
export const AUDIO_DOWNLOAD_ERROR = "读音没有下载下来。请检查网络。";
export const PLAY_FAILED_ERROR = "无法播放。";
export const PLAY_MISSING_ERROR = "无法播放。请安装 ffmpeg 或 mpv。";

export type PlayFailure = "missing" | "failed" | null;

export function practiceNotices(input: {
  gloss: boolean;
  audio: boolean;
  play: PlayFailure;
  platform: NodeJS.Platform;
}): string[] {
  const lines: string[] = [];
  if (input.gloss) lines.push(GLOSS_DOWNLOAD_ERROR);
  if (input.audio) lines.push(AUDIO_DOWNLOAD_ERROR);
  if (input.play === "missing" && input.platform === "linux") lines.push(PLAY_MISSING_ERROR);
  else if (input.play) lines.push(PLAY_FAILED_ERROR);
  return lines;
}
