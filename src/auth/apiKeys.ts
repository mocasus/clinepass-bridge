import { randomBytes, timingSafeEqual } from "node:crypto";

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(authorizationHeader);
  return match?.[1] ?? null;
}

/**
 * Extracts an API key from either an `Authorization: Bearer <key>` header
 * (OpenAI-style) or an `x-api-key: <key>` header (Anthropic-style).
 */
export function extractApiKey(
  authorizationHeader: string | undefined,
  apiKeyHeader: string | undefined,
): string | null {
  const bearer = extractBearerToken(authorizationHeader);
  if (bearer) return bearer;
  if (apiKeyHeader && apiKeyHeader.trim()) return apiKeyHeader.trim();
  return null;
}

/** Constant-time membership check against the configured API keys. */
export function isValidApiKey(presented: string | null, validKeys: readonly string[]): boolean {
  if (!presented) return false;
  const presentedBuf = Buffer.from(presented, "utf8");
  for (const key of validKeys) {
    const keyBuf = Buffer.from(key, "utf8");
    if (keyBuf.length === presentedBuf.length && timingSafeEqual(keyBuf, presentedBuf)) {
      return true;
    }
  }
  return false;
}

export function generateApiKey(prefix = "sk-cpb"): string {
  return `${prefix}-${randomBytes(24).toString("base64url")}`;
}
