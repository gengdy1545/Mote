export type MaimemoErrorKind =
  | "auth"
  | "missing_token"
  | "rate_limit"
  | "timeout"
  | "network"
  | "http"
  | "api"
  | "invalid"
  | "not_found";

export class MaimemoError extends Error {
  readonly kind: MaimemoErrorKind;

  constructor(kind: MaimemoErrorKind, message: string) {
    super(message);
    this.name = "MaimemoError";
    this.kind = kind;
  }
}

export function requireInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new MaimemoError("invalid", "需要交互式终端。");
  }
}

export function sanitize(message: string, token: string | undefined): string {
  if (!token || token.length === 0 || !message.includes(token)) return message;
  return message.split(token).join("[已隐藏]");
}
