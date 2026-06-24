# Panda Chat Widget

TypeScript/pnpm workspace for an embeddable chat widget spine. Current V1 work is still local/dev-only: vanilla loader, React/Vite iframe UI, Fastify API seams, Kysely/Postgres schema, local demo seed data, visitor sessions, conversations, messages, SSE contracts, and a deterministic fake reply.

There is no Panda Gateway/Panda agent integration in this repo yet.

## Requirements

- Node.js `>=24.0.0 <25` (declared in `package.json`)
- Corepack + pnpm `11.1.3`
- Docker Compose only if you want the local Postgres service

Install:

```sh
corepack enable
pnpm install --frozen-lockfile
```

Local validation in the current agent environment has run under Node `v22.23.0`; pnpm emits expected engine warnings there. Prefer Node 24 for new development.

## Workspace

| Path | Package | Current responsibility |
| --- | --- | --- |
| `apps/server` | `@panda-chat-widget/server` | Fastify health route, tested public widget API seams, Kysely schema/migrations/seed, process-local SSE contracts. |
| `apps/widget-ui` | `@panda-chat-widget/widget-ui` | React/Vite iframe widget UI and widget API client. |
| `packages/loader` | `@panda-chat-widget/loader` | Vanilla host-page loader that mounts a launcher and iframe. |
| `packages/shared` | `@panda-chat-widget/shared` | Shared visitor identity contract. |
| `examples/basic-html` | `@panda-chat-widget/basic-html` | Static host-page demo for the built loader. |

## Embed snippet

After building/copying the loader, a host page embeds it with a public widget key:

```html
<script src="/vendor/panda-chat-widget-loader.js" data-site-key="demo-local-widget" async></script>
```

Supported key attributes are `data-public-key`, `data-widget-key`, and `data-site-key`; script attributes win over `window.PandaChatWidgetConfig`. The loader creates a bottom-right launcher and opens an iframe at `/widget.html?publicKey=...` on the host origin.

Current caveat: `examples/basic-html/widget.html` is still a static placeholder page. The real React widget UI is in `apps/widget-ui`; wiring the built iframe app into the static example/reverse-proxy setup is not finished.

## Common commands

Run from the repository root unless noted.

| Command | What it does today |
| --- | --- |
| `pnpm check` | Workspace typecheck, lint placeholders, tests, and builds. |
| `pnpm test` | Workspace tests. |
| `pnpm --filter @panda-chat-widget/server test` | Server API/DB/SSE contract tests using fake DB seams. |
| `pnpm --filter @panda-chat-widget/widget-ui check` | Widget UI typecheck/tests/build. |
| `pnpm --filter @panda-chat-widget/loader check` | Loader typecheck/tests/build. |
| `pnpm --filter @panda-chat-widget/basic-html build` | Builds loader and copies it to `examples/basic-html/vendor/`. |
| `pnpm --filter @panda-chat-widget/basic-html dev` | Serves the static basic HTML demo on `127.0.0.1:4173`. |

Several package `lint`/`build` scripts still intentionally echo TODO placeholders. Treat `pnpm check` as the current repository validation contract, not a production build pipeline.

## Local static demo

```sh
pnpm --filter @panda-chat-widget/basic-html build
pnpm --filter @panda-chat-widget/basic-html dev
```

Open <http://127.0.0.1:4173/>. The host page should load the copied loader, show a bottom-right launcher, and open the placeholder iframe page.

This static demo does **not** prove the DB-backed chat flow. K6 static curl smoke and package tests were green, but browser screenshot smoke was blocked in the agent environment because no browser/browser automation was available.

## Server runbook

Start the current server health endpoint:

```sh
HOST=127.0.0.1 PORT=3000 SERVER_LOGGER=false pnpm --filter @panda-chat-widget/server dev
```

Health check:

```sh
curl -fsS http://127.0.0.1:3000/healthz
# {"ok":true}
```

Environment knobs:

| Env | Default | Notes |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Non-empty host. |
| `PORT` | `3000` | Integer `1`-`65535`. |
| `SERVER_LOGGER` | `true` | `true`, `false`, `1`, or `0`; request logging redacts public widget path tokens and query strings. |
| `DATABASE_URL` | `postgresql://panda_chat_widget:panda_chat_widget@127.0.0.1:5432/panda_chat_widget` | Used by migration/seed commands and future DB-connected runtime wiring. |

Current caveat: `apps/server/src/main.ts` starts `buildApp()` without a database client, so the committed dev server exposes health only. Public widget API routes are tested through `buildApp({ database })`; DB-connected runtime startup and live DB validation remain pending.

## Local Postgres, migrate, seed

Local-only Postgres is defined in `compose.yaml`:

```sh
docker compose up -d postgres
pnpm --filter @panda-chat-widget/server db:migrate
pnpm --filter @panda-chat-widget/server db:seed
```

Seed data is idempotent and uses:

- site: `Demo Local Site`
- widget: `Demo Local Widget`
- public key: `demo-local-widget`
- allowed domains: `localhost`, `127.0.0.1`

Stop without deleting data:

```sh
docker compose down
```

Reset local data:

```sh
docker compose down -v
```

K6 could not run DB-backed live validation in the agent environment because Docker/Postgres tooling was unavailable. Keep GitHub issue #5/live DB validation separate until it has real Docker/Postgres evidence.

## Current limitations

- Fake reply only: visitor messages receive a deterministic local fake agent reply; no real AI/Gateway/Panda integration.
- SSE is process-local memory only; no durable queue or multi-process fanout.
- Browser screenshots/live click smoke were blocked in K6 by missing browser automation in the validation environment.
- DB-backed live validation is pending; current server tests use fake DB seams, not a live Postgres process.
- No account/login identity, cross-device persistence, production auth, deployment, CLI, or Dockerized app runtime yet.

## Public planning context

- Mission log: [Discussion #2](https://github.com/patrikmojzis/panda-chat-widget/discussions/2)
- Parent hardening issue: [#13](https://github.com/patrikmojzis/panda-chat-widget/issues/13)
- DB live validation tracker: [#5](https://github.com/patrikmojzis/panda-chat-widget/issues/5)
