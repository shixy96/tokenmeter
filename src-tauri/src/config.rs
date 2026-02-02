use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuBarConfig {
    pub format: String,
    pub threshold_mode: String,
    pub fixed_budget: f64,
    pub show_color_coding: bool,
}

impl Default for MenuBarConfig {
    fn default() -> Self {
        Self {
            format: "${cost} ${tokens}".to_string(),
            threshold_mode: "fixed".to_string(),
            fixed_budget: 15.0,
            show_color_coding: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub refresh_interval: u64,
    pub launch_at_login: bool,
    pub menu_bar: MenuBarConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            refresh_interval: 900,
            launch_at_login: false,
            menu_bar: MenuBarConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiProvider {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub fetch_script: String,
    pub transform_script: String,
    pub env: HashMap<String, String>,
    pub last_fetched: Option<String>,
    pub last_error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_config_default() {
        let config = AppConfig::default();
        assert_eq!(config.refresh_interval, 900);
        assert!(!config.launch_at_login);
        assert_eq!(config.menu_bar.fixed_budget, 15.0);
    }

    #[test]
    fn test_app_config_deserialize() {
        let json = r#"{
            "refreshInterval": 600,
            "launchAtLogin": true,
            "menuBar": {
                "format": "${cost}",
                "thresholdMode": "fixed",
                "fixedBudget": 20.0,
                "showColorCoding": false
            }
        }"#;

        let config: AppConfig =
            serde_json::from_str(json).expect("test JSON should parse correctly");
        assert_eq!(config.refresh_interval, 600);
        assert!(config.launch_at_login);
        assert_eq!(config.menu_bar.fixed_budget, 20.0);
        assert!(!config.menu_bar.show_color_coding);
    }

    #[test]
    fn test_menu_bar_config_default() {
        let config = MenuBarConfig::default();
        assert_eq!(config.format, "${cost} ${tokens}");
        assert_eq!(config.threshold_mode, "fixed");
        assert!(config.show_color_coding);
    }

    #[test]
    fn test_api_provider_deserialize() {
        let json = r#"{
            "id": "test",
            "name": "Test Provider",
            "enabled": true,
            "fetchScript": "curl https://api.example.com",
            "transformScript": "",
            "env": {"API_KEY": "xxx"}
        }"#;

        let provider: ApiProvider =
            serde_json::from_str(json).expect("test JSON should parse correctly");
        assert_eq!(provider.id, "test");
        assert_eq!(provider.name, "Test Provider");
        assert!(provider.enabled);
        assert_eq!(provider.env.get("API_KEY"), Some(&"xxx".to_string()));
        assert!(provider.last_fetched.is_none());
    }
}
