import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TokenManager,
  TokenRefreshError,
  jwtExpiresAtMs,
  normalizeWorkosToken,
} from "../src/auth/tokenManager.js";

function makeJwt(expSecondsFromNow: number, nowMs: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: "user_1", exp: Math.floor(nowMs / 1000) + expSecondsFromNow }),
  ).toString("base64url");
  return `${header}.${payload}.fakesig`;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cpb-tm-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-07-21T12:00:00Z");

function providersJson(
  entries: Record<string, { accessToken: string; refreshToken: string; expiresAt: number }>,
) {
  const p = path.join(dir, "providers.json");
  writeFileSync(
    p,
    JSON.stringify({
      providers: Object.fromEntries(
        Object.entries(entries).map(([k, v]) => [k, { settings: { auth: v } }]),
      ),
    }),
  );
  return p;
}

describe("jwtExpiresAtMs", () => {
  it("decodes exp from a bare JWT", () => {
    expect(jwtExpiresAtMs(makeJwt(3600, NOW))).toBe(NOW + 3_600_000);
  });
  it("decodes exp from a workos:-prefixed JWT", () => {
    expect(jwtExpiresAtMs(`workos:${makeJwt(60, NOW)}`)).toBe(NOW + 60_000);
  });
  it("returns undefined for garbage", () => {
    expect(jwtExpiresAtMs("not-a-jwt")).toBeUndefined();
  });
});

describe("normalizeWorkosToken", () => {
  it("adds the prefix when missing", () => {
    expect(normalizeWorkosToken("abc")).toBe("workos:abc");
  });
  it("keeps an existing prefix", () => {
    expect(normalizeWorkosToken("workos:abc")).toBe("workos:abc");
  });
});

describe("TokenManager.getAccessToken", () => {
  it("uses the freshest valid entry from providers.json without refreshing", async () => {
    const fresh = makeJwt(3600, NOW);
    const stale = makeJwt(-10, NOW);
    const providersJsonPath = providersJson({
      cline: { accessToken: fresh, refreshToken: "rt1", expiresAt: NOW + 3_600_000 },
      "cline-pass": { accessToken: stale, refreshToken: "rt1", expiresAt: NOW - 10_000 },
    });
    const fetchImpl = vi.fn();
    const tm = new TokenManager({
      workosClientId: "client_x",
      providersJsonPath,
      tokenCachePath: path.join(dir, "cache.json"),
      syncProvidersJson: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
    });
    expect(await tm.getAccessToken()).toBe(fresh);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes via WorkOS when stored token is expired; persists to cache + providers.json", async () => {
    const stale = makeJwt(-10, NOW);
    const providersJsonPath = providersJson({
      cline: { accessToken: stale, refreshToken: "rt-old", expiresAt: NOW - 10_000 },
    });
    const newJwt = makeJwt(7200, NOW);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: newJwt, refresh_token: "rt-new" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const cachePath = path.join(dir, "cache.json");
    const tm = new TokenManager({
      workosClientId: "client_x",
      providersJsonPath,
      tokenCachePath: cachePath,
      syncProvidersJson: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
    });

    expect(await tm.getAccessToken()).toBe(`workos:${newJwt}`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("api.workos.com");
    expect(JSON.parse(String(init.body))).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "rt-old",
    });

    const cache = JSON.parse(readFileSync(cachePath, "utf8"));
    expect(cache.refreshToken).toBe("rt-new");

    const synced = JSON.parse(readFileSync(providersJsonPath, "utf8"));
    expect(synced.providers.cline.settings.auth.accessToken).toBe(`workos:${newJwt}`);
    expect(synced.providers.cline.settings.auth.refreshToken).toBe("rt-new");

    await tm.getAccessToken(); // served from memory
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent refreshes (single-flight)", async () => {
    const newJwt = makeJwt(7200, NOW);
    const deferred = new Promise<Response>((res) => {
      (globalThis as Record<string, unknown>).__cpbResolve = res;
    });
    const fetchImpl = vi.fn().mockImplementation(() => deferred);
    const tm = new TokenManager({
      workosClientId: "client_x",
      envRefreshToken: "rt",
      providersJsonPath: path.join(dir, "missing.json"),
      tokenCachePath: path.join(dir, "cache.json"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
    });
    const p1 = tm.getAccessToken();
    const p2 = tm.getAccessToken();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    (globalThis as Record<string, (r: Response) => void>).__cpbResolve(
      new Response(JSON.stringify({ access_token: newJwt }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1).toBe(t2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws TokenRefreshError when no refresh token exists anywhere", async () => {
    const tm = new TokenManager({
      workosClientId: "client_x",
      providersJsonPath: path.join(dir, "missing.json"),
      tokenCachePath: path.join(dir, "missing-cache.json"),
      fetchImpl: vi.fn() as unknown as typeof fetch,
      now: () => NOW,
    });
    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(TokenRefreshError);
  });

  it("surfaces a WorkOS error response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("invalid_grant", { status: 400 }));
    const tm = new TokenManager({
      workosClientId: "client_x",
      envRefreshToken: "rt-dead",
      providersJsonPath: path.join(dir, "missing.json"),
      tokenCachePath: path.join(dir, "cache.json"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
    });
    await expect(tm.getAccessToken()).rejects.toThrow(/HTTP 400/);
  });

  it("does not write a cache file when tokenCachePath is unset", async () => {
    const newJwt = makeJwt(7200, NOW);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: newJwt }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const tm = new TokenManager({
      workosClientId: "client_x",
      envRefreshToken: "rt",
      providersJsonPath: path.join(dir, "missing.json"),
      tokenCachePath: undefined,
      syncProvidersJson: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
    });
    await tm.getAccessToken();
    expect(existsSync(path.join(dir, "tokens.json"))).toBe(false);
  });
});
