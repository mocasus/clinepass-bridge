import "dotenv/config";
import { homedir } from "node:os";
import path from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  /** API keys accepted from bridge clients. */
  apiKeys: string[];
  clineApiBaseUrl: string;
  workosClientId: string;
  workosAuthenticateUrl: string;
  /** Path to the Cline CLI credential store (shared with the CLI). */
  providersJsonPath: string;
  /** Write refreshed tokens back into the Cline CLI store. */
  syncProvidersJson: boolean;
  /** Bridge-local token cache (keeps rotated refresh tokens safe). */
  tokenCachePath: string;
  requestTimeoutMs: number;
}

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === "") return dflt;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiKeys = (env.API_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    host: env.HOST ?? "127.0.0.1",
    port: Number.parseInt(env.PORT ?? "8787", 10),
    apiKeys,
    clineApiBaseUrl: (env.CLINE_API_BASE_URL ?? "https://api.cline.bot").replace(/\/+$/, ""),
    workosClientId: env.WORKOS_CLIENT_ID ?? "client_01K3A541FN8TA3EPPHTD2325AR",
    workosAuthenticateUrl:
      env.WORKOS_AUTHENTICATE_URL ?? "https://api.workos.com/user_management/authenticate",
    providersJsonPath:
      env.PROVIDERS_JSON_PATH ??
      path.join(homedir(), ".cline", "data", "settings", "providers.json"),
    syncProvidersJson: bool(env.SYNC_PROVIDERS_JSON, true),
    tokenCachePath: env.TOKEN_CACHE_PATH ?? path.join(process.cwd(), ".cache", "tokens.json"),
    requestTimeoutMs: Number.parseInt(env.REQUEST_TIMEOUT_MS ?? "300000", 10),
  };
}
