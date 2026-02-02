use tokenmeter_lib::services::ccusage;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("=== Testing ccusage ===\n");

    let usage = ccusage::fetch_usage().await?;

    println!("Today: ${:.2}", usage.today.cost);
    println!("This month: ${:.2}", usage.this_month.cost);
    println!("\nDaily usage ({} days):", usage.daily_usage.len());
    for day in usage.daily_usage.iter().take(5) {
        println!("  {}: ${:.2}", day.date, day.cost);
    }
    if usage.daily_usage.len() > 5 {
        println!("  ... and {} more days", usage.daily_usage.len() - 5);
    }

    println!(
        "\nModel breakdown ({} models):",
        usage.model_breakdown.len()
    );
    for m in &usage.model_breakdown {
        println!("  - {}: ${:.2}", m.model, m.cost);
    }

    Ok(())
}
