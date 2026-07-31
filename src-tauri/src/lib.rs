mod context_menu;
mod har;
mod menu;
mod prefs;
mod recent;
mod state;
mod update;
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

// Called by each window's frontend on mount to get the file it should show.
//
// Two cases, in order:
//  1. A file pre-assigned before this window's first mount (create_window or
//     send_file_to_window). Consumed here so the content isn't retained for
//     the window's whole life.
//  2. A remount of a window that already had a file — i.e. a webview reload
//     (View > Reload). The pending entry is long gone, so re-read the file
//     that open_files says this window is showing. Without this the window
//     would fall back to the welcome screen while its title, proxy icon and
//     dedup entry all still claimed the file, stranding it.
#[tauri::command]
fn get_window_file(window: tauri::WebviewWindow) -> Option<HarFileData> {
    let app = window.app_handle();
    let state = app.state::<AppState>();

    if let Some(data) = state.pending_files.lock().unwrap().remove(window.label()) {
        return Some(data);
    }

    let path = state
        .open_files
        .lock()
        .unwrap()
        .get(window.label())
        .cloned()?;
    load_har_file(path)
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
                return window.set_focus();
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

// Pop the native request-row context menu. Only the URL and sort state cross
// the IPC boundary; the entry data stays in the webview, which performs the
// copy actions when the menu round-trips back (see context_menu module).
#[tauri::command]
fn show_request_context_menu(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    url: String,
    sort_field: String,
    sort_direction: String,
) -> tauri::Result<()> {
    context_menu::show(&app, &window, url, sort_field, sort_direction)
}

// Clipboard writes go through Rust so the webview needs no clipboard
// permission or plugin JS bindings.
#[tauri::command]
fn set_clipboard(app: tauri::AppHandle, text: String) {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let _ = app.clipboard().write_text(text);
}

// Write a response body to a path the user picked in the save dialog
// (Response tab → Save As…). base64 marks binary bodies (e.g. images).
#[tauri::command]
fn save_file(path: String, contents: String, base64: bool) -> Result<(), String> {
    let bytes = if base64 {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(contents.trim())
            .map_err(|e| e.to_string())?
    } else {
        contents.into_bytes()
    };
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
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
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            read_har_file,
            get_window_file,
            register_open_file,
            open_file_in_new_window,
            open_paths_in_new_windows,
            new_window,
            signal_ready,
            show_request_context_menu,
            set_clipboard,
            save_file,
        ])
        .setup(move |app| {
            app.manage(AppState::new());
            recent::load(app.handle());

            app.set_menu(menu::build(app.handle())?)?;
            app.on_menu_event(menu::handle_event);

            // Files saved before an update-triggered restart come back once.
            // A file passed by the OS takes the first window; restored files
            // then open in their own windows.
            let mut restore: Vec<String> = update::take_restore_state(app.handle())
                .into_iter()
                .filter(|p| std::path::Path::new(p).exists())
                .collect();
            let mut first_file = startup_file.clone();
            if first_file.is_none() && !restore.is_empty() {
                first_file = Some(restore.remove(0));
            }

            // All windows are created from Rust (none in tauri.conf.json) so
            // every window — including the first — gets the same cascade,
            // chrome, and hidden-until-ready treatment.
            let file = first_file.as_deref().and_then(load_har_file);
            windows::create_window(app.handle(), file)?;
            if !restore.is_empty() {
                windows::open_paths_in_new_windows(app.handle(), &restore);
            }

            update::check_for_updates(app.handle());

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
