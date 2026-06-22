# Panda Chat Widget

TypeScript/pnpm workspace for a future embeddable Panda chat widget. The repo is currently a skeleton: it defines package ownership, shared TypeScript settings, and a command contract for future implementation work.

## Current scope

V1 is widget-only chat spine work. This repository is not a working widget yet.

In scope for the current skeleton:

- pnpm workspace layout
- Node 24 engine target
- TypeScript configuration presets for Node and browser packages
- root commands that future agents and humans can run consistently

Current non-goals:

- server routes, database/Kysely, or SSE runtime behavior
- React/Vite widget UI implementation
- host-page loader runtime behavior
- Docker, CLI, deployments, or production packaging
- Panda Gateway/Panda agent integration
- real chat logic

## Workspace packages

| Path | Package | Responsibility |
| --- | --- | --- |
| `apps/server` | `@panda-chat-widget/server` | Future API, database, and SSE service. |
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
| `pnpm dev` | Recursively runs package `dev` scripts in parallel. | Command wiring only; packages currently print explicit TODO messages. |
| `pnpm typecheck` | Recursively runs package `typecheck` scripts. | Packages without `src` print TODO; once TypeScript sources exist, they run `tsc -p tsconfig.json --noEmit --pretty false`. |
| `pnpm lint` | Recursively runs package `lint` scripts. | Command wiring only; lint tooling is not installed yet. |
| `pnpm test` | Recursively runs package `test` scripts. | Command wiring only; there are no real tests yet. |
| `pnpm build` | Recursively runs package `build` scripts. | Command wiring only; there are no real builds yet. |
| `pnpm check` | Runs `typecheck`, `lint`, `test`, then `build`. | One obvious validation path for the skeleton; it does not prove product behavior yet. |

## Public planning context

- Mission log: [Discussion #2](https://github.com/patrikmojzis/panda-chat-widget/discussions/2)
- Tracker issue: [#14](https://github.com/patrikmojzis/panda-chat-widget/issues/14)
- Milestone: [#1](https://github.com/patrikmojzis/panda-chat-widget/milestone/1)
