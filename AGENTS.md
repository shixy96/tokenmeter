# AGENTS.md

本文件面向在该仓库内运行的 agentic coding agents（含自动化代码修改/生成）。目标：让你快速、可重复地构建/检查/测试，并遵循仓库既有代码风格与安全边界。

## 与 CLAUDE.md 同步

- 规范来源：以 `AGENTS.md` 为准；`CLAUDE.md` 作为 Claude Code 入口与架构/数据流补充说明
- 若两者冲突，以 `AGENTS.md` 为准；修改命令/质量门槛/安全边界后同步更新 `CLAUDE.md`
- 本仓库未发现 Cursor 规则（`.cursor/rules/` / `.cursorrules`）与 Copilot 规则（`.github/copilot-instructions.md`）；如后续新增，请将其要点合并到 `AGENTS.md`

## 项目概览

- 应用：TokenMeter（macOS 菜单栏用量统计）
- 技术栈：Tauri 2 + Rust（后端/托盘/命令） + React 19 + TypeScript + Vite（前端 UI）
- 核心数据来源：`ccusage` CLI（可选安装）与自定义 Provider（脚本获取 + JS transform）

关键目录：`src/`（前端）、`src-tauri/src/`（后端）、`src/types/index.ts`（TS 类型）、`src-tauri/src/types.rs`（Rust IPC 类型）

## 常用命令（Build / Lint / Test）

### 安装依赖
```bash
npm install
```

### 开发（Tauri 前后端一起）
```bash
npm run tauri dev
```

### 前端构建/类型检查
```bash
# TS 类型检查 + Vite 构建
npm run build

# 仅运行 Vite（Web 预览用途；桌面开发优先用 tauri dev）
npm run dev
```

### 前端 Lint
```bash
npm run lint
npm run lint:fix

# 只 lint 单个文件（或一小组文件）
npx eslint src/App.tsx
```

说明：ESLint 配置见 `eslint.config.mjs`。

### Rust（在 `src-tauri/` 目录运行）
```bash
# 格式检查（不写入）
cargo fmt --check

# 自动格式化（会改文件）
cargo fmt

# Clippy（本项目对 clippy 要求较严格）
cargo clippy

# 单元测试（全部）
cargo test
```

#### 运行单个 Rust 测试（强烈推荐掌握）
```bash
# 通过测试函数名过滤
cargo test test_validate_fetch_script_valid_curl

# 通过模块路径过滤（更精确）
cargo test commands::providers::tests::test_validate_env_valid

# 打印测试输出（调试用）
cargo test test_parse_ccusage_response -- --nocapture
```

#### 运行验证 example（用于核心功能回归）
```bash
cargo run --example test_ccusage
cargo run --example test_provider -- <name>
cargo run --example test_config
```

### 发布构建（Tauri Bundle）
```bash
npm run tauri build
```

产物一般位于：`src-tauri/target/release/bundle/`。

## 质量门槛（提交前建议）
1) 前端：`npm run lint`；2) Rust：`cargo fmt --check && cargo clippy && cargo test`；3) 核心逻辑改动：补跑 `cargo run --example ...`

## 代码风格与约定

### TypeScript / React

- **格式化**：2 空格缩进、单引号、无分号（由 ESLint 约束）。
- **Imports**：类型用 `import type`；内部模块优先用 `@/`（见 `tsconfig.json`、`vite.config.ts`）；避免深相对路径。
- **类型**：避免 `any`（用 `unknown` + 收窄）；IPC 字段与 Rust `camelCase` 对齐；改 Rust 类型时同步更新 `src/types/index.ts`。
- **组件**：函数组件 + Hooks；`useEffect` 必须清理（如 `listen()` 的 `unlisten?.()`）。
- **数据**：用 TanStack Query（`src/hooks/`）；轮询/刷新间隔需按配置并做 clamp（见 `src/hooks/useUsageData.ts`）。
- **UI/错误**：优先复用 `src/components/ui/`；class 合并用 `cn()`；`invoke()` 错误多为字符串，前端需友好展示。

### Rust / Tauri

- **格式化/Clippy**：遵循 `src-tauri/rustfmt.toml`；crate 启用 `clippy::pedantic` + `clippy::nursery`（见 `src-tauri/src/lib.rs`）。
- **命名**：Rust `snake_case`/`PascalCase`；IPC `#[serde(rename_all = "camelCase")]`；Tauri command 名称为 `snake_case`（前端 `invoke()` 依赖）。
- **错误边界**：commands 返回 `Result<T, AppError>`；services 用 `anyhow::Result` 聚合上下文并在 command 层映射为 `AppError::{Fetch,Config,Validation,...}`。
- **并发/锁**：缩小锁范围，避免持锁跨 `await`（参考 `src-tauri/src/commands/usage.rs`）。
- **安全**：Provider 只允许 `curl/wget/http/httpie`，禁注入模式；执行必须 `env_clear()` 且 env 需校验（见 `src-tauri/src/commands/providers.rs`）。

## 变更指引（常见场景）

- 新增/修改 Tauri command：
  1) 在 `src-tauri/src/commands/` 添加函数并返回 `Result<_, AppError>`
  2) 在 `src-tauri/src/commands/mod.rs` 导出
  3) 在 `src-tauri/src/lib.rs` 的 `generate_handler![]` 注册
  4) 在 `src/lib/api.ts` 增加 `invoke()` 封装
  5) 若涉及 IPC 类型：同步更新 `src-tauri/src/types.rs` 与 `src/types/index.ts`

- 修改 Provider/脚本执行相关逻辑：必须保留现有校验与隔离策略，并补充/更新单元测试（`providers.rs`、`script_runner.rs`）。

## 运行环境提示

- Node.js 18+，Rust 1.75+（见 `README.md`）。
- `ccusage` 为可选依赖：未安装时应给出清晰提示（后端已有相关错误信息）。
