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
use std::path::{Path, PathBuf};
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
fn get_window_file<R: tauri::Runtime>(window: tauri::WebviewWindow<R>) -> Option<HarFileData> {
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

// Open the file picker. Rust owns the dialog so it needs no window — see
// windows::pick_and_open_files. The chosen files are routed there, which is
// also why there is no return value: the frontend doesn't decide anything.
#[tauri::command]
fn pick_and_open_files(app: tauri::AppHandle) {
    windows::pick_and_open_files(&app);
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
    // A File > Open that had no window to attach its sheet to is waiting for
    // this: the window is now on screen and painted, so the picker can open
    // over it rather than over a blank frame.
    windows::flush_pending_picker(window.app_handle());
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

/// Windows and Linux match file associations case-insensitively, so a
/// double-clicked `TRACE.HAR` arrives in argv exactly like `trace.har`.
/// Comparing the extension rather than the whole string also avoids matching
/// a file literally named `.har`.
fn has_har_extension(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("har"))
}

/// The first argument that names an existing `.har` file, resolved to an
/// absolute path.
///
/// `cwd` is the working directory the arguments came from, which is not
/// always this process's own: the single-instance plugin hands over a second
/// launch's argv and cwd, and a relative path in it means nothing here. The
/// caller must pass the matching directory or a relative argument resolves
/// against the wrong place — silently opening nothing, or the wrong file if
/// one happens to share the name.
fn find_har_arg(args: impl Iterator<Item = String>, cwd: &Path) -> Option<String> {
    args.skip(1).find_map(|arg| {
        // Joining an absolute path replaces the base, so this handles both.
        let candidate = cwd.join(&arg);
        (has_har_extension(&candidate) && candidate.exists())
            .then(|| candidate.to_string_lossy().into_owned())
    })
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
    let startup_file = find_har_arg(
        std::env::args(),
        &std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
    );

    tauri::Builder::default()
        // Must be the first plugin: a second launch (e.g. double-clicking
        // another .har on Windows/Linux) hands its argv to this process and
        // exits, so dedup / welcome-reuse / cascade work across launches.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            match find_har_arg(argv.into_iter(), Path::new(&cwd)) {
                Some(path) => windows::open_file_from_path(app, &path),
                None => {
                    let _ = windows::create_window(app, None);
                }
            }
            // Bring the app to the front, like Electron's second-instance
            // handler did.
            let front =
                windows::focused_window(app).or_else(|| app.webview_windows().into_values().next());
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
            pick_and_open_files,
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
                tauri::RunEvent::ExitRequested {
                    code: None, api, ..
                } => {
                    api.prevent_exit();
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod argv_tests {
    use super::{find_har_arg, has_har_extension};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// A scratch directory that cleans itself up. Enough for these tests, and
    /// avoids a dev-dependency for four files.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "netscope-argv-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&dir).expect("create scratch dir");
            Scratch(dir)
        }

        fn touch(&self, name: &str) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, "{}").expect("write scratch file");
            path
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// argv always starts with the executable, which find_har_arg skips.
    fn argv(rest: &[&str]) -> std::vec::IntoIter<String> {
        let mut all = vec!["/usr/bin/netscope".to_string()];
        all.extend(rest.iter().map(|s| s.to_string()));
        all.into_iter()
    }

    #[test]
    fn extension_match_ignores_case() {
        assert!(has_har_extension(Path::new("trace.har")));
        assert!(has_har_extension(Path::new("TRACE.HAR")));
        assert!(has_har_extension(Path::new("Trace.Har")));
        assert!(!has_har_extension(Path::new("trace.json")));
        // A file called ".har" has no extension, only a name.
        assert!(!has_har_extension(Path::new(".har")));
    }

    #[test]
    fn finds_an_uppercase_har_from_a_file_association() {
        let dir = Scratch::new();
        let file = dir.touch("TRACE.HAR");

        let found = find_har_arg(argv(&[file.to_str().unwrap()]), dir.path());

        assert_eq!(found, Some(file.to_string_lossy().into_owned()));
    }

    #[test]
    fn resolves_a_relative_arg_against_the_supplied_cwd() {
        let dir = Scratch::new();
        dir.touch("trace.har");

        // The process cwd is somewhere else entirely; only the passed-in
        // directory should decide what "trace.har" means.
        let found = find_har_arg(argv(&["trace.har"]), dir.path());

        assert_eq!(
            found,
            Some(dir.path().join("trace.har").to_string_lossy().into_owned())
        );
    }

    #[test]
    fn a_relative_arg_is_not_found_under_an_unrelated_cwd() {
        let dir = Scratch::new();
        let elsewhere = Scratch::new();
        dir.touch("trace.har");

        assert_eq!(find_har_arg(argv(&["trace.har"]), elsewhere.path()), None);
    }

    #[test]
    fn an_absolute_arg_ignores_the_cwd() {
        let dir = Scratch::new();
        let elsewhere = Scratch::new();
        let file = dir.touch("trace.har");

        let found = find_har_arg(argv(&[file.to_str().unwrap()]), elsewhere.path());

        assert_eq!(found, Some(file.to_string_lossy().into_owned()));
    }

    #[test]
    fn ignores_paths_that_do_not_exist() {
        let dir = Scratch::new();
        assert_eq!(find_har_arg(argv(&["missing.har"]), dir.path()), None);
    }

    #[test]
    fn ignores_files_that_are_not_har() {
        let dir = Scratch::new();
        dir.touch("notes.json");
        assert_eq!(find_har_arg(argv(&["notes.json"]), dir.path()), None);
    }

    #[test]
    fn skips_the_executable_even_when_it_looks_like_a_capture() {
        let dir = Scratch::new();
        let exe = dir.touch("netscope.har");
        let real = dir.touch("trace.har");

        let mut all = vec![exe.to_string_lossy().into_owned()];
        all.push(real.to_string_lossy().into_owned());

        let found = find_har_arg(all.into_iter(), dir.path());

        assert_eq!(found, Some(real.to_string_lossy().into_owned()));
    }

    #[test]
    fn takes_the_first_capture_when_several_are_passed() {
        let dir = Scratch::new();
        let first = dir.touch("a.har");
        dir.touch("b.har");

        let found = find_har_arg(argv(&[first.to_str().unwrap(), "b.har"]), dir.path());

        assert_eq!(found, Some(first.to_string_lossy().into_owned()));
    }
}

// Window-scoped command tests on Tauri's mock runtime. These need no webview
// and no display, so they run on macOS where tauri-driver can't (see #13).
//
// The target is get_window_file's interaction with pending_files and
// open_files, which is where the reload bug fixed in #3 lived: a window that
// had already consumed its pending file came back empty after a reload,
// because nothing fell back to the path registered for it.
#[cfg(test)]
mod window_file_tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "netscope-winfile-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&dir).expect("create scratch dir");
            Scratch(dir)
        }

        fn har(&self, name: &str, body: &str) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, body).expect("write scratch har");
            std::fs::canonicalize(&path).expect("canonicalize scratch har")
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A mock app with our state attached. noop_assets keeps this independent
    /// of whether the renderer has been built.
    fn app() -> tauri::App<tauri::test::MockRuntime> {
        mock_builder()
            .manage(AppState::new())
            .build(mock_context(noop_assets()))
            .expect("build mock app")
    }

    fn window(
        app: &tauri::App<tauri::test::MockRuntime>,
        label: &str,
    ) -> tauri::WebviewWindow<tauri::test::MockRuntime> {
        WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
            .build()
            .expect("build mock window")
    }

    fn pending(app: &tauri::App<tauri::test::MockRuntime>, label: &str, content: &str) {
        app.state::<AppState>()
            .pending_files
            .lock()
            .unwrap()
            .insert(
                label.to_string(),
                HarFileData {
                    file_path: format!("/tmp/{label}.har"),
                    content: content.to_string(),
                    file_name: format!("{label}.har"),
                },
            );
    }

    #[test]
    fn a_pending_file_is_served_once_and_then_consumed() {
        let app = app();
        let win = window(&app, "window-1");
        pending(&app, "window-1", r#"{"log":{"entries":[]}}"#);

        let first = get_window_file(win.clone()).expect("pending file on first call");
        assert_eq!(first.content, r#"{"log":{"entries":[]}}"#);

        // The map is a hand-off, not a cache.
        assert!(app
            .state::<AppState>()
            .pending_files
            .lock()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_reload_falls_back_to_the_registered_path() {
        let dir = Scratch::new();
        let file = dir.har("trace.har", r#"{"log":{"entries":[1]}}"#);

        let app = app();
        let win = window(&app, "window-1");
        pending(&app, "window-1", "handed over on first mount");
        app.state::<AppState>()
            .open_files
            .lock()
            .unwrap()
            .insert("window-1".into(), file.clone());

        // First mount consumes the hand-off.
        assert_eq!(
            get_window_file(win.clone()).unwrap().content,
            "handed over on first mount"
        );

        // Reloading the webview mounts again with nothing pending. This is #3:
        // without the open_files fallback the window came back empty.
        let after_reload = get_window_file(win).expect("window stranded after reload");
        assert_eq!(after_reload.content, r#"{"log":{"entries":[1]}}"#);
        assert_eq!(after_reload.file_path, file.to_string_lossy());
    }

    #[test]
    fn a_window_with_nothing_registered_gets_nothing() {
        let app = app();
        let win = window(&app, "window-1");

        assert!(get_window_file(win).is_none());
    }

    #[test]
    fn a_pending_file_belongs_to_one_window_only() {
        let app = app();
        let first = window(&app, "window-1");
        let second = window(&app, "window-2");
        pending(&app, "window-1", "for the first window");

        assert!(
            get_window_file(second).is_none(),
            "a second window must not pick up another's hand-off"
        );
        assert_eq!(
            get_window_file(first).unwrap().content,
            "for the first window"
        );
    }

    #[test]
    fn a_registered_path_that_has_gone_away_yields_nothing() {
        let dir = Scratch::new();
        let file = dir.har("trace.har", "{}");
        let app = app();
        let win = window(&app, "window-1");
        app.state::<AppState>()
            .open_files
            .lock()
            .unwrap()
            .insert("window-1".into(), file.clone());
        std::fs::remove_file(&file).unwrap();

        // Deleted under us between mounts: no data, and no panic.
        assert!(get_window_file(win).is_none());
    }
}
