# clinepass-bridge

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

> **Repo:** https://github.com/mocasus/clinepass-bridge

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

## OpenAI API compatibility

The bridge implements the **Chat Completions** surface and forwards every request
field through to `api.cline.bot` unchanged (only `model` is remapped), so
anything the upstream honors — `temperature`, `max_tokens`, `tools`,
`tool_choice`, `response_format`, `seed`, … — works transparently.

| Endpoint | Status | Notes |
|---|---|---|
| `POST /v1/chat/completions` | ✅ | streaming (SSE) + non-streaming; body passed through |
| `GET /v1/models` | ✅ | 11 Cline Pass models + short aliases |
| `GET /health` | ✅ | deploy health checks |
| `/v1/embeddings` | ❌ | not implemented |
| `/v1/images/*`, `/v1/audio/*` | ❌ | not implemented |
| `/v1/assistants`, `/v1/threads`, `/v1/messages` | ❌ | Assistants API not implemented |
| `/v1/responses` | ❌ | Responses API not implemented |

**Tool / function calling:** the request body is forwarded verbatim, so it works
**if the upstream model supports it** — the bridge adds nothing of its own.

This covers any client that only needs Chat Completions: Cursor, Continue.dev,
LibreChat, Aider, the `openai` SDK, `curl`, and most coding extensions. Clients
that need embeddings / images / Assistants won't work.

## Quick start

**Prerequisite:** sign in with the **Cline CLI** (or VS Code extension) once so
your credentials land in `~/.cline/data/settings/providers.json`. The bridge
reads that file — nothing else to configure.

```bash
git clone https://github.com/mocasus/clinepass-bridge.git
cd clinepass-bridge
npm install
npm run genkey            # → prints a fresh sk-cpb-… key
```

Copy `.env.example` to `.env` (`copy` on Windows, `cp` on macOS/Linux) and paste
the key:

```ini
API_KEYS=sk-cpb-…         # several? comma-separate: sk-cpb-aaa,sk-cpb-bbb
```

Start the server:

```bash
npm run dev               # dev (auto-reload)  →  http://127.0.0.1:8787
# production:  npm run build && npm start
```

On boot you'll see a one-line JSON log:

```json
{"level":"info","time":"2026-07-22T00:00:00.000Z","msg":"clinepass-bridge listening","url":"http://127.0.0.1:8787","providersJson":"~/.cline/data/settings/providers.json","apiKeysConfigured":1}
```

> Logs are one-line JSON for easy piping. `apiKeysConfigured` equals the number
> of keys you set; if it's `0` with a `warn` about empty `API_KEYS`, your `.env`
> wasn't loaded.

Verify it works:

```bash
curl http://127.0.0.1:8787/v1/models -H "Authorization: Bearer sk-cpb-…"
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-cpb-…" \
  -H "Content-Type: application/json" \
  -d '{"model":"kimi-k3","messages":[{"role":"user","content":"hi"}]}'
```

> On **Windows CMD** swap `\` for `^` line-continuations and escape the quotes:
> `-d "{\"model\":\"kimi-k3\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"`
> (PowerShell just needs normal quoting.)

✅ Got a JSON reply with `"choices"`? You're live. Point any tool at
`http://127.0.0.1:8787/v1` with your `sk-cpb-…` key.

## Use with your favorite tools

Point any OpenAI-compatible client at the bridge:

| Tool | Base URL | API Key |
|---|---|---|
| **Continue.dev** | `http://127.0.0.1:8787/v1` | your `sk-cpb-…` |
| **Cursor** (custom OpenAI) | `http://127.0.0.1:8787/v1` | your `sk-cpb-…` |
| **LibreChat** | `http://127.0.0.1:8787/v1` | your `sk-cpb-…` |

**OpenAI SDK (Python / Node):**

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:8787/v1", api_key="sk-cpb-…")
print(client.chat.completions.create(
    model="kimi-k3",
    messages=[{"role": "user", "content": "hello"}],
).choices[0].message.content)
```

```ts
import OpenAI from "openai";
const client = new OpenAI({ baseURL: "http://127.0.0.1:8787/v1", apiKey: "sk-cpb-…" });
const res = await client.chat.completions.create({
  model: "glm-5.2",
  messages: [{ role: "user", content: "hello" }],
});
console.log(res.choices[0].message.content);
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

**Running on a server?** See [Deploy](#deploy) — set `CLINE_REFRESH_TOKEN` and
`SYNC_PROVIDERS_JSON=false`, and mount a volume at `.cache/`.

## Deploy

One codebase for local **and** production — only the env vars differ. On a
server set `HOST=0.0.0.0`, provide `API_KEYS` and `CLINE_REFRESH_TOKEN` (grab it
from your local `providers.json` → `providers.cline.settings.auth.refreshToken`),
and set `SYNC_PROVIDERS_JSON=false` (no Cline CLI store on the server). The
bridge caches rotated tokens in `.cache/tokens.json` — mount a **persistent
volume** there so they survive redeploys.

### Railway

Railway auto-detects the repo's `Dockerfile` — connect the GitHub repo, then set
these variables (Railway injects `PORT` for you and hands you a public domain +
TLS):

| Variable | Value |
|---|---|
| `HOST` | `0.0.0.0` |
| `API_KEYS` | `sk-cpb-…` |
| `CLINE_REFRESH_TOKEN` | from your local `providers.json` |
| `SYNC_PROVIDERS_JSON` | `false` |

Add a persistent volume mounted at `/app/.cache` so `.cache/tokens.json`
survives redeploys.

### Fly.io

A ready `fly.toml` ships in the repo.

```bash
fly launch --no-deploy
fly secrets set \
  API_KEYS=sk-cpb-… \
  CLINE_ACCESS_TOKEN=workos:eyJ… \
  CLINE_REFRESH_TOKEN=…
fly deploy
fly open                        # https://clinepass-bridge.fly.dev
```

### Docker (any VPS)

```bash
docker build -t clinepass-bridge .
docker run -d -p 8787:8080 --name clinepass-bridge \
  -e HOST=0.0.0.0 -e PORT=8080 \
  -e API_KEYS=sk-cpb-… \
  -e CLINE_REFRESH_TOKEN=… \
  -v clinepass-cache:/app/.cache \
  clinepass-bridge
```

> **Avoid serverless platforms** (Vercel/Netlify) — their request timeouts kill
> LLM streaming. Use a VM-style host (Railway, Fly.io, Render) or run it locally.

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
