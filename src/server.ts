import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import type { AppConfig } from "./config.js";
import { extractBearerToken, isValidApiKey } from "./auth/apiKeys.js";
import type { ClineClient } from "./cline/client.js";
import { createChatHandler, openAiError } from "./proxy/chat.js";
import { modelsListResponse } from "./proxy/models.js";
import type { Logger } from "./logger.js";

export interface ServerDeps {
  config: AppConfig;
  clineClient: ClineClient;
  logger: Logger;
}

export function createApp(deps: ServerDeps): Hono {
  const { config, clineClient, logger } = deps;
  const app = new Hono();
  const chatHandler = createChatHandler({ client: clineClient });

  app.use("/*", cors());

  app.get("/health", (c) => c.json({ status: "ok", time: new Date().toISOString() }));

  // ---- protected OpenAI-compatible surface ----
  app.use("/v1/*", async (c, next) => {
    if (config.apiKeys.length === 0) {
      logger.error("refusing request: no API_KEYS configured");
      return c.json(
        openAiError("Server misconfiguration: no API keys configured.", {
          type: "authentication_error",
        }),
        500,
      );
    }
    const token = extractBearerToken(c.req.header("Authorization"));
    if (!isValidApiKey(token, config.apiKeys)) {
      return c.json(
        openAiError("Incorrect API key provided.", { type: "authentication_error" }),
        401,
      );
    }
    await next();
  });

  app.get("/v1/models", (c) => c.json(modelsListResponse()));

  app.post("/v1/chat/completions", async (c) => {
    const started = Date.now();
    const result = await chatHandler(await c.req.text());

    if (result.kind === "stream") {
      logger.info("chat.completions stream", {
        status: result.status,
        ms: Date.now() - started,
      });
      c.status(result.status as 200);
      for (const [k, v] of Object.entries(result.headers)) c.header(k, v);
      return stream(c, async (s) => {
        try {
          await s.pipe(result.body);
        } catch (err) {
          logger.warn("stream aborted mid-flight", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    }

    logger.info("chat.completions", { status: result.status, ms: Date.now() - started });
    return c.json(result.payload as Record<string, unknown>, result.status as 200);
  });

  app.notFound((c) =>
    c.json(openAiError(`Unknown path: ${c.req.method} ${c.req.path}`), 404),
  );

  app.onError((err, c) => {
    logger.error("unhandled error", { error: err.message });
    return c.json(openAiError("Internal server error", { type: "server_error" }), 500);
  });

  return app;
}
