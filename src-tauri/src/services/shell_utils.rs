use std::collections::HashMap;

/// Substitutes `${VAR}` patterns in a string with values from the environment map.
#[must_use]
#[allow(clippy::implicit_hasher)]
pub fn substitute_env_vars(input: &str, env: &HashMap<String, String>) -> String {
    let mut result = input.to_string();
    for (key, value) in env {
        let pattern = format!("${{{key}}}");
        result = result.replace(&pattern, value);
    }
    result
}

/// Parses a shell command string into arguments using shlex.
/// Performs variable substitution before parsing.
#[must_use]
#[allow(clippy::implicit_hasher)]
pub fn parse_command(script: &str, env: &HashMap<String, String>) -> Option<Vec<String>> {
    let substituted = substitute_env_vars(script, env);
    shlex::split(&substituted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_substitute_env_vars_basic() {
        let mut env = HashMap::new();
        env.insert("TOKEN".to_string(), "secret123".to_string());
        let result = substitute_env_vars("Bearer ${TOKEN}", &env);
        assert_eq!(result, "Bearer secret123");
    }

    #[test]
    fn test_substitute_env_vars_multiple() {
        let mut env = HashMap::new();
        env.insert("HOST".to_string(), "api.example.com".to_string());
        env.insert("TOKEN".to_string(), "abc".to_string());
        let result = substitute_env_vars("curl https://${HOST} -H 'Auth: ${TOKEN}'", &env);
        assert_eq!(result, "curl https://api.example.com -H 'Auth: abc'");
    }

    #[test]
    fn test_substitute_env_vars_no_match() {
        let env = HashMap::new();
        let result = substitute_env_vars("curl https://api.com", &env);
        assert_eq!(result, "curl https://api.com");
    }

    #[test]
    fn test_parse_command_with_quotes() {
        let env = HashMap::new();
        let result = parse_command(
            "curl -H 'Authorization: Bearer token' https://api.com",
            &env,
        );
        assert!(result.is_some());
        let parts = result.unwrap();
        assert_eq!(parts.len(), 4);
        assert_eq!(parts[0], "curl");
        assert_eq!(parts[1], "-H");
        assert_eq!(parts[2], "Authorization: Bearer token");
        assert_eq!(parts[3], "https://api.com");
    }

    #[test]
    fn test_parse_command_with_env_substitution() {
        let mut env = HashMap::new();
        env.insert("TOKEN".to_string(), "secret".to_string());
        let result = parse_command(
            "curl -H 'Authorization: Bearer ${TOKEN}' https://api.com",
            &env,
        );
        assert!(result.is_some());
        let parts = result.unwrap();
        assert_eq!(parts[2], "Authorization: Bearer secret");
    }

    #[test]
    fn test_parse_command_unmatched_quotes() {
        let env = HashMap::new();
        let result = parse_command("curl -H 'unmatched quote https://api.com", &env);
        assert!(result.is_none());
    }
}
