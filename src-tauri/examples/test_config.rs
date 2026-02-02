use std::fs;
use tokenmeter_lib::config::{ApiProvider, AppConfig};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("=== Testing config ===\n");

    let base_path = dirs::home_dir()
        .ok_or_else(|| anyhow::anyhow!("No home dir"))?
        .join(".tokenmeter");

    // 测试 AppConfig
    let config_path = base_path.join("config.json");
    println!("--- AppConfig ---");
    println!("Path: {}", config_path.display());

    if config_path.exists() {
        let content = fs::read_to_string(&config_path)?;
        let config: AppConfig = serde_json::from_str(&content)?;
        println!("✓ Config loaded:");
        println!("  refresh_interval: {}s", config.refresh_interval);
        println!("  launch_at_login: {}", config.launch_at_login);
        println!("  menu_bar.format: {}", config.menu_bar.format);
        println!(
            "  menu_bar.threshold_mode: {}",
            config.menu_bar.threshold_mode
        );
        println!(
            "  menu_bar.fixed_budget: ${:.2}",
            config.menu_bar.fixed_budget
        );
    } else {
        println!("✓ No config file, using defaults");
        let config = AppConfig::default();
        println!("  refresh_interval: {}s", config.refresh_interval);
        println!("  launch_at_login: {}", config.launch_at_login);
    }

    // 测试 Providers
    let providers_path = base_path.join("providers");
    println!("\n--- Providers ---");
    println!("Path: {}", providers_path.display());

    if providers_path.exists() {
        let entries: Vec<_> = fs::read_dir(&providers_path)?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|ext| ext == "json"))
            .collect();

        if entries.is_empty() {
            println!("✓ No providers configured");
        } else {
            println!("✓ Found {} provider(s):", entries.len());
            for entry in entries {
                let content = fs::read_to_string(entry.path())?;
                match serde_json::from_str::<ApiProvider>(&content) {
                    Ok(provider) => {
                        println!(
                            "  - {} ({}): {}",
                            provider.name,
                            provider.id,
                            if provider.enabled {
                                "enabled"
                            } else {
                                "disabled"
                            }
                        );
                    }
                    Err(e) => {
                        println!("  - {}: parse error: {}", entry.path().display(), e);
                    }
                }
            }
        }
    } else {
        println!("✓ Providers directory not found");
    }

    Ok(())
}
