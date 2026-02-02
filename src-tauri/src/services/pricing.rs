use anyhow::Result;
use serde::Deserialize;
use std::collections::HashMap;
use std::hash::BuildHasher;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::RwLock;

const MODELS_DEV_URL: &str = "https://models.dev/api.json";
const FETCH_TIMEOUT_SECS: u64 = 10;

#[derive(Debug, Clone)]
pub struct ModelPrice {
    pub input: f64,
    pub output: f64,
}

#[derive(Debug, Deserialize)]
struct ModelsDevResponse {
    #[serde(flatten)]
    providers: HashMap<String, ProviderData>,
}

#[derive(Debug, Deserialize)]
struct ProviderData {
    #[serde(default)]
    models: HashMap<String, ModelData>,
}

#[derive(Debug, Deserialize)]
struct ModelData {
    #[serde(default)]
    cost: CostData,
}

#[derive(Debug, Deserialize, Default)]
struct CostData {
    #[serde(default)]
    input: f64,
    #[serde(default)]
    output: f64,
}

static PRICE_CACHE: OnceLock<RwLock<Option<HashMap<String, ModelPrice>>>> = OnceLock::new();

fn get_cache() -> &'static RwLock<Option<HashMap<String, ModelPrice>>> {
    PRICE_CACHE.get_or_init(|| RwLock::new(None))
}

/// Fetches model prices from models.dev API.
///
/// # Errors
/// Returns an error if the HTTP request fails or the response cannot be parsed.
pub async fn fetch_prices() -> Result<HashMap<String, ModelPrice>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
        .build()?;

    let response: ModelsDevResponse = client
        .get(MODELS_DEV_URL)
        .header("User-Agent", "TokenMeter/1.0")
        .send()
        .await?
        .json()
        .await?;

    let mut prices = HashMap::new();
    for provider in response.providers.values() {
        for (model_id, model_data) in &provider.models {
            if model_data.cost.input > 0.0 || model_data.cost.output > 0.0 {
                prices.insert(
                    model_id.clone(),
                    ModelPrice {
                        input: model_data.cost.input,
                        output: model_data.cost.output,
                    },
                );
            }
        }
    }

    // Update cache
    *get_cache().write().await = Some(prices.clone());

    Ok(prices)
}

/// Gets cached prices or fetches them if not available.
pub async fn get_prices() -> Option<HashMap<String, ModelPrice>> {
    // Try to get from cache first
    let cached = get_cache().read().await.clone();
    if let Some(prices) = cached {
        return Some(prices);
    }

    // Fetch if not cached
    fetch_prices().await.ok()
}

/// Calculates cost using fallback prices when original cost is 0.
#[must_use]
#[allow(clippy::cast_precision_loss)]
pub fn calculate_fallback_cost<S: BuildHasher>(
    model_name: &str,
    input_tokens: u64,
    output_tokens: u64,
    prices: &HashMap<String, ModelPrice, S>,
) -> f64 {
    // Exact match
    if let Some(price) = prices.get(model_name) {
        return calculate_cost(input_tokens, output_tokens, price);
    }

    // Fuzzy match: find key containing model name (case insensitive)
    let model_lower = model_name.to_lowercase();
    for (key, price) in prices {
        let key_lower = key.to_lowercase();
        if model_lower.contains(&key_lower) || key_lower.contains(&model_lower) {
            return calculate_cost(input_tokens, output_tokens, price);
        }
    }

    0.0
}

#[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
fn calculate_cost(input_tokens: u64, output_tokens: u64, price: &ModelPrice) -> f64 {
    // Token counts in practice are well within u32 range for cost calculations
    let input = input_tokens as f64;
    let output = output_tokens as f64;
    input.mul_add(price.input, output * price.output) / 1_000_000.0
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_fallback_cost_exact_match() {
        let mut prices = HashMap::new();
        prices.insert(
            "claude-3-opus".to_string(),
            ModelPrice {
                input: 15.0,
                output: 75.0,
            },
        );

        let cost = calculate_fallback_cost("claude-3-opus", 1000, 500, &prices);
        // (1000 * 15 + 500 * 75) / 1_000_000 = (15000 + 37500) / 1_000_000 = 0.0525
        assert!((cost - 0.0525).abs() < 0.0001);
    }

    #[test]
    fn test_calculate_fallback_cost_fuzzy_match() {
        let mut prices = HashMap::new();
        prices.insert(
            "claude-3-opus-20240229".to_string(),
            ModelPrice {
                input: 15.0,
                output: 75.0,
            },
        );

        let cost = calculate_fallback_cost("claude-3-opus", 1000, 500, &prices);
        assert!((cost - 0.0525).abs() < 0.0001);
    }

    #[test]
    fn test_calculate_fallback_cost_no_match() {
        let prices = HashMap::new();
        let cost = calculate_fallback_cost("unknown-model", 1000, 500, &prices);
        assert_eq!(cost, 0.0);
    }
}
