use crate::config::AppConfig;
use crate::types::UsageSummary;
use anyhow::Result;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tokio::sync::Mutex;

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub usage: Mutex<Option<UsageSummary>>,
    pub usage_fetched_at: Mutex<Option<Instant>>,
    pub usage_refresh_lock: Mutex<()>,
    pub config_dir: PathBuf,
}

impl AppState {
    /// Creates a new `AppState` instance.
    ///
    /// # Errors
    /// Returns an error if the config directory cannot be created or accessed.
    pub fn new() -> Result<Self> {
        let config_dir = dirs::home_dir()
            .ok_or_else(|| anyhow::anyhow!("Cannot find home directory"))?
            .join(".tokenmeter");

        fs::create_dir_all(&config_dir)?;
        fs::create_dir_all(config_dir.join("providers"))?;

        let config = Self::load_config(&config_dir);

        Ok(Self {
            config: Mutex::new(config),
            usage: Mutex::new(None),
            usage_fetched_at: Mutex::new(None),
            usage_refresh_lock: Mutex::new(()),
            config_dir,
        })
    }

    fn load_config(config_dir: &Path) -> AppConfig {
        let config_path = config_dir.join("config.json");
        fs::read_to_string(&config_path)
            .ok()
            .and_then(|content| {
                serde_json::from_str(&content)
                    .inspect_err(|e| {
                        eprintln!("Warning: Failed to parse config file, using defaults: {e}");
                    })
                    .ok()
            })
            .unwrap_or_default()
    }

    /// Saves the configuration to disk.
    ///
    /// # Errors
    /// Returns an error if the config file cannot be written.
    pub fn save_config(&self, config: &AppConfig) -> Result<()> {
        let config_path = self.config_dir.join("config.json");
        let content = serde_json::to_string_pretty(config)?;
        fs::write(config_path, content)?;
        Ok(())
    }
}
