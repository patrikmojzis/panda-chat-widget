# Panda Chat Widget

TypeScript/pnpm workspace for an embeddable chat widget spine. The repository has a Node 24 compiled-artifact baseline for its Fastify server, migrations, operational CLIs, shared package, console, widget, loader, and reference host. Product behavior is still a local/self-hosted demo: Panda connection settings and delivery intents are local-only, and replies remain deterministic fakes.

There is no Panda Gateway/Panda agent integration in this repo yet.

## Requirements

- Node.js 24 (`>=24.0.0 <25`, declared in `package.json`)
- Corepack + pnpm `11.1.3`
- Docker Compose only if you want the local Postgres service

Install:

```sh
corepack enable
pnpm install --frozen-lockfile
```

All documented build and runtime commands require Node 24.

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

Run from the repository root unless noted. Build outputs are ignored, package-owned artifacts.

| Command | What it does today |
| --- | --- |
| `pnpm build` | Cleans and builds shared ESM/declarations, console, widget, loader, reference, and non-test server/migration/CLI JavaScript in workspace dependency order. |
| `pnpm check` | Runs substantive workspace typechecks, all tests, and clean production builds. There is no linter configured, so no command claims to lint. |
| `pnpm test` | Performs a clean production build, then runs all workspace tests, including built-artifact/static-serving tests. |
| `pnpm start` | Starts `apps/server/dist/main.js`; run `pnpm build` first. |
| `pnpm --filter @panda-chat-widget/server db:migrate` | Runs the compiled migration entry `apps/server/dist/migrate.js`; requires a build and PostgreSQL. |
| `pnpm --filter @panda-chat-widget/server db:seed` | Runs the compiled seed entry `apps/server/dist/seed.js`; requires a build and PostgreSQL. |
| `pnpm --filter @panda-chat-widget/server test` | Server API/DB/SSE/runtime and built-artifact contract tests using fake DB seams; run `pnpm build` first. |
| `pnpm --filter @panda-chat-widget/server local-panda:delivery-status` | Runs the compiled read-only local delivery diagnostics preflight; opens the configured DB, runs local SELECTs only, prints one JSON object, and does not claim/apply/mutate/network. |
| `pnpm --filter @panda-chat-widget/server local-panda:dispatch-dry-run` | Runs the compiled CLI, claims one queued local Panda delivery intent, and prints the existing local-only payload JSON; no network dispatch or reply apply. |
| `cat reply-ingress-build-input.json \| pnpm --silent --filter @panda-chat-widget/server local-panda:reply-ingress-build` | Runs the compiled stdin adapter and builds a local reply-ingress payload envelope; no DB/apply/Panda/Gateway/external CLI/network call. |
| `pnpm --filter @panda-chat-widget/server local-panda:reply-round-trip` | Runs the compiled local-only CLI to reuse or claim one intent and insert/replay one deterministic fake reply; no Panda/Gateway/external CLI/network call. |
| `printf '%s\n' '{"reply":{"text":"Hello from the local manual reply"}}' \| pnpm --silent --filter @panda-chat-widget/server local-panda:reply-manual` | Runs the compiled stdin CLI to reuse/claim an intent and apply one local manual reply; no Panda/Gateway/external CLI/network call. |
| `cat reply-ingress.json \| pnpm --silent --filter @panda-chat-widget/server local-panda:reply-ingress-apply` | Runs the compiled stdin CLI and applies one local reply-ingress object through the existing DB helper. |
| `pnpm --filter @panda-chat-widget/widget-ui check` | Widget UI typecheck/tests/build; build shared first when running this package in isolation. |
| `pnpm --filter @panda-chat-widget/console check` | Console shell typecheck/tests/build. |
| `pnpm --filter @panda-chat-widget/loader check` | Loader typecheck/tests/build. |
| `pnpm --filter @panda-chat-widget/basic-html build` | Rebuilds the reference tree from already-built loader/widget dependencies; prefer root `pnpm build` from a clean checkout. |
| `pnpm --filter @panda-chat-widget/basic-html dev` | Optional local source/demo server on `127.0.0.1:4173` with `/api/*` proxying to `http://127.0.0.1:3000`. |

## Local clickable demo runbook

Use a separate terminal for the compiled server and, only when using the optional port-4173 proxy workflow, the demo server. For repeatable browser/visual smoke, prefer a disposable local DB so the next local reply candidate belongs to the conversation you open during the runbook. If you intentionally keep an existing DB, run the delivery-status preflight before a mutating manual reply and verify `nextLocalReplyCandidate.conversationId` matches the currently open browser conversation; otherwise send a fresh visitor message or reset the DB first.

1. Install and build all artifacts under Node 24:

   ```sh
   corepack enable
   pnpm install --frozen-lockfile
   pnpm build
   ```

2. Start local Postgres. For a clean disposable smoke run, reset the local Postgres volume before starting it:

   ```sh
   docker compose down -v
   docker compose up -d postgres
   ```

3. Create/update the schema and seed the local demo widget:

   ```sh
   pnpm --filter @panda-chat-widget/server db:migrate
   pnpm --filter @panda-chat-widget/server db:seed
   ```

   Seed data is idempotent and uses public key `demo-local-widget`, local placeholder route handle `panda:local/demo`, and allowed domains `localhost` and `127.0.0.1`. Rerunning the seed restores that demo route handle; it is not a secret or real Panda connection.

4. Start the DB-connected compiled Fastify server:

   ```sh
   HOST=127.0.0.1 PORT=3000 SERVER_LOGGER=false pnpm start
   ```

   `pnpm start`, migration, seed, and every `local-panda:*` package script execute `apps/server/dist/*.js`; they do not load server TypeScript. `pnpm --filter @panda-chat-widget/server dev` remains the source-watching development command.

   Health check:

   ```sh
   curl -fsS http://127.0.0.1:3000/healthz
   # {"ok":true}
   ```

5. Optional: create the first owner workspace at <http://127.0.0.1:3000/console/setup>. The compiled Fastify app serves the built console under `/console/`; login/setup are public shells, while other direct and deep links remain session-protected. The setup endpoint is transactionally singleton and returns an HttpOnly session cookie. Console code uses `/api/me`; `/me` exists only as a compatibility alias.

6. Open the built same-origin reference host at <http://127.0.0.1:3000/reference/>, click the bottom-right `Chat` launcher, type a visitor message, and press `Send`. Fastify also serves the built widget at `/widget.html`, hashed widget files at `/assets/*`, and the classic loader at `/vendor/panda-chat-widget-loader.js`.

   For the separate Vite-style local proxy workflow, the existing optional command remains:

   ```sh
   pnpm --filter @panda-chat-widget/basic-html dev
   ```

   That development server runs at <http://127.0.0.1:4173/> and preserves its `/api/*` proxy/origin synthesis.

7. Send a visitor message from either reference host.

Expected result: the message appears in the widget, then the backend stores a deterministic local fake agent reply and delivers it through the same API/SSE/polling flow. The widget keeps the EventSource live path open for same-process server pushes and also sends one periodic catch-up `GET /messages?afterSeq=<latestSeq>` so out-of-band local DB replies from the server-only CLI path can appear in an already-open demo widget without a page reload. Because the seeded widget has the local placeholder route handle `panda:local/demo`, the backend also records one internal queued local delivery intent for the new visitor message. This is not exposed publicly and does not send anything to Panda/Gateway/CLI:

```text
Thanks for trying the local Panda chat widget demo. This is a fake V1 reply, but your message was received.
```

8. After sending a demo message, run the read-only delivery status preflight before choosing a mutating local reply command:

   ```sh
   pnpm --filter @panda-chat-widget/server local-panda:delivery-status
   ```

   Expected status shape is dynamic JSON with `kind: "local-panda-delivery-status"`, `mode: "local-only-read-only-diagnostics"`, queued/claimed/applied counts, oldest queued and claimed-unapplied summaries, and `nextLocalReplyCandidate` choosing the oldest claimed-unapplied intent before the oldest queued intent. The protected owner widget settings API also shows the scoped local-only `connection.localDelivery.nextLocalReplyCandidate` so operators can copy the next manual reply target ID for `local-panda:reply-manual` `targetIntentId`; that settings summary intentionally includes only IDs/status/timestamps and excludes message bodies, `routeHandleSnapshot`, and `visitorSessionId`. This command accepts no stdin or args and performs only local read-only DB diagnostics: no claim, apply, insert, update, delete, transaction, lock, schema migration, worker/retry/dead-letter flow, public route, frontend exposure, status lifecycle expansion, Panda/Gateway/external CLI/child-process/network call, or visitor/agent message body output.

   Then run the one-shot local reply round trip if you want to complete an already dry-run-claimed intent or claim the fresh queued intent and apply one additional deterministic local fake agent reply:

   ```sh
   pnpm --filter @panda-chat-widget/server local-panda:reply-round-trip
   ```

   Expected shape is dynamic JSON with `completed: true`, `kind: "local-panda-one-shot-deterministic-fake-reply-round-trip"`, `mode: "local-only-no-network-deterministic-fake-reply"`, `dispatchIntentSource`, `dispatchPayload`, `syntheticFakeReplyIngressPayload`, `applyResult`, and metadata such as `network: "no-network"`, `pandaCall: "not-attempted"`, `gatewayCall: "not-attempted"`, `externalCliCall: "not-attempted"`, and `stateMutation: "reuses-one-claimed-intent-or-claims-one-queued-intent-and-inserts-or-replays-one-local-agent-message"`. This mutates only the local DB: it may reuse one already-claimed unapplied local intent or claim one queued intent, then inserts or replays one local agent message. It does not call Panda, Gateway, an external CLI, a child process, or the network, and it does not replace the existing route-created public fake reply. If two one-shot invocations race on the same already-claimed candidate, reply ingress idempotency replays or reports a controlled conflict instead of adding duplicate local agent rows; this is not an exclusive worker/dispatcher lock.

   To apply one operator-authored manual local reply from stdin while reusing the same local intent selection policy, run the same `local-panda:delivery-status` read-only preflight first if you need to inspect the next local candidate without mutating it:

   ```sh
   printf '%s\n' '{"reply":{"text":"Hello from the local manual reply"}}' | pnpm --silent --filter @panda-chat-widget/server local-panda:reply-manual
   ```

   To aim the manual reply at a specific local Panda delivery intent, copy `nextLocalReplyCandidate.id` (or `oldestQueuedIntent.id` when you intentionally want a queued target) from `local-panda:delivery-status` into the optional top-level `targetIntentId`:

   ```sh
   printf '%s\n' '{"targetIntentId":"11111111-1111-4111-8111-111111111111","reply":{"text":"Hello for this exact local intent"}}' | pnpm --silent --filter @panda-chat-widget/server local-panda:reply-manual
   ```

   With `targetIntentId`, selection is exact and has no fallback to the oldest candidate: a queued target is claimed by id, a claimed/unapplied target is reused by id, and a missing, already-applied, or not-replyable target returns controlled `dispatch_prepare` JSON with `targetIntentId` and reason `target_intent_not_found`, `target_intent_already_applied`, or `target_intent_not_replyable`. Targeted successes and selected build/apply failures include `targetIntentId`; targeted success `dispatchIntentSource` is `targeted-newly-claimed-queued-local-intent` for a queued target or `targeted-already-claimed-unapplied-local-intent` for a claimed/unapplied target. No-target input keeps the existing oldest claimed-unapplied-before-queued selection behavior.

   Expected manual shape is dynamic JSON with `completed: true`, `parsed: true`, kind: `"local-panda-one-shot-manual-reply-round-trip"`, mode: `"local-only-stdin-manual-reply"`, `dispatchIntentSource`, `dispatchPayload`, `manualReplyIngressPayload`, `applyResult`, and manual-specific metadata such as `input: "stdin-json-object"`, `manualReplySource: "stdin-manual-reply-text"`, `replyTextValidation: "normalized-before-db-config-or-dispatch"`, and `network: "no-network"`. The command validates and normalizes `reply.text` and any provided `targetIntentId` before opening the DB or claiming/selecting any intent; empty stdin, malformed JSON, non-object JSON, missing/blank text, non-string text, blank/non-string target, or malformed UUID target print a JSON envelope on stdout, exit 1, and do not open the DB. Controlled dispatch/build/apply failures print JSON on stdout, exit 0, and close the DB. This mutates only the local DB: it may reuse one already-claimed unapplied local intent or claim one queued intent, then inserts or replays one local agent message through the existing reply-ingress apply helper. In an already-open demo widget, the manual local reply should appear without reload within the catch-up polling interval. It does not call Panda, Gateway, an external CLI, a child process, or the network, and it does not add a public route, worker/retry/dead-letter flow, status lifecycle expansion, fake-reply replacement, frontend exposure, or schema migration.

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

## Built artifact and deployment scope

The production command means “execute compiled JavaScript,” not “production deployment is complete.” The built Fastify app resolves sibling package-owned `dist` directories with `import.meta.url`; it needs no Vite/dev server and does not use `process.cwd()`, but this slice does not add Docker runtime packaging, TLS/reverse-proxy configuration, durable multi-process event delivery, a production rate limiter, or operational hardening. The separate port-4173 server is a local demo aid only. There is still no real Panda/Gateway integration.

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
- Configured widgets record internal queued local delivery intents for new visitor messages. The delivery-status CLI is a read-only local preflight for `local-panda:reply-manual` and `local-panda:reply-round-trip`: it opens the configured DB, prints local queued/claimed/applied diagnostics, and never claims/applies/mutates. The dry-run command claims one intent and prints local JSON; the reply-ingress build CLI only reads a stdin wrapper object and builds a local payload envelope without DB/apply/network work; the reply-round-trip command first reuses the oldest already-claimed unapplied local intent, or claims one queued intent if none exists, then inserts/replays one deterministic local fake agent message. The manual reply command reads `reply.text` and optional top-level `targetIntentId` from stdin, validates them before DB/config/dispatch work, then either reuses that same local selection policy or targets the exact requested local intent with no fallback before applying one local reply-ingress payload. The reply-ingress apply CLI only reads a stdin JSON object and applies it to the local DB through the existing helper. No Panda/Gateway/external CLI delivery exists yet.
- If dispatch payload build, synthetic reply build, or reply apply fails after an intent is claimed, the intent may remain claimed. There is intentionally no rollback, retry/dead-letter behavior, or sent/delivered/failed/replied status lifecycle expansion yet.
- SSE fanout is process-local memory only; delivery intents are durable local records, not a retry worker, dispatcher, dead-letter queue, sent/delivered/failed state, public/worker reply-ingestion path, or multi-process fanout.
- Browser screenshots/live click smoke require browser automation and a running local Postgres stack.
- DB-backed live validation for GitHub issue #5 remains separate until it has real Docker/Postgres/browser evidence in the target environment.
- Auth is intentionally minimal: first owner + one workspace, email/password login, HttpOnly cookie sessions, no invites, no teams/RBAC UI, no billing/plans/usage.
- Console site/widget management is intentionally minimal: workspace-scoped list/create, safe widget settings, allowed domains, a generated install snippet, a configuration-only Panda route handle placeholder, and an owner-only local `nextLocalReplyCandidate` target ID helper for manual local replies.
- No deployment or Dockerized app runtime yet; CLI coverage is limited to local-only server scripts and is not a public ingestion surface.

## Public planning context

- Mission log: [Discussion #2](https://github.com/patrikmojzis/panda-chat-widget/discussions/2)
- Parent hardening issue: [#13](https://github.com/patrikmojzis/panda-chat-widget/issues/13)
- DB live validation tracker: [#5](https://github.com/patrikmojzis/panda-chat-widget/issues/5)
