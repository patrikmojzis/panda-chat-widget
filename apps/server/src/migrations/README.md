# Server migrations

Kysely migration files live here and run in filename order via `pnpm --filter @panda-chat-widget/server db:migrate`.

Current migrations:

- `0001_initial_widget_tables.ts` creates the initial widget product tables.
- `0002_auth_workspace_foundation.ts` adds first-owner users, workspaces, auth sessions, and nullable site ownership.
- `0003_widget_safe_bootstrap_settings.ts` adds server-owned safe bootstrap copy and token settings to widgets.
