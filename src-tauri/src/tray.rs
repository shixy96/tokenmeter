use crate::config::AppConfig;
use crate::services::ccusage;
use crate::state::AppState;
use crate::types::{format_number, ProviderTrayStats, UsageSummary};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    image::Image,
    menu::{Menu, MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

pub const TRAY_ID: &str = "main";
static IS_REFRESHING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum UsageLevel {
    Low,
    Medium,
    High,
    Critical,
}

fn usage_level_from_cost(cost: f64, budget: f64) -> UsageLevel {
    if budget <= 0.0 {
        return UsageLevel::Low;
    }
    let percentage = (cost / budget) * 100.0;
    if percentage >= 90.0 {
        UsageLevel::Critical
    } else if percentage >= 75.0 {
        UsageLevel::High
    } else if percentage >= 50.0 {
        UsageLevel::Medium
    } else {
        UsageLevel::Low
    }
}

/// 格式化托盘标题（支持 $cost, $tokens, $input, $output 变量）
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

        let color = match level {
            UsageLevel::Low => NSColor::systemGreenColor(),
            UsageLevel::Medium => NSColor::systemYellowColor(),
            UsageLevel::High => NSColor::systemOrangeColor(),
            UsageLevel::Critical => NSColor::systemRedColor(),
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

/// 计算环比变化百分比
#[allow(clippy::cast_possible_truncation)]
fn calculate_change(today: f64, daily_avg: f64) -> String {
    if daily_avg <= 0.0 {
        return String::new();
    }
    let change = ((today - daily_avg) / daily_avg * 100.0).round() as i32;
    match change.cmp(&0) {
        std::cmp::Ordering::Greater => format!(" (+{change}%↑)"),
        std::cmp::Ordering::Less => format!(" ({change}%↓)"),
        std::cmp::Ordering::Equal => String::new(),
    }
}

/// 计算过去 30 天的日均花费
#[allow(clippy::cast_precision_loss)]
fn calculate_daily_avg(usage: &UsageSummary) -> f64 {
    if usage.daily_usage.is_empty() {
        return 0.0;
    }
    let total: f64 = usage.daily_usage.iter().map(|d| d.cost).sum();
    total / usage.daily_usage.len() as f64
}

/// 生成 Today 统计标题
fn format_today_header(usage: &UsageSummary) -> String {
    let daily_avg = calculate_daily_avg(usage);
    let change = calculate_change(usage.today.cost, daily_avg);
    format!(
        "📊 Today: ${:.2} / {}{}",
        usage.today.cost,
        format_number(usage.today.total_tokens),
        change
    )
}

/// 生成模型行文本
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn format_model_line(model: &str, cost: f64, tokens: u64, total_cost: f64) -> String {
    let percent = if total_cost > 0.0 {
        (cost / total_cost * 100.0).round() as u32
    } else {
        0
    };
    format!(
        "   {}: ${:.2}/{} ({}%)",
        model,
        cost,
        format_number(tokens),
        percent
    )
}

/// 生成 Last 30 Days 统计文本
#[allow(clippy::cast_precision_loss)]
fn format_last_30_days(usage: &UsageSummary) -> String {
    let total_cost: f64 = usage.daily_usage.iter().map(|d| d.cost).sum();
    let total_tokens: u64 = usage
        .daily_usage
        .iter()
        .map(|d| d.input_tokens + d.output_tokens)
        .sum();
    let days = usage.daily_usage.len();
    let daily_avg = if days > 0 {
        total_cost / days as f64
    } else {
        0.0
    };
    format!(
        "📅 Last 30 Days: ${:.2} / {} (${:.0}/day)",
        total_cost,
        format_number(total_tokens),
        daily_avg
    )
}

/// 构建托盘菜单
fn build_tray_menu(
    app: &AppHandle,
    usage: Option<&UsageSummary>,
    providers: &[ProviderTrayStats],
) -> tauri::Result<Menu<tauri::Wry>> {
    let mut menu_builder = MenuBuilder::new(app);

    // Today 统计
    let today_text = usage.map_or_else(|| "📊 Today: $-- / --".to_string(), format_today_header);
    let today_header = MenuItemBuilder::with_id("stat_today", &today_text).build(app)?;
    menu_builder = menu_builder.item(&today_header);

    // 模型明细
    if let Some(usage) = usage {
        let total_cost = usage.today.cost;
        for (i, model) in usage.model_breakdown.iter().enumerate() {
            let text = format_model_line(
                &model.model,
                model.cost,
                model.input_tokens + model.output_tokens,
                total_cost,
            );
            let item = MenuItemBuilder::with_id(format!("stat_model_{i}"), &text).build(app)?;
            menu_builder = menu_builder.item(&item);
        }
    }

    // 分隔线 + Last 30 Days
    let last_30_text = usage.map_or_else(
        || "📅 Last 30 Days: $-- / --".to_string(),
        format_last_30_days,
    );
    let last_30_days = MenuItemBuilder::with_id("stat_last30", &last_30_text).build(app)?;
    menu_builder = menu_builder.separator().item(&last_30_days);

    // Provider 统计（只在有数据时显示）
    if !providers.is_empty() {
        menu_builder = menu_builder.separator();
        for (i, provider) in providers.iter().enumerate() {
            let item =
                MenuItemBuilder::with_id(format!("stat_provider_{i}"), &provider.display_text)
                    .build(app)?;
            menu_builder = menu_builder.item(&item);
        }
    }

    // 功能菜单项
    let open_dashboard = MenuItemBuilder::with_id("dashboard", "Open Dashboard").build(app)?;
    let refresh = MenuItemBuilder::with_id("refresh", "Refresh Now").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings...").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    menu_builder
        .separator()
        .item(&open_dashboard)
        .item(&refresh)
        .item(&settings)
        .separator()
        .item(&quit)
        .build()
}

// NOTE: macOS menubar/tray icon needs to be a monochrome template image.
// Using a relative path like "icons/tray.png" is fragile because the working
// directory differs between `tauri dev` and the bundled app.
// Embed the tray icon at compile time to ensure it is always available.
const TRAY_ICON_PNG: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/icons/tray.png"));

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_tray_menu(app, None, &[])?;

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
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            // 忽略统计菜单项的点击（以 stat_ 开头）
            if id.starts_with("stat_") {
                return;
            }
            println!("[Tray] Menu event received: {id}");
            match id {
                "dashboard" => {
                    println!("[Tray] Opening dashboard...");
                    // Reuse the same codepath as the tauri command so macOS
                    // activation policy is updated consistently (Dock/Cmd+Tab).
                    crate::open_dashboard(app.clone());
                }
                "refresh" => {
                    println!("[Tray] Refresh requested...");
                    if IS_REFRESHING
                        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                        .is_err()
                    {
                        println!("[Tray] Already refreshing, skipping");
                        return;
                    }
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            match ccusage::fetch_usage().await {
                                Ok(data) => {
                                    *state.usage.lock().await = Some(data.clone());
                                    let config = state.config.lock().await.clone();
                                    update_tray_menu(&app_handle, &data, &config, &[]);
                                    println!("[Tray] Refresh completed successfully");
                                }
                                Err(e) => {
                                    eprintln!("[Tray] Failed to refresh usage: {e}");
                                    update_tray_error(&app_handle);
                                }
                            }
                        }
                        IS_REFRESHING.store(false, Ordering::SeqCst);
                    });
                }
                "settings" => {
                    println!("[Tray] Opening settings...");
                    // Reuse the tauri command to ensure Dock/Cmd+Tab behavior
                    // matches the dashboard open flow.
                    crate::open_settings(app.clone());
                }
                "quit" => {
                    println!("[Tray] Quitting application...");
                    app.exit(0);
                }
                _ => {
                    println!("[Tray] Unknown menu event: {id}");
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

/// 更新托盘菜单内容
pub fn update_tray_menu(
    app: &AppHandle,
    usage: &UsageSummary,
    config: &AppConfig,
    providers: &[ProviderTrayStats],
) {
    // 更新菜单栏标题
    let title = format_tray_title(&config.menu_bar.format, usage);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Err(e) = tray.set_title(Some(&title)) {
            eprintln!("Failed to set tray title: {e}");
        }
    }

    let level = if config.menu_bar.show_color_coding {
        Some(usage_level_from_cost(
            usage.today.cost,
            config.menu_bar.fixed_budget,
        ))
    } else {
        None
    };
    set_macos_tray_attributed_title(app, title.clone(), level);

    // 重建菜单
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };

    if let Err(e) =
        build_tray_menu(app, Some(usage), providers).and_then(|menu| tray.set_menu(Some(menu)))
    {
        eprintln!("Failed to update tray menu: {e}");
    }
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
        assert_eq!(usage_level_from_cost(10.0, 0.0), UsageLevel::Low);
    }

    #[test]
    fn test_usage_level_thresholds() {
        assert_eq!(usage_level_from_cost(4.9, 10.0), UsageLevel::Low);
        assert_eq!(usage_level_from_cost(5.0, 10.0), UsageLevel::Medium);
        assert_eq!(usage_level_from_cost(7.5, 10.0), UsageLevel::High);
        assert_eq!(usage_level_from_cost(9.0, 10.0), UsageLevel::Critical);
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

    #[test]
    fn test_calculate_change() {
        assert_eq!(calculate_change(100.0, 50.0), " (+100%↑)");
        assert_eq!(calculate_change(50.0, 100.0), " (-50%↓)");
        assert_eq!(calculate_change(100.0, 100.0), "");
        assert_eq!(calculate_change(100.0, 0.0), "");
    }

    #[test]
    fn test_format_today_header() {
        let usage = make_usage(34.02, 39_300_000, &[50.0, 50.0, 50.0]);
        let header = format_today_header(&usage);
        assert!(header.starts_with("📊 Today: $34.02 / 39.3M"));
        assert!(header.contains("↓")); // 34.02 < 50.0 avg
    }

    #[test]
    fn test_format_model_line() {
        let line = format_model_line("claude-opus-4-5", 20.50, 12_000_000, 34.02);
        assert_eq!(line, "   claude-opus-4-5: $20.50/12.0M (60%)");
    }

    #[test]
    fn test_format_last_30_days() {
        let usage = make_usage(34.02, 39_300_000, &[50.0, 60.0, 70.0]);
        let text = format_last_30_days(&usage);
        assert!(text.starts_with("📅 Last 30 Days: $180.00"));
        assert!(text.contains("$60/day"));
    }
}
