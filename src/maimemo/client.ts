import { MaimemoError, sanitize } from "./errors.js";

const BASE_URL = "https://open.maimemo.com/open/";
const TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 1000;

export async function apiRequest(token: string, path: string, body: unknown): Promise<unknown> {
  const url = new URL(path.replace(/^\//, ""), BASE_URL);
  let allowedRetry = true;

  while (true) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.status === 401) {
        throw new MaimemoError("auth", "认证失败，请检查 API Token");
      }
      if (response.status === 429 && allowedRetry) {
        allowedRetry = false;
        await delay(RETRY_DELAY_MS);
        continue;
      }
      if (response.status === 429) {
        throw new MaimemoError("rate_limit", "请求过于频繁，请稍后再试");
      }
      if (response.status === 404) {
        throw new MaimemoError("not_found", "资源不存在");
      }

      const text = await response.text();
      let json: unknown = null;
      if (text) {
        try {
          json = JSON.parse(text) as unknown;
        } catch {
          throw new MaimemoError("invalid", sanitize("墨墨返回的数据无法识别", token));
        }
      }

      if (!response.ok) {
        throw new MaimemoError("http", `请求失败（HTTP ${response.status}）`);
      }
      return json;
    } catch (error) {
      if (error instanceof MaimemoError) throw error;
      if (isTimeout(error)) throw new MaimemoError("timeout", "请求超时");
      throw new MaimemoError("network", "网络连接失败");
    }
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
