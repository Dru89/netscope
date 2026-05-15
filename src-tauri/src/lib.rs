use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HarFileData {
    file_path: String,
    content: String,
    file_name: String,
}

struct StartupState {
    file: Mutex<Option<HarFileData>>,
}

#[tauri::command]
fn get_startup_file(state: tauri::State<'_, StartupState>) -> Option<HarFileData> {
    state.file.lock().unwrap().take()
}

fn read_har_file(path: &str) -> Option<HarFileData> {
    let content = std::fs::read_to_string(path).ok()?;
    let file_name = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string();
    Some(HarFileData {
        file_path: path.to_string(),
        content,
        file_name,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // On Linux/Windows, files opened via file association arrive as argv[1].
    // On macOS this comes through the AppDelegate openFile: path (Phase 2).
    let startup_file = std::env::args().nth(1).and_then(|p| read_har_file(&p));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![get_startup_file])
        .setup(move |app| {
            app.manage(StartupState {
                file: Mutex::new(startup_file),
            });

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
                let file_menu = Submenu::with_items(app, "File", true, &[&open_item])?;
                Menu::with_items(app, &[&app_menu, &file_menu])?
            };

            #[cfg(not(target_os = "macos"))]
            let menu = {
                let quit_item =
                    MenuItem::with_id(app, "quit", "Quit", true, Some("CmdOrCtrl+Q"))?;
                let file_menu = Submenu::with_items(
                    app,
                    "File",
                    true,
                    &[
                        &open_item,
                        &PredefinedMenuItem::separator(app)?,
                        &quit_item,
                    ],
                )?;
                Menu::with_items(app, &[&file_menu])?
            };

            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                match event.id().0.as_str() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("request-open-file", ());
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
