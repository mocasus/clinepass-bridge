import { describe, expect, it } from "vitest";
import { normalizeUpstreamResponse, openAiError } from "../src/proxy/chat.js";

function makeResult(status: number, body: string) {
  return {
    status,
    headers: new Headers(),
    body: new TextEncoder().encode(body),
  };
}

describe("normalizeUpstreamResponse", () => {
  it("unwraps the {success,data} envelope", () => {
    const upstream = {
      success: true,
      data: { id: "gen_1", object: "chat.completion", choices: [{ index: 0 }] },
    };
    const r = normalizeUpstreamResponse(makeResult(200, JSON.stringify(upstream)));
    expect(r.status).toBe(200);
    expect(r.payload).toEqual(upstream.data);
  });

  it("passes through a bare OpenAI completion", () => {
    const completion = { id: "gen_2", object: "chat.completion", choices: [] };
    const r = normalizeUpstreamResponse(makeResult(200, JSON.stringify(completion)));
    expect(r.payload).toEqual(completion);
  });

  it("maps a string error envelope to an OpenAI error", () => {
    const r = normalizeUpstreamResponse(
      makeResult(401, JSON.stringify({ error: "Unauthorized: re-auth", success: false })),
    );
    expect(r.status).toBe(401);
    const p = r.payload as ReturnType<typeof openAiError>;
    expect((p.error as { message: string }).message).toBe("Unauthorized: re-auth");
    expect((p.error as { type: string }).type).toBe("authentication_error");
  });

  it("maps an object error envelope", () => {
    const r = normalizeUpstreamResponse(
      makeResult(429, JSON.stringify({ error: { message: "slow down" } })),
    );
    expect(r.status).toBe(429);
    expect((r.payload as ReturnType<typeof openAiError>).error).toMatchObject({
      message: "slow down",
      type: "server_error",
    });
  });

  it("handles non-JSON error bodies", () => {
    const r = normalizeUpstreamResponse(makeResult(502, "Bad Gateway"));
    expect(r.status).toBe(502);
    expect((r.payload as ReturnType<typeof openAiError>).error).toMatchObject({
      message: "Cline API error (HTTP 502)",
    });
  });
});
