use portsy_core::{
    kill_all_watched as core_kill_all_watched, kill_pid_for_port, scan_now, KillReport,
    MonitorConfig, MonitorMode, PortRange, PortSnapshot, PortWatcher,
    DEFAULT_BACKGROUND_REFRESH_INTERVAL_MS,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    process::Command,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    ActivationPolicy, AppHandle, Emitter, LogicalPosition, Manager, Monitor, Rect, State,
    WebviewWindow, Window, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const TRAY_ID: &str = "portsy-tray";
const SNAPSHOT_EVENT: &str = "portsy-snapshot";

type CommandResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub last_updated_at: u64,
    pub ranges: Vec<PortRange>,
    pub refresh_interval_ms: u64,
    pub launch_at_login: bool,
    #[serde(default)]
    pub keep_open_when_unfocused: bool,
    #[serde(default)]
    pub excluded_process_names: Vec<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        let config = MonitorConfig::default();
        Self {
            last_updated_at: 0,
            ranges: config.ranges,
            refresh_interval_ms: config.refresh_interval_ms,
            launch_at_login: false,
            keep_open_when_unfocused: false,
            excluded_process_names: Vec::new(),
        }
    }
}

impl AppSettings {
    fn monitor_config(&self) -> MonitorConfig {
        MonitorConfig {
            ranges: self.ranges.clone(),
            refresh_interval_ms: self.refresh_interval_ms,
            background_refresh_interval_ms: DEFAULT_BACKGROUND_REFRESH_INTERVAL_MS,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KillOutcome {
    pub ok: bool,
    pub report: Option<KillReport>,
    pub error: Option<String>,
}

struct AppState {
    settings: Mutex<AppSettings>,
    watcher: Mutex<Option<PortWatcher>>,
    monitor_mode: Mutex<MonitorMode>,
}

impl AppState {
    fn new(settings: AppSettings) -> Self {
        Self {
            settings: Mutex::new(settings),
            watcher: Mutex::new(None),
            monitor_mode: Mutex::new(MonitorMode::Background),
        }
    }
}

#[tauri::command]
async fn get_snapshot(state: State<'_, AppState>) -> CommandResult<PortSnapshot> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "settings lock was poisoned".to_string())?
        .clone();
    let config = settings.monitor_config();

    let snapshot = tauri::async_runtime::spawn_blocking(move || scan_now(&config))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    Ok(filter_snapshot(snapshot, &settings))
}

#[tauri::command]
fn start_monitor(app: AppHandle, state: State<'_, AppState>) -> CommandResult<()> {
    start_monitor_inner(app, &state)
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> CommandResult<AppSettings> {
    state
        .settings
        .lock()
        .map_err(|_| "settings lock was poisoned".to_string())
        .map(|settings| settings.clone())
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    mut settings: AppSettings,
) -> CommandResult<AppSettings> {
    settings
        .monitor_config()
        .validate()
        .map_err(|error| error.to_string())?;

    let previous_last_updated_at = state
        .settings
        .lock()
        .map_err(|_| "settings lock was poisoned".to_string())?
        .last_updated_at;
    settings.last_updated_at = now_ms().max(previous_last_updated_at.saturating_add(1));

    persist_settings(&app, &settings)?;
    configure_autostart(&app, settings.launch_at_login)?;

    {
        let mut current = state
            .settings
            .lock()
            .map_err(|_| "settings lock was poisoned".to_string())?;
        *current = settings.clone();
    }

    restart_monitor(app, &state)?;
    Ok(settings)
}

#[tauri::command]
async fn kill_port(state: State<'_, AppState>, pid: u32, port: u16) -> CommandResult<KillReport> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "settings lock was poisoned".to_string())?
        .clone();
    let config = settings.monitor_config();

    tauri::async_runtime::spawn_blocking(move || kill_pid_for_port(&config, pid, port))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn kill_all_watched(
    state: State<'_, AppState>,
    snapshot: PortSnapshot,
) -> CommandResult<Vec<KillOutcome>> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "settings lock was poisoned".to_string())?
        .clone();

    let snapshot = filter_snapshot(snapshot, &settings);
    let config = settings.monitor_config();
    let outcomes =
        tauri::async_runtime::spawn_blocking(move || core_kill_all_watched(&config, &snapshot))
            .await
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|result| match result {
                Ok(report) => KillOutcome {
                    ok: true,
                    report: Some(report),
                    error: None,
                },
                Err(error) => KillOutcome {
                    ok: false,
                    report: None,
                    error: Some(error.to_string()),
                },
            })
            .collect();

    Ok(outcomes)
}

#[tauri::command]
fn open_port(port: u16) -> CommandResult<String> {
    let url = format!("http://localhost:{port}");
    Command::new("open")
        .arg(&url)
        .status()
        .map_err(|error| format!("failed to open {url}: {error}"))
        .and_then(|status| {
            if status.success() {
                Ok(url.clone())
            } else {
                Err(format!("failed to open {url}: open exited with {status}"))
            }
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            app.set_activation_policy(ActivationPolicy::Accessory);
            create_tray(app)?;
            let settings = load_settings(app.handle()).unwrap_or_default();
            let _ = configure_autostart(app.handle(), settings.launch_at_login);
            let state = AppState::new(settings);
            start_monitor_inner(app.handle().clone(), &state)?;
            app.manage(state);
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "quit" {
                app.exit(0);
            }
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
                set_monitor_mode(window.app_handle(), MonitorMode::Background);
            }
            WindowEvent::Focused(false) => {
                if should_hide_when_unfocused(window) {
                    let _ = window.hide();
                    set_monitor_mode(window.app_handle(), MonitorMode::Background);
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            start_monitor,
            get_settings,
            save_settings,
            kill_port,
            kill_all_watched,
            open_port
        ])
        .run(tauri::generate_context!())
        .expect("error while running Portsy");
}

fn create_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let quit = MenuItem::with_id(app, "quit", "Quit Portsy", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quit])?;
    let icon = app
        .default_window_icon()
        .expect("generated Tauri app should have a default icon")
        .clone();

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .title("0")
        .tooltip("Portsy")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            let TrayIconEvent::Click {
                rect,
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            else {
                return;
            };

            let app = tray.app_handle();
            if let Some(window) = app.get_webview_window("main") {
                let visible = window.is_visible().unwrap_or(false);
                if visible {
                    let _ = window.hide();
                    set_monitor_mode(&app, MonitorMode::Background);
                } else {
                    set_monitor_mode(&app, MonitorMode::Foreground);
                    position_window_below_tray(&app, &window, rect);
                    let _ = window.show();
                    let _ = window.set_focus();
                    refresh_monitor_now(&app);
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// A rectangle in the global logical (point) coordinate space.
#[derive(Debug, Clone, Copy, PartialEq)]
struct LogicalRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl LogicalRect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

/// Positions the window under the tray icon, working entirely in logical
/// points.
///
/// Physical coordinates are not usable here: every source (tray rect, monitor
/// bounds, window size) is scaled by a different display's backing factor, so
/// on a mixed-DPI multi-monitor setup they do not share a coordinate space.
/// Logical points are global and consistent, and `set_position` passes a
/// `LogicalPosition` through untouched.
fn position_window_below_tray(app: &AppHandle, window: &WebviewWindow, tray_rect: Rect) {
    let monitor = monitor_under_cursor(app)
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return;
    };

    let Some(work_area) = logical_work_area(&monitor) else {
        return;
    };

    // The tray rect is scaled by the backing factor of the screen holding the
    // menu bar, which is the screen that was clicked.
    let scale_factor = monitor.scale_factor();
    let tray_position = tray_rect.position.to_logical::<f64>(scale_factor);
    let tray_size = tray_rect.size.to_logical::<f64>(scale_factor);

    // The window's own size is scaled by whichever screen it currently sits
    // on, which is not necessarily the one that was clicked.
    let (Ok(window_size), Ok(window_scale_factor)) = (window.outer_size(), window.scale_factor())
    else {
        return;
    };
    if window_scale_factor <= 0.0 {
        return;
    }
    let window_size = window_size.to_logical::<f64>(window_scale_factor);

    let min_x = work_area.x;
    let min_y = work_area.y;
    let max_x = min_x + work_area.width - window_size.width;
    let max_y = min_y + work_area.height - window_size.height;

    let tray_center_x = tray_position.x + tray_size.width / 2.0;
    let desired_x = tray_center_x - window_size.width / 2.0;
    let desired_y = (tray_position.y + tray_size.height).max(min_y);

    let x = clamp_position(desired_x, min_x, max_x);
    let y = clamp_position(desired_y, min_y, max_y);

    let _ = window.set_position(LogicalPosition::new(x, y));
}

/// Finds the monitor the tray icon was clicked on.
///
/// The cursor is used rather than the tray event's own click position. Both
/// are physical, but the click is scaled by the backing factor of whichever
/// screen holds the menu bar — a factor we cannot recover, leaving the click
/// ambiguous between overlapping displays. The cursor is always scaled by the
/// *primary* monitor's factor, which is known, so it converts back to logical
/// points exactly.
fn monitor_under_cursor(app: &AppHandle) -> Option<Monitor> {
    let cursor = app.cursor_position().ok()?;
    let primary_scale_factor = app.primary_monitor().ok().flatten()?.scale_factor();
    if primary_scale_factor <= 0.0 {
        return None;
    }

    let cursor = cursor.to_logical::<f64>(primary_scale_factor);
    let monitors = app.available_monitors().ok()?;

    monitors
        .into_iter()
        .find(|monitor| logical_bounds(monitor).is_some_and(|b| b.contains(cursor.x, cursor.y)))
}

fn logical_bounds(monitor: &Monitor) -> Option<LogicalRect> {
    let scale_factor = monitor.scale_factor();
    if scale_factor <= 0.0 {
        return None;
    }

    let position = monitor.position().to_logical::<f64>(scale_factor);
    let size = monitor.size().to_logical::<f64>(scale_factor);

    Some(LogicalRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn logical_work_area(monitor: &Monitor) -> Option<LogicalRect> {
    let scale_factor = monitor.scale_factor();
    if scale_factor <= 0.0 {
        return None;
    }

    let work_area = monitor.work_area();
    let position = work_area.position.to_logical::<f64>(scale_factor);
    let size = work_area.size.to_logical::<f64>(scale_factor);

    Some(LogicalRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn clamp_position(value: f64, min: f64, max: f64) -> f64 {
    if max <= min {
        min
    } else {
        value.clamp(min, max)
    }
}

fn should_hide_when_unfocused(window: &Window) -> bool {
    let Some(state) = window.try_state::<AppState>() else {
        return true;
    };

    state
        .settings
        .lock()
        .map(|settings| !settings.keep_open_when_unfocused)
        .unwrap_or(true)
}

fn set_monitor_mode(app: &AppHandle, mode: MonitorMode) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    if let Ok(mut current_mode) = state.monitor_mode.lock() {
        *current_mode = mode;
    }

    if let Ok(watcher) = state.watcher.lock() {
        if let Some(watcher) = watcher.as_ref() {
            watcher.set_mode(mode);
        }
    };
}

fn current_monitor_mode(state: &AppState) -> MonitorMode {
    state
        .monitor_mode
        .lock()
        .map(|mode| *mode)
        .unwrap_or(MonitorMode::Background)
}

fn start_monitor_inner(app: AppHandle, state: &AppState) -> CommandResult<()> {
    let mut watcher = state
        .watcher
        .lock()
        .map_err(|_| "monitor lock was poisoned".to_string())?;
    if watcher.is_some() {
        return Ok(());
    }

    let settings = state
        .settings
        .lock()
        .map_err(|_| "settings lock was poisoned".to_string())?
        .clone();
    let config = settings.monitor_config();
    let monitor_mode = current_monitor_mode(state);
    *watcher = Some(PortWatcher::spawn(config, monitor_mode, move |result| {
        if let Ok(snapshot) = result {
            let snapshot = filter_snapshot(snapshot, &settings);
            update_tray(&app, snapshot.entries.len());
            let _ = app.emit(SNAPSHOT_EVENT, snapshot);
        }
    }));

    Ok(())
}

fn refresh_monitor_now(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(settings) = state.settings.lock().map(|settings| settings.clone()) else {
        return;
    };
    let Ok(snapshot) = scan_now(&settings.monitor_config()) else {
        return;
    };

    let snapshot = filter_snapshot(snapshot, &settings);
    update_tray(app, snapshot.entries.len());
    let _ = app.emit(SNAPSHOT_EVENT, snapshot);
}

fn filter_snapshot(mut snapshot: PortSnapshot, settings: &AppSettings) -> PortSnapshot {
    let exclusions = settings
        .excluded_process_names
        .iter()
        .map(|name| name.trim().to_ascii_lowercase())
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();

    if exclusions.is_empty() {
        return snapshot;
    }

    snapshot.entries.retain(|entry| {
        let process_name = entry.process_name.to_ascii_lowercase();
        let command = entry.command.to_ascii_lowercase();
        !exclusions
            .iter()
            .any(|excluded| process_name == *excluded || command.contains(excluded))
    });
    snapshot
}

fn restart_monitor(app: AppHandle, state: &AppState) -> CommandResult<()> {
    {
        let mut watcher = state
            .watcher
            .lock()
            .map_err(|_| "monitor lock was poisoned".to_string())?;
        if let Some(mut current) = watcher.take() {
            current.stop();
        }
    }
    start_monitor_inner(app, state)
}

fn update_tray(app: &AppHandle, count: usize) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let title = count.to_string();
        let tooltip = if count == 1 {
            "Portsy: 1 watched port in use".to_string()
        } else {
            format!("Portsy: {count} watched ports in use")
        };
        let _ = tray.set_title(Some(&title));
        let _ = tray.set_tooltip(Some(&tooltip));
    }
}

fn load_settings(app: &AppHandle) -> CommandResult<AppSettings> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read settings {}: {error}", path.display()))?;
    let mut settings: AppSettings = serde_json::from_str(&contents)
        .map_err(|error| format!("failed to parse settings {}: {error}", path.display()))?;
    if settings.last_updated_at == 0 {
        settings.last_updated_at = fs::metadata(&path)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(timestamp_ms)
            .unwrap_or(1);
    }
    Ok(settings)
}

fn persist_settings(app: &AppHandle, settings: &AppSettings) -> CommandResult<()> {
    let path = settings_path(app)?;
    let contents = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("failed to serialize settings: {error}"))?;
    fs::write(&path, contents)
        .map_err(|error| format!("failed to write settings {}: {error}", path.display()))
}

fn settings_path(app: &AppHandle) -> CommandResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| {
        format!(
            "failed to create settings directory {}: {error}",
            dir.display()
        )
    })?;
    Ok(dir.join("settings.json"))
}

fn now_ms() -> u64 {
    timestamp_ms(SystemTime::now()).unwrap_or(1)
}

fn timestamp_ms(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn configure_autostart(app: &AppHandle, enabled: bool) -> CommandResult<()> {
    let manager = app.autolaunch();
    if enabled {
        manager
            .enable()
            .map_err(|error| format!("failed to enable launch at login: {error}"))
    } else {
        manager
            .disable()
            .map_err(|error| format!("failed to disable launch at login: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A 2x built-in laptop screen at the logical origin, with a 1x external to
    // its right. Their physical bounds as Tauri reports them overlap (the
    // built-in spans 0..3024, the external claims 1512..3432), which is why
    // monitor selection has to happen in logical points.
    const BUILT_IN: LogicalRect = LogicalRect {
        x: 0.0,
        y: 0.0,
        width: 1512.0,
        height: 945.0,
    };
    const EXTERNAL: LogicalRect = LogicalRect {
        x: 1512.0,
        y: 0.0,
        width: 1920.0,
        height: 1080.0,
    };

    // The cursor is always scaled by the primary monitor's factor, whichever
    // screen it is actually over. Here the 2x built-in is primary.
    fn logical_cursor(physical_x: f64, physical_y: f64) -> (f64, f64) {
        (physical_x / 2.0, physical_y / 2.0)
    }

    #[test]
    fn cursor_over_the_built_in_screen_selects_the_built_in_screen() {
        let (x, y) = logical_cursor(1400.0, 24.0);

        assert!(BUILT_IN.contains(x, y));
        assert!(!EXTERNAL.contains(x, y));
    }

    #[test]
    fn cursor_over_the_external_screen_selects_the_external_screen() {
        // The case that a per-monitor scale guess gets wrong: the raw physical
        // x of 4000 sits inside the built-in's reported physical bounds.
        let (x, y) = logical_cursor(4000.0, 24.0);

        assert!(EXTERNAL.contains(x, y));
        assert!(!BUILT_IN.contains(x, y));
    }

    #[test]
    fn cursor_over_the_far_edge_of_the_external_screen_still_selects_it() {
        let (x, y) = logical_cursor(6862.0, 24.0);

        assert!(EXTERNAL.contains(x, y));
        assert!(!BUILT_IN.contains(x, y));
    }

    #[test]
    fn cursor_over_a_screen_left_of_the_primary_selects_that_screen() {
        let left_of_primary = LogicalRect {
            x: -1920.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
        };
        let (x, y) = logical_cursor(-1920.0, 24.0);

        assert!(left_of_primary.contains(x, y));
        assert!(!BUILT_IN.contains(x, y));
    }

    #[test]
    fn bounds_exclude_the_far_edges() {
        assert!(BUILT_IN.contains(0.0, 0.0));
        assert!(!BUILT_IN.contains(1512.0, 0.0));
        assert!(!BUILT_IN.contains(0.0, 945.0));
    }

    #[test]
    fn clamp_position_keeps_values_inside_the_range() {
        assert_eq!(clamp_position(50.0, 0.0, 100.0), 50.0);
        assert_eq!(clamp_position(-10.0, 0.0, 100.0), 0.0);
        assert_eq!(clamp_position(150.0, 0.0, 100.0), 100.0);
    }

    #[test]
    fn clamp_position_falls_back_to_the_minimum_when_the_window_does_not_fit() {
        assert_eq!(clamp_position(50.0, 0.0, -20.0), 0.0);
    }
}
