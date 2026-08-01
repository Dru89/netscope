use std::path::Path;

use tauri::Manager;

use crate::prefs;
use crate::state::AppState;

const MAX_RECENT_DOCUMENTS: usize = 10;
const PREFS_KEY: &str = "recentDocuments";

// The in-app Open Recent list. Unlike Electron's (which was in-memory only
// and started empty every launch), this persists across launches via
// preferences.json. It is also mirrored to the OS recent-documents list
// (macOS dock menu, Windows jump list, Linux GTK recent files).

pub fn load(app: &tauri::AppHandle) {
    let paths: Vec<String> = prefs::read_prefs(app)
        .get(PREFS_KEY)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .take(MAX_RECENT_DOCUMENTS)
                .collect()
        })
        .unwrap_or_default();
    *app.state::<AppState>().recent_files.lock().unwrap() = paths;
}

pub fn list(app: &tauri::AppHandle) -> Vec<String> {
    app.state::<AppState>().recent_files.lock().unwrap().clone()
}

pub fn add(app: &tauri::AppHandle, path: &Path) {
    let path_str = path.to_string_lossy().to_string();
    {
        let state = app.state::<AppState>();
        let mut recent = state.recent_files.lock().unwrap();
        recent.retain(|p| *p != path_str);
        recent.insert(0, path_str);
        recent.truncate(MAX_RECENT_DOCUMENTS);
    }
    persist(app);
    os_note_recent(app, path);
    crate::menu::rebuild(app);
}

// Called when a recent entry turns out to be missing on disk.
pub fn remove(app: &tauri::AppHandle, path: &Path) {
    let path_str = path.to_string_lossy().to_string();
    {
        let state = app.state::<AppState>();
        let mut recent = state.recent_files.lock().unwrap();
        recent.retain(|p| *p != path_str);
    }
    persist(app);
    crate::menu::rebuild(app);
}

pub fn clear(app: &tauri::AppHandle) {
    let previous: Vec<String> = {
        let state = app.state::<AppState>();
        let mut recent = state.recent_files.lock().unwrap();
        std::mem::take(&mut *recent)
    };
    persist(app);
    os_clear_recent(app, &previous);
    crate::menu::rebuild(app);
}

fn persist(app: &tauri::AppHandle) {
    let recent = list(app);
    let mut prefs = prefs::read_prefs(app);
    prefs.insert(
        PREFS_KEY.to_string(),
        serde_json::Value::Array(recent.into_iter().map(serde_json::Value::String).collect()),
    );
    prefs::write_prefs(app, &prefs);
}

// ---- OS recent-documents integration ----
// AppKit and GTK both require the main thread, so each implementation hops
// there via run_on_main_thread.

#[cfg(target_os = "macos")]
fn os_note_recent(app: &tauri::AppHandle, path: &Path) {
    let path = path.to_string_lossy().to_string();
    let _ = app.run_on_main_thread(move || {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSDocumentController;
        use objc2_foundation::{NSString, NSURL};
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path));
        NSDocumentController::sharedDocumentController(mtm).noteNewRecentDocumentURL(&url);
    });
}

#[cfg(target_os = "macos")]
fn os_clear_recent(app: &tauri::AppHandle, _previous: &[String]) {
    let _ = app.run_on_main_thread(move || {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSDocumentController;
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        unsafe {
            NSDocumentController::sharedDocumentController(mtm).clearRecentDocuments(None);
        }
    });
}

#[cfg(target_os = "linux")]
fn os_note_recent(app: &tauri::AppHandle, path: &Path) {
    let path = path.to_path_buf();
    let _ = app.run_on_main_thread(move || {
        if let Ok(uri) = gtk::glib::filename_to_uri(&path, None) {
            if let Some(manager) = gtk::RecentManager::default() {
                gtk::prelude::RecentManagerExt::add_item(&manager, &uri);
            }
        }
    });
}

#[cfg(target_os = "linux")]
fn os_clear_recent(app: &tauri::AppHandle, previous: &[String]) {
    // GTK's purge would wipe other apps' entries too, so remove only ours.
    let previous: Vec<std::path::PathBuf> = previous.iter().map(std::path::PathBuf::from).collect();
    let _ = app.run_on_main_thread(move || {
        let Some(manager) = gtk::RecentManager::default() else {
            return;
        };
        for path in &previous {
            if let Ok(uri) = gtk::glib::filename_to_uri(path, None) {
                let _ = gtk::prelude::RecentManagerExt::remove_item(&manager, &uri);
            }
        }
    });
}

#[cfg(windows)]
fn os_note_recent(_app: &tauri::AppHandle, path: &Path) {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        windows::Win32::UI::Shell::SHAddToRecentDocs(
            windows::Win32::UI::Shell::SHARD_PATHW.0 as u32,
            Some(wide.as_ptr() as *const core::ffi::c_void),
        );
    }
}

#[cfg(windows)]
fn os_clear_recent(_app: &tauri::AppHandle, _previous: &[String]) {
    // Deliberately a no-op: clearing our in-app list must not touch the OS
    // list. SHAddToRecentDocs with a null pointer clears recent-document
    // usage data for *every* application, not just ours — the same trap the
    // Linux branch above avoids by removing individual entries. The Win32
    // API for "remove only this app's entries" is
    // IApplicationDestinations::RemoveAllDestinations, which needs COM setup
    // and a Windows machine to verify; until then the jump list keeps its
    // entries after Clear Menu, which is a far smaller wrong than wiping the
    // user's system-wide recent items.
}
