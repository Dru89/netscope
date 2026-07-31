use std::path::Path;

use tauri::{Emitter, EventTarget, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::har::{load_har_file, HarFileData};
use crate::state::AppState;

const CASCADE_OFFSET: f64 = 28.0;
// When a window is created to show a file it stays hidden until the renderer
// signals the HAR is parsed and painted; this is the safety net for very
// large files (matches the Electron shell).
const SHOW_TIMEOUT_MS: u64 = 800;

// har-file-opened carries its target label because emit_to(WebviewWindow)
// still broadcasts to every window (same Tauri quirk the Ctrl+O fix hit);
// the frontend ignores payloads addressed to other windows.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HarFileOpenedPayload {
    target_label: String,
    #[serde(flatten)]
    file: HarFileData,
}

// Returns the position (in logical pixels) for the next cascaded window.
//
// Reference window is the focused window, matching Ghostty/Chrome behaviour:
// if you refocus an earlier window, the next new window cascades from that
// one rather than from the most-recently-created window. (Deliberate
// divergence from the Electron shell, which anchored on most-recently-
// created; decision recorded in the handoff docs.)
//
// Positions come from window_positions — seeded from our own builder
// position hints and updated by WindowEvent::Moved with the compositor's
// actual placement. outer_position() works as a further fallback on X11 but
// fails on Wayland, which is why the map exists.
fn cascade_position(app: &tauri::AppHandle) -> Option<(f64, f64)> {
    let state = app.state::<AppState>();

    let reference_label = {
        let focused = state.last_focused_label.lock().unwrap().clone();
        let created = state.last_created_label.lock().unwrap().clone();
        focused.or(created)?
    };

    if let Some(&(x, y)) = state.window_positions.lock().unwrap().get(&reference_label) {
        return Some((x + CASCADE_OFFSET, y + CASCADE_OFFSET));
    }

    let reference = app.get_webview_window(&reference_label)?;
    let scale = reference.scale_factor().ok()?;
    let phys = reference.outer_position().ok()?;
    Some((
        phys.x as f64 / scale + CASCADE_OFFSET,
        phys.y as f64 / scale + CASCADE_OFFSET,
    ))
}

pub fn focused_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    app.webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
}

fn attach_window_handler(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let app_handle = app.clone();
        let label = label.to_string();
        window.on_window_event(move |event| {
            match event {
                WindowEvent::Focused(true) => {
                    *app_handle
                        .state::<AppState>()
                        .last_focused_label
                        .lock()
                        .unwrap() = Some(label.clone());
                }
                WindowEvent::Moved(position) => {
                    // Track where the window actually ended up — the
                    // compositor may ignore our position hint, and on
                    // Wayland this event is the only reliable source of
                    // coordinates for the next cascade anchor.
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
                    state.zoom_levels.lock().unwrap().remove(&label);
                    for last in [&state.last_created_label, &state.last_focused_label] {
                        let mut last = last.lock().unwrap();
                        if last.as_deref() == Some(&label) {
                            *last = None;
                        }
                    }
                    // No explicit quit-on-last-window here: Tauri exits by
                    // default when the last window closes; macOS prevents
                    // that in the RunEvent::ExitRequested handler.
                }
                _ => {}
            }
        });
    }
}

pub fn create_window(
    app: &tauri::AppHandle,
    file: Option<HarFileData>,
) -> tauri::Result<tauri::WebviewWindow> {
    let state = app.state::<AppState>();
    let label = state.next_label();

    let title = file
        .as_ref()
        .map(|f| f.file_name.clone())
        .unwrap_or_else(|| "Netscope".to_string());

    let resolved = file
        .as_ref()
        .and_then(|data| std::fs::canonicalize(&data.file_path).ok());

    if let Some(ref data) = file {
        state
            .pending_files
            .lock()
            .unwrap()
            .insert(label.clone(), data.clone());
        if let Some(ref resolved) = resolved {
            state
                .open_files
                .lock()
                .unwrap()
                .insert(label.clone(), resolved.clone());
        }
    }

    #[allow(unused_mut)]
    let mut builder =
        WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
            .title(&title)
            .inner_size(1400.0, 900.0)
            .min_inner_size(900.0, 600.0)
            // Hidden until the renderer signals ready (or the timeout below
            // fires) — no flash of the welcome screen before file content,
            // and no white flash before first paint in dark mode.
            .visible(false);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(16.0, 16.0));
    }

    if let Some((x, y)) = cascade_position(app) {
        builder = builder.position(x, y);
        // Record the position we assigned so cascade_position can use it
        // before the first Moved event arrives.
        state
            .window_positions
            .lock()
            .unwrap()
            .insert(label.clone(), (x, y));
    }

    let window = builder.build()?;

    *state.last_created_label.lock().unwrap() = Some(label.clone());
    attach_window_handler(app, &label);

    if let Some(resolved) = resolved {
        note_file_open(app, &window, &resolved);
    }

    // Safety net: show the window even if the renderer never signals ready.
    {
        let app = app.clone();
        let label = label.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(SHOW_TIMEOUT_MS));
            if let Some(w) = app.get_webview_window(&label) {
                if !w.is_visible().unwrap_or(true) {
                    let _ = w.show();
                }
            }
        });
    }

    Ok(window)
}

// Record that a window now displays a file: dedup registry, title,
// macOS proxy icon, and the recent-files list. Every open path funnels
// through here (creation with a file, dialog loads, drops, OS opens).
pub fn note_file_open(app: &tauri::AppHandle, window: &tauri::WebviewWindow, resolved: &Path) {
    app.state::<AppState>()
        .open_files
        .lock()
        .unwrap()
        .insert(window.label().to_string(), resolved.to_path_buf());

    if let Some(name) = resolved.file_name().and_then(|n| n.to_str()) {
        let _ = window.set_title(name);
    }

    #[cfg(target_os = "macos")]
    set_represented_file(app, window.label(), resolved);

    crate::recent::add(app, resolved);
}

// macOS: represented filename / proxy icon on the title bar.
#[cfg(target_os = "macos")]
fn set_represented_file(app: &tauri::AppHandle, label: &str, path: &Path) {
    let app = app.clone();
    let label = label.to_string();
    let path = path.to_string_lossy().to_string();
    let _ = app.clone().run_on_main_thread(move || {
        use objc2_app_kit::NSWindow;
        use objc2_foundation::NSString;
        let Some(window) = app.get_webview_window(&label) else {
            return;
        };
        let Ok(ns_ptr) = window.ns_window() else { return };
        let ns_window = unsafe { &*(ns_ptr as *const NSWindow) };
        ns_window.setRepresentedFilename(&NSString::from_str(&path));
    });
}

// File > Open, and the Open buttons in the UI.
//
// The picker is opened from here rather than from a webview, which means it
// needs no window at all. That matters on macOS, where closing every window
// leaves the app running: the JS dialog API can only be called from inside a
// webview, so routing Cmd+O through the frontend meant a window had to be
// restored or created purely to host the call. Cancelling now leaves nothing
// behind, and an existing minimized window stays minimized.
//
// The chosen files then take the same route as a Finder double-click, so the
// dedup / welcome-reuse / new-window rules live in exactly one place.
pub fn pick_and_open_files(app: &tauri::AppHandle) {
    let app = app.clone();
    app.dialog()
        .file()
        .add_filter("HAR Files", &["har"])
        .add_filter("All Files", &["*"])
        .pick_files(move |selection| {
            // None means cancelled — deliberately no window, no error.
            let Some(selection) = selection else { return };
            let paths: Vec<String> = selection
                .into_iter()
                .filter_map(|p| p.into_path().ok())
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            let Some((first, rest)) = paths.split_first() else {
                return;
            };

            // The picker delivers its result on a worker thread, and windows
            // can only be built on the main one.
            let first = first.clone();
            let rest = rest.to_vec();
            let _ = app.clone().run_on_main_thread(move || {
                open_file_from_path(&app, &first);
                if !rest.is_empty() {
                    open_paths_in_new_windows(&app, &rest);
                }
            });
        });
}

// The unified entry point for OS-driven opens (file association, dock drop,
// Open Recent, second launch, CLI): dedup → welcome-window reuse → new
// window, with a native warning if the file is gone.
pub fn open_file_from_path(app: &tauri::AppHandle, path: &str) {
    let resolved = match std::fs::canonicalize(path) {
        Ok(p) => p,
        Err(_) => {
            show_open_error(app, Path::new(path), true);
            crate::recent::remove(app, Path::new(path));
            return;
        }
    };

    // Already open somewhere → just focus that window
    let state = app.state::<AppState>();
    if let Some(label) = state.find_window_for_file(&resolved) {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.set_focus();
            return;
        }
    }

    // Reuse an empty welcome window rather than leaving one behind
    if let Some(window) = reusable_welcome_window(app) {
        send_file_to_window(app, &window, &resolved);
        let _ = window.set_focus();
        return;
    }

    match load_har_file(&resolved) {
        Some(data) => {
            let _ = create_window(app, Some(data));
        }
        None => show_open_error(app, &resolved, false),
    }
}

// Open each path in its own window (dedup applies, welcome reuse does not).
// Used for the extra files of a multi-select in the Open dialog — the first
// selection is already claiming the calling window, so reusing another
// welcome window here would be surprising.
pub fn open_paths_in_new_windows(app: &tauri::AppHandle, paths: &[String]) {
    let state = app.state::<AppState>();
    for path in paths {
        let resolved = match std::fs::canonicalize(path) {
            Ok(p) => p,
            Err(_) => {
                show_open_error(app, Path::new(path), true);
                continue;
            }
        };
        if let Some(label) = state.find_window_for_file(&resolved) {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.set_focus();
                continue;
            }
        }
        match load_har_file(&resolved) {
            Some(data) => {
                let _ = create_window(app, Some(data));
            }
            None => show_open_error(app, &resolved, false),
        }
    }
}

// Which empty window may be taken over for an OS-driven open?
// - The focused window, if it's an empty welcome screen (the rule from the
//   Electron shell: an unfocused welcome window is never silently replaced).
// - When nothing is focused (launch-by-double-click, app in background):
//   the sole window, if it's empty. Electron reached the same launch
//   behavior through its pendingFile mechanism; here the first window
//   already exists by the time macOS delivers the open event.
fn reusable_welcome_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    let state = app.state::<AppState>();
    let is_empty = |label: &str| {
        !state.open_files.lock().unwrap().contains_key(label)
            && !state.pending_files.lock().unwrap().contains_key(label)
    };

    let windows = app.webview_windows();
    if let Some(focused) = windows.values().find(|w| w.is_focused().unwrap_or(false)) {
        if is_empty(focused.label()) {
            return Some(focused.clone());
        }
        return None;
    }
    if windows.len() == 1 {
        let only = windows.values().next().unwrap();
        if is_empty(only.label()) {
            return Some(only.clone());
        }
    }
    None
}

// Load a file into an existing (welcome) window. The file is both stashed as
// pending and emitted: at launch the renderer may not have registered its
// listener yet and picks the file up on mount instead; once mounted, the
// event wins and the pending entry is consumed by get_window_file. Whichever
// path delivers it, open_files is what a later reload reads back.
pub fn send_file_to_window(app: &tauri::AppHandle, window: &tauri::WebviewWindow, resolved: &Path) {
    match load_har_file(resolved) {
        Some(data) => {
            note_file_open(app, window, resolved);
            app.state::<AppState>()
                .pending_files
                .lock()
                .unwrap()
                .insert(window.label().to_string(), data.clone());
            let _ = app.emit_to(
                EventTarget::WebviewWindow {
                    label: window.label().to_string(),
                },
                "har-file-opened",
                HarFileOpenedPayload {
                    target_label: window.label().to_string(),
                    file: data,
                },
            );
        }
        None => show_open_error(app, resolved, false),
    }
}

pub fn show_open_error(app: &tauri::AppHandle, path: &Path, not_found: bool) {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("(unknown)");
    let detail = if not_found {
        format!("The file \"{name}\" could not be found. It may have been moved or deleted.")
    } else {
        format!("The file \"{name}\" could not be opened.")
    };
    let mut dialog = app
        .dialog()
        .message(detail)
        .title("Unable to open file")
        .kind(MessageDialogKind::Warning);
    if let Some(window) = focused_window(app) {
        dialog = dialog.parent(&window);
    }
    dialog.show(|_| {});
}

