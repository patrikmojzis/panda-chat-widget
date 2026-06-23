# Panda Chat Widget

TypeScript/pnpm workspace for a future embeddable Panda chat widget. The repo is still early: it defines package ownership, shared TypeScript settings, a command contract, and a minimal Fastify server health endpoint.

## Current scope

V1 is widget-only chat spine work. This repository is not a working chat widget yet.

In scope today:

- pnpm workspace layout
- Node 24 engine target
- TypeScript configuration presets for Node and browser packages
- root commands that future agents and humans can run consistently
- Fastify server seam with `GET /healthz`

Current non-goals:

- server functionality beyond the minimal `/healthz` route
- database/Kysely or SSE runtime behavior
- React/Vite widget UI implementation
- host-page loader runtime behavior
- Docker, CLI, deployments, or production packaging
- Panda Gateway/Panda agent integration
- real chat logic

## Workspace packages

| Path | Package | Responsibility |
| --- | --- | --- |
| `apps/server` | `@panda-chat-widget/server` | Future API, database, and SSE service; currently owns `/healthz`. |
| `apps/widget-ui` | `@panda-chat-widget/widget-ui` | Future iframe React widget UI. |
| `packages/loader` | `@panda-chat-widget/loader` | Future vanilla TypeScript host-page embed script. |
| `packages/shared` | `@panda-chat-widget/shared` | Future cross-boundary API and theme types. |
| `examples/basic-html` | `@panda-chat-widget/basic-html` | Future basic HTML host-page example. |

## Local requirements

- Node.js 24.x (`package.json` targets `>=24.0.0 <25`)
- Corepack-enabled pnpm (`packageManager` pins `pnpm@11.1.3`)

Typical setup:

```sh
corepack enable
pnpm install
```

Running under another Node version may still execute the skeleton commands, but pnpm will emit engine warnings.

## Commands

Run commands from the repository root.

| Command | Current behavior | What it proves today |
| --- | --- | --- |
| `pnpm dev` | Recursively runs package `dev` scripts in parallel. | Starts the server dev watcher; other packages currently print explicit TODO messages. |
| `pnpm typecheck` | Recursively runs package `typecheck` scripts. | Typechecks server TypeScript; packages without `src` still print TODO. |
| `pnpm lint` | Recursively runs package `lint` scripts. | Command wiring only; lint tooling is not installed yet. |
| `pnpm test` | Recursively runs package `test` scripts. | Runs server Node tests, including `/healthz`; other packages still print TODO. |
| `pnpm build` | Recursively runs package `build` scripts. | Command wiring only; real builds are not implemented yet. |
| `pnpm check` | Runs `typecheck`, `lint`, `test`, then `build`. | One obvious validation path; server typecheck/tests are real, lint/build remain TODO placeholders. |

## Server health runbook

Start the current server from the repository root:

```sh
HOST=127.0.0.1 PORT=3000 SERVER_LOGGER=false pnpm --filter @panda-chat-widget/server dev
```

In another shell, check health:

```sh
curl -fsS http://127.0.0.1:3000/healthz
```

Expected response:

```json
{"ok":true}
```

Stop the dev server with `Ctrl-C`.

Server env knobs:

| Env | Default | Notes |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Must be non-empty. |
| `PORT` | `3000` | Must be an integer from `1` to `65535`. |
| `SERVER_LOGGER` | `true` | Accepts `true`, `false`, `1`, or `0`. Use `false` for quieter local smoke runs. |

There is no production `start`/build artifact yet. Use `pnpm --filter @panda-chat-widget/server dev` for the current local server and `pnpm check` for validation.

## Public planning context

- Mission log: [Discussion #2](https://github.com/patrikmojzis/panda-chat-widget/discussions/2)
- Tracker issue: [#14](https://github.com/patrikmojzis/panda-chat-widget/issues/14)
- Milestone: [#1](https://github.com/patrikmojzis/panda-chat-widget/milestone/1)
