# TokenMeter - Mac 菜单栏用量统计应用

## 概述

将现有的 xbar 插件 `claude_tokens.15m.py` 改造为独立的 Mac 应用，使用 Tauri 2 + React 技术栈。

```python claude_tokens.15m.py
#!/usr/bin/env python3

# <xbar.title>Claude Token Usage</xbar.title>
# <xbar.version>v1.1</xbar.version>
# <xbar.author>Preslav Rachev</xbar.author>
# <xbar.desc>Shows today's Claude Code token usage in the Mac toolbar</xbar.desc>
# <xbar.dependencies>python3,ccusage</xbar.dependencies>
# <xbar.abouturl>https://ccusage.com</xbar.abouturl>

import json
import subprocess
import os
import glob
import urllib.request
import urllib.error
from datetime import datetime
from typing import Any, Optional

def get_modelsdev_prices() -> dict:
    """从 models.dev 获取模型价格数据"""
    try:
        req = urllib.request.Request("https://models.dev/api.json")
        req.add_header("User-Agent", "Mozilla/5.0")
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))

        prices = {}
        for provider in data.values():
            if not isinstance(provider, dict):
                continue
            for model_id, model_info in provider.get("models", {}).items():
                if not isinstance(model_info, dict):
                    continue
                cost = model_info.get("cost", {})
                input_cost, output_cost = cost.get("input", 0), cost.get("output", 0)
                if input_cost > 0 or output_cost > 0:
                    prices[model_id] = {"input": input_cost, "output": output_cost}
        return prices
    except Exception:
        return {}


def calculate_fallback_cost(model_name: str, input_tokens: int, output_tokens: int, prices: dict) -> float:
    """使用 fallback 价格计算成本"""
    # 精确匹配
    if model_name in prices:
        p = prices[model_name]
        return (input_tokens * p["input"] + output_tokens * p["output"]) / 1_000_000

    # 模糊匹配：查找包含模型名称的 key（忽略大小写）
    model_lower = model_name.lower()
    for key, p in prices.items():
        if model_lower in key.lower() or key.lower() in model_lower:
            return (input_tokens * p["input"] + output_tokens * p["output"]) / 1_000_000

    return 0.0


def get_minimax_token() -> Optional[str]:
    """从配置文件读取 minimax token"""
    config_path = os.path.expanduser("~/.config/agi-account/minimax")
    if os.path.exists(config_path):
        with open(config_path) as f:
            return f.read().strip()
    return None


def get_minimax_data() -> Optional[dict]:
    """调用 minimax API 获取用量数据"""
    token = get_minimax_token()
    if not token:
        return None
    try:
        url = "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains"
        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=10) as response:
            result = json.loads(response.read().decode("utf-8"))
            if result.get("base_resp", {}).get("status_code") == 0:
                return result
            return None
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError):
        return None


def render_progress_bar(used: float, total: float, width: int = 10) -> str:
    """生成 ASCII 进度条 [████░░░░░░]"""
    pct = min(used / total, 1.0) if total > 0 else 0
    filled = int(pct * width)
    return f"[{'█' * filled}{'░' * (width - filled)}]"


def print_minimax_stats(data: dict):
    """打印 minimax 统计信息"""
    print("🔋 MiniMax")
    model_remains = data.get("model_remains", [])
    if not model_remains:
        print("No data")
        return
    for model in model_remains:
        name = model.get("model_name", "unknown")
        used = model.get("current_interval_usage_count", 0)
        total = model.get("current_interval_total_count", 0)
        pct = (used / total * 100) if total > 0 else 0
        bar = render_progress_bar(used, total)
        print(f"{name}: {bar} {used}/{total} ({pct:.0f}%)")


def format_number(num):
    """Formats a number into a human-readable string with K/M suffixes."""
    if num >= 1000000:
        return f"{num / 1000000:.1f}M"
    if num >= 1000:
        return f"{num / 1000:.1f}K"
    return str(num)


def calculate_percentage_change(current: float, previous: float) -> tuple[float, str]:
    """计算环比变化百分比，返回 (百分比, 方向符号)"""
    if previous == 0:
        return (0, "") if current == 0 else (100, "↑")
    change = ((current - previous) / previous) * 100
    direction = "↑" if change >= 0 else "↓"
    return (abs(change), direction)


def calculate_model_percentages(breakdown_list: list) -> list:
    """计算模型金额百分比"""
    total_cost = sum(m.get("cost", 0) for m in breakdown_list)
    if total_cost == 0:
        return breakdown_list
    return [{**m, "percentage": m.get("cost", 0) / total_cost * 100} for m in breakdown_list]


def print_top2_models(breakdowns: list, prefix: str = ""):
    """打印 top2 模型，格式：模型名: $花费 (百分比%)"""
    if not breakdowns:
        return
    breakdowns_with_pct = calculate_model_percentages(breakdowns)
    sorted_breakdowns = sorted(breakdowns_with_pct, key=lambda x: x.get("cost", 0), reverse=True)
    for model_data in sorted_breakdowns[:2]:
        model_name = model_data.get("modelName", "unknown")
        cost = model_data.get("cost", 0)
        pct = model_data.get("percentage", 0)
        print(f"{prefix}{model_name}: ${cost:.2f} ({pct:.0f}%)")


def _merge_breakdown(breakdown: dict, day: dict, fallback_prices: dict = None):
    """合并模型统计数据"""
    for model_data in day.get("modelBreakdowns", []):
        model_name = model_data.get("modelName", "unknown")
        if model_name not in breakdown:
            breakdown[model_name] = {"cost": 0, "inputTokens": 0, "outputTokens": 0}

        cost = model_data.get("cost", 0)
        input_tokens = model_data.get("inputTokens", 0)
        output_tokens = model_data.get("outputTokens", 0)

        # 如果 cost 为 0 但有 token，尝试使用 fallback 价格
        if cost == 0 and (input_tokens > 0 or output_tokens > 0) and fallback_prices:
            cost = calculate_fallback_cost(model_name, input_tokens, output_tokens, fallback_prices)

        breakdown[model_name]["cost"] += cost
        breakdown[model_name]["inputTokens"] += input_tokens
        breakdown[model_name]["outputTokens"] += output_tokens


def _to_breakdown_list(breakdown: dict) -> list:
    """将字典转换为列表格式"""
    return [{"modelName": k, **v} for k, v in breakdown.items()]


def compute_all_stats(daily_data: list, today: str):
    """单次遍历计算所有统计数据"""
    # 检查是否有 cost=0 但有 token 的模型，如果有则获取 fallback 价格
    fallback_prices = None
    for day in daily_data:
        for model_data in day.get("modelBreakdowns", []):
            if model_data.get("cost", 0) == 0 and (
                model_data.get("inputTokens", 0) > 0 or model_data.get("outputTokens", 0) > 0
            ):
                fallback_prices = get_modelsdev_prices()
                break
        if fallback_prices is not None:
            break

    today_usage = None
    total_tokens, total_cost = 0, 0
    total_breakdown = {}
    active_days = []  # 有消耗的日期列表

    for day in daily_data:
        date = day.get("date", "")
        tokens = day.get("totalTokens", 0)
        cost = day.get("totalCost", 0)

        if date == today:
            today_usage = day

        # 只统计有 token 消耗的天
        if tokens > 0:
            active_days.append({
                "date": date,
                "cost": cost,
                "tokens": tokens
            })
            total_tokens += tokens
            total_cost += cost
            _merge_breakdown(total_breakdown, day, fallback_prices)

    # 按日期降序排序
    active_days.sort(key=lambda x: x["date"], reverse=True)

    # 最近 5 天有消耗的
    recent_5_days = active_days[:5]

    # 最近 30 天有消耗的
    last_30_active = active_days[:30]
    last_30_cost = sum(d["cost"] for d in last_30_active)
    last_30_tokens = sum(d["tokens"] for d in last_30_active)

    # 计算 last 30 days 的模型分布
    last_30_breakdown = {}
    last_30_dates = {d["date"] for d in last_30_active}
    for day in daily_data:
        if day.get("date", "") in last_30_dates:
            _merge_breakdown(last_30_breakdown, day, fallback_prices)

    # 为 today 计算带 fallback 的 breakdown 和 cost
    today_breakdown = {}
    today_cost_with_fallback = 0
    if today_usage:
        _merge_breakdown(today_breakdown, today_usage, fallback_prices)
        today_cost_with_fallback = sum(m["cost"] for m in today_breakdown.values())

    return {
        "today": today_usage,
        "today_breakdown": _to_breakdown_list(today_breakdown),
        "today_cost": today_cost_with_fallback,
        "last_30_days": {
            "cost": last_30_cost,
            "tokens": last_30_tokens,
            "active_days": len(last_30_active),
            "breakdown": _to_breakdown_list(last_30_breakdown)
        },
        "total": {
            "cost": total_cost,
            "tokens": total_tokens,
            "active_days": len(active_days),
            "breakdown": _to_breakdown_list(total_breakdown)
        },
        "recent_5_days": recent_5_days
    }


def get_ccusage_data() -> dict[str, Any]:
    """Fetches Claude Code usage statistics using the `npx ccusage@latest -j` command."""
    try:
        # Set up environment with common paths for xbar
        env = os.environ.copy()

        # Add common Node.js paths to ensure npx is found
        common_paths = [
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/opt/homebrew/bin",  # Homebrew on Apple Silicon
            os.path.expanduser("~/.nvm/versions/node/*/bin"),  # NVM paths
            os.path.expanduser("~/node_modules/.bin"),  # Local node modules
        ]

        # Expand glob patterns and filter existing paths
        expanded_paths = []
        for path in common_paths:
            if "*" in path:
                expanded_paths.extend(glob.glob(path))
            elif os.path.exists(path):
                expanded_paths.append(path)

        # Add to PATH if not already present
        current_path = env.get("PATH", "")
        for path in expanded_paths:
            if path not in current_path:
                current_path = f"{path}:{current_path}"
        env["PATH"] = current_path

        # 优先尝试使用全局安装的 ccusage (更快)
        try:
            result = subprocess.run(
                ["ccusage", "-j", "--offline"],
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
                env=env,
            )
            if result.returncode == 0:
                return json.loads(result.stdout)
        except FileNotFoundError:
            pass

        # 降级到 npx，使用 @latest (可能已缓存) + 增加超时
        result = subprocess.run(
            ["npx", "ccusage", "-j", "--offline"],
            capture_output=True,
            text=True,
            timeout=300,  # 增加超时到 300 秒以应对首次下载
            check=False,
            env=env,
        )

        if result.returncode == 0:
            return json.loads(result.stdout)

        return {
            "error": f"Command failed with code {result.returncode}",
            "stderr": result.stderr,
            "stdout": result.stdout,
        }
    except subprocess.TimeoutExpired:
        return {"error": "Command timed out after 300 seconds"}
    except json.JSONDecodeError as e:
        return {"error": f"JSON decode error: {e}", "stdout": result.stdout}
    except FileNotFoundError:
        return {"error": "npx command not found - Node.js may not be installed"}


def main():
    """Main function to fetch and display Claude Code usage statistics."""
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")

    # Get usage data
    data = get_ccusage_data()

    if not data or (isinstance(data, dict) and "error" in data):
        print(f"Error")
        print("---")
        if isinstance(data, dict) and "error" in data:
            print(f"Error: {data['error']}")
            if "stderr" in data:
                print(f"Stderr: {data['stderr']}")
            if "stdout" in data:
                print(f"Stdout: {data['stdout']}")
        else:
            print("Failed to fetch usage data")
        return

    # 单次遍历计算所有统计数据
    daily_data = data.get("daily", [])
    stats = compute_all_stats(daily_data, today)

    today_usage = stats["today"]
    today_breakdown = stats["today_breakdown"]
    today_cost = stats["today_cost"]
    last_30 = stats["last_30_days"]
    recent_5 = stats["recent_5_days"]

    # 计算日均（基于 last 30 days breakdown 的 cost，包含 fallback）
    last_30_cost = sum(m.get("cost", 0) for m in last_30["breakdown"])
    avg_daily = last_30_cost / 30 if last_30["active_days"] > 0 else 0

    if not today_usage:
        print(f"$0.00/0 (avg ${avg_daily:.0f})")
        print("---")
        print("No usage today")
    else:
        total_tokens = today_usage.get("totalTokens", 0)

        # 菜单栏格式：$今日花费/今日token数 (avg $日均)
        print(f"${today_cost:.2f}/{format_number(total_tokens)} (avg ${avg_daily:.0f})")
        print("---")
        print(f"📊 Today ({today})")
        # 紧凑格式：-35%↓   $34.02/$52.15   39.3M
        pct, direction = calculate_percentage_change(today_cost, avg_daily)
        sign = "+" if direction == "↑" else "-"
        print(f"{sign}{pct:.0f}%{direction}   ${today_cost:.2f}/${avg_daily:.2f}   {format_number(total_tokens)}")
        print_top2_models(today_breakdown)

    print("---")

    # Last 30 Days
    print("📅 Last 30 Days")
    print(f"${last_30_cost:.2f}   {format_number(last_30['tokens'])}   ${avg_daily:.0f}/day")
    print_top2_models(last_30["breakdown"])

    # MiniMax statistics
    print("---")
    minimax_data = get_minimax_data()
    if minimax_data:
        print_minimax_stats(minimax_data)
    else:
        print("🔋 MiniMax: Not configured")

    print("---")

    # Stats 子菜单
    print("📋 Stats")
    # Recent 5 Days
    print("--📆 Recent 5 Days")
    for day in recent_5:
        date_str = day["date"][5:]  # MM-DD
        print(f"--{date_str}: ${day['cost']:.2f} / {format_number(day['tokens'])}")
    print("-----")

    # 30 Days Models
    print(f"--📅 30 Days Models (${last_30_cost:.2f})")
    sorted_30_breakdown = sorted(calculate_model_percentages(last_30["breakdown"]),
                                  key=lambda x: x.get("cost", 0), reverse=True)
    for model_data in sorted_30_breakdown:
        model_name = model_data.get("modelName", "unknown")
        cost = model_data.get("cost", 0)
        pct = model_data.get("percentage", 0)
        tokens = model_data.get("inputTokens", 0) + model_data.get("outputTokens", 0)
        print(f"--{model_name}: ${cost:.2f}/{format_number(tokens)} ({pct:.0f}%)")


if __name__ == "__main__":
    main()
```

## 核心功能

1. **菜单栏显示** - 可配置的用量信息展示，支持颜色编码
2. **独立窗口 Dashboard** - 详细图表和历史统计
3. **API 提供者系统** - 支持 ccusage、MiniMax 及自定义 API（脚本化配置）
4. **设置管理** - 刷新间隔、显示格式、阈值配置等

## 技术栈

- **Tauri 2.8** + Rust 1.85+
- **React 18** + TypeScript + Vite
- **TailwindCSS** + shadcn/ui
- **Recharts** - 图表
- **TanStack Query** - 数据缓存
- **boa_engine** - JS 脚本执行（用于 API 响应转换）

## 项目结构

```
tokenmeter/
├── src/                          # React 前端
│   ├── components/
│   │   ├── TrayMenu.tsx          # 菜单栏下拉内容
│   │   ├── Dashboard.tsx         # 主窗口
│   │   ├── Settings.tsx          # 设置窗口
│   │   ├── ProviderEditor.tsx    # API 提供者编辑器
│   │   └── ui/                   # shadcn 组件
│   ├── hooks/
│   │   ├── useUsageData.ts
│   │   └── useProviders.ts
│   ├── lib/
│   │   └── api.ts                # Tauri 命令封装
│   └── types/
│       └── index.ts
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs
│   │   ├── tray.rs               # 系统托盘
│   │   ├── commands/
│   │   │   ├── usage.rs          # ccusage 调用
│   │   │   ├── providers.rs      # API 提供者管理
│   │   │   └── config.rs         # 配置管理
│   │   └── services/
│   │       ├── ccusage.rs
│   │       ├── script_runner.rs  # JS 脚本执行
│   │       └── provider.rs
│   └── tauri.conf.json
├── package.json
└── Cargo.toml
```

## 数据存储

```
~/.tokenmeter/
├── config.json                   # 应用配置
└── providers/                    # API 提供者配置
    ├── minimax.json
    └── custom-xxx.json
```

### config.json

```json
{
  "refreshInterval": 900,
  "launchAtLogin": false,
  "menuBar": {
    "format": "${cost} ${tokens}",
    "thresholdMode": "fixed",
    "fixedBudget": 15.00,
    "showColorCoding": true
  }
}
```

### API 提供者配置

```json
{
  "id": "minimax",
  "name": "MiniMax",
  "enabled": true,
  "fetchScript": "curl -s -H \"Authorization: Bearer ${MINIMAX_TOKEN}\" ...",
  "transformScript": "(response) => { ... }",
  "env": {
    "MINIMAX_TOKEN": "encrypted:xxx"
  }
}
```
