# Server migrations

Kysely migration sources live here and compile to `apps/server/dist/migrations/*.js`. After `pnpm build`, they run in filename order via `pnpm --filter @panda-chat-widget/server db:migrate`; the production command loads only the compiled directory.

Current migrations:

- `0001_initial_widget_tables.ts` creates the initial widget product tables.
- `0002_auth_workspace_foundation.ts` adds first-owner users, workspaces, auth sessions, and nullable site ownership.
- `0003_widget_safe_bootstrap_settings.ts` adds server-owned safe bootstrap copy and token settings to widgets.
- `0004_widget_panda_connection_placeholder.ts` adds a nullable widget-owned Panda route handle placeholder.
- `0005_panda_delivery_intents.ts` adds an internal local-only durable intent table for future Panda delivery; it records queued rows only and does not call Panda, Gateway, CLI, or any dispatcher.
- `0006_panda_delivery_intent_claims.ts` adds a local-only queued-to-claimed intent transition timestamp; it still does not call Panda, Gateway, CLI, or any dispatcher.
