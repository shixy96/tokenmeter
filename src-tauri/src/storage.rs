use crate::types::DailyUsage;
use anyhow::Result;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// Loads usage history from the history.json file.
pub fn load_history(config_dir: &Path) -> Result<Vec<DailyUsage>> {
    let history_path = config_dir.join("history.json");
    if !history_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(history_path)?;
    let history: Vec<DailyUsage> = serde_json::from_str(&content)?;
    Ok(history)
}

/// Saves usage history to the history.json file atomically.
pub fn save_history(config_dir: &Path, history: &[DailyUsage]) -> Result<()> {
    if !config_dir.exists() {
        fs::create_dir_all(config_dir)?;
    }

    let history_path = config_dir.join("history.json");
    let tmp_path = config_dir.join("history.json.tmp");

    let content = serde_json::to_string_pretty(history)?;

    // Write to temp file first
    fs::write(&tmp_path, content)?;

    // Atomically rename. On Windows, rename fails if target exists, so remove first.
    #[cfg(windows)]
    if history_path.exists() {
        fs::remove_file(&history_path)?;
    }

    fs::rename(&tmp_path, &history_path)?;

    Ok(())
}

/// Merges current history with new data.
/// - Updates existing entries with fresher data.
/// - Adds new entries.
/// - Sorts by date.
pub fn merge_history(current: &[DailyUsage], new_data: &[DailyUsage]) -> Vec<DailyUsage> {
    let mut map: HashMap<String, DailyUsage> = HashMap::new();

    // Load current history into map
    for entry in current {
        map.insert(entry.date.clone(), entry.clone());
    }

    // Overwrite/Add new data
    for entry in new_data {
        map.insert(entry.date.clone(), entry.clone());
    }

    // Convert back to vec and sort
    let mut merged: Vec<DailyUsage> = map.into_values().collect();
    merged.sort_by(|a, b| a.date.cmp(&b.date));

    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merge_history() {
        let history = vec![DailyUsage {
            date: "2024-01-01".to_string(),
            cost: 1.0,
            input_tokens: 100,
            output_tokens: 100,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            models: vec![],
        }];

        let new_data = vec![
            DailyUsage {
                date: "2024-01-01".to_string(), // Overwrite
                cost: 2.0,
                input_tokens: 200,
                output_tokens: 200,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                models: vec![],
            },
            DailyUsage {
                date: "2024-01-02".to_string(), // New
                cost: 3.0,
                input_tokens: 300,
                output_tokens: 300,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                models: vec![],
            },
        ];

        let merged = merge_history(&history, &new_data);

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].date, "2024-01-01");
        assert!((merged[0].cost - 2.0).abs() < f64::EPSILON); // Updated
        assert_eq!(merged[1].date, "2024-01-02");
    }
}
