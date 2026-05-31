use portsy_core::{
    kill_all_watched as core_kill_all_watched, kill_pid_for_port, scan_now, KillReport,
    MonitorConfig, PortRange, PortSnapshot, PortWatcher,
};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    ActivationPolicy, AppHandle, Emitter, Manager, PhysicalPosition, Rect, State, WebviewWindow,
    WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const TRAY_ID: &str = "portsy-tray";
const SNAPSHOT_EVENT: &str = "portsy-snapshot";

type CommandResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub ranges: Vec<PortRange>,
    pub refresh_interval_ms: u64,
    pub launch_at_login: bool,
    #[serde(default)]
    pub excluded_process_names: Vec<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        let config = MonitorConfig::default();
        Self {
            ranges: config.ranges,
            refresh_interval_ms: config.refresh_interval_ms,
            launch_at_login: false,
            excluded_process_names: Vec::new(),
        }
    }
}

impl AppSettings {
    fn monitor_config(&self) -> MonitorConfig {
        MonitorConfig {
            ranges: self.ranges.clone(),
            refresh_interval_ms: self.refresh_interval_ms,
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
}

impl AppState {
    fn new(settings: AppSettings) -> Self {
        Self {
            settings: Mutex::new(settings),
            watcher: Mutex::new(None),
        }
    }
}

#[tauri::command]
fn get_snapshot(state: State<'_, AppState>) -> CommandResult<PortSnapshot> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "settings lock was poisoned".to_string())?
        .clone();

    let snapshot = scan_now(&settings.monitor_config()).map_err(|error| error.to_string())?;
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
    settings: AppSettings,
) -> CommandResult<AppSettings> {
    settings
        .monitor_config()
        .validate()
        .map_err(|error| error.to_string())?;
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
fn kill_port(state: State<'_, AppState>, pid: u32, port: u16) -> CommandResult<KillReport> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "settings lock was poisoned".to_string())?
        .clone();

    kill_pid_for_port(&settings.monitor_config(), pid, port).map_err(|error| error.to_string())
}

#[tauri::command]
fn kill_all_watched(
    state: State<'_, AppState>,
    snapshot: PortSnapshot,
) -> CommandResult<Vec<KillOutcome>> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "settings lock was poisoned".to_string())?
        .clone();

    let snapshot = filter_snapshot(snapshot, &settings);
    let outcomes = core_kill_all_watched(&settings.monitor_config(), &snapshot)
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
        .on_window_event(|window, event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                WindowEvent::Focused(false) => {
                    let _ = window.hide();
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            start_monitor,
            get_settings,
            save_settings,
            kill_port,
            kill_all_watched
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
                position,
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
                } else {
                    position_window_below_tray(&app, &window, position.x, position.y, rect);
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = app.emit("portsy-opened", ());
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn position_window_below_tray(
    app: &AppHandle,
    window: &WebviewWindow,
    click_x: f64,
    click_y: f64,
    tray_rect: Rect,
) {
    let monitor = app
        .monitor_from_point(click_x, click_y)
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return;
    };

    let scale_factor = monitor.scale_factor();
    let tray_position = tray_rect.position.to_physical::<f64>(scale_factor);
    let tray_size = tray_rect.size.to_physical::<f64>(scale_factor);
    let Ok(window_size) = window.outer_size() else {
        return;
    };

    let work_area = monitor.work_area();
    let min_x = work_area.position.x as f64;
    let min_y = work_area.position.y as f64;
    let max_x = min_x + work_area.size.width as f64 - window_size.width as f64;
    let max_y = min_y + work_area.size.height as f64 - window_size.height as f64;

    let tray_center_x = tray_position.x + tray_size.width / 2.0;
    let desired_x = tray_center_x - window_size.width as f64 / 2.0;
    let desired_y = (tray_position.y + tray_size.height).max(min_y);

    let x = clamp_position(desired_x, min_x, max_x);
    let y = clamp_position(desired_y, min_y, max_y);

    let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

fn clamp_position(value: f64, min: f64, max: f64) -> f64 {
    if max <= min {
        min
    } else {
        value.clamp(min, max)
    }
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
    *watcher = Some(PortWatcher::spawn(config, move |result| {
        if let Ok(snapshot) = result {
            let snapshot = filter_snapshot(snapshot, &settings);
            update_tray(&app, snapshot.entries.len());
            let _ = app.emit(SNAPSHOT_EVENT, snapshot);
        }
    }));

    Ok(())
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
    serde_json::from_str(&contents)
        .map_err(|error| format!("failed to parse settings {}: {error}", path.display()))
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
