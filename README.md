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
| `apps/server` | `@panda-chat-widget/server` | Fastify health route, public widget API routes, Kysely schema/migrations/seed, process-local SSE contracts. |
| `apps/widget-ui` | `@panda-chat-widget/widget-ui` | React/Vite iframe widget UI and widget API client. |
| `packages/loader` | `@panda-chat-widget/loader` | Vanilla host-page loader that mounts a launcher and iframe. |
| `packages/shared` | `@panda-chat-widget/shared` | Shared visitor identity contract. |
| `examples/basic-html` | `@panda-chat-widget/basic-html` | Local clickable host-page demo that serves the built loader/widget UI and proxies `/api/*` to the backend. |

## Embed snippet

After building/copying the loader, a host page embeds it with a public widget key:

```html
<script src="/vendor/panda-chat-widget-loader.js" data-site-key="demo-local-widget" async></script>
```

Supported key attributes are `data-public-key`, `data-widget-key`, and `data-site-key`; script attributes win over `window.PandaChatWidgetConfig`. The loader creates a bottom-right launcher and opens an iframe at `/widget.html?publicKey=...` on the host origin.

## Common commands

Run from the repository root unless noted.

| Command | What it does today |
| --- | --- |
| `pnpm check` | Workspace typecheck, lint placeholders, tests, and builds. |
| `pnpm test` | Workspace tests. |
| `pnpm --filter @panda-chat-widget/server test` | Server API/DB/SSE/runtime contract tests using fake DB seams. |
| `pnpm --filter @panda-chat-widget/widget-ui check` | Widget UI typecheck/tests/build. |
| `pnpm --filter @panda-chat-widget/loader check` | Loader typecheck/tests/build. |
| `pnpm --filter @panda-chat-widget/basic-html build` | Builds loader + React widget UI and copies artifacts into `examples/basic-html/vendor/` and `examples/basic-html/widget-dist/`. |
| `pnpm --filter @panda-chat-widget/basic-html dev` | Serves the local demo on `127.0.0.1:4173` and proxies `/api/*` to `http://127.0.0.1:3000`. |

Several package `lint`/`build` scripts still intentionally echo TODO placeholders. Treat `pnpm check` as the current repository validation contract, not a production build pipeline.

## Local clickable demo runbook

Use separate terminals for the server and the demo server.

1. Install dependencies:

   ```sh
   corepack enable
   pnpm install --frozen-lockfile
   ```

2. Start local Postgres:

   ```sh
   docker compose up -d postgres
   ```

3. Create/update the schema and seed the local demo widget:

   ```sh
   pnpm --filter @panda-chat-widget/server db:migrate
   pnpm --filter @panda-chat-widget/server db:seed
   ```

   Seed data is idempotent and uses public key `demo-local-widget` with allowed domains `localhost` and `127.0.0.1`.

4. Start the DB-connected Fastify server:

   ```sh
   HOST=127.0.0.1 PORT=3000 SERVER_LOGGER=false pnpm --filter @panda-chat-widget/server dev
   ```

   Health check:

   ```sh
   curl -fsS http://127.0.0.1:3000/healthz
   # {"ok":true}
   ```

5. Build and start the basic HTML demo:

   ```sh
   pnpm --filter @panda-chat-widget/basic-html build
   pnpm --filter @panda-chat-widget/basic-html dev
   ```

6. Open <http://127.0.0.1:4173/>, click the bottom-right `Chat` launcher, type a visitor message, and press `Send`.

Expected result: the message appears in the widget, then the backend stores a deterministic local fake agent reply and delivers it through the same API/SSE/polling flow:

```text
Thanks for trying the local Panda chat widget demo. This is a fake V1 reply, but your message was received.
```

The demo server is local-only. Defaults are `DEMO_HOST=127.0.0.1`, `DEMO_PORT=4173`, and `DEMO_BACKEND_URL=http://127.0.0.1:3000` (generic `HOST`, `PORT`, and `BACKEND_URL` also work). For proxied `/api/*` requests only, it synthesizes a safe localhost `Origin` when the browser omits one; the production Fastify API still enforces normal origin checks.

## Server environment knobs

| Env | Default | Notes |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Non-empty host. |
| `PORT` | `3000` | Integer `1`-`65535`. |
| `SERVER_LOGGER` | `true` | `true`, `false`, `1`, or `0`; request logging redacts public widget path tokens and query strings. |
| `DATABASE_URL` | `postgresql://panda_chat_widget:panda_chat_widget@127.0.0.1:5432/panda_chat_widget` | Used by the DB-connected server runtime, migration command, and seed command. |

## Local Postgres cleanup

Stop without deleting data:

```sh
docker compose down
```

Reset local data:

```sh
docker compose down -v
```

## Current limitations

- Fake reply only: visitor messages receive a deterministic local fake agent reply; no real AI/Gateway/Panda integration.
- SSE is process-local memory only; no durable queue or multi-process fanout.
- Browser screenshots/live click smoke require browser automation and a running local Postgres stack.
- DB-backed live validation for GitHub issue #5 remains separate until it has real Docker/Postgres/browser evidence in the target environment.
- No account/login identity, cross-device persistence, production auth, deployment, CLI, or Dockerized app runtime yet.

## Public planning context

- Mission log: [Discussion #2](https://github.com/patrikmojzis/panda-chat-widget/discussions/2)
- Parent hardening issue: [#13](https://github.com/patrikmojzis/panda-chat-widget/issues/13)
- DB live validation tracker: [#5](https://github.com/patrikmojzis/panda-chat-widget/issues/5)
