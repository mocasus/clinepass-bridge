# clinepass-bridge

A tiny **OpenAI-compatible API bridge** that lets you use your **Cline Pass** account from
any tool that speaks the OpenAI API — Cursor, Continue.dev, LibreChat, the `openai` SDK,
`curl`, you name it.

```
[ your favorite tool ]  --(OpenAI API + your sk-cpb key)-->  [ clinepass-bridge ]
                                                              │  reads / refreshes your
                                                              │  Cline credentials
                                                              ▼
                                                     [ api.cline.bot ]
                                                     kimi-k3 · glm-5.2 · …
```

## Features

- ✅ `POST /v1/chat/completions` — streaming (SSE) **and** non-streaming
- ✅ `GET /v1/models` — the full Cline Pass catalog (11 models)
- ✅ Model aliases — `kimi-k3` works just like `cline-pass/kimi-k3`
- ✅ **Zero token babysitting** — reads the Cline CLI credential store
  (`~/.cline/data/settings/providers.json`), so the token stays fresh as long as
  you use the Cline CLI / VS Code extension
- ✅ **Auto-refresh** — when the token expires and the CLI hasn't refreshed it yet,
  the bridge performs a WorkOS `refresh_token` grant itself and writes the new
  tokens back (cache file + CLI store)
- ✅ Your own API keys (`sk-cpb-…`), multiple supported
- ✅ Retries once on `401/403` with a force-refreshed token

## Quick start

```bash
npm install
npm run genkey            # prints a fresh sk-cpb-... key
cp .env.example .env      # paste the key into API_KEYS
npm run dev               # http://127.0.0.1:8787
```

Test it:

```bash
curl http://127.0.0.1:8787/v1/models -H "Authorization: Bearer sk-cpb-…"

curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-cpb-…" \
  -H "Content-Type: application/json" \
  -d '{"model":"kimi-k3","messages":[{"role":"user","content":"hi"}]}'
```

## Configuration

See `.env.example`. The essentials:

| Variable | Default | Notes |
|---|---|---|
| `API_KEYS` | — | Comma-separated keys your clients use. **Required.** |
| `HOST` / `PORT` | `127.0.0.1:8787` | Bind address. |
| `PROVIDERS_JSON_PATH` | `~/.cline/data/settings/providers.json` | Cline CLI credential store. |
| `SYNC_PROVIDERS_JSON` | `true` | Write refreshed tokens back into the CLI store. |
| `CLINE_ACCESS_TOKEN` / `CLINE_REFRESH_TOKEN` | — | Manual override (server deploys without the CLI). |

**Running on a server?** Set `CLINE_REFRESH_TOKEN` (grab it from your local
`providers.json` → `providers.cline.settings.auth.refreshToken`) and optionally
`CLINE_ACCESS_TOKEN`. The bridge refreshes from there and keeps its own cache in
`.cache/tokens.json`.

## Docker

```bash
docker build -t clinepass-bridge .
docker run --rm -p 8787:8787 \
  -e API_KEYS=sk-cpb-… \
  -e CLINE_REFRESH_TOKEN=… \
  clinepass-bridge
```

## Models

`cline-pass/deepseek-v4-flash` · `cline-pass/deepseek-v4-pro` · `cline-pass/glm-5.2` ·
`cline-pass/kimi-k2.6` · `cline-pass/kimi-k2.7-code` · `cline-pass/kimi-k3` ·
`cline-pass/mimo-v2.5` · `cline-pass/mimo-v2.5-pro` · `cline-pass/minimax-m3` ·
`cline-pass/qwen3.7-max` · `cline-pass/qwen3.7-plus`

Short aliases (`kimi-k3`, `glm-5.2`, …) resolve automatically.

## Development

```bash
npm test          # vitest (36 tests)
npm run build     # tsc → dist/
npm start         # run the built server
```

## ⚠️ Disclaimer & security

- This uses Cline Pass **outside the official client**, which may be against
  Cline's Terms of Service. Intended for **personal, low-volume** use.
- Your WorkOS access/refresh tokens are sensitive. This repo **never** logs them,
  `.env` / `.cache/` are git-ignored, and the server binds to localhost by
  default. Don't expose it publicly without TLS + real key hygiene.
