import { randomBytes, timingSafeEqual } from "node:crypto";

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(authorizationHeader);
  return match?.[1] ?? null;
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
