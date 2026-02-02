# AGENTS.md

This file is for agentic coding agents (including automated code modification/generation) running in this repository. Goal: enable fast, repeatable build/check/test cycles while following the codebase's existing code style and security boundaries.

## Sync with CLAUDE.md

- Source of truth: `AGENTS.md`; `CLAUDE.md` serves as the Claude Code entry point and architecture/data flow supplement
- If conflicts exist, `AGENTS.md` takes precedence; update `CLAUDE.md` when modifying commands/quality gates/security boundaries
- No Cursor rules (`.cursor/rules/` / `.cursorrules`) or Copilot rules (`.github/copilot-instructions.md`) found in this repo; if added later, merge key points into `AGENTS.md`

## Project Overview

- App: TokenMeter (macOS menu bar usage statistics)
- Tech stack: Tauri 2 + Rust (backend/tray/commands) + React 19 + TypeScript + Vite (frontend UI)
- Core data sources: `ccusage` CLI (optional) and custom Providers (script fetch + JS transform)

Key directories: `src/` (frontend), `src-tauri/src/` (backend), `src/types/index.ts` (TS types), `src-tauri/src/types.rs` (Rust IPC types)

## Common Commands (Build / Lint / Test)

### Install Dependencies
```bash
npm install
```

### Development (Tauri frontend + backend together)
```bash
npm run tauri dev
```

### Frontend Build / Type Check
```bash
# TS type check + Vite build
npm run build

# Run Vite only (for web preview; use tauri dev for desktop development)
npm run dev
```

### Frontend Lint
```bash
npm run lint
npm run lint:fix

# Lint a single file (or a small set of files)
npx eslint src/App.tsx
```

Note: ESLint config is in `eslint.config.mjs`.

### Rust (run in `src-tauri/` directory)
```bash
# Format check (no write)
cargo fmt --check

# Auto format (modifies files)
cargo fmt

# Clippy (must use --all-targets to include test code, -D warnings to treat warnings as errors)
cargo clippy --all-targets -- -D warnings

# Unit tests (all)
cargo test
```

#### Running a Single Rust Test (highly recommended to master)
```bash
# Filter by test function name
cargo test test_validate_fetch_script_valid_curl

# Filter by module path (more precise)
cargo test commands::providers::tests::test_validate_env_valid

# Print test output (for debugging)
cargo test test_parse_ccusage_response -- --nocapture
```

#### Running Validation Examples (for core functionality regression)
```bash
cargo run --example test_ccusage
cargo run --example test_provider -- <name>
cargo run --example test_config
```

### Release Build (Tauri Bundle)
```bash
npm run tauri build
```

Artifacts are typically in: `src-tauri/target/release/bundle/`.

## Quality Gates (recommended before commit)
1) Frontend: `npm run lint`
2) Rust: `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`
3) Core logic changes: run `cargo run --example ...`

> **Note**: `--all-targets` is required to check test code (`#[cfg(test)]` modules). Without it, clippy only checks library/binary code, which may cause CI failures.

## Code Style & Conventions

### TypeScript / React

- **Formatting**: 2-space indent, single quotes, no semicolons (enforced by ESLint).
- **Imports**: Use `import type` for types; prefer `@/` for internal modules (see `tsconfig.json`, `vite.config.ts`); avoid deep relative paths.
- **Types**: Avoid `any` (use `unknown` + narrowing); align IPC fields with Rust `camelCase`; sync `src/types/index.ts` when changing Rust types.
- **Components**: Functional components + Hooks; `useEffect` must clean up (e.g., `unlisten?.()` for `listen()`).
- **Data**: Use TanStack Query (`src/hooks/`); polling/refresh intervals need to follow config and be clamped (see `src/hooks/useUsageData.ts`).
- **UI/Errors**: Prefer reusing `src/components/ui/`; use `cn()` for class merging; `invoke()` errors are often strings, frontend should display them user-friendly.
- **i18n**: Use `useTranslation()` hook for UI text; translation files are in `src/i18n/locales/{en,zh}/`, split by feature module (common/dashboard/providers/settings/tray); new text must update both English and Chinese translations.

### Rust / Tauri

- **Formatting/Clippy**: Follow `src-tauri/rustfmt.toml`; crate enables `clippy::pedantic` + `clippy::nursery` (see `src-tauri/src/lib.rs`).
- **Naming**: Rust uses `snake_case`/`PascalCase`; IPC uses `#[serde(rename_all = "camelCase")]`; Tauri command names are `snake_case` (frontend `invoke()` depends on this).
- **Error Boundaries**: Commands return `Result<T, AppError>`; services use `anyhow::Result` to aggregate context and map to `AppError::{Fetch,Config,Validation,...}` at command layer.
- **Concurrency/Locks**: Minimize lock scope, avoid holding locks across `await` (reference `src-tauri/src/commands/usage.rs`).
- **Security**: Providers only allow `curl/wget/http/httpie`, injection patterns forbidden; execution must use `env_clear()` and env needs validation (see `src-tauri/src/commands/providers.rs`).

## Change Guidelines (common scenarios)

- Adding/modifying a Tauri command:
  1) Add function in `src-tauri/src/commands/` returning `Result<_, AppError>`
  2) Export in `src-tauri/src/commands/mod.rs`
  3) Register in `src-tauri/src/lib.rs` `generate_handler![]`
  4) Add `invoke()` wrapper in `src/lib/api.ts`
  5) If IPC types involved: sync both `src-tauri/src/types.rs` and `src/types/index.ts`

- Modifying Provider/script execution logic: must preserve existing validation and isolation strategies, and add/update unit tests (`providers.rs`, `script_runner.rs`).

- Adding/modifying UI text translations:
  1) Determine which module the text belongs to (common/dashboard/providers/settings/tray)
  2) Add English translation in `src/i18n/locales/en/{module}.json`
  3) Add Chinese translation in `src/i18n/locales/zh/{module}.json`
  4) Use `const { t } = useTranslation('{module}')` in component to get translation function
  5) Use `t('key')` or `t('nested.key')` to reference translated text

## Runtime Notes

- Node.js 18+, Rust 1.75+ (see `README.md`).
- `ccusage` is an optional dependency: should provide clear prompts when not installed (backend already has relevant error messages).
