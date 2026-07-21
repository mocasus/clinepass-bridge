import type { ClineClient, UpstreamResult } from "../cline/client.js";
import { resolveModel } from "./models.js";

export interface ChatProxyDeps {
  client: ClineClient;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function openAiError(
  message: string,
  opts: { type?: string; code?: string | null } = {},
): Record<string, unknown> {
  return {
    error: {
      message,
      type: opts.type ?? "invalid_request_error",
      param: null,
      code: opts.code ?? null,
    },
  };
}

/**
 * api.cline.bot wraps non-streaming responses in a { success, data } envelope
 * and puts errors in { error: string | {...} }. Streaming is plain OpenAI SSE.
 */
export function normalizeUpstreamResponse(result: UpstreamResult): {
  status: number;
  payload: unknown;
} {
  let text: string;
  try {
    text = new TextDecoder().decode(result.body as Uint8Array);
  } catch {
    return {
      status: 502,
      payload: openAiError("Failed to read upstream response", { type: "server_error" }),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  if (result.status >= 400) {
    let message = `Cline API error (HTTP ${result.status})`;
    if (isRecord(parsed)) {
      const err = parsed.error;
      if (typeof err === "string") message = err;
      else if (isRecord(err) && typeof err.message === "string") message = err.message;
      else if (typeof parsed.message === "string") message = parsed.message;
    }
    return {
      status: result.status,
      payload: openAiError(message, {
        type: result.status === 401 || result.status === 403 ? "authentication_error" : "server_error",
      }),
    };
  }

  // success envelope: { success: true, data: <openai completion> }
  if (isRecord(parsed) && "data" in parsed && parsed.data !== undefined) {
    return { status: result.status, payload: parsed.data };
  }
  if (parsed !== undefined) {
    return { status: result.status, payload: parsed };
  }
  return {
    status: 502,
    payload: openAiError("Upstream returned a non-JSON response", { type: "server_error" }),
  };
}

export function createChatHandler(deps: ChatProxyDeps) {
  return async function chatCompletionsHandler(rawBody: string): Promise<{
    kind: "json";
    status: number;
    payload: unknown;
  } | {
    kind: "stream";
    status: number;
    headers: Record<string, string>;
    body: ReadableStream<Uint8Array>;
  }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody || "null");
    } catch {
      return {
        kind: "json",
        status: 400,
        payload: openAiError("Request body must be valid JSON"),
      };
    }
    if (!isRecord(parsed)) {
      return { kind: "json", status: 400, payload: openAiError("Request body must be a JSON object") };
    }

    if (typeof parsed.model !== "string" || parsed.model.trim() === "") {
      return { kind: "json", status: 400, payload: openAiError("missing model field in request") };
    }
    if (!Array.isArray(parsed.messages)) {
      return {
        kind: "json",
        status: 400,
        payload: openAiError("messages must be an array of messages"),
      };
    }

    const stream = parsed.stream === true;
    const upstreamBody = JSON.stringify({ ...parsed, model: resolveModel(parsed.model) });

    let result: UpstreamResult;
    try {
      result = await deps.client.chatCompletions(upstreamBody, { stream });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return {
        kind: "json",
        status: aborted ? 504 : 502,
        payload: openAiError(
          aborted ? "Upstream request timed out" : "Failed to reach the Cline API",
          { type: "server_error" },
        ),
      };
    }

    if (stream) {
      if (result.status >= 400) {
        const normalized = normalizeUpstreamResponse(result);
        return { kind: "json", status: normalized.status, payload: normalized.payload };
      }
      if (!(result.body instanceof ReadableStream)) {
        return {
          kind: "json",
          status: 502,
          payload: openAiError("Upstream returned no stream", { type: "server_error" }),
        };
      }
      const headers: Record<string, string> = {};
      result.headers.forEach((value, key) => {
        const k = key.toLowerCase();
        if (["content-length", "content-encoding", "transfer-encoding", "connection"].includes(k)) {
          return;
        }
        headers[k] = value;
      });
      headers["content-type"] = "text/event-stream";
      headers["cache-control"] = "no-cache";
      headers["connection"] = "keep-alive";
      return { kind: "stream", status: result.status, headers, body: result.body };
    }

    const normalized = normalizeUpstreamResponse(result);
    return { kind: "json", status: normalized.status, payload: normalized.payload };
  };
}
