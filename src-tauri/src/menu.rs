#[cfg(target_os = "macos")]
use tauri::menu::AboutMetadata;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, EventTarget, Manager, Wry};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::state::AppState;

const WEBSITE_URL: &str = "https://netscopeapp.com";
const ISSUES_URL: &str = "https://github.com/Dru89/netscope/issues";
const COPYRIGHT: &str = "Copyright © 2026 Drew Hays";

const ZOOM_STEP: f64 = 0.1;
const ZOOM_MIN: f64 = 0.3;
const ZOOM_MAX: f64 = 3.0;

pub fn rebuild(app: &tauri::AppHandle) {
    match build(app) {
        Ok(menu) => {
            let _ = app.set_menu(menu);
        }
        Err(err) => log::error!("failed to rebuild menu: {err}"),
    }
}

pub fn build(app: &tauri::AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;

    // ---- macOS app menu ----
    #[cfg(target_os = "macos")]
    {
        let about = PredefinedMenuItem::about(
            app,
            Some("About Netscope"),
            Some(AboutMetadata {
                name: Some("Netscope".to_string()),
                version: Some(app.package_info().version.to_string()),
                copyright: Some(COPYRIGHT.to_string()),
                ..Default::default()
            }),
        )?;
        let app_menu = Submenu::with_items(
            app,
            "Netscope",
            true,
            &[
                &about,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;
        menu.append(&app_menu)?;
    }

    // ---- File ----
    let file_menu = Submenu::new(app, "File", true)?;
    file_menu.append(&MenuItem::with_id(
        app,
        "new_window",
        "New Window",
        true,
        Some("CmdOrCtrl+N"),
    )?)?;
    file_menu.append(&MenuItem::with_id(
        app,
        "open",
        "Open HAR File...",
        true,
        Some("CmdOrCtrl+O"),
    )?)?;

    // Open Recent — rebuilt whenever the recent list changes
    let recent = crate::recent::list(app);
    let open_recent = Submenu::new(app, "Open Recent", true)?;
    for (index, path) in recent.iter().enumerate() {
        let name = std::path::Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(path);
        open_recent.append(&MenuItem::with_id(
            app,
            format!("recent:{index}"),
            name,
            true,
            None::<&str>,
        )?)?;
    }
    if !recent.is_empty() {
        open_recent.append(&PredefinedMenuItem::separator(app)?)?;
    }
    open_recent.append(&MenuItem::with_id(
        app,
        "clear_recent",
        "Clear Menu",
        !recent.is_empty(),
        None::<&str>,
    )?)?;
    file_menu.append(&open_recent)?;

    file_menu.append(&PredefinedMenuItem::separator(app)?)?;
    #[cfg(target_os = "macos")]
    file_menu.append(&PredefinedMenuItem::close_window(app, None)?)?;
    #[cfg(not(target_os = "macos"))]
    {
        file_menu.append(&MenuItem::with_id(
            app,
            "close_window",
            "Close Window",
            true,
            Some("CmdOrCtrl+W"),
        )?)?;
        file_menu.append(&PredefinedMenuItem::separator(app)?)?;
        file_menu.append(&MenuItem::with_id(
            app,
            "quit",
            "Quit",
            true,
            Some("CmdOrCtrl+Q"),
        )?)?;
    }
    menu.append(&file_menu)?;

    // ---- Edit ----
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    menu.append(&edit_menu)?;

    // ---- View ----
    let view_menu = Submenu::new(app, "View", true)?;
    view_menu.append(&MenuItem::with_id(
        app,
        "reload",
        "Reload",
        true,
        Some("CmdOrCtrl+R"),
    )?)?;
    view_menu.append(&MenuItem::with_id(
        app,
        "toggle_devtools",
        "Toggle Developer Tools",
        true,
        Some("CmdOrCtrl+Alt+I"),
    )?)?;
    view_menu.append(&PredefinedMenuItem::separator(app)?)?;
    view_menu.append(&MenuItem::with_id(
        app,
        "actual_size",
        "Actual Size",
        true,
        Some("CmdOrCtrl+0"),
    )?)?;
    view_menu.append(&MenuItem::with_id(
        app,
        "zoom_in",
        "Zoom In",
        true,
        Some("CmdOrCtrl+="),
    )?)?;
    view_menu.append(&MenuItem::with_id(
        app,
        "zoom_out",
        "Zoom Out",
        true,
        Some("CmdOrCtrl+-"),
    )?)?;
    view_menu.append(&PredefinedMenuItem::separator(app)?)?;
    #[cfg(target_os = "macos")]
    view_menu.append(&PredefinedMenuItem::fullscreen(app, None)?)?;
    #[cfg(not(target_os = "macos"))]
    view_menu.append(&MenuItem::with_id(
        app,
        "fullscreen",
        "Toggle Full Screen",
        true,
        Some("F11"),
    )?)?;
    menu.append(&view_menu)?;

    // ---- Window ----
    let window_menu = Submenu::new(app, "Window", true)?;
    window_menu.append(&PredefinedMenuItem::minimize(app, None)?)?;
    window_menu.append(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)?;
    #[cfg(target_os = "macos")]
    {
        window_menu.append(&PredefinedMenuItem::separator(app)?)?;
        window_menu.append(&PredefinedMenuItem::bring_all_to_front(app, None)?)?;
        window_menu.set_as_windows_menu_for_nsapp()?;
    }
    menu.append(&window_menu)?;

    // ---- Help ----
    let help_menu = Submenu::new(app, "Help", true)?;
    help_menu.append(&MenuItem::with_id(
        app,
        "help_website",
        "Netscope Website",
        true,
        None::<&str>,
    )?)?;
    help_menu.append(&MenuItem::with_id(
        app,
        "help_report_issue",
        "Report an Issue",
        true,
        None::<&str>,
    )?)?;
    #[cfg(not(target_os = "macos"))]
    {
        help_menu.append(&PredefinedMenuItem::separator(app)?)?;
        help_menu.append(&MenuItem::with_id(
            app,
            "about",
            "About Netscope",
            true,
            None::<&str>,
        )?)?;
    }
    #[cfg(target_os = "macos")]
    help_menu.set_as_help_menu_for_nsapp()?;
    menu.append(&help_menu)?;

    Ok(menu)
}

pub fn handle_event(app: &tauri::AppHandle, event: MenuEvent) {
    let id = event.id().0.as_str();
    if crate::context_menu::handle_event(app, id) {
        return;
    }
    match id {
        "new_window" => {
            let _ = crate::windows::create_window(app, None);
        }
        "open" => {
            // Route to the focused window's frontend, which owns the dialog
            // and the load-in-place vs. new-window decision.
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
            if let Some(window) = crate::windows::focused_window(app) {
                let _ = window.close();
            }
        }
        "quit" => app.exit(0),
        "reload" => {
            if let Some(window) = crate::windows::focused_window(app) {
                let _ = window.reload();
            }
        }
        "toggle_devtools" => {
            if let Some(window) = crate::windows::focused_window(app) {
                if window.is_devtools_open() {
                    window.close_devtools();
                } else {
                    window.open_devtools();
                }
            }
        }
        "actual_size" | "zoom_in" | "zoom_out" => {
            if let Some(window) = crate::windows::focused_window(app) {
                let state = app.state::<AppState>();
                let mut levels = state.zoom_levels.lock().unwrap();
                let current = levels.get(window.label()).copied().unwrap_or(1.0);
                let next = match id {
                    "zoom_in" => (current + ZOOM_STEP).min(ZOOM_MAX),
                    "zoom_out" => (current - ZOOM_STEP).max(ZOOM_MIN),
                    _ => 1.0,
                };
                levels.insert(window.label().to_string(), next);
                drop(levels);
                let _ = window.set_zoom(next);
            }
        }
        "fullscreen" => {
            if let Some(window) = crate::windows::focused_window(app) {
                let full = window.is_fullscreen().unwrap_or(false);
                let _ = window.set_fullscreen(!full);
            }
        }
        "clear_recent" => crate::recent::clear(app),
        "help_website" => {
            let _ = app.opener().open_url(WEBSITE_URL, None::<&str>);
        }
        "help_report_issue" => {
            let _ = app.opener().open_url(ISSUES_URL, None::<&str>);
        }
        "about" => {
            let version = app.package_info().version.to_string();
            app.dialog()
                .message(format!("Version {version}\n\n{COPYRIGHT}"))
                .title("About Netscope")
                .show(|_| {});
        }
        id if id.starts_with("recent:") => {
            let path = id
                .strip_prefix("recent:")
                .and_then(|idx| idx.parse::<usize>().ok())
                .and_then(|idx| crate::recent::list(app).get(idx).cloned());
            if let Some(path) = path {
                crate::windows::open_file_from_path(app, &path);
            }
        }
        _ => {}
    }
}
