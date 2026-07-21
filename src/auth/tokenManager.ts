import { promises as fs } from "node:fs";
import path from "node:path";

export const WORKOS_TOKEN_PREFIX = "workos:";
const DEFAULT_WORKOS_AUTHENTICATE_URL = "https://api.workos.com/user_management/authenticate";
const DEFAULT_CLOCK_SKEW_MS = 60_000;

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** epoch milliseconds, when known */
  expiresAt?: number;
}

export interface TokenManagerOptions {
  workosClientId: string;
  workosAuthenticateUrl?: string;
  /** Cline CLI credential store (~/.cline/data/settings/providers.json). */
  providersJsonPath?: string;
  /** Bridge-local cache for refreshed tokens. */
  tokenCachePath?: string;
  /** Also write refreshed tokens back into the Cline CLI store. */
  syncProvidersJson?: boolean;
  envAccessToken?: string;
  envRefreshToken?: string;
  clockSkewMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class TokenRefreshError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TokenRefreshError";
  }
}

/** Decode `exp` (ms) from a JWT, tolerating the "workos:" prefix. Undefined when unknown. */
export function jwtExpiresAtMs(token: string): number | undefined {
  try {
    const raw = token.startsWith(WORKOS_TOKEN_PREFIX)
      ? token.slice(WORKOS_TOKEN_PREFIX.length)
      : token;
    const parts = raw.split(".");
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      exp?: number;
    };
    return typeof payload.exp === "number" ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** Cline stores/sends WorkOS access tokens with a "workos:" prefix. */
export function normalizeWorkosToken(token: string): string {
  return token.startsWith(WORKOS_TOKEN_PREFIX) ? token : `${WORKOS_TOKEN_PREFIX}${token}`;
}

interface ProvidersJsonShape {
  providers?: Record<
    string,
    {
      settings?: {
        auth?: Record<string, unknown> & {
          accessToken?: string;
          refreshToken?: string;
          expiresAt?: number;
        };
      };
      updatedAt?: string;
    }
  >;
  [key: string]: unknown;
}

/**
 * Resolves a valid Cline access token, in this order:
 *   1. in-memory token
 *   2. bridge-local cache file (tokens we refreshed ourselves)
 *   3. Cline CLI credential store (freshest of the "cline" / "cline-pass" entries)
 *   4. env-provided static token
 *   5. WorkOS refresh_token grant (single-flight), persisted to cache + CLI store
 */
export class TokenManager {
  private memory?: TokenSet;
  private inFlightRefresh?: Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly skew: number;

  constructor(private readonly opts: TokenManagerOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? (() => Date.now());
    this.skew = opts.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
  }

  async getAccessToken(options?: { forceRefresh?: boolean }): Promise<string> {
    if (options?.forceRefresh) {
      this.memory = undefined;
      return this.refresh();
    }
    const now = this.now();

    if (this.memory && this.isUsable(this.memory, now)) return this.memory.accessToken;

    const cached = await this.readTokenCacheFile();
    if (cached && this.isUsable(cached, now)) {
      this.memory = cached;
      return cached.accessToken;
    }

    const fromStore = await this.readProvidersJson();
    if (fromStore && this.isUsable(fromStore, now)) {
      this.memory = fromStore;
      return fromStore.accessToken;
    }

    if (this.opts.envAccessToken) {
      const fromEnv: TokenSet = {
        accessToken: this.opts.envAccessToken,
        refreshToken: this.opts.envRefreshToken,
        expiresAt: jwtExpiresAtMs(this.opts.envAccessToken),
      };
      if (this.isUsable(fromEnv, now)) {
        this.memory = fromEnv;
        return fromEnv.accessToken;
      }
    }

    return this.refresh();
  }

  private isUsable(t: TokenSet, now: number): boolean {
    if (!t.accessToken) return false;
    const exp = t.expiresAt ?? jwtExpiresAtMs(t.accessToken);
    if (exp === undefined) return true; // no expiry info → assume valid
    return exp - this.skew > now;
  }

  private refresh(): Promise<string> {
    this.inFlightRefresh ??= this.doRefresh().finally(() => {
      this.inFlightRefresh = undefined;
    });
    return this.inFlightRefresh;
  }

  private async doRefresh(): Promise<string> {
    const refreshToken =
      this.memory?.refreshToken ??
      (await this.readTokenCacheFile())?.refreshToken ??
      (await this.readProvidersJson())?.refreshToken ??
      this.opts.envRefreshToken;

    if (!refreshToken) {
      throw new TokenRefreshError(
        "No refresh token available. Sign in with the Cline CLI first, or set CLINE_REFRESH_TOKEN.",
      );
    }

    const url = this.opts.workosAuthenticateUrl ?? DEFAULT_WORKOS_AUTHENTICATE_URL;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: this.opts.workosClientId,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });
    } catch (err) {
      throw new TokenRefreshError("WorkOS refresh request failed", err);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new TokenRefreshError(
        `WorkOS refresh failed with HTTP ${res.status}: ${text.slice(0, 300)}`,
      );
    }

    const json = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!json.access_token) {
      throw new TokenRefreshError("WorkOS refresh response is missing access_token");
    }

    const next: TokenSet = {
      accessToken: normalizeWorkosToken(json.access_token),
      refreshToken: json.refresh_token ?? refreshToken,
      expiresAt: jwtExpiresAtMs(json.access_token),
    };

    this.memory = next;
    await this.persist(next);
    return next.accessToken;
  }

  // ---------- storage ----------

  private async readTokenCacheFile(): Promise<TokenSet | undefined> {
    if (!this.opts.tokenCachePath) return undefined;
    try {
      const raw = await fs.readFile(this.opts.tokenCachePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<TokenSet>;
      if (typeof parsed.accessToken !== "string") return undefined;
      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        expiresAt:
          typeof parsed.expiresAt === "number"
            ? parsed.expiresAt
            : jwtExpiresAtMs(parsed.accessToken),
      };
    } catch {
      return undefined;
    }
  }

  /** Reads the Cline CLI store; returns the freshest of the "cline"/"cline-pass" auth entries. */
  private async readProvidersJson(): Promise<TokenSet | undefined> {
    if (!this.opts.providersJsonPath) return undefined;
    try {
      const raw = await fs.readFile(this.opts.providersJsonPath, "utf8");
      const parsed = JSON.parse(raw) as ProvidersJsonShape;
      const candidates: TokenSet[] = [];
      for (const entry of Object.values(parsed.providers ?? {})) {
        const auth = entry?.settings?.auth;
        if (auth?.accessToken) {
          candidates.push({
            accessToken: auth.accessToken,
            refreshToken: auth.refreshToken,
            expiresAt:
              typeof auth.expiresAt === "number"
                ? auth.expiresAt
                : jwtExpiresAtMs(auth.accessToken),
          });
        }
      }
      if (candidates.length === 0) return undefined;
      candidates.sort((a, b) => (b.expiresAt ?? 0) - (a.expiresAt ?? 0));
      return candidates[0];
    } catch {
      return undefined;
    }
  }


  private async persist(next: TokenSet): Promise<void> {
    // 1. bridge-local cache (always, so a rotated refresh token is never lost)
    if (this.opts.tokenCachePath) {
      await atomicWriteJson(this.opts.tokenCachePath, {
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
        expiresAt: next.expiresAt,
        updatedAt: new Date().toISOString(),
      }).catch(() => undefined);
    }

    // 2. sync back into the Cline CLI store so CLI + bridge stay consistent
    if (this.opts.syncProvidersJson && this.opts.providersJsonPath) {
      try {
        const raw = await fs.readFile(this.opts.providersJsonPath, "utf8");
        const parsed = JSON.parse(raw) as ProvidersJsonShape;
        const stamp = new Date().toISOString();
        for (const [key, entry] of Object.entries(parsed.providers ?? {})) {
          const auth = entry?.settings?.auth;
          if (!entry || !auth || typeof auth !== "object") continue;
          if (!("accessToken" in auth) && !("refreshToken" in auth)) continue;
          auth.accessToken = next.accessToken;
          if (next.refreshToken) auth.refreshToken = next.refreshToken;
          if (next.expiresAt) auth.expiresAt = next.expiresAt;
          parsed.providers![key] = { ...entry, updatedAt: stamp };
        }
        await atomicWriteJson(this.opts.providersJsonPath, parsed);
      } catch {
        // never fail a refresh because of a sync problem — the local cache has the tokens
      }
    }
  }
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

