import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { TokenManager } from "./auth/tokenManager.js";
import { ClineClient } from "./cline/client.js";
import { createApp } from "./server.js";

function main(): void {
  const config = loadConfig();

  if (config.apiKeys.length === 0) {
    logger.warn(
      "API_KEYS is empty — all /v1/* requests will be rejected. " +
        "Generate a key with `npm run genkey` and add it to your .env.",
    );
  }

  const tokenManager = new TokenManager({
    workosClientId: config.workosClientId,
    workosAuthenticateUrl: config.workosAuthenticateUrl,
    providersJsonPath: config.providersJsonPath,
    tokenCachePath: config.tokenCachePath,
    syncProvidersJson: config.syncProvidersJson,
    envAccessToken: process.env.CLINE_ACCESS_TOKEN,
    envRefreshToken: process.env.CLINE_REFRESH_TOKEN,
  });

  const clineClient = new ClineClient({
    baseUrl: config.clineApiBaseUrl,
    tokenManager,
    timeoutMs: config.requestTimeoutMs,
  });

  const app = createApp({ config, clineClient, logger });

  serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    logger.info(`clinepass-bridge listening`, {
      url: `http://${info.address}:${info.port}`,
      providersJson: config.providersJsonPath,
      apiKeysConfigured: config.apiKeys.length,
    });
  });
}

main();
