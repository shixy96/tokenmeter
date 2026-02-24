use crate::config::AppConfig;
use crate::error::AppError;
use crate::services::ccusage;
use crate::state::AppState;
use crate::storage;
use crate::tray;
use crate::types::UsageSummary;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const MIN_REFRESH_INTERVAL: u64 = 60;
const MAX_REFRESH_INTERVAL: u64 = 3600;

pub async fn fetch_and_update_history(
    state: &State<'_, AppState>,
) -> Result<UsageSummary, AppError> {
    let mut data = ccusage::fetch_usage()
        .await
        .map_err(|e| AppError::Fetch(e.to_string()))?;

    // Load existing history, treat errors as empty history but log warning
    let history = match storage::load_history(&state.config_dir) {
        Ok(h) => h,
        Err(e) => {
            eprintln!("Warning: Failed to load history: {e}");
            Vec::new()
        }
    };

    // Merge history
    let merged_history = storage::merge_history(&history, &data.daily_usage);

    // Save merged history (best-effort, do not block fresh data)
    if let Err(e) = storage::save_history(&state.config_dir, &merged_history) {
        eprintln!("Warning: Failed to save history: {e}");
    }

    // Update data with merged history
    data.daily_usage = merged_history;

    Ok(data)
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub async fn get_usage_summary(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<UsageSummary, AppError> {
    let refresh_interval = state
        .config
        .lock()
        .await
        .refresh_interval
        .clamp(MIN_REFRESH_INTERVAL, MAX_REFRESH_INTERVAL);
    let cache_ttl = Duration::from_secs(refresh_interval);

    let cached = state.usage.lock().await.clone();
    let fetched_at = *state.usage_fetched_at.lock().await;
    if let (Some(data), Some(fetched_at)) = (cached, fetched_at) {
        if fetched_at.elapsed() < cache_ttl {
            return Ok(data);
        }
    }

    // Avoid running ccusage concurrently when multiple callers race.
    let _refresh_guard = state.usage_refresh_lock.lock().await;

    // Re-check after acquiring the lock.
    let cached = state.usage.lock().await.clone();
    let fetched_at = *state.usage_fetched_at.lock().await;
    if let (Some(data), Some(fetched_at)) = (cached, fetched_at) {
        if fetched_at.elapsed() < cache_ttl {
            return Ok(data);
        }
    }

    let data = fetch_and_update_history(&state).await?;

    *state.usage.lock().await = Some(data.clone());
    *state.usage_fetched_at.lock().await = Some(std::time::Instant::now());
    let config = state.config.lock().await.clone();
    tray::update_tray_menu(&app, &data, &config, &[]);

    Ok(data)
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub async fn refresh_usage(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<UsageSummary, AppError> {
    // Emit refresh-started event to sync UI state across windows
    let _ = app.emit("refresh-started", ());

    let cached = state.usage.lock().await.clone();
    let config = state.config.lock().await.clone();

    // Acquire lock to prevent concurrent refreshing/writing
    let _refresh_guard = state.usage_refresh_lock.lock().await;

    let data = match fetch_and_update_history(&state).await {
        Ok(data) => data,
        Err(e) => {
            // Emit refresh-completed even on failure to re-enable buttons
            let _ = app.emit("refresh-completed", ());
            if let Some(usage) = cached.as_ref() {
                tray::update_tray_menu(&app, usage, &config, &[]);
            }
            return Err(e);
        }
    };

    *state.usage.lock().await = Some(data.clone());
    *state.usage_fetched_at.lock().await = Some(std::time::Instant::now());
    tray::update_tray_menu(&app, &data, &config, &[]);

    // Emit refresh-completed to re-enable buttons
    let _ = app.emit("refresh-completed", ());

    Ok(data)
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, AppError> {
    let config = state.config.lock().await;
    Ok(config.clone())
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub async fn save_config(
    app: AppHandle,
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<(), AppError> {
    if config.refresh_interval < MIN_REFRESH_INTERVAL
        || config.refresh_interval > MAX_REFRESH_INTERVAL
    {
        return Err(AppError::Validation(format!(
            "refresh_interval must be between {MIN_REFRESH_INTERVAL} and {MAX_REFRESH_INTERVAL} seconds"
        )));
    }

    state
        .save_config(&config)
        .map_err(|e| AppError::Config(e.to_string()))?;
    *state.config.lock().await = config.clone();

    // Update menubar title to reflect new display format
    if let Some(usage) = state.usage.lock().await.as_ref() {
        tray::update_tray_menu(&app, usage, &config, &[]);
    }
    let _ = app.emit("config-updated", &config);

    Ok(())
}
