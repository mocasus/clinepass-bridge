import type { TokenManager } from "../auth/tokenManager.js";

export interface UpstreamResult {
  status: number;
  headers: Headers;
  /** Raw body bytes (arrayBuffer/text or the SSE stream). */
  body: Uint8Array | ReadableStream<Uint8Array> | null;
}

interface ClineClientOptions {
  baseUrl: string;
  tokenManager: TokenManager;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * Thin HTTP client for api.cline.bot that injects the WorkOS token,
 * retries once on 401/403 with a refreshed token, and supports
 * streaming (raw SSE passthrough) or buffered responses.
 */
export class ClineClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ClineClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  get baseUrl(): string {
    return this.opts.baseUrl;
  }

  async chatCompletions(
    body: string,
    opts: { stream: boolean },
  ): Promise<UpstreamResult> {
    const doFetch = async (): Promise<UpstreamResult> => {
      const token = await this.opts.tokenManager.getAccessToken();
      return this.rawRequest(token, body, opts.stream);
    };

    let result = await doFetch();
    if (result.status === 401 || result.status === 403) {
      // The stored token was rejected (e.g. session rotated) → force refresh and retry once.
      const token = await this.opts.tokenManager.getAccessToken({ forceRefresh: true });
      result = await this.rawRequest(token, body, opts.stream);
    }
    return result;
  }

  private async rawRequest(
    token: string,
    body: string,
    stream: boolean,
  ): Promise<UpstreamResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.opts.baseUrl}/api/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: stream ? "text/event-stream" : "application/json",
        },
        body,
        signal: controller.signal,
      });
      const payload = stream
        ? (res.body as ReadableStream<Uint8Array> | null)
        : new Uint8Array(await res.arrayBuffer());
      return { status: res.status, headers: res.headers, body: payload };
    } finally {
      clearTimeout(timer);
    }
  }
}
