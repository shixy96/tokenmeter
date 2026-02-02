use crate::services::pricing;
use crate::types::{DailyUsage, ModelUsage, UsageData, UsageSummary};
use anyhow::Result;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcusageResponse {
    daily: Vec<CcusageDailyEntry>,
    totals: CcusageTotals,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcusageDailyEntry {
    date: String,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_tokens: Option<u64>,
    cache_read_tokens: Option<u64>,
    total_tokens: u64,
    total_cost: f64,
    model_breakdowns: Vec<CcusageModelBreakdown>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcusageModelBreakdown {
    model_name: String,
    input_tokens: u64,
    output_tokens: u64,
    #[allow(dead_code)]
    cache_creation_tokens: Option<u64>,
    #[allow(dead_code)]
    cache_read_tokens: Option<u64>,
    cost: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcusageTotals {
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_tokens: Option<u64>,
    cache_read_tokens: Option<u64>,
    total_cost: f64,
    total_tokens: u64,
}

const COMMAND_TIMEOUT_SECS: u64 = 60;

/// Allowed shells for security - only well-known system shells.
const ALLOWED_SHELLS: &[&str] = &[
    "/bin/bash",
    "/bin/zsh",
    "/bin/sh",
    "/usr/bin/bash",
    "/usr/bin/zsh",
    "/usr/bin/sh",
    "/usr/local/bin/bash",
    "/usr/local/bin/zsh",
];

const DEFAULT_SHELL: &str = "/bin/zsh";

// NOTE: macOS GUI apps (bundled .app) often start without the user's shell PATH.
// Relying on `zsh -l` alone is not enough because many setups put PATH changes in
// ~/.zshrc (interactive) instead of ~/.zprofile (login). We keep the command
// non-interactive, but add a small, safe bootstrap that covers common install paths
// (Homebrew) and popular Node version managers.
#[allow(clippy::literal_string_with_formatting_args)]
fn build_ccusage_shell_script() -> String {
    let prelude = r#"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if [ -z "${NVM_DIR:-}" ]; then
  export NVM_DIR="$HOME/.nvm"
fi

if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
  if command -v nvm >/dev/null 2>&1; then
    nvm use --silent default >/dev/null 2>&1 || nvm use --silent >/dev/null 2>&1 || true
  fi
fi

if [ -s "$HOME/.asdf/asdf.sh" ]; then
  . "$HOME/.asdf/asdf.sh" >/dev/null 2>&1 || true
fi

if [ -s "$HOME/.volta/load.sh" ]; then
  . "$HOME/.volta/load.sh" >/dev/null 2>&1 || true
fi
"#;

    format!(
        "{prelude}\nccusage --json --days 30 --offline",
        prelude = prelude.trim()
    )
}

/// Gets the user's default shell with security validation.
/// Falls back to /bin/zsh if SHELL is not set or not in the allowed list.
fn get_user_shell() -> &'static str {
    std::env::var("SHELL")
        .ok()
        .and_then(|shell| ALLOWED_SHELLS.iter().find(|&&s| s == shell).copied())
        .unwrap_or(DEFAULT_SHELL)
}

/// Fetches usage data from ccusage CLI tool.
///
/// # Errors
/// Returns an error if:
/// - ccusage command is not found
/// - ccusage command times out
/// - ccusage command fails
/// - Output cannot be parsed as JSON
#[allow(clippy::too_many_lines)]
pub async fn fetch_usage() -> Result<UsageSummary> {
    // Use shell to execute command to inherit user's PATH (including nvm, etc.)
    let shell = get_user_shell();

    // Ensure HOME exists for shell init (GUI apps should have it, but don't assume)
    let home = dirs::home_dir();
    let nvm_dir = home.as_ref().map(|h| h.join(".nvm"));

    let mut cmd = Command::new(shell);

    // Add NVM_DIR environment variable if .nvm directory exists
    if let Some(ref nvm_path) = nvm_dir {
        if nvm_path.exists() {
            cmd.env("NVM_DIR", nvm_path);
        }
    }

    if let Some(ref home_path) = home {
        cmd.env("HOME", home_path);
    }

    let script = build_ccusage_shell_script();

    // Use -l to load login shell config; keep it non-interactive to avoid prompts/hangs.
    let output = timeout(
        Duration::from_secs(COMMAND_TIMEOUT_SECS),
        cmd.args(["-l", "-c", script.as_str()]).output(),
    )
    .await
    .map_err(|_| anyhow::anyhow!("ccusage command timed out after {COMMAND_TIMEOUT_SECS}s"))?
    .map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            anyhow::anyhow!("ccusage not found. Please install it first: npm install -g ccusage")
        } else {
            anyhow::anyhow!("Failed to execute ccusage: {e}")
        }
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Treat common command-not-found exit code (127) as missing.
        if output.status.code() == Some(127)
            || stderr.contains("command not found")
            || stderr.contains("not found")
        {
            return Err(anyhow::anyhow!(
                "ccusage not found. Please install it first: npm install -g ccusage"
            ));
        }
        return Err(anyhow::anyhow!("ccusage failed: {stderr}"));
    }

    let stdout = String::from_utf8(output.stdout)?;
    let response: CcusageResponse = serde_json::from_str(&stdout)?;

    // Check if we need fallback prices (any model has cost=0 but has tokens)
    let needs_fallback = response.daily.iter().any(|day| {
        day.model_breakdowns
            .iter()
            .any(|m| m.cost == 0.0 && (m.input_tokens > 0 || m.output_tokens > 0))
    });

    let fallback_prices = if needs_fallback {
        pricing::get_prices().await
    } else {
        None
    };

    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();

    // Helper to calculate cost with fallback
    let calc_cost = |m: &CcusageModelBreakdown| -> f64 {
        if m.cost > 0.0 {
            m.cost
        } else if let Some(ref prices) = fallback_prices {
            pricing::calculate_fallback_cost(&m.model_name, m.input_tokens, m.output_tokens, prices)
        } else {
            0.0
        }
    };

    let today_data = response
        .daily
        .iter()
        .find(|d| d.date == today_str)
        .map(|d| {
            let cost = if d.total_cost > 0.0 {
                d.total_cost
            } else {
                d.model_breakdowns.iter().map(calc_cost).sum()
            };
            UsageData {
                date: d.date.clone(),
                cost,
                input_tokens: d.input_tokens,
                output_tokens: d.output_tokens,
                cache_creation_input_tokens: d.cache_creation_tokens.unwrap_or(0),
                cache_read_input_tokens: d.cache_read_tokens.unwrap_or(0),
                total_tokens: d.total_tokens,
            }
        })
        .unwrap_or_default();

    let total_cost = if response.totals.total_cost > 0.0 {
        response.totals.total_cost
    } else {
        response
            .daily
            .iter()
            .flat_map(|d| &d.model_breakdowns)
            .map(calc_cost)
            .sum()
    };

    let this_month = UsageData {
        date: today_str,
        cost: total_cost,
        input_tokens: response.totals.input_tokens,
        output_tokens: response.totals.output_tokens,
        cache_creation_input_tokens: response.totals.cache_creation_tokens.unwrap_or(0),
        cache_read_input_tokens: response.totals.cache_read_tokens.unwrap_or(0),
        total_tokens: response.totals.total_tokens,
    };

    let daily_usage: Vec<DailyUsage> = response
        .daily
        .iter()
        .map(|d| {
            let day_cost = if d.total_cost > 0.0 {
                d.total_cost
            } else {
                d.model_breakdowns.iter().map(calc_cost).sum()
            };
            DailyUsage {
                date: d.date.clone(),
                cost: day_cost,
                input_tokens: d.input_tokens,
                output_tokens: d.output_tokens,
                models: d
                    .model_breakdowns
                    .iter()
                    .map(|m| ModelUsage {
                        model: m.model_name.clone(),
                        cost: calc_cost(m),
                        input_tokens: m.input_tokens,
                        output_tokens: m.output_tokens,
                    })
                    .collect(),
            }
        })
        .collect();

    // Aggregate model breakdown across all days
    let mut model_map: HashMap<String, ModelUsage> = HashMap::new();
    for day in &response.daily {
        for m in &day.model_breakdowns {
            let cost = calc_cost(m);
            model_map
                .entry(m.model_name.clone())
                .and_modify(|entry| {
                    entry.cost += cost;
                    entry.input_tokens += m.input_tokens;
                    entry.output_tokens += m.output_tokens;
                })
                .or_insert_with(|| ModelUsage {
                    model: m.model_name.clone(),
                    cost,
                    input_tokens: m.input_tokens,
                    output_tokens: m.output_tokens,
                });
        }
    }
    let model_breakdown: Vec<ModelUsage> = model_map.into_values().collect();

    Ok(UsageSummary {
        today: today_data,
        this_month,
        daily_usage,
        model_breakdown,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ccusage_response() {
        let json = r#"{
            "daily": [{
                "date": "2024-01-15",
                "inputTokens": 1000,
                "outputTokens": 500,
                "totalTokens": 1500,
                "totalCost": 0.05,
                "modelBreakdowns": [{
                    "modelName": "claude-3-opus",
                    "inputTokens": 1000,
                    "outputTokens": 500,
                    "cost": 0.05
                }]
            }],
            "totals": {
                "inputTokens": 1000,
                "outputTokens": 500,
                "totalTokens": 1500,
                "totalCost": 0.05
            }
        }"#;

        let response: CcusageResponse =
            serde_json::from_str(json).expect("test JSON should parse correctly");
        assert_eq!(response.daily.len(), 1);
        assert_eq!(response.daily[0].date, "2024-01-15");
        assert_eq!(response.daily[0].model_breakdowns.len(), 1);
        assert_eq!(response.totals.total_cost, 0.05);
    }

    #[test]
    fn test_parse_ccusage_with_cache_tokens() {
        let json = r#"{
            "daily": [{
                "date": "2024-01-15",
                "inputTokens": 1000,
                "outputTokens": 500,
                "cacheCreationTokens": 200,
                "cacheReadTokens": 100,
                "totalTokens": 1800,
                "totalCost": 0.08,
                "modelBreakdowns": []
            }],
            "totals": {
                "inputTokens": 1000,
                "outputTokens": 500,
                "cacheCreationTokens": 200,
                "cacheReadTokens": 100,
                "totalTokens": 1800,
                "totalCost": 0.08
            }
        }"#;

        let response: CcusageResponse =
            serde_json::from_str(json).expect("test JSON should parse correctly");
        assert_eq!(response.daily[0].cache_creation_tokens, Some(200));
        assert_eq!(response.daily[0].cache_read_tokens, Some(100));
    }

    #[test]
    fn test_parse_ccusage_empty_daily() {
        let json = r#"{
            "daily": [],
            "totals": {
                "inputTokens": 0,
                "outputTokens": 0,
                "totalTokens": 0,
                "totalCost": 0.0
            }
        }"#;

        let response: CcusageResponse =
            serde_json::from_str(json).expect("empty daily should parse correctly");
        assert!(response.daily.is_empty());
        assert_eq!(response.totals.total_cost, 0.0);
    }

    #[test]
    fn test_parse_ccusage_multiple_days() {
        let json = r#"{
            "daily": [
                {
                    "date": "2024-01-15",
                    "inputTokens": 1000,
                    "outputTokens": 500,
                    "totalTokens": 1500,
                    "totalCost": 0.05,
                    "modelBreakdowns": []
                },
                {
                    "date": "2024-01-14",
                    "inputTokens": 2000,
                    "outputTokens": 1000,
                    "totalTokens": 3000,
                    "totalCost": 0.10,
                    "modelBreakdowns": []
                }
            ],
            "totals": {
                "inputTokens": 3000,
                "outputTokens": 1500,
                "totalTokens": 4500,
                "totalCost": 0.15
            }
        }"#;

        let response: CcusageResponse =
            serde_json::from_str(json).expect("multiple days should parse correctly");
        assert_eq!(response.daily.len(), 2);
        assert_eq!(response.totals.total_cost, 0.15);
    }

    #[test]
    fn test_parse_ccusage_multiple_models() {
        let json = r#"{
            "daily": [{
                "date": "2024-01-15",
                "inputTokens": 3000,
                "outputTokens": 1500,
                "totalTokens": 4500,
                "totalCost": 0.15,
                "modelBreakdowns": [
                    {
                        "modelName": "claude-3-opus",
                        "inputTokens": 1000,
                        "outputTokens": 500,
                        "cost": 0.10
                    },
                    {
                        "modelName": "claude-3-sonnet",
                        "inputTokens": 2000,
                        "outputTokens": 1000,
                        "cost": 0.05
                    }
                ]
            }],
            "totals": {
                "inputTokens": 3000,
                "outputTokens": 1500,
                "totalTokens": 4500,
                "totalCost": 0.15
            }
        }"#;

        let response: CcusageResponse =
            serde_json::from_str(json).expect("multiple models should parse correctly");
        assert_eq!(response.daily[0].model_breakdowns.len(), 2);
        assert_eq!(
            response.daily[0].model_breakdowns[0].model_name,
            "claude-3-opus"
        );
        assert_eq!(
            response.daily[0].model_breakdowns[1].model_name,
            "claude-3-sonnet"
        );
    }

    #[test]
    fn test_parse_ccusage_without_optional_cache_tokens() {
        let json = r#"{
            "daily": [{
                "date": "2024-01-15",
                "inputTokens": 1000,
                "outputTokens": 500,
                "totalTokens": 1500,
                "totalCost": 0.05,
                "modelBreakdowns": []
            }],
            "totals": {
                "inputTokens": 1000,
                "outputTokens": 500,
                "totalTokens": 1500,
                "totalCost": 0.05
            }
        }"#;

        let response: CcusageResponse =
            serde_json::from_str(json).expect("should parse without optional cache tokens");
        assert!(response.daily[0].cache_creation_tokens.is_none());
        assert!(response.daily[0].cache_read_tokens.is_none());
        assert!(response.totals.cache_creation_tokens.is_none());
    }
}
