mod har;
mod menu;
mod prefs;
mod recent;
mod state;
mod windows;

use har::{load_har_file, HarFileData};
use state::AppState;
use tauri::Manager;

// Read a HAR file for the frontend. This deliberately bypasses the fs-plugin
// scope: drops, recent files, and CLI args hand the app arbitrary paths, and
// a local file viewer must be able to read whatever the OS gives it.
#[tauri::command]
fn read_har_file(path: String) -> Option<HarFileData> {
    load_har_file(&path)
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

// Called by the frontend after loading a file into the current window
// (dialog load-in-place, drag-and-drop): registers for dedup, sets the
// title / macOS proxy icon, and updates the recent-files list.
#[tauri::command]
fn register_open_file(window: tauri::WebviewWindow, file_path: String) {
    if let Ok(resolved) = std::fs::canonicalize(&file_path) {
        windows::note_file_open(window.app_handle(), &window, &resolved);
    }
}

// Open a file that the frontend has already read. Focuses the existing
// window if the file is already open; otherwise creates a new window for it.
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
    windows::create_window(
        &app,
        Some(HarFileData {
            file_path,
            content,
            file_name,
        }),
    )
    .map(|_| ())
}

// Open the extra files of a multi-select (first one loads into the calling
// window via the normal dialog return).
#[tauri::command]
fn open_paths_in_new_windows(app: tauri::AppHandle, paths: Vec<String>) {
    windows::open_paths_in_new_windows(&app, &paths);
}

#[tauri::command]
fn new_window(app: tauri::AppHandle) -> tauri::Result<()> {
    windows::create_window(&app, None).map(|_| ())
}

// The renderer signals that its content is parsed and painted; windows are
// created hidden and shown here so opening a file never flashes the welcome
// screen (an 800ms timeout in create_window is the safety net).
#[tauri::command]
fn signal_ready(window: tauri::WebviewWindow) {
    if !window.is_visible().unwrap_or(true) {
        let _ = window.show();
    }
}

fn find_har_arg(args: impl Iterator<Item = String>) -> Option<String> {
    args.skip(1)
        .find(|arg| arg.ends_with(".har") && std::path::Path::new(arg).exists())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK's DMA-BUF renderer crashes at startup on the NVIDIA
    // proprietary driver under Wayland ("Error 71 (Protocol error)
    // dispatching to Wayland display", reproduced on KDE Plasma + RTX 4080).
    // Disable it only there, and never override the user's own setting.
    #[cfg(target_os = "linux")]
    if std::path::Path::new("/proc/driver/nvidia").exists()
        && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    // Files opened via file association arrive as argv on Linux/Windows.
    // On macOS they arrive through RunEvent::Opened instead.
    let startup_file = find_har_arg(std::env::args());

    tauri::Builder::default()
        // Must be the first plugin: a second launch (e.g. double-clicking
        // another .har on Windows/Linux) hands its argv to this process and
        // exits, so dedup / welcome-reuse / cascade work across launches.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            match find_har_arg(argv.into_iter()) {
                Some(path) => windows::open_file_from_path(app, &path),
                None => {
                    let _ = windows::create_window(app, None);
                }
            }
            // Bring the app to the front, like Electron's second-instance
            // handler did.
            let front = windows::focused_window(app)
                .or_else(|| app.webview_windows().into_values().next());
            if let Some(window) = front {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_har_file,
            get_window_file,
            register_open_file,
            open_file_in_new_window,
            open_paths_in_new_windows,
            new_window,
            signal_ready,
        ])
        .setup(move |app| {
            app.manage(AppState::new());
            recent::load(app.handle());

            app.set_menu(menu::build(app.handle())?)?;
            app.on_menu_event(menu::handle_event);

            // All windows are created from Rust (none in tauri.conf.json) so
            // every window — including the first — gets the same cascade,
            // chrome, and hidden-until-ready treatment.
            let file = startup_file.as_deref().and_then(load_har_file);
            windows::create_window(app.handle(), file)?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            match _event {
                // Finder double-click, dock drop, `open --args` — macOS
                // delivers documents here rather than via argv.
                tauri::RunEvent::Opened { urls } => {
                    for url in urls {
                        if let Ok(path) = url.to_file_path() {
                            windows::open_file_from_path(_app, &path.to_string_lossy());
                        }
                    }
                }
                // Dock icon clicked with no windows open → new welcome
                // window (Electron's `activate` behavior).
                tauri::RunEvent::Reopen {
                    has_visible_windows,
                    ..
                } => {
                    if !has_visible_windows {
                        let _ = windows::create_window(_app, None);
                    }
                }
                // A macOS document app stays running when its last window
                // closes; Windows/Linux take Tauri's default exit.
                tauri::RunEvent::ExitRequested { code: None, api, .. } => {
                    api.prevent_exit();
                }
                _ => {}
            }
        });
}
