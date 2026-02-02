# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Sync with AGENTS.md

- Agent execution guidelines follow `AGENTS.md`; this file serves as Claude Code entry point and architecture/data flow documentation
- If `CLAUDE.md` conflicts with `AGENTS.md`, `AGENTS.md` takes precedence
- When updating commands, quality gates, or security boundaries, please sync `AGENTS.md`

## Project Overview

TokenMeter is a Tauri 2 + React desktop application for real-time API usage statistics display. Core functionality is implemented through Rust backend for data fetching and script execution, with React frontend handling UI rendering.

## Development Commands

```bash
# Start development mode (frontend + backend together)
npm run tauri dev

# Frontend lint
npm run lint
npm run lint:fix

# Rust format check (run in src-tauri/ directory)
cargo fmt --check

# Rust clippy check (must use --all-targets to include test code)
cargo clippy --all-targets -- -D warnings

# Rust unit tests
cargo test

# Validation scripts (run in src-tauri/ directory)
cargo run --example test_ccusage           # Validate ccusage data fetching
cargo run --example test_provider -- <name> # Validate specified provider
cargo run --example test_config            # Validate config loading
```

## Code Architecture

> For complete ASCII architecture diagrams, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

### Frontend (React)

```
src/
├── main.tsx                   # React entry point, configures TanStack Query + i18n
├── App.tsx                    # Main app, uses Tabs for navigation
├── components/
│   ├── Dashboard.tsx          # Usage dashboard (charts, statistics)
│   ├── ProviderEditor.tsx     # Provider editor (CRUD + test)
│   ├── Settings.tsx           # App settings (refresh interval, menu bar format, language, etc.)
│   └── ui/                    # shadcn/ui base component library
├── hooks/
│   ├── useProviders.ts        # Provider management hooks
│   ├── useUsageData.ts        # Usage data hooks (with auto-polling)
│   └── useLanguage.ts         # Language switch hook (read/save language preference)
├── i18n/
│   ├── index.ts               # i18next initialization config
│   └── locales/               # Translation files
│       ├── en/                # English translations
│       │   ├── common.json
│       │   ├── dashboard.json
│       │   ├── providers.json
│       │   ├── settings.json
│       │   └── tray.json
│       └── zh/                # Chinese translations
│           ├── common.json
│           ├── dashboard.json
│           ├── providers.json
│           ├── settings.json
│           └── tray.json
├── lib/
│   ├── api.ts                 # Rust backend API wrapper (invoke calls)
│   └── utils.ts               # Utility functions (class name merging, formatting)
└── types/
    └── index.ts               # TypeScript type definitions
```

**Frontend Features:**
- Uses `TanStack Query` for data caching and auto-polling
- Page navigation uses controlled `Tabs` component pattern (not React Router)
- Listens to `navigate` events sent from Rust backend via `listen()`
- Uses `i18next` + `react-i18next` for multi-language support (Chinese/English)

### Backend (Rust)

```
src-tauri/src/
├── main.rs              # Program entry, calls lib::run()
├── lib.rs               # Command registration, app initialization, tray setup
├── commands/
│   ├── mod.rs           # Module exports
│   ├── usage.rs         # Usage-related commands (get/refresh)
│   └── providers.rs     # Provider management commands (with security validation)
├── services/
│   ├── mod.rs           # Module exports
│   ├── ccusage.rs       # ccusage CLI integration (external command calls)
│   ├── pricing.rs       # Model pricing fetching (HTTP API + fuzzy matching)
│   └── script_runner.rs # JS script execution (boa_engine)
├── state.rs             # Global state (AppState)
├── config.rs            # Config structure definitions
├── types.rs             # Type definitions
├── error.rs             # Error types (serializable)
└── tray.rs              # System tray logic (menu, title updates)
```

### Frontend-Backend Communication

| Pattern | Frontend | Backend |
|---------|----------|---------|
| Request/Response | `invoke('command_name', args)` | `#[tauri::command]` |
| Event Push | `listen('event', callback)` | `window.emit('event', data)` |

### API Mapping

| Frontend API (`src/lib/api.ts`) | Rust Command | File Location |
|---------------------------------|--------------|---------------|
| `getUsageSummary()` | `get_usage_summary` | `commands/usage.rs` |
| `refreshUsage()` | `refresh_usage` | `commands/usage.rs` |
| `getConfig()` / `saveConfig()` | `get_config` / `save_config` | `commands/usage.rs` |
| `getProviders()` / `saveProvider()` | `get_providers` / `save_provider` | `commands/providers.rs` |
| `deleteProvider()` / `testProvider()` | `delete_provider` / `test_provider` | `commands/providers.rs` |
| `openDashboard()` / `openSettings()` | `open_dashboard` / `open_settings` | `lib.rs` |

### Data Flow

1. **ccusage Service** (`services/ccusage.rs`): Calls external `ccusage` CLI to get usage data
2. **Custom Provider** (`services/script_runner.rs`):
   - `fetch_script`: Calls external commands (curl/wget/http/httpie) to fetch data
   - `transform_script`: Executes transform scripts via `boa_engine` JS engine
3. **State Management** (`state.rs`): `AppState` singleton manages config and usage cache
4. **Price Fallback** (`services/pricing.rs`): Fetches model prices from models.dev API

### Type Synchronization

- Rust types: `src-tauri/src/types.rs` (`#[serde(rename_all = "camelCase")]`)
- Rust config: `src-tauri/src/config.rs` (`AppConfig` struct, includes `language` field)
- TypeScript types: `src/types/index.ts`
- Field naming: Rust uses snake_case, TS uses camelCase

## Configuration Storage

| Path | Contents |
|------|----------|
| `~/.tokenmeter/config.json` | App config (refresh interval, menu bar format, budget threshold, language preference) |
| `~/.tokenmeter/providers/{id}.json` | Custom Provider configs |

**AppConfig.language field:** Stores user language preference (`"en"` / `"zh"`), defaults to `None` (follows browser/system language).

## Testing

### Unit Tests (46 test cases)

| Module | Test Coverage |
|--------|---------------|
| `ccusage.rs` | JSON parsing, cache tokens, multi-day/multi-model |
| `config.rs` | Serialization/deserialization, defaults |
| `pricing.rs` | Price calculation (exact/fuzzy matching) |
| `script_runner.rs` | JS execution, array handling, error handling |
| `providers.rs` | Security validation (path traversal, command injection, env variable injection) |

### Validation Commands

```bash
cargo test                    # Run all tests
cargo run --example test_ccusage      # Validate ccusage data fetching
cargo run --example test_provider -- <name>  # Validate provider script
cargo run --example test_config       # Validate config loading
```

## Quality Checks

After modifying code, must run these checks:

1. **Frontend**: `npm run lint`
2. **Rust**: `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`
3. **Core functionality changes**: Run corresponding example validation

> **Note**: `--all-targets` is required to check test code (`#[cfg(test)]` modules). Without it, clippy only checks library/binary code, which may cause CI failures.

## Code Standards

- TypeScript strict mode, functional components + Hooks
- UI components based on shadcn/ui (`src/components/ui/`)
- Rust follows Clippy pedantic + nursery rules
- No TODOs, placeholders, or incomplete code
- Provider security validation: only allow curl/wget/http/httpie, forbid command injection
