import { describe, expect, it } from "vitest";
import {
  CLINE_PASS_MODELS,
  modelsListResponse,
  resolveModel,
} from "../src/proxy/models.js";

describe("resolveModel", () => {
  it("keeps full cline-pass ids", () => {
    expect(resolveModel("cline-pass/kimi-k3")).toBe("cline-pass/kimi-k3");
  });
  it("resolves short aliases", () => {
    expect(resolveModel("kimi-k3")).toBe("cline-pass/kimi-k3");
    expect(resolveModel("glm-5.2")).toBe("cline-pass/glm-5.2");
  });
  it("is case-insensitive on aliases", () => {
    expect(resolveModel("KIMI-K3")).toBe("cline-pass/kimi-k3");
  });
  it("passes through unknown ids (forward-compat)", () => {
    expect(resolveModel("cline-pass/future-model")).toBe("cline-pass/future-model");
  });
});

describe("modelsListResponse", () => {
  it("is an OpenAI-style list with all catalog models", () => {
    const res = modelsListResponse(1700000000);
    expect(res.object).toBe("list");
    expect(res.data).toHaveLength(CLINE_PASS_MODELS.length);
    const ids = res.data.map((m) => m.id);
    expect(ids).toContain("cline-pass/kimi-k3");
    expect(ids).toContain("cline-pass/glm-5.2");
    for (const m of res.data) {
      expect(m.object).toBe("model");
      expect(m.owned_by).toBe("cline-pass");
      expect(m.created).toBe(1700000000);
    }
  });
});
