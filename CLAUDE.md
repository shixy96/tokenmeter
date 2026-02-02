# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## 与 AGENTS.md 同步

- 本仓库的 agent 运行规范以 `AGENTS.md` 为准；本文件主要作为 Claude Code 入口与架构/数据流说明
- 若 `CLAUDE.md` 与 `AGENTS.md` 有冲突，以 `AGENTS.md` 为准
- 更新命令、质量门槛或安全边界时，请同步更新 `AGENTS.md`

## 项目概述

TokenMeter 是一个 Tauri 2 + React 桌面应用，用于实时显示 API 用量统计。核心功能通过 Rust 后端实现数据抓取和脚本执行，React 前端负责 UI 展示。

## 开发命令

```bash
# 前后端同时启动开发模式
npm run tauri dev

# 前端 lint
npm run lint
npm run lint:fix

# Rust 格式检查（在 src-tauri/ 目录运行）
cargo fmt --check

# Rust clippy 检查
cargo clippy

# Rust 单元测试
cargo test

# 验证脚本（在 src-tauri/ 目录运行）
cargo run --example test_ccusage           # 验证 ccusage 数据抓取
cargo run --example test_provider -- <name> # 验证指定 provider
cargo run --example test_config            # 验证配置加载
```

## 代码架构

> 完整的 ASCII 架构图请参阅 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

### 前端 (React)

```
src/
├── main.tsx                   # React 渲染入口，配置 TanStack Query
├── App.tsx                    # 主应用，使用 Tabs 实现导航
├── components/
│   ├── Dashboard.tsx          # 用量仪表板（图表、统计）
│   ├── ProviderEditor.tsx     # Provider 编辑器（增删改测）
│   ├── Settings.tsx           # 应用设置（刷新间隔、菜单栏格式等）
│   └── ui/                    # shadcn/ui 基础组件库
├── hooks/
│   ├── useProviders.ts        # Provider 管理 hooks
│   └── useUsageData.ts        # 用量数据 hooks（含自动轮询）
├── lib/
│   ├── api.ts                 # Rust 后端 API 封装（invoke 调用）
│   └── utils.ts               # 工具函数（类名合并、格式化）
└── types/
    └── index.ts               # TypeScript 类型定义
```

**前端特点：**
- 使用 `TanStack Query` 管理数据缓存和自动轮询
- 页面导航采用 `Tabs` 受控组件模式（非 React Router）
- 通过 `listen()` 监听 Rust 后端发送的 `navigate` 事件

### 后端 (Rust)

```
src-tauri/src/
├── main.rs              # 程序入口，调用 lib::run()
├── lib.rs               # 命令注册、应用初始化、托盘设置
├── commands/
│   ├── mod.rs           # 模块导出
│   ├── usage.rs         # 用量相关命令（get/refresh）
│   └── providers.rs     # Provider 管理命令（含安全验证）
├── services/
│   ├── mod.rs           # 模块导出
│   ├── ccusage.rs       # ccusage CLI 集成（调用外部命令）
│   ├── pricing.rs       # 模型价格获取（HTTP API + 模糊匹配）
│   └── script_runner.rs # JS 脚本执行（boa_engine 引擎）
├── state.rs             # 全局状态（AppState）
├── config.rs            # 配置结构定义
├── types.rs             # 类型定义
├── error.rs             # 错误类型（可序列化）
└── tray.rs              # 系统托盘逻辑（菜单、标题更新）
```

### 前后端通信

| 模式 | 前端 | 后端 |
|------|------|------|
| 请求/响应 | `invoke('command_name', args)` | `#[tauri::command]` |
| 事件推送 | `listen('event', callback)` | `window.emit('event', data)` |

### API 对应关系

| 前端 API (`src/lib/api.ts`) | Rust 命令 | 文件位置 |
|-----------------------------|-----------|----------|
| `getUsageSummary()` | `get_usage_summary` | `commands/usage.rs` |
| `refreshUsage()` | `refresh_usage` | `commands/usage.rs` |
| `getConfig()` / `saveConfig()` | `get_config` / `save_config` | `commands/usage.rs` |
| `getProviders()` / `saveProvider()` | `get_providers` / `save_provider` | `commands/providers.rs` |
| `deleteProvider()` / `testProvider()` | `delete_provider` / `test_provider` | `commands/providers.rs` |
| `openDashboard()` / `openSettings()` | `open_dashboard` / `open_settings` | `lib.rs` |

### 数据流

1. **ccusage 服务** (`services/ccusage.rs`): 调用外部 `ccusage` CLI 获取用量
2. **自定义 Provider** (`services/script_runner.rs`):
   - `fetch_script`: 调用外部命令（curl/wget/http/httpie）获取数据
   - `transform_script`: 通过 `boa_engine` JS 引擎执行转换脚本
3. **状态管理** (`state.rs`): `AppState` 单例管理配置和用量缓存
4. **价格回退** (`services/pricing.rs`): 从 models.dev API 获取模型价格

### 类型同步

- Rust 类型: `src-tauri/src/types.rs`（`#[serde(rename_all = "camelCase")]`
- TypeScript 类型: `src/types/index.ts`
- 字段命名: Rust 用 snake_case，TS 用 camelCase

## 配置存储

| 路径 | 内容 |
|------|------|
| `~/.tokenmeter/config.json` | 应用配置（刷新间隔、菜单栏格式、预算阈值） |
| `~/.tokenmeter/providers/{id}.json` | 自定义 Provider 配置 |

## 测试

### 单元测试 (46 个测试用例)

| 模块 | 测试内容 |
|------|----------|
| `ccusage.rs` | JSON 解析、cache tokens、多天/多模型 |
| `config.rs` | 序列化/反序列化、默认值 |
| `pricing.rs` | 价格计算（精确/模糊匹配） |
| `script_runner.rs` | JS 执行、数组处理、错误处理 |
| `providers.rs` | 安全验证（路径遍历、命令注入、环境变量注入） |

### 验证命令

```bash
cargo test                    # 运行所有测试
cargo run --example test_ccusage      # 验证 ccusage 数据抓取
cargo run --example test_provider -- <name>  # 验证 provider 脚本
cargo run --example test_config       # 验证配置加载
```

## 质量检查

修改代码后必须运行以下检查：

1. **前端**: `npm run lint`
2. **Rust**: `cargo fmt --check && cargo clippy && cargo test`
3. **核心功能变更**: 运行对应 example 验证

## 代码规范

- TypeScript 严格模式，函数式组件 + Hooks
- UI 组件基于 shadcn/ui（`src/components/ui/`）
- Rust 遵循 Clippy pedantic + nursery 规范
- 禁止 TODO、占位符或未完成代码
- Provider 安全验证：仅允许 curl/wget/http/httpie，禁止命令注入
