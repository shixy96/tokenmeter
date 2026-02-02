#![warn(clippy::all)]
#![warn(clippy::pedantic)]
#![warn(clippy::nursery)]
#![allow(clippy::module_name_repetitions)]

mod commands;
pub mod config;
mod error;
pub mod services;
pub mod state;
mod tray;
pub mod types;

use commands::providers::{delete_provider, get_providers, save_provider, test_provider};
use commands::usage::{get_config, get_usage_summary, refresh_usage, save_config};
use services::ccusage;
use state::AppState;
#[cfg(not(target_os = "macos"))]
use std::time::Duration;
use tauri::{Emitter, Manager};

/// Set Dock icon visibility on macOS
#[cfg(target_os = "macos")]
fn set_dock_visible(app: &tauri::AppHandle, visible: bool) {
    use tauri::ActivationPolicy;
    let policy = if visible {
        ActivationPolicy::Regular
    } else {
        ActivationPolicy::Accessory
    };
    let _ = app.set_activation_policy(policy);
    if visible {
        let _ = app.show();
    }
}

fn show_window_with_dock(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    set_dock_visible(app, true);
    if let Some(window) = app.get_webview_window("dashboard") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
fn open_dashboard(app: tauri::AppHandle) {
    show_window_with_dock(&app);
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
fn open_settings(app: tauri::AppHandle) {
    show_window_with_dock(&app);
    if let Some(window) = app.get_webview_window("dashboard") {
        let _ = window.emit("navigate", "settings");
    }
}

#[tauri::command]
async fn set_launch_at_login(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let autostart = app.autolaunch();
    if enabled {
        autostart.enable().map_err(|e| e.to_string())?;
    } else {
        autostart.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Preload usage data in background on app startup
fn spawn_preload_task(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        match ccusage::fetch_usage().await {
            Ok(data) => {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    *state.usage.lock().await = Some(data.clone());
                    *state.usage_fetched_at.lock().await = Some(std::time::Instant::now());
                    let config = state.config.lock().await.clone();
                    tray::update_tray_menu(&app_handle, &data, &config, &[]);
                    // Emit event to notify frontend that data is ready
                    let _ = app_handle.emit("usage-preloaded", ());
                }
            }
            Err(e) => {
                eprintln!("Background preload failed: {e}");
                tray::update_tray_error(&app_handle);
            }
        }
    });
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// # Panics
/// Panics if the Tauri application fails to start.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_nspopover::init());

    builder
        .setup(|app| {
            // Start as accessory app (no Dock icon) since window is hidden by default
            #[cfg(target_os = "macos")]
            {
                use tauri::ActivationPolicy;
                app.set_activation_policy(ActivationPolicy::Accessory);
            }

            let state = AppState::new().expect(
                "Failed to initialize app state. Please check if ~/.tokenmeter directory is writable.",
            );
            app.manage(state);
            tray::setup_tray(app.handle())?;

            #[cfg(target_os = "macos")]
            {
                if app.tray_by_id(tray::TRAY_ID).is_some() {
                    if let Some(window) = app.get_webview_window("tray") {
                        use tauri_plugin_nspopover::{ToPopoverOptions, WindowExt};
                        window.to_popover(ToPopoverOptions {
                            is_fullsize_content: true,
                        });
                    }
                }
            }

            // Start background preload of usage data
            spawn_preload_task(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Hide window instead of closing, app runs in tray
                    let _ = window.hide();
                    api.prevent_close();

                    #[cfg(target_os = "macos")]
                    {
                        // Only hide dock if it's the dashboard window being closed
                        if window.label() == "dashboard" {
                            set_dock_visible(window.app_handle(), false);
                        }
                    }
                }
                tauri::WindowEvent::Focused(false) => {
                    // Auto-hide tray window when it loses focus
                    if window.label() == "tray" {
                        #[cfg(not(target_os = "macos"))]
                        {
                            if let Some(delay_ms) = tray::blur_hide_delay_ms() {
                                let show_mark = tray::last_tray_show_mark();
                                let window = window.clone();
                                tauri::async_runtime::spawn(async move {
                                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                                    if tray::last_tray_show_mark() != show_mark {
                                        return;
                                    }
                                    let is_visible = window.is_visible().unwrap_or(false);
                                    let is_focused = window.is_focused().unwrap_or(false);
                                    if is_visible && !is_focused {
                                        let _ = window.hide();
                                    }
                                });
                            } else {
                                let _ = window.hide();
                            }
                        }
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_usage_summary,
            refresh_usage,
            get_config,
            save_config,
            get_providers,
            save_provider,
            delete_provider,
            test_provider,
            open_dashboard,
            open_settings,
            set_launch_at_login,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running Tauri application. Check system tray permissions.");
}
