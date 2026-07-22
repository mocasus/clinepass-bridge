import { describe, expect, it } from "vitest";
import {
  anthropicError,
  anthropicMessagesToOpenAi,
  anthropicSseTransform,
  anthropicToOpenAiRequest,
  anthropicToolChoiceToOpenAi,
  anthropicToolsToOpenAi,
  createAnthropicHandler,
  mapFinishReason,
  openAiCompletionToAnthropic,
  systemToOpenAi,
} from "../src/proxy/anthropic.js";
import type { ClineClient, UpstreamResult } from "../src/cline/client.js";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { logger } from "../src/logger.js";

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  out += dec.decode();
  return out;
}

function parseEvents(s: string): { event: string; data: any }[] {
  return s
    .split("\n\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => {
      const ev = /^event:\s*(.+)$/m.exec(f);
      const dt = /^data:\s*(.+)$/m.exec(f);
      return { event: ev ? ev[1].trim() : "", data: dt ? JSON.parse(dt[1]) : null };
    });
}

function sse(lines: string[]): string {
  return lines.map((l) => `data: ${l}`).join("\n\n") + "\n\n";
}

describe("anthropicError", () => {
  it("wraps an Anthropic-style error envelope", () => {
    const e = anthropicError("boom", { type: "api_error" }) as any;
    expect(e.type).toBe("error");
    expect(e.error).toEqual({ type: "api_error", message: "boom" });
  });
});

describe("mapFinishReason", () => {
  it("maps OpenAI finish reasons to Anthropic stop reasons", () => {
    expect(mapFinishReason("stop")).toBe("end_turn");
    expect(mapFinishReason("tool_calls")).toBe("tool_use");
    expect(mapFinishReason("length")).toBe("max_tokens");
    expect(mapFinishReason("stop_sequence")).toBe("stop_sequence");
    expect(mapFinishReason("garbage")).toBe("end_turn");
  });
});

describe("systemToOpenAi", () => {
  it("passes a string through", () => {
    expect(systemToOpenAi("be concise")).toBe("be concise");
  });
  it("joins text blocks", () => {
    expect(
      systemToOpenAi([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]),
    ).toBe("ab");
  });
  it("returns undefined when missing", () => {
    expect(systemToOpenAi(undefined)).toBeUndefined();
  });
});
describe("anthropicMessagesToOpenAi", () => {
  it("converts a plain user string", () => {
    expect(anthropicMessagesToOpenAi([{ role: "user", content: "hi" }])).toEqual([
      { role: "user", content: "hi" },
    ]);
  });

  it("converts an image block to image_url", () => {
    const out = anthropicMessagesToOpenAi([
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
        ],
      },
    ]) as any[];
    expect(out[0].role).toBe("user");
    const parts = out[0].content;
    expect(parts[0]).toEqual({ type: "text", text: "what is this?" });
    expect(parts[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAA" } });
  });

  it("converts assistant tool_use blocks to tool_calls", () => {
    const out = anthropicMessagesToOpenAi([
      {
        role: "assistant",
        content: [
          { type: "text", text: "sure" },
          { type: "tool_use", id: "tu_1", name: "foo", input: { a: 1 } },
        ],
      },
    ]) as any[];
    expect(out[0].role).toBe("assistant");
    expect(out[0].content).toBe("sure");
    expect(out[0].tool_calls).toEqual([
      { id: "tu_1", type: "function", function: { name: "foo", arguments: '{"a":1}' } },
    ]);
  });

  it("converts user tool_result blocks to tool messages", () => {
    const out = anthropicMessagesToOpenAi([
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tu_1", content: "42" }],
      },
    ]) as any[];
    expect(out[0]).toEqual({ role: "tool", tool_call_id: "tu_1", content: "42" });
  });
});

describe("anthropicToolsToOpenAi", () => {
  it("maps input_schema to function parameters", () => {
    const out = anthropicToolsToOpenAi([
      { name: "foo", description: "d", input_schema: { type: "object", properties: { a: {} } } },
    ]);
    expect(out).toEqual([
      {
        type: "function",
        function: {
          name: "foo",
          description: "d",
          parameters: { type: "object", properties: { a: {} } },
        },
      },
    ]);
  });
  it("returns undefined when no tools", () => {
    expect(anthropicToolsToOpenAi(undefined)).toBeUndefined();
    expect(anthropicToolsToOpenAi([])).toBeUndefined();
  });
});
describe("anthropicToolChoiceToOpenAi", () => {
  it("maps auto/any/none/tool", () => {
    expect(anthropicToolChoiceToOpenAi({ type: "auto" })).toBe("auto");
    expect(anthropicToolChoiceToOpenAi({ type: "any" })).toBe("required");
    expect(anthropicToolChoiceToOpenAi({ type: "none" })).toBe("none");
    expect(anthropicToolChoiceToOpenAi({ type: "tool", name: "foo" })).toEqual({
      type: "function",
      function: { name: "foo" },
    });
  });
  it("returns undefined for unknown/missing", () => {
    expect(anthropicToolChoiceToOpenAi(undefined)).toBeUndefined();
    expect(anthropicToolChoiceToOpenAi({ type: "weird" })).toBeUndefined();
  });
});

describe("anthropicToOpenAiRequest", () => {
  it("resolves the model and prepends system", () => {
    const body = anthropicToOpenAiRequest({
      model: "kimi-k3",
      messages: [{ role: "user", content: "hi" }],
      system: "be nice",
      max_tokens: 128,
      stop_sequences: ["END"],
    }) as any;
    expect(body.model).toBe("cline-pass/kimi-k3");
    expect(body.messages[0]).toEqual({ role: "system", content: "be nice" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
    expect(body.max_tokens).toBe(128);
    expect(body.stop).toEqual(["END"]);
  });
});

describe("openAiCompletionToAnthropic", () => {
  it("converts a text completion", () => {
    const r = openAiCompletionToAnthropic(
      {
        id: "chatcmpl-1",
        choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      },
      "kimi-k3",
    ) as any;
    expect(r.type).toBe("message");
    expect(r.role).toBe("assistant");
    expect(r.model).toBe("kimi-k3");
    expect(r.content).toEqual([{ type: "text", text: "hello" }]);
    expect(r.stop_reason).toBe("end_turn");
    expect(r.usage).toEqual({ input_tokens: 3, output_tokens: 2 });
  });

  it("converts tool_calls into tool_use blocks", () => {
    const r = openAiCompletionToAnthropic(
      {
        id: "c1",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "call_1", type: "function", function: { name: "foo", arguments: '{"a":1}' } }],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
      "kimi-k3",
    ) as any;
    expect(r.stop_reason).toBe("tool_use");
    expect(r.content).toEqual([{ type: "tool_use", id: "call_1", name: "foo", input: { a: 1 } }]);
  });
});
describe("anthropicSseTransform", () => {
  it("emits a full text streaming sequence", async () => {
    const input = sse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: "Hello" } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { content: " world" } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2 } }),
      "[DONE]",
    ]);
    const src = new ReadableStream({ start(c) { c.enqueue(enc(input)); c.close(); } });
    const out = await collectStream(src.pipeThrough(anthropicSseTransform("kimi-k3")));
    const events = parseEvents(out);
    expect(events.map((e) => e.event)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    const deltas = events.filter((e) => e.event === "content_block_delta").map((e) => e.data.delta.text);
    expect(deltas.join("")).toBe("Hello world");
    expect(events.find((e) => e.event === "message_delta").data.delta.stop_reason).toBe("end_turn");
    expect(events.find((e) => e.event === "message_delta").data.usage).toEqual({ input_tokens: 5, output_tokens: 2 });
  });

  it("emits tool_use blocks with input_json_delta", async () => {
    const input = sse([
      JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_weather", arguments: "" } }] } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"SF"}' } }] } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
      "[DONE]",
    ]);
    const src = new ReadableStream({ start(c) { c.enqueue(enc(input)); c.close(); } });
    const out = await collectStream(src.pipeThrough(anthropicSseTransform("kimi-k3")));
    const events = parseEvents(out);
    expect(events.map((e) => e.event)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    const start = events.find((e) => e.event === "content_block_start");
    expect(start.data.content_block).toEqual({ type: "tool_use", id: "call_1", name: "get_weather", input: {} });
    const deltas = events.filter((e) => e.event === "content_block_delta").map((e) => e.data.delta.partial_json);
    expect(deltas.join("")).toBe('{"city":"SF"}');
    expect(events.find((e) => e.event === "message_delta").data.delta.stop_reason).toBe("tool_use");
  });
});

const API_KEY = "sk-cpb-anthropic-test-key";

function makeApp(clineClient?: Partial<ClineClient>) {
  const config = loadConfig({ API_KEYS: API_KEY } as NodeJS.ProcessEnv);
  return createApp({ config, clineClient: clineClient as ClineClient, logger });
}

function makeClient(
  impl: (body: string, opts: { stream: boolean }) => UpstreamResult | Promise<UpstreamResult>,
): ClineClient {
  return { chatCompletions: impl } as unknown as ClineClient;
}

describe("createAnthropicHandler", () => {
  it("proxies a non-streaming request and returns an Anthropic response", async () => {
    let captured: string | undefined;
    const client = makeClient(async (body) => {
      captured = body;
      return {
        status: 200,
        headers: new Headers(),
        body: enc(JSON.stringify({ success: true, data: {
          id: "c1", object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: "hi there" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        } })),
      };
    });
    const handler = createAnthropicHandler({ client });
    const res = await handler(JSON.stringify({
      model: "kimi-k3", max_tokens: 100, system: "be nice",
      messages: [{ role: "user", content: "hi" }],
    }));
    expect(res.kind).toBe("json");
    expect(res.status).toBe(200);
    const payload = res.payload as any;
    expect(payload.type).toBe("message");
    expect(payload.content).toEqual([{ type: "text", text: "hi there" }]);
    expect(payload.usage).toEqual({ input_tokens: 3, output_tokens: 2 });
    const sent = JSON.parse(captured!);
    expect(sent.model).toBe("cline-pass/kimi-k3");
    expect(sent.messages[0]).toEqual({ role: "system", content: "be nice" });
    expect(sent.max_tokens).toBe(100);
  });

  it("returns an Anthropic error for a bad body", async () => {
    const client = makeClient(async () => ({ status: 200, headers: new Headers(), body: enc("{}") }));
    const handler = createAnthropicHandler({ client });
    const res = await handler(JSON.stringify({ messages: [] }));
    expect(res.status).toBe(400);
    expect((res.payload as any).type).toBe("error");
  });

  it("returns a stream for a streaming request", async () => {
    const input = sse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: "hi" } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
      "[DONE]",
    ]);
    const client = makeClient(async () => ({
      status: 200, headers: new Headers(),
      body: new ReadableStream({ start(c) { c.enqueue(enc(input)); c.close(); } }),
    }));
    const handler = createAnthropicHandler({ client });
    const res = await handler(JSON.stringify({ model: "kimi-k3", messages: [{ role: "user", content: "hi" }], stream: true }));
    expect(res.kind).toBe("stream");
    if (res.kind !== "stream") throw new Error("stream");
    const text = await collectStream(res.body);
    expect(text).toContain("event: message_start");
    expect(text).toContain("event: message_stop");
  });
});

describe("server /v1/messages", () => {
  const completion = {
    id: "c1", object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };

  it("rejects without an api key (anthropic error shape)", async () => {
    const res = await makeApp({}).request("http://x/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "kimi-k3", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("authentication_error");
  });

  it("accepts x-api-key and returns an Anthropic message", async () => {
    const clineClient = makeClient(async () => ({
      status: 200, headers: new Headers(),
      body: enc(JSON.stringify({ success: true, data: completion })),
    }));
    const res = await makeApp(clineClient).request("http://x/v1/messages", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "kimi-k3", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.type).toBe("message");
    expect(body.content).toEqual([{ type: "text", text: "ok" }]);
  });

  it("still accepts Authorization: Bearer on /v1/messages", async () => {
    const clineClient = makeClient(async () => ({
      status: 200, headers: new Headers(),
      body: enc(JSON.stringify({ success: true, data: completion })),
    }));
    const res = await makeApp(clineClient).request("http://x/v1/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "kimi-k3", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
  });

  it("streams an Anthropic SSE response", async () => {
    const input = sse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: "hi" } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
      "[DONE]",
    ]);
    const clineClient = makeClient(async () => ({
      status: 200, headers: new Headers(),
      body: new ReadableStream({ start(c) { c.enqueue(enc(input)); c.close(); } }),
    }));
    const res = await makeApp(clineClient).request("http://x/v1/messages", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "kimi-k3", messages: [{ role: "user", content: "hi" }], stream: true }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: message_start");
    expect(text).toContain("event: message_stop");
  });
});