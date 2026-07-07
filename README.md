# Panda Chat Widget

TypeScript/pnpm workspace for an embeddable chat widget spine. Current V1 work is still local/dev-only: vanilla loader, React/Vite iframe UI, Fastify API seams, Kysely/Postgres schema, first-owner auth/workspace foundation, protected console shell with workspace-scoped site/widget list-create plus widget settings/domain/snippet/Panda connection placeholder flows, a local-only Panda delivery-intent table for configured widgets, local demo seed data, visitor sessions, conversations, messages, SSE contracts, and a deterministic fake reply.

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
| `apps/console` | `@panda-chat-widget/console` | React/Vite protected owner console shell for first-user setup/login plus workspace-scoped site/widget list-create and widget settings/domain/install-snippet flows. |
| `packages/loader` | `@panda-chat-widget/loader` | Vanilla host-page loader that mounts a launcher and iframe. |
| `packages/shared` | `@panda-chat-widget/shared` | Shared visitor identity contract. |
| `examples/basic-html` | `@panda-chat-widget/basic-html` | Local clickable host-page demo that serves the built loader/widget UI and proxies `/api/*` to the backend. |

## Embed snippet

After adding at least one allowed domain for a widget in the protected console, copy the generated snippet. It uses the server-owned public widget key:

```html
<script src="/vendor/panda-chat-widget-loader.js" data-public-key="demo-local-widget" async></script>
```

Supported key attributes remain `data-public-key`, `data-widget-key`, and `data-site-key`; script attributes win over `window.PandaChatWidgetConfig`. The loader creates a bottom-right launcher and opens an iframe at `/widget.html?publicKey=...` on the host origin.

## Common commands

Run from the repository root unless noted.

| Command | What it does today |
| --- | --- |
| `pnpm check` | Workspace typecheck, lint placeholders, tests, and builds. |
| `pnpm test` | Workspace tests. |
| `pnpm --filter @panda-chat-widget/server test` | Server API/DB/SSE/runtime contract tests using fake DB seams. |
| `pnpm --filter @panda-chat-widget/server local-panda:delivery-status` | Read-only local delivery diagnostics preflight; opens the configured DB, runs local SELECTs only, prints one JSON object, and does not claim/apply/mutate/network. |
| `pnpm --filter @panda-chat-widget/server local-panda:dispatch-dry-run` | Claims one queued local Panda delivery intent and prints the existing local-only payload JSON; no network dispatch or reply apply. |
| `cat reply-ingress-build-input.json \| pnpm --silent --filter @panda-chat-widget/server local-panda:reply-ingress-build` | Reads one wrapper JSON object from stdin and builds a local reply-ingress payload envelope; no DB/apply/Panda/Gateway/external CLI/network call. |
| `pnpm --filter @panda-chat-widget/server local-panda:reply-round-trip` | Reuses one already-claimed unapplied local Panda delivery intent, or claims one queued intent if none exists, then builds a deterministic local fake reply ingress payload and inserts/replays one local agent message; no Panda/Gateway/external CLI/network call. |
| `printf '%s\n' '{"reply":{"text":"Hello from the local manual reply"}}' \| pnpm --silent --filter @panda-chat-widget/server local-panda:reply-manual` | Reads one manual reply JSON object from stdin, reuses or claims one local Panda delivery intent, builds/applies a local reply-ingress payload, and inserts/replays one local agent message; no Panda/Gateway/external CLI/network call. |
| `cat reply-ingress.json \| pnpm --silent --filter @panda-chat-widget/server local-panda:reply-ingress-apply` | Reads one local reply-ingress JSON object from stdin and applies it through the existing local DB helper; no Panda/Gateway/external CLI/network call. |
| `pnpm --filter @panda-chat-widget/widget-ui check` | Widget UI typecheck/tests/build. |
| `pnpm --filter @panda-chat-widget/console check` | Console shell typecheck/tests/build. |
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

   Seed data is idempotent and uses public key `demo-local-widget`, local placeholder route handle `panda:local/demo`, and allowed domains `localhost` and `127.0.0.1`. Rerunning the seed restores that demo route handle; it is not a secret or real Panda connection.

4. Start the DB-connected Fastify server:

   ```sh
   HOST=127.0.0.1 PORT=3000 SERVER_LOGGER=false pnpm --filter @panda-chat-widget/server dev
   ```

   Health check:

   ```sh
   curl -fsS http://127.0.0.1:3000/healthz
   # {"ok":true}
   ```

5. Optional: create the first owner workspace and open the protected console. The setup endpoint is transactionally singleton and returns an HttpOnly session cookie. Console code uses `/api/me`; `/me` exists only as a compatibility alias.

   ```sh
   pnpm --filter @panda-chat-widget/console build
   # then open http://127.0.0.1:3000/console/setup while the Fastify server is running
   ```

6. Build and start the basic HTML demo:

   ```sh
   pnpm --filter @panda-chat-widget/basic-html build
   pnpm --filter @panda-chat-widget/basic-html dev
   ```

7. Open <http://127.0.0.1:4173/>, click the bottom-right `Chat` launcher, type a visitor message, and press `Send`.

Expected result: the message appears in the widget, then the backend stores a deterministic local fake agent reply and delivers it through the same API/SSE/polling flow. Because the seeded widget has the local placeholder route handle `panda:local/demo`, the backend also records one internal queued local delivery intent for the new visitor message. This is not exposed publicly and does not send anything to Panda/Gateway/CLI:

```text
Thanks for trying the local Panda chat widget demo. This is a fake V1 reply, but your message was received.
```

8. After sending a demo message, run the read-only delivery status preflight before choosing a mutating local reply command:

   ```sh
   pnpm --filter @panda-chat-widget/server local-panda:delivery-status
   ```

   Expected status shape is dynamic JSON with `kind: "local-panda-delivery-status"`, `mode: "local-only-read-only-diagnostics"`, queued/claimed/applied counts, oldest queued and claimed-unapplied summaries, and `nextLocalReplyCandidate` choosing the oldest claimed-unapplied intent before the oldest queued intent. This command accepts no stdin or args and performs only local read-only DB diagnostics: no claim, apply, insert, update, delete, transaction, lock, schema migration, worker/retry/dead-letter flow, public route, frontend exposure, status lifecycle expansion, Panda/Gateway/external CLI/child-process/network call, or visitor/agent message body output.

   Then run the one-shot local reply round trip if you want to complete an already dry-run-claimed intent or claim the fresh queued intent and apply one additional deterministic local fake agent reply:

   ```sh
   pnpm --filter @panda-chat-widget/server local-panda:reply-round-trip
   ```

   Expected shape is dynamic JSON with `completed: true`, `kind: "local-panda-one-shot-deterministic-fake-reply-round-trip"`, `mode: "local-only-no-network-deterministic-fake-reply"`, `dispatchIntentSource`, `dispatchPayload`, `syntheticFakeReplyIngressPayload`, `applyResult`, and metadata such as `network: "no-network"`, `pandaCall: "not-attempted"`, `gatewayCall: "not-attempted"`, `externalCliCall: "not-attempted"`, and `stateMutation: "reuses-one-claimed-intent-or-claims-one-queued-intent-and-inserts-or-replays-one-local-agent-message"`. This mutates only the local DB: it may reuse one already-claimed unapplied local intent or claim one queued intent, then inserts or replays one local agent message. It does not call Panda, Gateway, an external CLI, a child process, or the network, and it does not replace the existing route-created public fake reply. If two one-shot invocations race on the same already-claimed candidate, reply ingress idempotency replays or reports a controlled conflict instead of adding duplicate local agent rows; this is not an exclusive worker/dispatcher lock.

   To apply one operator-authored manual local reply from stdin while reusing the same local intent selection policy, run the same `local-panda:delivery-status` read-only preflight first if you need to inspect the next local candidate without mutating it:

   ```sh
   printf '%s\n' '{"reply":{"text":"Hello from the local manual reply"}}' | pnpm --silent --filter @panda-chat-widget/server local-panda:reply-manual
   ```

   Expected manual shape is dynamic JSON with `completed: true`, `parsed: true`, kind: `"local-panda-one-shot-manual-reply-round-trip"`, mode: `"local-only-stdin-manual-reply"`, `dispatchIntentSource`, `dispatchPayload`, `manualReplyIngressPayload`, `applyResult`, and manual-specific metadata such as `input: "stdin-json-object"`, `manualReplySource: "stdin-manual-reply-text"`, `replyTextValidation: "normalized-before-db-config-or-dispatch"`, and `network: "no-network"`. The command validates and normalizes `reply.text` before opening the DB or claiming/selecting any intent; empty stdin, malformed JSON, non-object JSON, missing/blank text, or non-string text print a JSON envelope on stdout, exit 1, and do not open the DB. Controlled dispatch/build/apply failures print JSON on stdout, exit 0, and close the DB. This mutates only the local DB: it may reuse one already-claimed unapplied local intent or claim one queued intent, then inserts or replays one local agent message through the existing reply-ingress apply helper. It does not call Panda, Gateway, an external CLI, a child process, or the network, and it does not add a public route, worker/retry/dead-letter flow, status lifecycle expansion, fake-reply replacement, frontend exposure, or schema migration.

   If you only want to inspect the future-dispatch payload without applying a reply, use the dry run instead:

   ```sh
   pnpm --filter @panda-chat-widget/server local-panda:dispatch-dry-run
   ```

   Expected dry-run shape is dynamic JSON with `prepared: true`, `payload.kind: "local-panda-future-dispatch"`, `payload.routeHandleSnapshot: "panda:local/demo"`, and local-only metadata such as `locality: "local-only"` and `network: "no-network"`. The dry run still claims the queued local intent; if you run `local-panda:dispatch-dry-run` first, `local-panda:reply-round-trip` may reuse that already-claimed intent as long as no matching local round-trip reply row exists. Running either command again after the local reply has been applied can correctly return a controlled `no_queued_intent` result until another visitor message records a new queued intent.

   To manually build a reply-ingress payload from a dry-run dispatch payload and then apply it:

   1. Run `local-panda:dispatch-dry-run`; it prints an envelope whose `payload` is the local future-dispatch payload.
   2. Copy or extract that dry-run envelope `payload` into a new JSON object's `dispatchPayload` field and add `reply.text`, for example `{ "dispatchPayload": { ... }, "reply": { "text": "Hello from the local reply builder" } }`.
   3. Build the local reply-ingress payload envelope:

      ```sh
      cat reply-ingress-build-input.json | pnpm --silent --filter @panda-chat-widget/server local-panda:reply-ingress-build
      ```

   4. Pipe or copy only the build envelope's `payload` JSON object into the apply CLI:

      ```sh
      cat reply-ingress.json | pnpm --silent --filter @panda-chat-widget/server local-panda:reply-ingress-apply
      ```

   The build CLI is a local-only adapter: it reads one non-null, non-array wrapper JSON object from stdin, injects dispatch correlation IDs into object replies only when `reply.correlationIds` is absent, and delegates reply payload validation to `buildLocalPandaReplyIngressPayloadV1`. On success, stdout is a JSON envelope with `kind: "local-panda-reply-ingress-build"`, `mode: "local-only-stdin-reply-ingress-build"`, `built: true`, `parsed: true`, `payload`, and local/no-network/no-mutation metadata. Empty stdin, malformed JSON, or JSON values that are `null`, arrays, or scalars print the same base envelope with `built: false`, `parsed: false`, `failedStep: "stdin_parse"`, reason `empty_stdin`, `malformed_json`, or `json_value_not_object`, and exit 1 without printing stderr when run directly or through the documented `pnpm --silent` command; non-silent pnpm may add lifecycle noise around any script that exits 1. Builder-controlled failures keep the same envelope with `built: false`, `parsed: true`, `failedStep: "reply_ingress_build"`, `reason`, and `buildResult`, and exit 0. The build step performs no DB access, no reply apply, no state mutation, no public route, no worker/retry/dead-letter/status lifecycle expansion, no fake-reply replacement, no frontend exposure, and no Panda/Gateway/external CLI/child-process/network call; it is not real Panda/Gateway integration.

   The apply CLI stdin value must parse to a non-null, non-array JSON object. It is then delegated to the existing `applyLocalPandaReplyIngressPayloadV1` helper; malformed v1-shaped objects are reported as helper-controlled apply failures such as `invalid_payload` rather than rejected by a separate CLI schema layer. On success, stdout is a JSON envelope with `kind: "local-panda-reply-ingress-apply"`, `mode: "local-only-stdin-reply-ingress-apply"`, `completed: true`, `parsed: true`, `applyResult`, and a `metadata` object including `locality: "local-only"`, `input: "stdin-json-object"`, `network: "no-network"`, `pandaCall/gatewayCall/externalCliCall: "not-attempted"`, `childProcess: "not-used"`, `publicRoute/worker: "not-created"`, `statusLifecycleExpansion: "not-attempted"`, and `stateMutation: "local-db-apply-or-replay-via-existing-helper"`. Controlled helper failures keep the same envelope with `completed: false`, `parsed: true`, `failedStep: "apply_reply_ingress"`, `reason`, and `applyResult`, and exit 0. Empty stdin, malformed JSON, or JSON values that are `null`, arrays, or scalars print the same base envelope with `completed: false`, `parsed: false`, `failedStep: "stdin_parse"`, reason `empty_stdin`, `malformed_json`, or `json_value_not_object`, and exit 1 without opening the DB or printing stderr when run directly or through the documented `pnpm --silent` command; non-silent pnpm may add lifecycle noise around any script that exits 1. Once parsed, this mutates only the local DB by inserting or replaying one local agent message through the existing helper; it still creates no public route, worker, retry/dead-letter flow, status lifecycle expansion, fake-reply replacement, frontend exposure, Panda/Gateway call, child process, or network dispatch.

The demo server is local-only. Defaults are `DEMO_HOST=127.0.0.1`, `DEMO_PORT=4173`, and `DEMO_BACKEND_URL=http://127.0.0.1:3000` (generic `HOST`, `PORT`, and `BACKEND_URL` also work). For proxied `/api/*` requests only, it synthesizes a safe localhost `Origin` when the browser omits one; the production Fastify API still enforces normal origin checks.

## Server environment knobs

| Env | Default | Notes |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Non-empty host. |
| `PORT` | `3000` | Integer `1`-`65535`. |
| `SERVER_LOGGER` | `true` | `true`, `false`, `1`, or `0`; request logging redacts public widget path tokens and query strings. |
| `AUTH_COOKIE_SECURE` | `true` when `NODE_ENV=production`, otherwise `false` | `true`, `false`, `1`, or `0`; adds `Secure` to owner session cookies when enabled. |
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
- Panda connection settings are placeholder-only: the saved route handle is an opaque label, not a secret/token. The seeded demo uses `panda:local/demo` only to make the local dry-run path reproducible; it does not imply real Panda connectivity.
- Configured widgets record internal queued local delivery intents for new visitor messages. The delivery-status CLI is a read-only local preflight for `local-panda:reply-manual` and `local-panda:reply-round-trip`: it opens the configured DB, prints local queued/claimed/applied diagnostics, and never claims/applies/mutates. The dry-run command claims one intent and prints local JSON; the reply-ingress build CLI only reads a stdin wrapper object and builds a local payload envelope without DB/apply/network work; the reply-round-trip command first reuses the oldest already-claimed unapplied local intent, or claims one queued intent if none exists, then inserts/replays one deterministic local fake agent message. The manual reply command reads `reply.text` from stdin, validates it before DB/config/dispatch work, then reuses that same local selection policy and applies one local reply-ingress payload. The reply-ingress apply CLI only reads a stdin JSON object and applies it to the local DB through the existing helper. No Panda/Gateway/external CLI delivery exists yet.
- If dispatch payload build, synthetic reply build, or reply apply fails after an intent is claimed, the intent may remain claimed. There is intentionally no rollback, retry/dead-letter behavior, or sent/delivered/failed/replied status lifecycle expansion yet.
- SSE fanout is process-local memory only; delivery intents are durable local records, not a retry worker, dispatcher, dead-letter queue, sent/delivered/failed state, public/worker reply-ingestion path, or multi-process fanout.
- Browser screenshots/live click smoke require browser automation and a running local Postgres stack.
- DB-backed live validation for GitHub issue #5 remains separate until it has real Docker/Postgres/browser evidence in the target environment.
- Auth is intentionally minimal: first owner + one workspace, email/password login, HttpOnly cookie sessions, no invites, no teams/RBAC UI, no billing/plans/usage.
- Console site/widget management is intentionally minimal: workspace-scoped list/create, safe widget settings, allowed domains, a generated install snippet, and a configuration-only Panda route handle placeholder.
- No deployment or Dockerized app runtime yet; CLI coverage is limited to local-only server scripts and is not a public ingestion surface.

## Public planning context

- Mission log: [Discussion #2](https://github.com/patrikmojzis/panda-chat-widget/discussions/2)
- Parent hardening issue: [#13](https://github.com/patrikmojzis/panda-chat-widget/issues/13)
- DB live validation tracker: [#5](https://github.com/patrikmojzis/panda-chat-widget/issues/5)
