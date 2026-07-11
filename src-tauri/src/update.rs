use serde_json::Value;
use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::Manager;
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};
use tauri_plugin_updater::UpdaterExt;

use crate::prefs;
use crate::state::AppState;

// The prompted update flow, ported from the Electron shell:
// - Ask before downloading: Install Update / Remind Me Later / Skip This
//   Version. "Remind Me Later" is remembered for the rest of the UTC
//   calendar day; "Skip This Version" until a newer version appears. Both
//   live in preferences.json.
// - Download progress is shown on the dock/taskbar; failures get a dialog.
// - After download: Restart Now / Later, with the About panel showing the
//   pending version until restart.
// - Open files are saved before the restart and reopened once afterwards.

const KEY_SKIPPED: &str = "skippedUpdateVersion";
const KEY_REMIND: &str = "remindLaterDate";
const KEY_RESTORE: &str = "restoreAfterUpdate";

const BTN_INSTALL: &str = "Install Update";
const BTN_REMIND: &str = "Remind Me Later";
const BTN_SKIP: &str = "Skip This Version";
const BTN_RESTART: &str = "Restart Now";
const BTN_LATER: &str = "Later";

// A downloaded update waiting for the user to restart (kept so the About
// panel's "Restart Now" can install it without re-downloading).
pub struct PendingUpdate {
    pub version: String,
    update: tauri_plugin_updater::Update,
    bytes: Vec<u8>,
}

pub fn check_for_updates(app: &tauri::AppHandle) {
    // Dev builds have no update artifacts to compare against.
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // build() fails on installs with no update support (e.g. Linux
        // deb/pacman — those update through the package manager), and
        // check() fails without a network. Both stay silent, like the
        // Electron shell's pre-prompt phase did.
        let Ok(updater) = app.updater_builder().build() else {
            return;
        };
        if let Ok(Some(update)) = updater.check().await {
            prompt_for_update(app.clone(), update);
        }
    });
}

fn prompt_for_update(app: tauri::AppHandle, update: tauri_plugin_updater::Update) {
    let preferences = prefs::read_prefs(&app);
    if preferences.get(KEY_SKIPPED).and_then(Value::as_str) == Some(update.version.as_str()) {
        return;
    }
    if let Some(date) = preferences.get(KEY_REMIND).and_then(Value::as_str) {
        if date == today_utc() {
            return;
        }
    }

    let version = update.version.clone();
    let mut dialog = app
        .dialog()
        .message(format!(
            "A new version of Netscope ({version}) is available. \
             Would you like to download and install it?"
        ))
        .title("Update Available")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            BTN_INSTALL.to_string(),
            BTN_REMIND.to_string(),
            BTN_SKIP.to_string(),
        ));
    if let Some(window) = crate::windows::focused_window(&app) {
        dialog = dialog.parent(&window);
    }
    dialog.show_with_result(move |result| {
        let MessageDialogResult::Custom(choice) = result else {
            return;
        };
        match choice.as_str() {
            BTN_INSTALL => start_download(app, update),
            BTN_REMIND => {
                let mut preferences = prefs::read_prefs(&app);
                preferences.insert(KEY_REMIND.into(), Value::String(today_utc()));
                prefs::write_prefs(&app, &preferences);
            }
            BTN_SKIP => {
                let mut preferences = prefs::read_prefs(&app);
                preferences.insert(
                    KEY_SKIPPED.into(),
                    Value::String(update.version.clone()),
                );
                // Mutually exclusive with remind-later, as in Electron
                preferences.remove(KEY_REMIND);
                prefs::write_prefs(&app, &preferences);
            }
            _ => {}
        }
    });
}

fn start_download(app: tauri::AppHandle, update: tauri_plugin_updater::Update) {
    tauri::async_runtime::spawn(async move {
        let mut downloaded: usize = 0;
        let progress_app = app.clone();
        let result = update
            .download(
                move |chunk, total| {
                    downloaded += chunk;
                    if let Some(total) = total {
                        if total > 0 {
                            let percent = (downloaded as f64 / total as f64) * 100.0;
                            set_progress_all(&progress_app, Some(percent as u64));
                        }
                    }
                },
                || {},
            )
            .await;
        set_progress_all(&app, None);
        match result {
            Ok(bytes) => on_update_downloaded(app, update, bytes),
            Err(err) => show_update_error(&app, &err.to_string()),
        }
    });
}

fn on_update_downloaded(
    app: tauri::AppHandle,
    update: tauri_plugin_updater::Update,
    bytes: Vec<u8>,
) {
    let version = update.version.clone();
    *app.state::<AppState>().pending_update.lock().unwrap() = Some(PendingUpdate {
        version: version.clone(),
        update,
        bytes,
    });
    // Refresh the About panel metadata ("version X is ready…")
    crate::menu::rebuild(&app);

    let mut dialog = app
        .dialog()
        .message(format!(
            "Version {version} has been downloaded. Restart to install."
        ))
        .title("Update Ready")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            BTN_RESTART.to_string(),
            BTN_LATER.to_string(),
        ));
    if let Some(window) = crate::windows::focused_window(&app) {
        dialog = dialog.parent(&window);
    }
    dialog.show_with_result(move |result| {
        if let MessageDialogResult::Custom(choice) = result {
            if choice == BTN_RESTART {
                restart_and_install(&app);
            }
        }
    });
}

// Install the downloaded update and restart, saving the set of open files
// so they come back after the restart. Used by the Update Ready dialog and
// by "Restart Now" in the About dialog.
pub fn restart_and_install(app: &tauri::AppHandle) {
    let Some(pending) = app.state::<AppState>().pending_update.lock().unwrap().take() else {
        return;
    };
    save_restore_state(app);
    if let Err(err) = pending.update.install(&pending.bytes) {
        show_update_error(app, &err.to_string());
        return;
    }
    app.restart();
}

pub fn pending_update_version(app: &tauri::AppHandle) -> Option<String> {
    app.state::<AppState>()
        .pending_update
        .lock()
        .unwrap()
        .as_ref()
        .map(|p| p.version.clone())
}

fn save_restore_state(app: &tauri::AppHandle) {
    let paths: Vec<Value> = app
        .state::<AppState>()
        .open_files
        .lock()
        .unwrap()
        .values()
        .map(|p| Value::String(p.to_string_lossy().to_string()))
        .collect();
    if paths.is_empty() {
        return;
    }
    let mut preferences = prefs::read_prefs(app);
    preferences.insert(KEY_RESTORE.into(), Value::Array(paths));
    prefs::write_prefs(app, &preferences);
}

// Read-and-clear the restore list saved before an update restart.
pub fn take_restore_state(app: &tauri::AppHandle) -> Vec<String> {
    let mut preferences = prefs::read_prefs(app);
    let paths = preferences
        .remove(KEY_RESTORE)
        .and_then(|v| match v {
            Value::Array(items) => Some(
                items
                    .into_iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect::<Vec<_>>(),
            ),
            _ => None,
        })
        .unwrap_or_default();
    if !paths.is_empty() {
        prefs::write_prefs(app, &preferences);
    }
    paths
}

fn show_update_error(app: &tauri::AppHandle, message: &str) {
    let mut dialog = app
        .dialog()
        .message(format!(
            "An error occurred while updating: {message}. You can download \
             the latest version manually from the Netscope website."
        ))
        .title("Update Failed")
        .kind(MessageDialogKind::Error);
    if let Some(window) = crate::windows::focused_window(app) {
        dialog = dialog.parent(&window);
    }
    dialog.show(|_| {});
}

fn set_progress_all(app: &tauri::AppHandle, percent: Option<u64>) {
    for window in app.webview_windows().values() {
        let state = match percent {
            Some(progress) => ProgressBarState {
                status: Some(ProgressBarStatus::Normal),
                progress: Some(progress.min(100)),
            },
            None => ProgressBarState {
                status: Some(ProgressBarStatus::None),
                progress: None,
            },
        };
        let _ = window.set_progress_bar(state);
    }
}

// UTC calendar date as YYYY-MM-DD without a date-library dependency
// (Howard Hinnant's civil-from-days algorithm).
fn today_utc() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::civil_from_days;

    #[test]
    fn civil_from_days_matches_known_dates() {
        // Expected values generated with Python's datetime.date
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
        assert_eq!(civil_from_days(20_088), (2024, 12, 31));
        assert_eq!(civil_from_days(20_645), (2026, 7, 11));
        assert_eq!(civil_from_days(47_541), (2100, 3, 1));
    }
}
