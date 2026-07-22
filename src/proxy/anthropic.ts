import type { ClineClient, UpstreamResult } from "../cline/client.js";
import { resolveModel } from "./models.js";

export interface AnthropicProxyDeps {
  client: ClineClient;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  source?: Record<string, unknown>;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Anthropic-style error envelope: { type: "error", error: { type, message } } */
export function anthropicError(
  message: string,
  opts: { type?: string } = {},
): Record<string, unknown> {
  return {
    type: "error",
    error: {
      type: opts.type ?? "invalid_request_error",
      message,
    },
  };
}

function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (isRecord(b) && typeof b.text === "string" ? b.text : ""))
      .join("");
  }
  return "";
}

function convertUserBlock(b: Record<string, unknown>): unknown {
  if (b.type === "text") return { type: "text", text: b.text ?? "" };
  if (b.type === "image" && isRecord(b.source)) {
    const src = b.source;
    if (src.type === "base64" && typeof src.data === "string") {
      return {
        type: "image_url",
        image_url: { url: `data:${src.media_type};base64,${src.data}` },
      };
    }
    if (src.type === "url" && typeof src.url === "string") {
      return { type: "image_url", image_url: { url: src.url } };
    }
  }
  return { type: "text", text: typeof b.text === "string" ? b.text : "" };
}

function convertAssistantBlock(b: Record<string, unknown>): unknown {
  if (b.type === "text") return { type: "text", text: b.text ?? "" };
  return { type: "text", text: "" };
}

export function mapFinishReason(f: string): string {
  switch (f) {
    case "stop":
      return "end_turn";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    default:
      return "end_turn";
  }
}


// ===========================================================================
// Anthropic Messages API  →  OpenAI Chat Completion translation
// ===========================================================================

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicContentBlock[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: unknown;
}

/** Convert an Anthropic `system` field to a plain OpenAI system-message string. */
export function systemToOpenAi(
  system?: string | AnthropicContentBlock[],
): string | undefined {
  if (system === undefined || system === null) return undefined;
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((b) => (isRecord(b) && typeof b.text === "string" ? b.text : ""))
      .join("");
  }
  return undefined;
}

/** Convert Anthropic Messages `messages` to OpenAI Chat Completion `messages`. */
export function anthropicMessagesToOpenAi(
  messages: AnthropicMessage[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        out.push({ role: "user", content: msg.content });
        continue;
      }
      if (Array.isArray(msg.content)) {
        const toolResults: Record<string, unknown>[] = [];
        const parts: unknown[] = [];
        for (const block of msg.content) {
          if (isRecord(block) && block.type === "tool_result") {
            toolResults.push({
              role: "tool",
              tool_call_id:
                typeof block.tool_use_id === "string" ? block.tool_use_id : "",
              content: contentToString(block.content),
            });
          } else if (isRecord(block)) {
            parts.push(convertUserBlock(block));
          }
        }
        if (toolResults.length > 0) out.push(...toolResults);
        if (parts.length > 0) {
          const single =
            parts.length === 1 &&
            isRecord(parts[0]) &&
            (parts[0] as Record<string, unknown>).type === "text";
          out.push({
            role: "user",
            content: single
              ? (parts[0] as Record<string, unknown>).text
              : parts,
          });
        }
      }
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        out.push({ role: "assistant", content: msg.content });
        continue;
      }
      if (Array.isArray(msg.content)) {
        const text = msg.content
          .filter((b) => isRecord(b) && b.type === "text")
          .map((b) => (isRecord(b) && typeof b.text === "string" ? b.text : ""))
          .join("");
        const toolUses = msg.content.filter(
          (b) => isRecord(b) && b.type === "tool_use",
        );
        const entry: Record<string, unknown> = { role: "assistant" };
        entry.content = text || null;
        if (toolUses.length > 0) {
          entry.tool_calls = toolUses.map((b, i) => {
            const blk = b as unknown as Record<string, unknown>;
            return {
              id: typeof blk.id === "string" ? blk.id : `call_${i}`,
              type: "function",
              function: {
                name: typeof blk.name === "string" ? blk.name : "",
                arguments: JSON.stringify(isRecord(blk.input) ? blk.input : {}),
              },
            };
          });
        }
        out.push(entry);
      }
    } else {
      out.push({ role: msg.role, content: contentToString(msg.content) });
    }
  }
  return out;
}

/** Convert Anthropic `tools` (input_schema) to OpenAI `tools` (function/parameters). */
export function anthropicToolsToOpenAi(
  tools?: AnthropicTool[],
): Record<string, unknown>[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      parameters: t.input_schema ?? { type: "object", properties: {} },
    },
  }));
}

/** Convert an Anthropic `tool_choice` object to the OpenAI equivalent. */
export function anthropicToolChoiceToOpenAi(toolChoice?: unknown): unknown {
  if (!isRecord(toolChoice)) return undefined;
  switch (toolChoice.type) {
    case "auto":
      return "auto";
    case "any":
      return "required";
    case "none":
      return "none";
    case "tool":
      return typeof toolChoice.name === "string"
        ? { type: "function", function: { name: toolChoice.name } }
        : undefined;
    default:
      return undefined;
  }
}

/** Build the OpenAI Chat Completion request body from an Anthropic Messages request. */
export function anthropicToOpenAiRequest(
  req: AnthropicRequest,
): Record<string, unknown> {
  const system = systemToOpenAi(req.system);
  const messages: unknown[] = [];
  if (system !== undefined) messages.push({ role: "system", content: system });
  messages.push(...anthropicMessagesToOpenAi(req.messages));

  const body: Record<string, unknown> = {
    model: resolveModel(req.model),
    messages,
  };
  if (typeof req.max_tokens === "number") body.max_tokens = req.max_tokens;
  if (typeof req.temperature === "number") body.temperature = req.temperature;
  if (typeof req.top_p === "number") body.top_p = req.top_p;
  if (Array.isArray(req.stop_sequences) && req.stop_sequences.length > 0) {
    body.stop = req.stop_sequences;
  }
  const tools = anthropicToolsToOpenAi(req.tools);
  if (tools) body.tools = tools;
  const toolChoice = anthropicToolChoiceToOpenAi(req.tool_choice);
  if (toolChoice !== undefined) body.tool_choice = toolChoice;
  return body;
}

/** Convert an OpenAI Chat Completion object to an Anthropic Messages response. */
export function openAiCompletionToAnthropic(
  completion: Record<string, unknown>,
  requestedModel: string,
): Record<string, unknown> {
  const choices = completion.choices;
  const choice =
    Array.isArray(choices) && choices.length > 0 && isRecord(choices[0])
      ? (choices[0] as Record<string, unknown>)
      : {};
  const message = isRecord(choice.message) ? choice.message : undefined;
  const finishReason =
    typeof choice.finish_reason === "string" ? choice.finish_reason : "stop";

  const content: Record<string, unknown>[] = [];
  if (message) {
    if (typeof message.content === "string" && message.content.length > 0) {
      content.push({ type: "text", text: message.content });
    }
    if (Array.isArray(message.tool_calls)) {
      for (const raw of message.tool_calls) {
        if (!isRecord(raw)) continue;
        const fn = isRecord(raw.function) ? raw.function : {};
        let input: unknown = {};
        if (typeof fn.arguments === "string") {
          try {
            input = JSON.parse(fn.arguments);
          } catch {
            input = {};
          }
        } else if (isRecord(fn.arguments)) {
          input = fn.arguments;
        }
        content.push({
          type: "tool_use",
          id: typeof raw.id === "string" ? raw.id : "",
          name: typeof fn.name === "string" ? fn.name : "",
          input,
        });
      }
    }
  }

  const usage = isRecord(completion.usage) ? completion.usage : {};
  const inputTokens =
    typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const outputTokens =
    typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;

  return {
    id: typeof completion.id === "string" ? completion.id : `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    content,
    model: requestedModel,
    stop_reason: mapFinishReason(finishReason),
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

/** Read an upstream body (bytes or a stream) to a UTF-8 string. */
async function bodyToText(body: UpstreamResult["body"]): Promise<string> {
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ReadableStream) {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    let total = 0;
    for (const c of chunks) total += c.length;
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    return new TextDecoder().decode(merged);
  }
  return "";
}

/** Normalize an upstream (api.cline.bot) result into an Anthropic-style payload. */
export async function anthropicNormalizeUpstream(
  result: UpstreamResult,
): Promise<{ status: number; payload: unknown }> {
  let text: string;
  try {
    text = await bodyToText(result.body);
  } catch {
    return {
      status: 502,
      payload: anthropicError("Failed to read upstream response", { type: "api_error" }),
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
      payload: anthropicError(message, {
        type: result.status === 401 || result.status === 403 ? "authentication_error" : "api_error",
      }),
    };
  }

  if (isRecord(parsed) && "data" in parsed && parsed.data !== undefined) {
    return { status: result.status, payload: parsed.data };
  }
  if (parsed !== undefined) return { status: result.status, payload: parsed };
  return {
    status: 502,
    payload: anthropicError("Upstream returned a non-JSON response", { type: "api_error" }),
  };
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Transform an OpenAI Chat Completion SSE stream into an Anthropic Messages
 * SSE stream: message_start → content_block_start/delta/stop → message_delta → message_stop.
 */
export function anthropicSseTransform(
  model: string,
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let leftover = "";
  let started = false;
  let stopped = false;
  let textOpen = false;
  let textIndex = -1;
  let nextIndex = 0;
  const toolBlocks = new Map<number, number>();
  let stopReason = "end_turn";
  let inputTokens = 0;
  let outputTokens = 0;
  const messageId = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  type Ctrl = TransformStreamDefaultController<Uint8Array>;

  function emit(ctrl: Ctrl, event: string, data: unknown): void {
    ctrl.enqueue(encoder.encode(sseFrame(event, data)));
  }
  function startMessage(ctrl: Ctrl): void {
    if (started) return;
    started = true;
    emit(ctrl, "message_start", {
      type: "message_start",
      message: {
        id: messageId, type: "message", role: "assistant", content: [],
        model, stop_reason: null, stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      },
    });
  }
  function openText(ctrl: Ctrl): void {
    if (textOpen) return;
    for (const idx of toolBlocks.values()) {
      emit(ctrl, "content_block_stop", { type: "content_block_stop", index: idx });
    }
    toolBlocks.clear();
    textIndex = nextIndex++;
    textOpen = true;
    emit(ctrl, "content_block_start", {
      type: "content_block_start", index: textIndex,
      content_block: { type: "text", text: "" },
    });
  }
  function closeText(ctrl: Ctrl): void {
    if (!textOpen) return;
    emit(ctrl, "content_block_stop", { type: "content_block_stop", index: textIndex });
    textOpen = false;
  }
  function finish(ctrl: Ctrl): void {
    if (stopped) return;
    if (!started) startMessage(ctrl);
    closeText(ctrl);
    for (const idx of toolBlocks.values()) {
      emit(ctrl, "content_block_stop", { type: "content_block_stop", index: idx });
    }
    toolBlocks.clear();
    stopped = true;
    emit(ctrl, "message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    });
    emit(ctrl, "message_stop", { type: "message_stop" });
  }
  function handleChunk(ctrl: Ctrl, chunk: Record<string, unknown>): void {
    if (isRecord(chunk.usage)) {
      if (typeof chunk.usage.prompt_tokens === "number") inputTokens = chunk.usage.prompt_tokens;
      if (typeof chunk.usage.completion_tokens === "number") outputTokens = chunk.usage.completion_tokens;
    }
    if (!started) startMessage(ctrl);
    const choices = chunk.choices;
    const choice =
      Array.isArray(choices) && choices.length > 0 && isRecord(choices[0])
        ? (choices[0] as Record<string, unknown>)
        : undefined;
    if (!choice) return;

    const delta = isRecord(choice.delta) ? choice.delta : {};
    if (typeof delta.content === "string" && delta.content.length > 0) {
      if (!textOpen) openText(ctrl);
      emit(ctrl, "content_block_delta", {
        type: "content_block_delta", index: textIndex,
        delta: { type: "text_delta", text: delta.content },
      });
    }
    if (Array.isArray(delta.tool_calls)) {
      closeText(ctrl);
      for (const raw of delta.tool_calls) {
        if (!isRecord(raw)) continue;
        const tcIndex = typeof raw.index === "number" ? raw.index : 0;
        let blockIdx = toolBlocks.get(tcIndex);
        if (blockIdx === undefined) {
          blockIdx = nextIndex++;
          toolBlocks.set(tcIndex, blockIdx);
          const fn = isRecord(raw.function) ? raw.function : {};
          emit(ctrl, "content_block_start", {
            type: "content_block_start", index: blockIdx,
            content_block: {
              type: "tool_use",
              id: typeof raw.id === "string" ? raw.id : "",
              name: typeof fn.name === "string" ? fn.name : "",
              input: {},
            },
          });
        }
        const fn = isRecord(raw.function) ? raw.function : {};
        if (typeof fn.arguments === "string" && fn.arguments.length > 0) {
          emit(ctrl, "content_block_delta", {
            type: "content_block_delta", index: blockIdx,
            delta: { type: "input_json_delta", partial_json: fn.arguments },
          });
        }
      }
    }
    if (typeof choice.finish_reason === "string" && choice.finish_reason) {
      stopReason = mapFinishReason(choice.finish_reason);
    }
  }
  function processLine(ctrl: Ctrl, line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return false;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") { finish(ctrl); return true; }
    let json: unknown;
    try { json = JSON.parse(data); } catch { return false; }
    if (isRecord(json)) handleChunk(ctrl, json);
    return false;
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      leftover += decoder.decode(chunk, { stream: true });
      const lines = leftover.split("\n");
      leftover = lines.pop() ?? "";
      for (const line of lines) if (processLine(ctrl, line)) return;
    },
    flush(ctrl) {
      if (leftover.trim() && processLine(ctrl, leftover)) return;
      if (!stopped) finish(ctrl);
    },
  });
}

export type AnthropicHandlerResult =
  | { kind: "json"; status: number; payload: unknown }
  | {
      kind: "stream";
      status: number;
      headers: Record<string, string>;
      body: ReadableStream<Uint8Array>;
    };

/** Create a handler that accepts Anthropic Messages API requests and proxies
 *  them to api.cline.bot via the OpenAI Chat Completion surface. */
export function createAnthropicHandler(deps: AnthropicProxyDeps) {
  return async function messagesHandler(
    rawBody: string,
  ): Promise<AnthropicHandlerResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody || "null");
    } catch {
      return { kind: "json", status: 400, payload: anthropicError("Request body must be valid JSON") };
    }
    if (!isRecord(parsed)) {
      return { kind: "json", status: 400, payload: anthropicError("Request body must be a JSON object") };
    }
    if (typeof parsed.model !== "string" || parsed.model.trim() === "") {
      return { kind: "json", status: 400, payload: anthropicError("model: field is required") };
    }
    if (!Array.isArray(parsed.messages)) {
      return { kind: "json", status: 400, payload: anthropicError("messages: field is required and must be an array") };
    }

    const requestedModel = parsed.model;
    const stream = parsed.stream === true;
    const openAiBody = anthropicToOpenAiRequest(parsed as unknown as AnthropicRequest);

    let result: UpstreamResult;
    try {
      result = await deps.client.chatCompletions(JSON.stringify(openAiBody), { stream });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return {
        kind: "json",
        status: aborted ? 504 : 502,
        payload: anthropicError(
          aborted ? "Upstream request timed out" : "Failed to reach the Cline API",
          { type: "api_error" },
        ),
      };
    }

    if (stream) {
      if (result.status >= 400) {
        const norm = await anthropicNormalizeUpstream(result);
        return { kind: "json", status: norm.status, payload: norm.payload };
      }
      if (!(result.body instanceof ReadableStream)) {
        return {
          kind: "json",
          status: 502,
          payload: anthropicError("Upstream returned no stream", { type: "api_error" }),
        };
      }
      return {
        kind: "stream",
        status: result.status,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
        body: (result.body as ReadableStream<Uint8Array>).pipeThrough(anthropicSseTransform(requestedModel)),
      };
    }

    const norm = await anthropicNormalizeUpstream(result);
    if (norm.status >= 400 || !isRecord(norm.payload)) {
      return { kind: "json", status: norm.status, payload: norm.payload };
    }
    return {
      kind: "json",
      status: norm.status,
      payload: openAiCompletionToAnthropic(norm.payload as Record<string, unknown>, requestedModel),
    };
  };
}
