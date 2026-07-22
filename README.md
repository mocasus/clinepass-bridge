# clinepass-bridge

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![Powered by Cline](https://img.shields.io/badge/Powered%20by-Cline-3B82F6?logo=cline&logoColor=white)](https://github.com/cline/cline)

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
- ✅ **Anthropic Messages API** — `POST /v1/messages` (streaming + non-streaming),
  so Claude Code, the Anthropic SDK, and any Anthropic-API client can use Cline
  Pass too. Authenticate with `x-api-key: sk-cpb-…` (the OpenAI
  `Authorization: Bearer` header is also accepted).

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
| `POST /v1/messages` | ✅ | Anthropic Messages API (streaming + non-streaming); body translated to/from OpenAI Chat Completions |
| `/v1/assistants`, `/v1/threads` | ❌ | Assistants API not implemented |
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

> Already have the folder locally? Skip `git clone` — just `cd clinepass-bridge`
> and run `npm install`. (Cloning into an existing, non-empty dir fails with
> `destination path already exists`, which is expected.)

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
# List models
curl -s http://127.0.0.1:8787/v1/models \
  -H "Authorization: Bearer sk-cpb-…"

# Chat completion (non-streaming)
curl -s http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-cpb-…" \
  -H "Content-Type: application/json" \
  -d '{"model":"kimi-k3","messages":[{"role":"user","content":"hi"}]}'

# Stream (add "stream": true)
curl -s http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-cpb-…" \
  -H "Content-Type: application/json" \
  -d '{"model":"kimi-k3","messages":[{"role":"user","content":"tell me a joke"}],"stream":true}'
```

Expected response (non-streaming):

```json
{
  "id": "chatcmpl-…",
  "object": "chat.completion",
  "model": "kimi-k3",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello! How can I help?" },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18 }
}
```

> On **Windows CMD** swap `\` for `^` line-continuations and escape the quotes:
> `-d "{\"model\":\"kimi-k3\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"`
> (PowerShell just needs normal quoting.)

✅ Got a JSON reply with `"choices"`? You're live. Point any tool at
`http://127.0.0.1:8787/v1` with your `sk-cpb-…` key.

## IDE & tool support

The bridge speaks the **OpenAI Chat Completions API**, so any client that lets you point
at a custom OpenAI endpoint just works. Point it at `http://127.0.0.1:8787/v1` (or your
deployed URL) and use your `sk-cpb-…` key as the API key.

<p align="center">
  <sub><b>Works with any OpenAI-compatible client</b></sub>

  <br>
  <a href='https://cursor.com'><img src='https://img.shields.io/badge/Cursor-compatible-000000?logo=cursor&logoColor=white' alt='https://cursor.com'></a>
  <a href='https://code.visualstudio.com'><img src='https://img.shields.io/badge/VS_Code-compatible-007ACC?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHRpdGxlPmZpbGVfdHlwZV92c2NvZGU8L3RpdGxlPjxwYXRoIGQ9Ik0yOS4wMSw1LjAzLDIzLjI0NCwyLjI1NGExLjc0MiwxLjc0MiwwLDAsMC0xLjk4OS4zMzhMMi4zOCwxOS44QTEuMTY2LDEuMTY2LDAsMCwwLDIuMywyMS40NDdjLjAyNS4wMjcuMDUuMDUzLjA3Ny4wNzdsMS41NDEsMS40YTEuMTY1LDEuMTY1LDAsMCwwLDEuNDg5LjA2NkwyOC4xNDIsNS43NUExLjE1OCwxLjE1OCwwLDAsMSwzMCw2LjY3MlY2LjYwNUExLjc0OCwxLjc0OCwwLDAsMCwyOS4wMSw1LjAzWiIgc3R5bGU9ImZpbGw6IzAwNjVhOSIvPjxwYXRoIGQ9Ik0yOS4wMSwyNi45N2wtNS43NjYsMi43NzdhMS43NDUsMS43NDUsMCwwLDEtMS45ODktLjMzOEwyLjM4LDEyLjJBMS4xNjYsMS4xNjYsMCwwLDEsMi4zLDEwLjU1M2MuMDI1LS4wMjcuMDUtLjA1My4wNzctLjA3N2wxLjU0MS0xLjRBMS4xNjUsMS4xNjUsMCwwLDEsNS40MSw5LjAxTDI4LjE0MiwyNi4yNUExLjE1OCwxLjE1OCwwLDAsMCwzMCwyNS4zMjhWMjUuNEExLjc0OSwxLjc0OSwwLDAsMSwyOS4wMSwyNi45N1oiIHN0eWxlPSJmaWxsOiMwMDdhY2MiLz48cGF0aCBkPSJNMjMuMjQ0LDI5Ljc0N2ExLjc0NSwxLjc0NSwwLDAsMS0xLjk4OS0uMzM4QTEuMDI1LDEuMDI1LDAsMCwwLDIzLDI4LjY4NFYzLjMxNmExLjAyNCwxLjAyNCwwLDAsMC0xLjc0OS0uNzI0LDEuNzQ0LDEuNzQ0LDAsMCwxLDEuOTg5LS4zMzlsNS43NjUsMi43NzJBMS43NDgsMS43NDgsMCwwLDEsMzAsNi42VjI1LjRhMS43NDgsMS43NDgsMCwwLDEtLjk5MSwxLjU3NloiIHN0eWxlPSJmaWxsOiMxZjljZjAiLz48L3N2Zz4=&logoColor=white' alt='https://code.visualstudio.com'></a>
  <a href='https://www.continue.dev'><img src='https://img.shields.io/badge/Continue.dev-compatible-000000?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAADD0lEQVR4nGL5/PkzAy0BE01NH7VgZFjAgl/606dPO3bsQRNkZ2f38nJjZWUlxgJG/Plg8uTpa9duRBMMDQ26f/9BV1cLExPhAMDng0ePHm/YsEVJSSEkJPDx4ydwcU5OjjNnzu3Zs5+VlVVKSkJNTZWRkZFkH/z//7+kpOrs2fMpKQmfP3/esGHzz5+/IFJBQX4vXrz8+PHz9evXExJieXi4g4L8SbbgyJHjNTWN9va2Dx8++vTpU3V12cuXryBSrKws+vp6mzZtFRMT3bZt57NnL5Ytm8fDw4PVHOxB9Pv375kz57KxsUlKih88eDg0NNDY2BBNwcGDh1+9eh0WFrx48fI5cxYUFORgNQp7LN24cVNFRSk5OX7Hjt28vDxxcVFoClhZWfPysn7+/HX37j11ddWNG7fevXufBAv+//9/+fLVu3fvCQsLpaYm8fLyYqoxNTW2sjI/duykmZnJ////Z8yYjdUo5qqqKkxRcXHx27fv3rlzNzY20t3dBVciUVVVuXXrDicnp5SUxLFjJ1VVVeTkZIj1wf///5mYmP/////v3z+sahgYGP78+fP3719GRsY/f/6A4pMFS4xit+DcuQtnz55XVVVetGj5pk1bcVkwY8bcGzdu8fPzHTly3MLCzNzchFgLODjYdXS0ZWWlP3/+PHfuog8fPmCqOX781KlTZ2xsrI4fP8nMzJyRkYzVKOwWaGhoPH78ZN68xW5uzl++fFm4cBmagl+/fk+aNI2dnU1BQe7OnXuBgb4KCvJYjcKeD5iZmTIzU8rLax8+fKyqqnz48FFzc5Pnz19CZNnZ2QwN9W1sLMXERA8cOCwoKJiYGIvVHAKFXUVF7YkTp5OT479+/bp27cbfv39DxENCAh48ePTr16/Ll68mJ8fx8fH5+XmTY8HTp88SE9MlJSX9/LyfPEEUdgICAvPnL66rq+Dg4JSQEFNUVCCnsIOAGTPmrFixBk0wODjg8eMnnZ3NeMwl1oLPn7/s3r0PTZCdnc3V1YmNjY2g6YQtoBwM/Up/1IKBtwAQAAD//7rlRWZ+M6P0AAAAAElFTkSuQmCC&logoColor=white' alt='https://www.continue.dev'></a>
  <a href='https://aider.chat'><img src='https://img.shields.io/badge/Aider-compatible-EF3A42?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAF50lEQVR4nFRWTW8cxRY9t6r6wz3jGfs5eYks2S9Pesru6eUhIBEbFghY8h/YsOAPICGWLPgZ+RGwgBVCiC1IiAUSihQpJHGCM56ZzFd310XnVrWdjMet6p7q+3HuuedWwN1bEEAEzsGBV28LEYja1R6mBbcBjisAUIVG+8nxgQIxIqar2gYEbLsrBwJ4W3h73z4iUHHioCKSLCfj6V/yTtoXmHXll775NGDXWwgCp/nKDMxZ48N7t2LjGbyIOCee4SszgLvY9t8+kG1UM67J7avWlTEElGFAw+X0vcBbyP9s4sdvx2sNNEOU/lJoeLyQn5/qfMebXiXSgdJBzG6IkgQ0Bd9wA47JQeHUC6Z7aG6i2Dd7bvhmfGT8F66P4D0j7aN2AmWc2kf64FWgGhDcUINcRvGigWWQMsDXgkYHBzo4sPI1qAtUHSPtIxwtqlp80aHr0cMg2rWADA7ogxDvjC3zDbZnOl4NGciwsM/2BRYbfpkB0EWru7Nbc0mUELDp+Jq7ysBYaFjN1v63B3JUG0v4lLVAZqTONzoJ4vZEVc82+rIVOuBd9mFMFbxxYpxx4lXdAFeiZwBKY454Fc0JJI6p4njkP39fxw35ef+n/us/EnIsgyq6TKeAvYLvEHcvnkzVKwcO3msRrf7poZHYOxo6aPTgONZjoHf/OMBhzeAvCdoKS50dOEEhCF6Dhx8ilcRXj5LWEzkNOmtDUZnU6g6BCX9pxtivjKNKFqmiVAIanTVaqnsvTCp1MgHp0Ql8RO/FDcJgLGO6IlhupX+h6IAOqyVWO6F1JHYO7RYDNq1x38Gbp7S2isKrFB5FUiSRK/mAONXlFvMn0DlDmc0w32qnEq3+CaXcyanWZEDMLOaa1ZZrI/fpvTiqxdqQWmTv0QqsGSuPrhV0hGFLZMw0rZt6qIldU1FeAsEV57goXE7i5kT/e1vrWuGN4AMPKWnImsdPJ9N9TErEoVAacxJRA0YlW8eTM+odgqLwmSrXRlqcAFWiJ64wildgJc7vT7FfGe4DOFyw9YJ0Ud2l5/ROn7u/6wU7i/f1Hn7NAaUOfUttiJfWlQVXMjXoess9ZGRPJBI4qZsuVmgfpRFhLeBM8ntYt6RoSCftMJ9h0b2q1UZZhmI0TcLgHILA9e6tG3LnRmpv3P/eJYVxadrwQy8QjIO+8x9UlUor8zXWO8sg5kpcTbQqZP3xju0mkHun8aM7kOCenPeffYNtbwjZtEjzIDX18Vg+/J+OxuyDwzHGBe32Jnx52mQWFWnCUBgKRqrXj+BPCMio5EjYRlgWw1i2ZobI9X3dO0agVOBgimltlVO01skpFPZBAseZKqQa1HuK2nZ422IyznBkGNrWFsFDSnBnB+9JcWdngCSFBrtAgrzcgb8JQovCixes5sBj7lieYWZyn2nm8nA3Nknj0D7WYg7tsbjAxToPhjZm3jkqStDVIBXi4FvG8uufvqFGy2LlT0YpWQ71RA+NEpW8agJ++d2XpaKX9RqnY86z803/YJkzSAKDu/8yiIaJHxwqz1RE5PYUX3ygZZFjzp2S6SHnS/3yO326Yk0+eVPf/bcC4ceH3Vc/sBKKNMECqsJ0344RHPeB+lyYKowrqW9qaIb6prNQJ2JFHM8xqbHsGOXhkZan3DHaYFqh7wcceWzx4BiAJnko0mwwxMoSMgWaYdwnevZZiwpBXaZxIuMJcEAUq32MCnSB4m/CZSe7LpJC0uVDYxjEbrFGfAa/l46POhRYk5asZjhfYdFyPKxmgmfMr53JaqedpukipOmqNYmWfE00T4fU85fuxSNUIZ3skM+qgwQ9v4jPlpi16p178lzmD4nbxZlebGjdhr61w/9PrRU0n3DdK4fcyslRQwbns3AaFdYTUZn387Uo5wQmBWprmk2H2XY4oaYa1D7bvfxe3nrooh0UQgbBsK5L58O9Kp1M0CraTqLFXBd8RK12QrGrQtavYGPADUf2NPHpL8rAUgbrTTdUpKORnJnNBU3zIA8mVRuTfwcAAP//hSQA9XEXf8oAAAAASUVORK5CYII=&logoColor=white' alt='https://aider.chat'></a>
  <a href='https://platform.openai.com/docs/api-reference'><img src='https://img.shields.io/badge/OpenAI-compatible-412991?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAERElEQVR4nOyWW4hSXRvHn9luTYy0IrfCLsRIQa2otKibJLTmIi0toSAIMbywkwURHSEiQiKsiw4X0YUVEt3sDhBU0IkMK4t27AI7KBiEg47jzB7HEQ/Px/euF5F5G51e6CJ4/1drPfzX81trr7WetWlEhN8p6rdm/w8wFdE9HdVqleO4p0+flstllmX7/1JfX98UAX3dT5EgCB6Pp1AorF+/nmEYQRCePHnicrn8fv+XL18UCoXdbl+0aFE3Ak6uYrGo1Wq9Xm+pVCKRZrO5b98+AJBKpXq9fubMmQDg8/mKxeJkSboBTp48uXjx4lqtRrovXryw2WxSqfT48eOiKCJiq9W6f/8+y7ILFy4cGRn5NUAikTAYDLFYDBGz2ezWrVtlMlkwGPz27RsiViqV79+/E2cul2NZNhQKTRVQLpddLhf5gMlkEhGdTqfNZvv8+TMx3LlzZ+7cuRKJZOfOnUNDQ4h48eJFuVxerVanBHA6nRqN5vHjxzNmzHj16hUi2u32U6dOIWImk9m8eTNFUTt27Lh06ZJWq503bx7Hce/fvweA9gy6Ae7du0dR1Js3bxCxE3DkyJFjx47J5XIA2LJlS71eR8Th4eFdu3YBwNKlSwEgk8n0BgQCAZ/PR9qdAIqizGbz9evXb9y4YTAYjEbjtWvXCIbnea/XCwAPHjzoDVizZs3p06f/CfD7/c1mk8Sr1arb7QYAi8WSSCRI8MSJExqNhpyuTk0sFUqlslAotLsfPnwgjQULFlDU32a5XD5//nyLxWI2m1evXn3gwAEAOHr06LRp0+Lx+ISEEwErVqy4fft2vV4HgO3btweDwY0bN3Yi25ozZ86tW7fOnDlz+fLl/9ccmnY6nc+fP+8BCAQCoiju3bu30WhcuHAhmUw2Go1Pnz6lUqlyuUw8+Xye5/n2ytpjVSqVKIq9SwWZxbJly1KpFIk8e/bMZDLNnj07Go2eO3dOpVLRNG2328mdUCgUxOZwOA4fPtxjkxExnU4DgNVqpWl6//795CqNjY05HA4AmD59ejQa3bNnzwTA69evaZoWBKE34OPHjwDA8/zNmzcZhlGr1efPn9+0aRMAbNu2jVSIcDjcCXj06BHDMH6/v/cxRcTx8XGlUnn27FlEFEUxEomo1ep169a9ffuWGO7evavT6dxuNyJyHAcAMpksFApVKpUpARDx4MGDs2bNyuVypNtqtUhDEIS1a9fKZLJDhw6R8hmJRGw2248fP36aZ1LA6OjokiVLjEbjw4cPG40GIubz+d27d9M0vXLlSp7nia1Wq5lMpitXrkyWvVu5LpVKGzZsILvKsqxEIgGAcDjcXs3g4KDH4+l8MH6qHk9mOp1+9+5drVbT6/VXr16Nx+NWq9VgMAwMDLx8+XL58uWxWEyn03XJ0AMwQV+/fuU4LpvNMgzT39+/atWqnkN+DfAv9Of/eP35gP8FAAD//4LRqxZbTERiAAAAAElFTkSuQmCC&logoColor=white' alt='https://platform.openai.com/docs/api-reference'></a>
  <a href='https://nousresearch.com'><img src='https://img.shields.io/badge/Hermes-compatible-FFD700?logo=data:image/png;base64,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&logoColor=white' alt='https://nousresearch.com'></a>
</p>

| Tool | Where to set it | Notes |
|---|---|---|
| **Cursor** | Settings → Models → *OpenAI API Key* | Set *Override OpenAI Base URL* to the bridge URL |
| **Continue.dev** (VS Code & JetBrains) | `~/.continue/config.json` → `"provider": "openai"` | Runs inside VS Code and JetBrains IDEs |
| **LibreChat** | `.env` → `OPENAI_REVERSE_PROXY` | Custom OpenAI-compatible endpoint |
| **Aider** | `--openai-api-base` flag / env | LiteLLM `openai/<model>` prefix |
| **OpenAI SDK** (Python / Node) | `base_url` / `baseURL` ctor arg | Drop-in for the `openai` package |
| **`curl`** | `Authorization: Bearer …` header | Quick smoke test |

### Cursor

1. Open **Cursor** → **Settings** (`Ctrl`/`Cmd` + `,`) → **Models**.
2. Expand the **OpenAI API Key** section and paste your `sk-cpb-…` key.
3. Turn on **Override OpenAI Base URL** and set it to `http://127.0.0.1:8787/v1`
   (use your deployed URL in production).
4. Add the model id to the custom-models list — e.g. `kimi-k3` (short alias) or
   `cline-pass/kimi-k3` — then click **Verify**.
5. Pick that model in chat. Done.

### Continue.dev (VS Code & JetBrains)

Continue is an extension for VS Code and JetBrains IDEs. Add a model to
`~/.continue/config.json` (`%USERPROFILE%\.continue\config.json` on Windows):

```json
{
  "models": [
    {
      "title": "Cline Pass — Kimi K3",
      "provider": "openai",
      "model": "cline-pass/kimi-k3",
      "apiBase": "http://127.0.0.1:8787/v1",
      "apiKey": "sk-cpb-…"
    }
  ]
}
```

Reload the IDE and pick the model from Continue's dropdown. The `"provider": "openai"`
mode speaks the OpenAI Chat Completions API, which is exactly what the bridge implements.

### LibreChat

LibreChat can front any OpenAI-compatible endpoint via its reverse-proxy setting. In your
LibreChat `.env`:

```ini
OPENAI_API_KEY=sk-cpb-…
OPENAI_REVERSE_PROXY=http://127.0.0.1:8787/v1/chat/completions
OPENAI_MODELS=kimi-k3,glm-5.2,deepseek-v4-pro,qwen3.7-max
ENDPOINTS=openai
```

Restart LibreChat and the Cline Pass models you listed appear under the OpenAI endpoint.

### Aider

Aider is driven by LiteLLM, so address the bridge as an `openai/` provider:

```bash
aider \
  --model openai/kimi-k3 \
  --openai-api-base http://127.0.0.1:8787/v1 \
  --openai-api-key sk-cpb-…
```

…or via env: `OPENAI_API_BASE=http://127.0.0.1:8787/v1` + `OPENAI_API_KEY=sk-cpb-…`.

### OpenAI SDK (Python / Node)

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

### `curl`

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-cpb-…" \
  -H "Content-Type: application/json" \
  -d '{"model":"kimi-k3","messages":[{"role":"user","content":"hi"}]}'
```

> On **Windows CMD** swap `\` for `^` line-continuations and escape the quotes:
> `-d "{\"model\":\"kimi-k3\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}"`
> (PowerShell just needs normal quoting.)

### Which models can I use?

The bridge serves the **11 Cline Pass models** listed under [Models](#models) and accepts
both short aliases (`kimi-k3`) and full ids (`cline-pass/kimi-k3`). Any other model name in
a request is forwarded to `api.cline.bot` **unchanged**, so it works with whatever the
upstream exposes — the bridge never invents or blocks a model name.

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

| Model ID | Context | Aliases |
|---|---|---|
| `cline-pass/kimi-k3` | 1,048,576 | `kimi-k3` |
| `cline-pass/glm-5.2` | 1,048,576 | `glm-5.2` |
| `cline-pass/deepseek-v4-pro` | 1,048,576 | `deepseek-v4-pro` |
| `cline-pass/deepseek-v4-flash` | 1,048,576 | `deepseek-v4-flash` |
| `cline-pass/mimo-v2.5-pro` | 1,048,576 | `mimo-v2.5-pro` |
| `cline-pass/mimo-v2.5` | 1,048,576 | `mimo-v2.5` |
| `cline-pass/minimax-m3` | 1,048,576 | `minimax-m3` |
| `cline-pass/qwen3.7-max` | 262,144 | `qwen3.7-max` |
| `cline-pass/qwen3.7-plus` | 262,144 | `qwen3.7-plus` |
| `cline-pass/kimi-k2.7-code` | 262,144 | `kimi-k2.7-code` |
| `cline-pass/kimi-k2.6` | 262,144 | `kimi-k2.6` |

Short aliases (`kimi-k3`, `glm-5.2`, …) resolve automatically.

## Use with Anthropic clients (Claude Code, Anthropic SDK)

The bridge also speaks the **Anthropic Messages API** at `POST /v1/messages`,
so any Anthropic-API client works. Authenticate with your bridge key in the
`x-api-key` header (the OpenAI `Authorization: Bearer` header is accepted too).

**Claude Code** — point it at the bridge with env vars, then run `claude`:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
export ANTHROPIC_API_KEY=sk-cpb-…
```

**Anthropic Python SDK:**

```python
import anthropic

client = anthropic.Anthropic(
    api_key="sk-cpb-…",
    base_url="http://127.0.0.1:8787",
)
msg = client.messages.create(
    model="kimi-k3",
    max_tokens=1024,
    messages=[{"role": "user", "content": "hi"}],
)
```

**curl:**

```bash
curl http://127.0.0.1:8787/v1/messages \
  -H "x-api-key: sk-cpb-…" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"kimi-k3","max_tokens":256,"messages":[{"role":"user","content":"hi"}]}'
```

The bridge translates Anthropic `messages` / `system` / `tools` / `tool_choice`
to OpenAI Chat Completions and converts the response (and the SSE stream) back
to the Anthropic shape — including `tool_use` / `tool_result` blocks and
`input_json_delta` streaming.

## Development

```bash
npm test          # vitest (36 tests)
npm run build     # tsc → dist/
npm start         # run the built server
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `apiKeysConfigured: 0` | `.env` not loaded | Make sure `.env` is in project root and `API_KEYS` is set |
| `No refresh token available` | No Cline CLI login | Run `npx cline` and sign in once, or set `CLINE_REFRESH_TOKEN` |
| Streaming cuts off mid-response | Serverless platform timeout | Use a VM (Railway, Fly.io, VPS). Don't use Vercel/Netlify |
| `Port already in use` | Another process on the port | Change `PORT` in `.env` or `lsof -ti:8787 \| xargs kill` |
| `401` / `403` from upstream | Token expired and refresh failed | Check `providers.json` path; sign in with Cline CLI again |
| `connection refused` | Bridge not running | Run `npm run dev` first, verify with `curl /health` |

## Docs site

Full documentation with interactive examples at **[clinepass-bridge.pages.dev](https://mocasus.github.io/clinepass-bridge/)**.

## ⚠️ Disclaimer & security

- This uses Cline Pass **outside the official client**, which may be against
  Cline's Terms of Service. Intended for **personal, low-volume** use.
- Your WorkOS access/refresh tokens are sensitive. This repo **never** logs them,
  `.env` / `.cache/` are git-ignored, and the server binds to localhost by
  default. Don't expose it publicly without TLS + real key hygiene.
