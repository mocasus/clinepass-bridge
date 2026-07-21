export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
}

/** Cline Pass model catalog (extracted from @cline/llms v3.65.2, 2026-07-21). */
export const CLINE_PASS_MODELS: readonly ModelInfo[] = [
  { id: "cline-pass/deepseek-v4-flash", name: "DeepSeek V4 Flash", contextWindow: 1048576 },
  { id: "cline-pass/deepseek-v4-pro", name: "DeepSeek V4 Pro", contextWindow: 1048576 },
  { id: "cline-pass/glm-5.2", name: "GLM-5.2", contextWindow: 1048576 },
  { id: "cline-pass/kimi-k2.6", name: "Kimi K2.6", contextWindow: 262144 },
  { id: "cline-pass/kimi-k2.7-code", name: "Kimi K2.7 Code", contextWindow: 262144 },
  { id: "cline-pass/kimi-k3", name: "Kimi K3", contextWindow: 1048576 },
  { id: "cline-pass/mimo-v2.5", name: "MiMo-V2.5", contextWindow: 1048576 },
  { id: "cline-pass/mimo-v2.5-pro", name: "MiMo-V2.5-Pro", contextWindow: 1048576 },
  { id: "cline-pass/minimax-m3", name: "MiniMax-M3", contextWindow: 1048576 },
  { id: "cline-pass/qwen3.7-max", name: "Qwen3.7 Max", contextWindow: 262144 },
  { id: "cline-pass/qwen3.7-plus", name: "Qwen3.7 Plus", contextWindow: 262144 },
];

/**
 * Friendly aliases so clients can use short names. Both the alias and the
 * full "cline-pass/<name>" id are accepted and resolved upstream.
 */
const ALIASES: Record<string, string> = Object.fromEntries(
  CLINE_PASS_MODELS.flatMap((m) => {
    const short = m.id.replace(/^cline-pass\//, "");
    return [
      [short, m.id],
      [m.name.toLowerCase().replace(/\s+/g, "-"), m.id],
    ];
  }),
);

const KNOWN_IDS = new Set(CLINE_PASS_MODELS.map((m) => m.id));

/** Maps a client-supplied model name to the id sent upstream. Unknown names pass through. */
export function resolveModel(requested: string): string {
  const key = requested.trim().toLowerCase();
  return KNOWN_IDS.has(requested) ? requested : (ALIASES[key] ?? requested);
}

/** OpenAI-style GET /v1/models payload. */
export function modelsListResponse(created = Math.floor(Date.now() / 1000)) {
  return {
    object: "list",
    data: CLINE_PASS_MODELS.map((m) => ({
      id: m.id,
      object: "model",
      created,
      owned_by: "cline-pass",
      name: m.name,
      context_window: m.contextWindow,
    })),
  };
}
