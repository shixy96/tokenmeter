use crate::config::AppConfig;
use crate::error::AppError;
use crate::services::ccusage;
use crate::state::AppState;
use crate::tray;
use crate::types::UsageSummary;
use tauri::{AppHandle, State};

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub async fn get_usage_summary(state: State<'_, AppState>) -> Result<UsageSummary, AppError> {
    let cached = state.usage.lock().await.clone();
    if let Some(data) = cached {
        return Ok(data);
    }

    let data = ccusage::fetch_usage()
        .await
        .map_err(|e| AppError::Fetch(e.to_string()))?;

    *state.usage.lock().await = Some(data.clone());

    Ok(data)
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub async fn refresh_usage(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<UsageSummary, AppError> {
    let data = ccusage::fetch_usage()
        .await
        .map_err(|e| AppError::Fetch(e.to_string()))?;

    *state.usage.lock().await = Some(data.clone());

    let config = state.config.lock().await.clone();
    tray::update_tray_menu(&app, &data, &config, &[]);

    Ok(data)
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, AppError> {
    let config = state.config.lock().await;
    Ok(config.clone())
}

const MIN_REFRESH_INTERVAL: u64 = 60;
const MAX_REFRESH_INTERVAL: u64 = 86400;

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

    // 更新 menubar 标题以反映新的 display format
    if let Some(usage) = state.usage.lock().await.as_ref() {
        tray::update_tray_menu(&app, usage, &config, &[]);
    }

    Ok(())
}
