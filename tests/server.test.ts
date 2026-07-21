import { describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { logger } from "../src/logger.js";
import type { ClineClient } from "../src/cline/client.js";

const API_KEY = "sk-cpb-test-key-123";

function makeApp(clineClient?: Partial<ClineClient>) {
  const config = loadConfig({ API_KEYS: API_KEY } as NodeJS.ProcessEnv);
  return createApp({
    config,
    clineClient: clineClient as ClineClient,
    logger,
  });
}

describe("server auth", () => {
  it("health endpoint is public", async () => {
    const res = await makeApp({}).request("http://x/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("rejects /v1/* without a key", async () => {
    const res = await makeApp({}).request("http://x/v1/models");
    expect(res.status).toBe(401);
  });

  it("rejects /v1/* with a wrong key", async () => {
    const res = await makeApp({}).request("http://x/v1/models", {
      headers: { Authorization: "Bearer sk-cpb-wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("serves models with a valid key", async () => {
    const res = await makeApp({}).request("http://x/v1/models", {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { object: string; data: { id: string }[] };
    expect(body.object).toBe("list");
    expect(body.data.some((m) => m.id === "cline-pass/kimi-k3")).toBe(true);
  });

  it("validates chat request bodies", async () => {
    const res = await makeApp({}).request("http://x/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("model");
  });

  it("proxies a non-streaming completion and unwraps the envelope", async () => {
    const upstreamCompletion = {
      id: "gen_1",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const clineClient: Partial<ClineClient> = {
      chatCompletions: async (_body: string, _opts: { stream: boolean }) => ({
        status: 200,
        headers: new Headers(),
        body: new TextEncoder().encode(
          JSON.stringify({ success: true, data: upstreamCompletion }),
        ),
      }),
    };
    const res = await makeApp(clineClient).request("http://x/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "kimi-k3",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(upstreamCompletion);
  });
});
