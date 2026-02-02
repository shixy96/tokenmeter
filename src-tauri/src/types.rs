use crate::config::ApiProvider;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageData {
    pub date: String,
    pub cost: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub cache_read_input_tokens: u64,
    pub total_tokens: u64,
}

impl Default for UsageData {
    fn default() -> Self {
        Self {
            date: chrono::Local::now().format("%Y-%m-%d").to_string(),
            cost: 0.0,
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            total_tokens: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub cost: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    pub date: String,
    pub cost: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub models: Vec<ModelUsage>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub today: UsageData,
    pub this_month: UsageData,
    pub daily_usage: Vec<DailyUsage>,
    pub model_breakdown: Vec<ModelUsage>,
}

/// 托盘菜单显示用的 Provider 统计
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTrayStats {
    pub name: String,
    pub display_text: String,
}

impl ProviderTrayStats {
    #[must_use]
    pub fn from_provider(provider: &ApiProvider, result: Option<&ProviderUsageResult>) -> Self {
        let display_text = result.map_or_else(
            || format!("{}: --", provider.name),
            |r| r.format_display(&provider.name),
        );
        Self {
            name: provider.name.clone(),
            display_text,
        }
    }
}

/// Provider 脚本执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsageResult {
    pub cost: Option<f64>,
    pub tokens: Option<u64>,
    pub used: Option<f64>,
    pub total: Option<f64>,
}

impl ProviderUsageResult {
    #[must_use]
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    pub fn format_display(&self, name: &str) -> String {
        // 如果有 used/total，显示进度条
        if let (Some(used), Some(total)) = (self.used, self.total) {
            let percent = if total > 0.0 {
                (used / total * 100.0).round() as u32
            } else {
                0
            };
            let bar = render_progress_bar(used, total, 10);
            return format!(
                "🔋 {}: [{}] {}/{} ({}%)",
                name,
                bar,
                format_number(used as u64),
                format_number(total as u64),
                percent
            );
        }

        // 否则显示 cost/tokens
        let mut parts = vec![format!("🔋 {name}:")];
        if let Some(cost) = self.cost {
            parts.push(format!("${cost:.2}"));
        }
        if let Some(tokens) = self.tokens {
            parts.push(format!("/ {}", format_number(tokens)));
        }
        if parts.len() == 1 {
            parts.push("--".to_string());
        }
        parts.join(" ")
    }
}

/// 格式化数字为 K/M/B 后缀
#[must_use]
#[allow(clippy::cast_precision_loss)]
pub fn format_number(num: u64) -> String {
    if num >= 1_000_000_000 {
        format!("{:.1}B", num as f64 / 1_000_000_000.0)
    } else if num >= 1_000_000 {
        format!("{:.1}M", num as f64 / 1_000_000.0)
    } else if num >= 1_000 {
        format!("{:.1}K", num as f64 / 1_000.0)
    } else {
        num.to_string()
    }
}

/// 生成 ASCII 进度条
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
fn render_progress_bar(used: f64, total: f64, width: usize) -> String {
    let ratio = if total > 0.0 {
        (used / total).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let filled = (ratio * width as f64).round() as usize;
    let empty = width.saturating_sub(filled);
    format!("{}{}", "█".repeat(filled), "░".repeat(empty))
}
