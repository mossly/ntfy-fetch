# Repository Guidelines

## Project Structure & Module Organization
- src/index.ts — application entrypoint.
- src/core/ — scheduling, queues, notifications, and plugin orchestration (EventScheduler, Scheduler, PluginManager).
- src/plugins/ — built-in and custom plugins (ase/ abstractions, 	ide/ examples).
- src/utils/ — shared helpers (logger, scheduling, 	imezone).
- src/types/ — domain types and interfaces.
- src/config/ — configuration loader/utilities.
- Runtime folders: config/, data/, plugins/ (mounted or populated at deploy time).

## Build, Test, and Development Commands
- 
pm run dev — watch mode via tsx (runs src/index.ts).
- 
pm run build — compile TypeScript to dist/ (tsc).
- 
pm start — run compiled app from dist/index.js.
- 
pm test — run Jest tests (ts-jest).
- 
pm run lint — ESLint over src/**/*.ts.
- 
pm run type-check — strict TS checks without emit.

## Coding Style & Naming Conventions
- TypeScript, strict; 2-space indentation.
- Classes use PascalCase (e.g., EventScheduler.ts); utilities use camelCase filenames.
- Prefer named exports; keep modules focused and avoid circular deps.
- ESLint with @typescript-eslint enforces style—fix warnings before commit.

## Testing Guidelines
- Jest with 	s-jest. Name tests *.test.ts near sources or __tests__/.
- Mock network (xios) and time-sensitive code.
- Aim to cover scheduling logic, plugin loading, and time zone handling.
- 
px jest --coverage for local coverage checks.

## Commit & Pull Request Guidelines
- Conventional Commits: eat:, ix:, efactor:, chore:, docs:, 	est:. Scopes: core, plugins, utils (e.g., eat(core): add backoff policy).
- PRs: clear summary, rationale, linked issues, screenshots/logs when UX/behavior changes, note env/config changes, and test updates.
- CI gates: build, lint, and tests must pass. Update README.md/DEPLOYMENT.md when ops change.

## Plugin Authoring & Security
- Create under src/plugins/<Name>/; extend ase/Plugin and optionally ase/DataProvider.
- Register via PluginManager; avoid side effects in constructors.
- Load secrets via env vars (dotenv supported). Do not commit secrets; use .env locally and deployment env vars in production.