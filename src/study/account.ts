import { createHash } from "node:crypto";

/** Stable local key. The token itself is never stored. */
export function accountKey(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}
