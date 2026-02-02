use crate::config::ApiProvider;
use crate::services::shell_utils;
use crate::types::{ProviderTrayStats, ProviderUsageResult};
use anyhow::Result;
use boa_engine::{Context, Source};
use std::process::Command;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

const SCRIPT_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_SCRIPT_LENGTH: usize = 10_000;

/// Runs a JavaScript transform script on JSON data.
///
/// # Security Notes
/// - Script length is limited to prevent resource exhaustion
/// - Script execution runs in a separate thread with timeout enforcement
/// - If timeout is exceeded, the thread is abandoned (`boa_engine` doesn't support interruption)
/// - For production use with untrusted scripts, consider running in a separate
///   process with OS-level resource limits
///
/// # Errors
/// Returns an error if:
/// - Script exceeds maximum length
/// - JSON data is invalid
/// - Script execution fails
/// - Script execution times out
pub fn run_transform_script(script: &str, json_data: &str) -> Result<String> {
    if script.len() > MAX_SCRIPT_LENGTH {
        return Err(anyhow::anyhow!(
            "Script exceeds maximum length of {MAX_SCRIPT_LENGTH} characters"
        ));
    }

    serde_json::from_str::<serde_json::Value>(json_data)
        .map_err(|e| anyhow::anyhow!("Invalid JSON data: {e}"))?;

    let full_script = format!(
        r"
        var response = {json_data};
        var transform = {script};
        JSON.stringify(transform(response));
        "
    );

    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let mut context = Context::default();
        let result = context
            .eval(Source::from_bytes(&full_script))
            .map_err(|e| anyhow::anyhow!("Script execution error: {e:?}"))
            .and_then(|result| {
                result
                    .to_string(&mut context)
                    .map_err(|e| anyhow::anyhow!("Failed to convert result: {e:?}"))
                    .map(|s| s.to_std_string_escaped())
            });
        let _ = tx.send(result);
    });

    rx.recv_timeout(SCRIPT_TIMEOUT)
        .map_err(|_| anyhow::anyhow!("Script execution exceeded timeout of {SCRIPT_TIMEOUT:?}"))?
}

/// Executes a Provider script and returns tray display format.
///
/// # Errors
/// Returns an error if the fetch script fails or transform script fails.
pub fn fetch_provider_for_tray(provider: &ApiProvider) -> Result<ProviderTrayStats> {
    let parts =
        shell_utils::parse_command(&provider.fetch_script, &provider.env).ok_or_else(|| {
            anyhow::anyhow!("Invalid fetch script: unmatched quotes or escape sequences")
        })?;
    if parts.is_empty() {
        return Err(anyhow::anyhow!("Empty fetch script"));
    }

    let output = Command::new(&parts[0])
        .args(&parts[1..])
        .env_clear()
        .envs(&provider.env)
        .output()?;

    if !output.status.success() {
        return Ok(ProviderTrayStats::from_provider(provider, None));
    }

    let stdout = String::from_utf8(output.stdout)?;

    let result_json = if provider.transform_script.is_empty() {
        stdout
    } else {
        run_transform_script(&provider.transform_script, &stdout)?
    };

    let result: ProviderUsageResult = serde_json::from_str(&result_json)
        .map_err(|e| anyhow::anyhow!("Failed to parse provider result: {e}"))?;

    Ok(ProviderTrayStats::from_provider(provider, Some(&result)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transform_script() {
        let script = "(response) => ({ cost: response.total * 0.01 })";
        let json_data = r#"{"total": 100}"#;
        let result =
            run_transform_script(script, json_data).expect("transform script should succeed");
        assert!(result.contains("cost"));
    }

    #[test]
    fn test_transform_script_extract_field() {
        let script = "(r) => ({ value: r.data.amount })";
        let json_data = r#"{"data": {"amount": 42}}"#;
        let result = run_transform_script(script, json_data).expect("should extract nested field");
        assert!(result.contains("42"));
    }

    #[test]
    fn test_transform_script_array_processing() {
        let script = "(r) => ({ total: r.items.reduce((a, b) => a + b, 0) })";
        let json_data = r#"{"items": [1, 2, 3, 4, 5]}"#;
        let result = run_transform_script(script, json_data).expect("should process array");
        assert!(result.contains("15"));
    }

    #[test]
    fn test_transform_script_empty_json() {
        let script = "(r) => ({ empty: true })";
        let json_data = "{}";
        let result = run_transform_script(script, json_data).expect("should handle empty JSON");
        assert!(result.contains("true"));
    }

    #[test]
    fn test_transform_script_invalid_syntax() {
        let script = "(r) => { invalid syntax here";
        let json_data = r#"{"data": 1}"#;
        let result = run_transform_script(script, json_data);
        assert!(result.is_err(), "Should fail on invalid JS syntax");
    }

    #[test]
    fn test_transform_script_runtime_error() {
        let script = "(r) => r.nonexistent.property";
        let json_data = r#"{"data": 1}"#;
        let result = run_transform_script(script, json_data);
        assert!(result.is_err(), "Should fail on runtime error");
    }

    #[test]
    fn test_transform_script_not_a_function() {
        let script = "42";
        let json_data = r#"{"data": 1}"#;
        let result = run_transform_script(script, json_data);
        assert!(result.is_err(), "Should fail when script is not a function");
    }

    #[test]
    fn test_transform_script_invalid_json() {
        let script = "(r) => ({ value: r.data })";
        let json_data = "not valid json";
        let result = run_transform_script(script, json_data);
        assert!(result.is_err(), "Should fail on invalid JSON input");
    }

    #[test]
    fn test_transform_script_too_long() {
        let script = "a".repeat(15_000);
        let json_data = r#"{"data": 1}"#;
        let result = run_transform_script(&script, json_data);
        assert!(result.is_err(), "Should fail when script is too long");
    }
}
