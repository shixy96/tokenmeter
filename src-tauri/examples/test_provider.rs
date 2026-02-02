use std::collections::HashMap;
use std::fs;
use tokenmeter_lib::services::script_runner;

fn load_provider(name: &str) -> anyhow::Result<Provider> {
    let path = dirs::home_dir()
        .ok_or_else(|| anyhow::anyhow!("No home dir"))?
        .join(".tokenmeter/providers")
        .join(format!("{}.json", name));
    let content = fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&content)?)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Provider {
    id: String,
    name: String,
    enabled: bool,
    fetch_script: String,
    transform_script: String,
    env: HashMap<String, String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let name = std::env::args()
        .nth(1)
        .expect("Usage: cargo run --example test_provider -- <provider-name>");

    let provider = load_provider(&name)?;
    println!("=== Testing: {} ({}) ===\n", provider.name, provider.id);
    println!("Enabled: {}", provider.enabled);

    // 执行 fetch_script
    println!("\n--- Fetch Script ---");
    println!(
        "Script: {}",
        &provider.fetch_script[..provider.fetch_script.len().min(100)]
    );

    let output = std::process::Command::new("sh")
        .arg("-c")
        .arg(&provider.fetch_script)
        .env_clear()
        .envs(&provider.env)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("Fetch failed: {}", stderr);
    }

    let raw = String::from_utf8(output.stdout)?;
    println!("✓ Fetch output: {} bytes", raw.len());
    println!("  Preview: {}...", &raw[..raw.len().min(200)]);

    // 执行 transform_script
    if !provider.transform_script.is_empty() {
        println!("\n--- Transform Script ---");
        println!(
            "Script: {}",
            &provider.transform_script[..provider.transform_script.len().min(100)]
        );

        let result = script_runner::run_transform_script(&provider.transform_script, &raw)?;
        println!("✓ Transform result: {}", result);
    } else {
        println!("\n(No transform script configured)");
    }

    Ok(())
}
