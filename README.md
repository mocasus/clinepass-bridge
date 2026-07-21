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

## Quick start

**Prerequisite:** sign in with the **Cline CLI** (or VS Code extension) at least
once, so your credentials exist at `~/.cline/data/settings/providers.json`.
The bridge reads that file — nothing else to configure.

### 1. Install

```bash
git clone https://github.com/mocasus/clinepass-bridge.git
cd clinepass-bridge
npm install
```

### 2. Create your `.env`

**Windows (PowerShell / CMD):**

```powershell
copy .env.example .env
```

**macOS / Linux:**

```bash
cp .env.example .env
```

### 3. Generate an API key and put it in `.env`

```bash
npm run genkey
```

Copy the printed `sk-cpb-…` value, then open `.env` and set:

```ini
API_KEYS=sk-cpb-…
```

> 💡 Multiple keys? Separate with commas: `API_KEYS=sk-cpb-aaa,sk-cpb-bbb`

### 4. Run it

```bash
npm run dev          # dev mode (auto-reload)  → http://127.0.0.1:8787
# or, production:
npm run build && npm start
```

You should see a single-line JSON log like:

```json
{"level":"info","time":"2026-07-22T00:00:00.000Z","msg":"clinepass-bridge listening","url":"http://127.0.0.1:8787","providersJson":"~/.cline/data/settings/providers.json","apiKeysConfigured":1}
```

> Logs are emitted as one-line JSON so they're easy to pipe/parse. The `time`
> and `providersJson` values differ on your machine, and `apiKeysConfigured`
> matches the number of keys you set in `API_KEYS`. If you instead see a `warn`
> about empty `API_KEYS` and `apiKeysConfigured:0`, your `.env` wasn't picked up
> — go back to Step 3.

### 5. Verify it works

```bash
# should return the 11-model catalog
curl http://127.0.0.1:8787/v1/models -H "Authorization: Bearer sk-cpb-…"

# a real chat completion
curl http://127.0.0.1:8787/v1/chat/completions ^
  -H "Authorization: Bearer sk-cpb-…" ^
  -H "Content-Type: application/json" ^
  -d "{\"model\":\"kimi-k3\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"
```

> On **macOS/Linux** use `\` line-continuations and single quotes:
>
> ```bash
> curl http://127.0.0.1:8787/v1/chat/completions \
>   -H "Authorization: Bearer sk-cpb-…" \
>   -H "Content-Type: application/json" \
>   -d '{"model":"kimi-k3","messages":[{"role":"user","content":"hi"}]}'
> ```

✅ Got a JSON reply with `"choices"`? The bridge is working. Point your tools at
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

**Running on a server?** Set `CLINE_REFRESH_TOKEN` (grab it from your local
`providers.json` → `providers.cline.settings.auth.refreshToken`) and optionally
`CLINE_ACCESS_TOKEN`. The bridge refreshes from there and keeps its own cache in
`.cache/tokens.json`.

## Docker

```bash
docker build -t clinepass-bridge .
docker run --rm -p 8787:8080 \
  -e HOST=0.0.0.0 -e PORT=8080 \
  -e API_KEYS=sk-cpb-… \
  -e CLINE_REFRESH_TOKEN=… \
  clinepass-bridge
```

## Deploy to Fly.io

The repo ships a ready `fly.toml`.

```bash
fly launch --no-deploy          # creates the app (uses fly.toml)
fly secrets set \
  API_KEYS=sk-cpb-… \
  CLINE_ACCESS_TOKEN=workos:eyJ… \
  CLINE_REFRESH_TOKEN=…
fly deploy
fly open                        # https://clinepass-bridge.fly.dev
```

> **Note:** a long-running HTTP server doesn't fit serverless platforms
> (Vercel/Netlify) — their request timeouts kill LLM streaming. Use a VM-style
> host (Fly.io, Railway, Render) or run it locally.

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
