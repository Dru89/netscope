use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, EventTarget, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HarFileData {
    file_path: String,
    content: String,
    file_name: String,
}

const CASCADE_OFFSET: f64 = 28.0;

struct AppState {
    // window label → resolved path of the file currently shown (for dedup)
    open_files: Mutex<HashMap<String, PathBuf>>,
    // files waiting to be fetched by the frontend on mount
    pending_files: Mutex<HashMap<String, HarFileData>>,
    // counter for generating unique labels beyond the initial "main" window
    window_counter: Mutex<u32>,
    // number of live windows (for quit-on-last-close on Linux/Windows)
    active_windows: Mutex<u32>,
    // label of the most-recently created window, used for cascade positioning
    last_created_label: Mutex<Option<String>>,
    // label of the most-recently focused window, used for routing "open" events
    last_focused_label: Mutex<Option<String>>,
    // label → logical-pixel position we explicitly assigned via builder.position();
    // outer_position() fails on Wayland so this map is our only reliable source
    // for the cascade chain — we only ever write to it from create_window, not
    // from OS events (Moved fires on Wayland too, but reflects the compositor's
    // placement decisions, not ours, which would corrupt the cascade chain)
    window_positions: Mutex<HashMap<String, (f64, f64)>>,
}

impl AppState {
    fn new(initial_count: u32) -> Self {
        Self {
            open_files: Mutex::new(HashMap::new()),
            pending_files: Mutex::new(HashMap::new()),
            window_counter: Mutex::new(0),
            active_windows: Mutex::new(initial_count),
            last_created_label: Mutex::new(Some("main".to_string())),
            last_focused_label: Mutex::new(Some("main".to_string())),
            window_positions: Mutex::new(HashMap::new()),
        }
    }

    fn next_label(&self) -> String {
        let mut n = self.window_counter.lock().unwrap();
        *n += 1;
        format!("window-{}", n)
    }

    fn find_window_for_file(&self, path: &PathBuf) -> Option<String> {
        self.open_files
            .lock()
            .unwrap()
            .iter()
            .find(|(_, p)| *p == path)
            .map(|(label, _)| label.clone())
    }
}

fn read_har_file(path: &str) -> Option<HarFileData> {
    let resolved = std::fs::canonicalize(path).ok()?;
    let content = std::fs::read_to_string(&resolved).ok()?;
    let file_name = resolved
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string();
    Some(HarFileData {
        file_path: resolved.to_string_lossy().to_string(),
        content,
        file_name,
    })
}

// Returns the position (in logical pixels) for the next cascaded window.
//
// Reference window is the focused window, matching Ghostty/Chrome behaviour:
// if you refocus an earlier window, the next new window cascades from that
// one rather than from the most-recently-created window.
//
// We read positions from window_positions — a map seeded from WindowEvent::Moved
// (actual compositor position) and from create_window (our requested position
// before Moved fires). On X11 outer_position() serves as a further fallback
// for "main", which we never explicitly positioned.
fn cascade_position(app: &tauri::AppHandle) -> Option<(f64, f64)> {
    let state = app.state::<AppState>();

    // Prefer the focused window; fall back to the most-recently-created one.
    let reference_label = {
        let focused = state.last_focused_label.lock().unwrap().clone();
        let created = state.last_created_label.lock().unwrap().clone();
        focused.or(created)?
    };

    if let Some(&(x, y)) = state.window_positions.lock().unwrap().get(&reference_label) {
        return Some((x + CASCADE_OFFSET, y + CASCADE_OFFSET));
    }

    // No tracked position yet (e.g. "main" on X11 before any Moved event).
    let reference = app.get_webview_window(&reference_label)?;
    let scale = reference.scale_factor().ok()?;
    let phys = reference.outer_position().ok()?;
    Some((
        phys.x as f64 / scale + CASCADE_OFFSET,
        phys.y as f64 / scale + CASCADE_OFFSET,
    ))
}

fn attach_window_handler(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let app_handle = app.clone();
        let label = label.to_string();
        window.on_window_event(move |event| {
            match event {
                WindowEvent::Focused(true) => {
                    *app_handle.state::<AppState>().last_focused_label.lock().unwrap() =
                        Some(label.clone());
                }
                WindowEvent::Moved(position) => {
                    // Update tracked position so the next cascade starts from where
                    // this window actually ended up — the compositor may ignore our
                    // position hint and place the window elsewhere, so we read back
                    // the actual position here. On Wayland this event does fire with
                    // real coordinates (compositor-relative), giving us a correct
                    // anchor for the next window.
                    if let Some(w) = app_handle.get_webview_window(&label) {
                        if let Ok(scale) = w.scale_factor() {
                            let x = position.x as f64 / scale;
                            let y = position.y as f64 / scale;
                            app_handle
                                .state::<AppState>()
                                .window_positions
                                .lock()
                                .unwrap()
                                .insert(label.clone(), (x, y));
                        }
                    }
                }
                WindowEvent::Destroyed => {
                    let state = app_handle.state::<AppState>();
                    state.open_files.lock().unwrap().remove(&label);
                    state.pending_files.lock().unwrap().remove(&label);
                    state.window_positions.lock().unwrap().remove(&label);
                    {
                        let mut last = state.last_created_label.lock().unwrap();
                        if last.as_deref() == Some(&label) {
                            *last = None;
                        }
                    }
                    {
                        let mut last = state.last_focused_label.lock().unwrap();
                        if last.as_deref() == Some(&label) {
                            *last = None;
                        }
                    }
                    let remaining = {
                        let mut count = state.active_windows.lock().unwrap();
                        *count = count.saturating_sub(1);
                        *count
                    };
                    #[cfg(not(target_os = "macos"))]
                    if remaining == 0 {
                        app_handle.exit(0);
                    }
                }
                _ => {}
            }
        });
    }
}

fn create_window(app: &tauri::AppHandle, file: Option<HarFileData>) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let label = state.next_label();

    if let Some(ref data) = file {
        state
            .pending_files
            .lock()
            .unwrap()
            .insert(label.clone(), data.clone());
        if let Ok(resolved) = std::fs::canonicalize(&data.file_path) {
            state
                .open_files
                .lock()
                .unwrap()
                .insert(label.clone(), resolved);
        }
    }

    *state.active_windows.lock().unwrap() += 1;

    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Netscope")
        .inner_size(1400.0, 900.0)
        .min_inner_size(900.0, 600.0);

    if let Some((x, y)) = cascade_position(app) {
        builder = builder.position(x, y);
        // Record the position we assigned so cascade_position can use it on the
        // next call — outer_position() is unreliable on Wayland, so this map is
        // the only reliable source of position for the cascade chain.
        state.window_positions.lock().unwrap().insert(label.clone(), (x, y));
    }

    builder.build()?;

    *state.last_created_label.lock().unwrap() = Some(label.clone());
    attach_window_handler(app, &label);

    Ok(())
}

// Called by each window's frontend on mount to get any pre-assigned file.
#[tauri::command]
fn get_window_file(window: tauri::WebviewWindow) -> Option<HarFileData> {
    window
        .app_handle()
        .state::<AppState>()
        .pending_files
        .lock()
        .unwrap()
        .remove(window.label())
}

// Called by the frontend after loading a file into the current window, so
// Rust can track it for dedup when another window tries to open the same file.
#[tauri::command]
fn register_open_file(window: tauri::WebviewWindow, file_path: String) {
    if let Ok(resolved) = std::fs::canonicalize(&file_path) {
        window
            .app_handle()
            .state::<AppState>()
            .open_files
            .lock()
            .unwrap()
            .insert(window.label().to_string(), resolved);
    }
}

// Open a file that the frontend has already read. Focuses the existing window
// if the file is already open; otherwise creates a new window for it.
#[tauri::command]
fn open_file_in_new_window(
    app: tauri::AppHandle,
    file_path: String,
    content: String,
    file_name: String,
) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    if let Ok(resolved) = std::fs::canonicalize(&file_path) {
        if let Some(label) = state.find_window_for_file(&resolved) {
            if let Some(window) = app.get_webview_window(&label) {
                return window.set_focus().map_err(Into::into);
            }
        }
    }
    create_window(&app, Some(HarFileData { file_path, content, file_name }))
}

#[tauri::command]
fn new_window(app: tauri::AppHandle) -> tauri::Result<()> {
    create_window(&app, None)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // On Linux/Windows, files opened via file association arrive as argv[1].
    // On macOS this comes through the AppDelegate openFile: path (Phase 2).
    let startup_file = std::env::args().nth(1).and_then(|p| read_har_file(&p));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_window_file,
            register_open_file,
            open_file_in_new_window,
            new_window,
        ])
        .setup(move |app| {
            // The initial "main" window is created by Tauri from tauri.conf.json.
            // We just need to wire up its state and close handler.
            let state = AppState::new(1);

            if let Some(ref data) = startup_file {
                state
                    .pending_files
                    .lock()
                    .unwrap()
                    .insert("main".to_string(), data.clone());
                if let Ok(resolved) = std::fs::canonicalize(&data.file_path) {
                    state
                        .open_files
                        .lock()
                        .unwrap()
                        .insert("main".to_string(), resolved);
                }
            }

            app.manage(state);

            // On X11, seed the cascade map with "main"'s actual position so
            // window-1 cascades cleanly from it. On Wayland outer_position()
            // fails, so we skip this — window-1 will get no position hint and
            // the compositor places it freely; WindowEvent::Moved then fires
            // with the real coordinates, seeding the chain from there.
            if let Some(main_pos) = app
                .get_webview_window("main")
                .and_then(|w| {
                    let scale = w.scale_factor().ok()?;
                    let phys = w.outer_position().ok()?;
                    Some((phys.x as f64 / scale, phys.y as f64 / scale))
                })
            {
                app.state::<AppState>()
                    .window_positions
                    .lock()
                    .unwrap()
                    .insert("main".to_string(), main_pos);
            }

            attach_window_handler(app.handle(), "main");

            // Build menu
            let new_window_item =
                MenuItem::with_id(app, "new_window", "New Window", true, Some("CmdOrCtrl+N"))?;
            let open_item =
                MenuItem::with_id(app, "open", "Open...", true, Some("CmdOrCtrl+O"))?;

            #[cfg(target_os = "macos")]
            let menu = {
                let app_name = app.package_info().name.clone();
                let app_menu = Submenu::with_items(
                    app,
                    &app_name,
                    true,
                    &[
                        &PredefinedMenuItem::about(app, None, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::services(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::hide(app, None)?,
                        &PredefinedMenuItem::hide_others(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::quit(app, None)?,
                    ],
                )?;
                let file_menu = Submenu::with_items(
                    app,
                    "File",
                    true,
                    &[
                        &new_window_item,
                        &open_item,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::close_window(app, None)?,
                    ],
                )?;
                Menu::with_items(app, &[&app_menu, &file_menu])?
            };

            #[cfg(not(target_os = "macos"))]
            let menu = {
                let close_item = MenuItem::with_id(
                    app,
                    "close_window",
                    "Close Window",
                    true,
                    Some("CmdOrCtrl+W"),
                )?;
                let quit_item =
                    MenuItem::with_id(app, "quit", "Quit", true, Some("CmdOrCtrl+Q"))?;
                let file_menu = Submenu::with_items(
                    app,
                    "File",
                    true,
                    &[
                        &new_window_item,
                        &open_item,
                        &PredefinedMenuItem::separator(app)?,
                        &close_item,
                        &PredefinedMenuItem::separator(app)?,
                        &quit_item,
                    ],
                )?;
                Menu::with_items(app, &[&file_menu])?
            };

            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                match event.id().0.as_str() {
                    "new_window" => {
                        let _ = create_window(app, None);
                    }
                    "open" => {
                        let label = app
                            .state::<AppState>()
                            .last_focused_label
                            .lock()
                            .unwrap()
                            .clone();
                        if let Some(label) = label {
                            let _ = app.emit_to(
                                EventTarget::WebviewWindow { label },
                                "request-open-file",
                                (),
                            );
                        }
                    }
                    "close_window" => {
                        let target = app
                            .webview_windows()
                            .into_values()
                            .find(|w| w.is_focused().unwrap_or(false));
                        if let Some(window) = target {
                            let _ = window.close();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                }
            });

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
