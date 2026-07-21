import { describe, expect, it } from "vitest";
import {
  extractBearerToken,
  generateApiKey,
  isValidApiKey,
} from "../src/auth/apiKeys.js";

describe("extractBearerToken", () => {
  it("parses a standard header", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  });
  it("is case-insensitive on the scheme", () => {
    expect(extractBearerToken("bearer  abc123 ")).toBe("abc123");
  });
  it("returns null without a header", () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });
  it("returns null for non-bearer schemes", () => {
    expect(extractBearerToken("Basic abc123")).toBeNull();
  });
});

describe("isValidApiKey", () => {
  const keys = ["sk-cpb-alpha", "sk-cpb-beta-2"];
  it("accepts configured keys", () => {
    expect(isValidApiKey("sk-cpb-alpha", keys)).toBe(true);
    expect(isValidApiKey("sk-cpb-beta-2", keys)).toBe(true);
  });
  it("rejects unknown keys", () => {
    expect(isValidApiKey("sk-cpb-gamma", keys)).toBe(false);
  });
  it("rejects keys of different length", () => {
    expect(isValidApiKey("short", keys)).toBe(false);
  });
  it("rejects null", () => {
    expect(isValidApiKey(null, keys)).toBe(false);
  });
});

describe("generateApiKey", () => {
  it("produces sk-cpb-prefixed unique keys", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).toMatch(/^sk-cpb-[A-Za-z0-9_-]{32}$/);
    expect(b).toMatch(/^sk-cpb-[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
  });
});
