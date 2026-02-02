use crate::config::AppConfig;
use crate::types::{format_number, ProviderTrayStats, UsageSummary};
#[cfg(not(target_os = "macos"))]
use std::sync::atomic::Ordering;
use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter,
};
#[cfg(target_os = "macos")]
use tauri_plugin_nspopover::AppExt;

pub const TRAY_ID: &str = "main";
#[cfg(not(target_os = "macos"))]
const TRAY_WINDOW_LABEL: &str = "tray";

// Store the last time the tray window was shown to prevent immediate auto-hide on blur
// (which can happen due to focus stealing by the menu bar on macOS).
#[cfg(not(target_os = "macos"))]
static LAST_SHOW_TIME: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(not(target_os = "macos"))]
fn current_time_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(not(target_os = "macos"))]
pub fn mark_tray_shown() {
    LAST_SHOW_TIME.store(current_time_ms(), Ordering::Relaxed);
}

#[cfg(not(target_os = "macos"))]
pub fn last_tray_show_mark() -> u64 {
    LAST_SHOW_TIME.load(Ordering::Relaxed)
}

#[cfg(not(target_os = "macos"))]
pub fn blur_hide_delay_ms() -> Option<u64> {
    // Blur can be triggered by macOS focus stealing right after show.
    // Defer hiding for a short grace period, then re-check focus.
    const GRACE_PERIOD_MS: u64 = 600;
    let last = LAST_SHOW_TIME.load(Ordering::Relaxed);
    let now = current_time_ms();

    // If now < last (clock skew), be conservative and defer.
    if now < last {
        return Some(GRACE_PERIOD_MS);
    }

    let elapsed = now - last;
    if elapsed < GRACE_PERIOD_MS {
        Some(GRACE_PERIOD_MS - elapsed)
    } else {
        None
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum UsageLevel {
    NearBudget,
    OverBudget,
}

fn usage_level_from_cost(
    cost: f64,
    budget: f64,
    near_threshold_percent: f64,
) -> Option<UsageLevel> {
    if budget <= 0.0 {
        return None;
    }

    if cost > budget {
        return Some(UsageLevel::OverBudget);
    }

    if near_threshold_percent > 0.0 {
        let threshold = budget * (1.0 - (near_threshold_percent / 100.0));
        if cost >= threshold {
            return Some(UsageLevel::NearBudget);
        }
    }

    None
}

/// Formats tray title (supports $cost, $tokens, $input, $output variables)
fn format_tray_title(format: &str, usage: &UsageSummary) -> String {
    format
        .replace("${cost}", &format!("${:.2}", usage.today.cost))
        .replace("${tokens}", &format_number(usage.today.total_tokens))
        .replace("${input}", &format_number(usage.today.input_tokens))
        .replace("${output}", &format_number(usage.today.output_tokens))
}

#[cfg(target_os = "macos")]
fn set_macos_tray_attributed_title(app: &AppHandle, title: String, level: Option<UsageLevel>) {
    use objc2::runtime::{AnyObject, ProtocolObject};
    use objc2::ClassType;
    use objc2_app_kit::{NSColor, NSForegroundColorAttributeName};
    use objc2_foundation::{
        MainThreadMarker, NSAttributedString, NSAttributedStringKey, NSCopying, NSDictionary,
        NSString,
    };

    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };

    let _ = tray.with_inner_tray_icon(move |inner| {
        let Some(ns_status_item) = inner.ns_status_item() else {
            return;
        };

        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };

        let Some(button) = ns_status_item.button(mtm) else {
            return;
        };

        let ns_title = NSString::from_str(&title);

        let Some(level) = level else {
            // Clear any previous color attributes by setting a plain attributed title.
            let attributed = NSAttributedString::from_nsstring(&ns_title);
            button.setAttributedTitle(&attributed);
            return;
        };

        // UX: color coding only indicates close-to / over-budget states.
        let color = match level {
            UsageLevel::NearBudget => NSColor::systemOrangeColor(),
            UsageLevel::OverBudget => NSColor::systemRedColor(),
        };

        // Attributes dictionary: { NSForegroundColorAttributeName: NSColor }
        let color_any: &AnyObject = color.as_super().as_super();
        let key: &ProtocolObject<dyn NSCopying> = unsafe {
            // SAFETY: This is an AppKit constant provided by the OS.
            ProtocolObject::from_ref(NSForegroundColorAttributeName)
        };
        let attrs: objc2::rc::Retained<NSDictionary<NSAttributedStringKey, AnyObject>> =
            unsafe { NSDictionary::dictionaryWithObject_forKey(color_any, key) };

        let attributed: objc2::rc::Retained<NSAttributedString> =
            unsafe { NSAttributedString::new_with_attributes(&ns_title, &attrs) };
        button.setAttributedTitle(&attributed);
    });
}

#[cfg(not(target_os = "macos"))]
fn set_macos_tray_attributed_title(_app: &AppHandle, _title: String, _level: Option<UsageLevel>) {}

// NOTE: macOS menubar/tray icon needs to be a monochrome template image.
// Using a relative path like "icons/tray.png" is fragile because the working
// directory differs between `tauri dev` and the bundled app.
// Embed the tray icon at compile time to ensure it is always available.
const TRAY_ICON_PNG: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/icons/tray.png"));

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    // We do NOT attach a menu, as we want to control the click event ourselves
    // to toggle the window.

    let icon = Image::from_bytes(TRAY_ICON_PNG)
        .or_else(|e| {
            eprintln!("[Tray] Failed to load embedded tray icon: {e}");
            Image::from_path("icons/tray.png")
        })
        .or_else(|e| {
            eprintln!("[Tray] Failed to load tray icon from path: {e}");
            app.default_window_icon()
                .cloned()
                .ok_or_else(|| tauri::Error::AssetNotFound("default icon".into()))
        })?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state,
                ..
            } = event
            {
                if button_state != MouseButtonState::Up {
                    return;
                }
                let app = tray.app_handle();
                #[cfg(target_os = "macos")]
                {
                    if app.is_popover_shown() {
                        app.hide_popover();
                    } else {
                        app.show_popover();
                    }
                }
                #[cfg(not(target_os = "macos"))]
                {
                    if let Some(window) = app.get_webview_window(TRAY_WINDOW_LABEL) {
                        let is_visible = window.is_visible().unwrap_or(false);
                        if is_visible {
                            let _ = window.hide();
                        } else {
                            mark_tray_shown();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn set_tray_title(app: &AppHandle, title: &str) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Err(e) = tray.set_title(Some(title)) {
            eprintln!("Failed to set tray title: {e}");
        }
    }

    // macOS only: optionally override title color by setting attributedTitle.
    // Error state should not be colored (user preference), so we clear it there.
    set_macos_tray_attributed_title(app, title.to_string(), None);
}

/// Sets tray title with optional color coding based on usage level.
fn set_tray_title_with_level(
    app: &AppHandle,
    title: &str,
    usage: &UsageSummary,
    config: &AppConfig,
) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Err(e) = tray.set_title(Some(title)) {
            eprintln!("Failed to set tray title: {e}");
        }
    }

    let level = if config.menu_bar.show_color_coding {
        usage_level_from_cost(
            usage.today.cost,
            config.menu_bar.fixed_budget,
            config.menu_bar.near_budget_threshold_percent,
        )
    } else {
        None
    };
    set_macos_tray_attributed_title(app, title.to_string(), level);
}

/// Updates tray title to include a refreshing indicator while keeping old data.
pub fn update_tray_refreshing(app: &AppHandle, usage: &UsageSummary, config: &AppConfig) {
    let title = format_tray_title(&config.menu_bar.format, usage);
    let title_with_indicator = format!("{title} ⟳");
    set_tray_title_with_level(app, &title_with_indicator, usage, config);
}

/// Updates tray menu content
pub fn update_tray_menu(
    app: &AppHandle,
    usage: &UsageSummary,
    config: &AppConfig,
    _providers: &[ProviderTrayStats],
) {
    let title = format_tray_title(&config.menu_bar.format, usage);
    set_tray_title_with_level(app, &title, usage, config);

    // Emit event so the tray window updates immediately without waiting for poll.
    let _ = app.emit("usage-updated", usage);
}

/// Updates tray title to show error state.
pub fn update_tray_error(app: &AppHandle) {
    // User preference: error title should not be colored.
    set_tray_title(app, "$--");
}

#[cfg(test)]
mod usage_level_tests {
    use super::*;

    #[test]
    fn test_usage_level_budget_zero() {
        assert_eq!(usage_level_from_cost(10.0, 0.0, 10.0), None);
    }

    #[test]
    fn test_usage_level_thresholds() {
        assert_eq!(usage_level_from_cost(8.99, 10.0, 10.0), None);
        assert_eq!(
            usage_level_from_cost(9.0, 10.0, 10.0),
            Some(UsageLevel::NearBudget)
        );
        assert_eq!(
            usage_level_from_cost(10.0, 10.0, 10.0),
            Some(UsageLevel::NearBudget)
        );
        assert_eq!(
            usage_level_from_cost(10.01, 10.0, 10.0),
            Some(UsageLevel::OverBudget)
        );

        assert_eq!(
            usage_level_from_cost(9.8, 10.0, 5.0),
            Some(UsageLevel::NearBudget)
        );
        assert_eq!(usage_level_from_cost(9.49, 10.0, 5.0), None);
        assert_eq!(usage_level_from_cost(9.99, 10.0, 0.0), None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ModelUsage, UsageData};

    fn make_usage(today_cost: f64, today_tokens: u64, daily_costs: &[f64]) -> UsageSummary {
        UsageSummary {
            today: UsageData {
                date: "2024-01-15".to_string(),
                cost: today_cost,
                input_tokens: today_tokens / 2,
                output_tokens: today_tokens / 2,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                total_tokens: today_tokens,
            },
            this_month: UsageData::default(),
            daily_usage: daily_costs
                .iter()
                .enumerate()
                .map(|(i, &cost)| crate::types::DailyUsage {
                    date: format!("2024-01-{:02}", i + 1),
                    cost,
                    input_tokens: 1000,
                    output_tokens: 1000,
                    models: vec![],
                })
                .collect(),
            model_breakdown: vec![
                ModelUsage {
                    model: "claude-opus-4-5".to_string(),
                    cost: today_cost * 0.6,
                    input_tokens: today_tokens / 3,
                    output_tokens: today_tokens / 6,
                },
                ModelUsage {
                    model: "claude-haiku-4-5".to_string(),
                    cost: today_cost * 0.4,
                    input_tokens: today_tokens / 6,
                    output_tokens: today_tokens / 3,
                },
            ],
        }
    }

    #[test]
    fn test_format_number() {
        assert_eq!(format_number(500), "500");
        assert_eq!(format_number(1_500), "1.5K");
        assert_eq!(format_number(1_500_000), "1.5M");
        assert_eq!(format_number(1_500_000_000), "1.5B");
    }

    #[test]
    fn test_format_tray_title() {
        let usage = make_usage(34.02, 39_300_000, &[]);
        assert_eq!(
            format_tray_title("${cost} ${tokens}", &usage),
            "$34.02 39.3M"
        );
        assert_eq!(format_tray_title("${cost}", &usage), "$34.02");
    }
}
