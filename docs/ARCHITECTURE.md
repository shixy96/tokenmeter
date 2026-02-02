# TokenMeter Architecture Documentation

This document provides visual architecture diagrams for the TokenMeter project to help quickly understand the system structure and data flow.

## Overall Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TokenMeter Overall Architecture                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         macOS System Tray                            │   │
│  │  ┌──────────────┐                                                   │   │
│  │  │ Tray Icon    │ ← Display real-time usage ($34.02 39.3M)          │   │
│  │  │ + Menu       │ ← Today/Last 30 Days/Model breakdown              │   │
│  │  └──────────────┘                                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Tauri 2 Runtime                              │   │
│  │  ┌─────────────────────────┐     ┌─────────────────────────────┐   │   │
│  │  │     React Frontend      │     │       Rust Backend          │   │   │
│  │  │  ┌───────────────────┐  │     │  ┌───────────────────────┐  │   │   │
│  │  │  │ Dashboard         │  │     │  │ commands/             │  │   │   │
│  │  │  │ ProviderEditor    │◄─┼─────┼─►│   usage.rs            │  │   │   │
│  │  │  │ Settings          │  │ IPC │  │   providers.rs        │  │   │   │
│  │  │  └───────────────────┘  │     │  └───────────────────────┘  │   │   │
│  │  │           │             │     │            │                │   │   │
│  │  │           ▼             │     │            ▼                │   │   │
│  │  │  ┌───────────────────┐  │     │  ┌───────────────────────┐  │   │   │
│  │  │  │ TanStack Query    │  │     │  │ services/             │  │   │   │
│  │  │  │ (Cache + Polling) │  │     │  │   ccusage.rs          │  │   │   │
│  │  │  └───────────────────┘  │     │  │   pricing.rs          │  │   │   │
│  │  │                         │     │  │   script_runner.rs    │  │   │   │
│  │  └─────────────────────────┘     │  └───────────────────────┘  │   │   │
│  │                                  └─────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        External Dependencies                         │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │   │
│  │  │ ccusage CLI  │  │ models.dev   │  │ curl/wget/http/httpie    │  │   │
│  │  │ (Usage data) │  │ (Pricing API)│  │ (Provider fetch)         │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Data Flow Details                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ══════════════════════════════════════════════════════════════════════    │
│  ║                    1. ccusage Usage Data Flow                       ║    │
│  ══════════════════════════════════════════════════════════════════════    │
│                                                                             │
│  ┌──────────────┐    shell -l -c     ┌──────────────┐                      │
│  │ ccusage CLI  │◄───────────────────│ ccusage.rs   │                      │
│  │ (npm global) │                    │              │                      │
│  └──────┬───────┘                    └──────┬───────┘                      │
│         │                                   │                              │
│         │ JSON (daily + totals)             │ Parse + Transform            │
│         ▼                                   ▼                              │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │  CcusageResponse { daily: [...], totals: {...} }                 │     │
│  └──────────────────────────────────────────────────────────────────┘     │
│         │                                                                  │
│         │ cost == 0 ? ──► pricing.rs ──► models.dev API                   │
│         ▼                                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │  UsageSummary { today, thisMonth, dailyUsage, modelBreakdown }   │     │
│  └──────────────────────────────────────────────────────────────────┘     │
│         │                                                                  │
│         ├──► AppState.usage (Mutex cache)                                 │
│         └──► tray.rs (Update menu bar title + menu)                       │
│                                                                            │
│  ══════════════════════════════════════════════════════════════════════    │
│  ║                 2. Custom Provider Data Flow                        ║    │
│  ══════════════════════════════════════════════════════════════════════    │
│                                                                             │
│  ApiProvider { fetchScript, transformScript, env }                         │
│         │                                                                  │
│         │ Security validation (only curl/wget/http/httpie allowed)        │
│         ▼                                                                  │
│  ┌──────────────┐    Command::new()   ┌──────────────┐                    │
│  │ shell_utils  │───────────────────►│ External HTTP│                    │
│  │ parse_command│    env_clear()      │ Client       │                    │
│  └──────────────┘                     └──────┬───────┘                    │
│                                              │ JSON Response               │
│                                              ▼                             │
│  ┌──────────────────────────────────────────────────────────────────┐     │
│  │  script_runner.rs (boa_engine JS sandbox, 5s timeout, 10KB limit)│     │
│  └──────────────────────────────────────────────────────────────────┘     │
│         │                                                                  │
│         ▼                                                                  │
│  ProviderUsageResult { cost?, tokens?, used?, total? }                    │
│                                                                            │
│  ══════════════════════════════════════════════════════════════════════    │
│  ║                    3. Frontend-Backend Communication                ║    │
│  ══════════════════════════════════════════════════════════════════════    │
│                                                                             │
│   Frontend (React)                         Backend (Rust)                  │
│                                                                             │
│   api.ts ──────── invoke() ──────────────► #[tauri::command]              │
│          ◄─────── JSON Response ──────────                                 │
│                                                                             │
│   App.tsx ◄────── listen('navigate') ────── lib.rs emit()                 │
│   Dashboard ◄──── listen('usage-preloaded') lib.rs emit()                 │
│   App/Tray ◄───── listen('config-updated') usage.rs emit()                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Backend Module Dependencies

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Backend Module Dependencies                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  main.rs ──► lib.rs                                                        │
│                 │                                                           │
│                 ├── Register Tauri commands                                │
│                 ├── Initialize AppState                                    │
│                 ├── Set up system tray                                     │
│                 └── Start background preload task                          │
│                 │                                                           │
│      ┌──────────┼──────────┬──────────────┬──────────────┐                 │
│      │          │          │              │              │                 │
│      ▼          ▼          ▼              ▼              ▼                 │
│  tray.rs   commands/   services/     state.rs      config.rs              │
│      │     usage.rs    ccusage.rs        │          types.rs              │
│      │     providers   pricing.rs        │          error.rs              │
│      │         .rs     script_runner     │                                 │
│      │                 shell_utils       │                                 │
│      │                      │            │                                 │
│      └──────────────────────┴────────────┘                                 │
│                             │                                              │
│                             ▼                                              │
│                    Shared Type Modules                                     │
│                    (config/types/error)                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Frontend Module Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Frontend Module Structure                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  main.tsx ──► QueryClientProvider                                          │
│                    │                                                        │
│                    ▼                                                        │
│               App.tsx                                                       │
│                    │                                                        │
│       ┌────────────┼────────────┐                                          │
│       │            │            │                                          │
│       ▼            ▼            ▼                                          │
│  Dashboard   ProviderEditor  Settings                                      │
│       │            │            │                                          │
│       └────────────┴────────────┘                                          │
│                    │                                                        │
│                    ▼                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         hooks/                                       │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ useUsageData │  │ useProviders │  │ useTheme     │              │   │
│  │  │ useConfig    │  │ useSave...   │  │ useLanguage  │              │   │
│  │  │ useRefresh   │  │ useDelete... │  │ useConfigEvents            │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────────────┘              │   │
│  └─────────┼─────────────────┼──────────────────────────────────────────┘   │
│            │                 │                                              │
│            ▼                 ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        lib/api.ts                                    │   │
│  │  getUsageSummary() │ getProviders()  │ getConfig()                  │   │
│  │  refreshUsage()    │ saveProvider()  │ saveConfig()                 │   │
│  │                    │ deleteProvider()│                              │   │
│  │                    │ testProvider()  │                              │   │
│  └────────────────────────────┬────────────────────────────────────────┘   │
│                               │                                             │
│                               │ invoke()                                    │
│                               ▼                                             │
│                    @tauri-apps/api/core                                     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      components/ui/                                  │   │
│  │  button │ card │ input │ label │ separator │ switch │ tabs │ textarea│   │
│  │                       (shadcn/ui)                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                          i18n/                                       │   │
│  │  index.ts (i18next init) │ locales/{en,zh}/*.json (translation files)│   │
│  │                    (i18next + react-i18next)                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       types/index.ts                                 │   │
│  │  UsageSummary │ ApiProvider │ AppConfig │ MenuBarConfig │ ...       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Configuration Storage Structure

```
~/.tokenmeter/
├── config.json              # Application config
│   ├── refreshInterval      # Refresh interval (seconds)
│   ├── launchAtLogin        # Launch at login
│   ├── language             # Language preference ("en"/"zh", optional, defaults to system)
│   └── menuBar              # Menu bar config
│       ├── format           # Display format (${cost} ${tokens})
│       ├── fixedBudget      # Daily budget
│       └── showColorCoding  # Color coding
│
└── providers/               # Custom Provider configs
    └── {id}.json
        ├── id               # Provider ID
        ├── name             # Display name
        ├── enabled          # Whether enabled
        ├── fetchScript      # Data fetch script
        ├── transformScript  # JS transform script
        └── env              # Environment variables
```

Theme preference is stored in `localStorage` (key: `tokenmeter-theme`), synchronized across windows via `storage` events.
