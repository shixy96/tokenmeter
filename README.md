# TokenMeter

Mac 菜单栏 API 用量统计应用，实时显示 Claude API 等用量费用。

## 功能

- 菜单栏实时显示 API 用量和费用
- Dashboard 窗口查看详细图表和历史统计
- 支持 ccusage 和自定义 API Provider
- 可配置刷新间隔、显示格式、阈值告警
- 开机自启动

## 技术栈

- Tauri 2 + Rust
- React 19 + TypeScript + Vite
- TailwindCSS v4 + shadcn/ui
- Recharts + TanStack Query

## 架构

详细的架构图和数据流说明请参阅 [ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 安装

```bash
npm install
```

## 开发

```bash
npm run tauri dev          # 开发模式（前后端同时启动）
npm run tauri build        # 生产构建，产物在 src-tauri/target/release/bundle/
```

## 构建产物

| 平台 | 位置 |
|------|------|
| macOS | `src-tauri/target/release/bundle/macos/TokenMeter.app` |
| DMG | `src-tauri/target/release/bundle/dmg/TokenMeter-x.x.x.dmg` |

## 配置

应用配置存储在 `~/.tokenmeter/`：

```
~/.tokenmeter/
├── config.json       # 应用设置（刷新间隔、菜单栏格式等）
└── providers/        # 自定义 API Provider 配置（JSON 文件）
```

## 前端 Lint

```bash
npm run lint        # 检查
npm run lint:fix    # 自动修复
```

## Requirements

- Node.js 18+
- Rust 1.75+
- macOS 10.15+
- [ccusage](https://github.com/anthropics/ccusage) (可选，用于获取 Claude API 用量)

## 许可证

MIT
