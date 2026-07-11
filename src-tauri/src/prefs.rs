use serde_json::{Map, Value};
use tauri::Manager;

// preferences.json in the app-data dir, mirroring the Electron app's
// userData/preferences.json. Holds the recent-files list and (Phase 3)
// the updater's skipped-version / remind-later / restore-after-update state.

fn prefs_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("preferences.json"))
}

pub fn read_prefs(app: &tauri::AppHandle) -> Map<String, Value> {
    prefs_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn write_prefs(app: &tauri::AppHandle, prefs: &Map<String, Value>) {
    let Some(path) = prefs_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(prefs) {
        let _ = std::fs::write(path, json);
    }
}
