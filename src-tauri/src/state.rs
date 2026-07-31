use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::har::HarFileData;

pub struct AppState {
    // window label → resolved path of the file currently shown (for dedup)
    pub open_files: Mutex<HashMap<String, PathBuf>>,
    // files waiting to be fetched by the frontend on mount
    pub pending_files: Mutex<HashMap<String, HarFileData>>,
    // counter for generating unique window labels
    pub window_counter: Mutex<u32>,
    // label of the most-recently created window, used as a cascade fallback
    pub last_created_label: Mutex<Option<String>>,
    // label of the most-recently focused window, used for cascade anchoring
    // and for routing "open" menu events
    pub last_focused_label: Mutex<Option<String>>,
    // label → logical-pixel position for the cascade chain. Seeded from our
    // own builder.position() hints and updated from WindowEvent::Moved;
    // outer_position() fails on Wayland so this map is the only reliable
    // source for cascade anchoring there.
    pub window_positions: Mutex<HashMap<String, (f64, f64)>>,
    // label → webview zoom factor (View menu zoom items)
    pub zoom_levels: Mutex<HashMap<String, f64>>,
    // Open Recent list, most recent first, capped at MAX_RECENT_DOCUMENTS.
    // Persisted to preferences.json and mirrored to the OS recent-documents
    // list (dock menu / jump list) by the recent module.
    pub recent_files: Mutex<Vec<String>>,
    // Data for the currently-open request-row context menu (set when the
    // menu pops, consumed by its click handler).
    pub context_menu: Mutex<Option<crate::context_menu::ContextMenuState>>,
    // A downloaded update waiting for the user to restart (drives the About
    // panel status and its Restart Now action).
    pub pending_update: Mutex<Option<crate::update::PendingUpdate>>,
    // Set when File > Open arrived with no window to attach its sheet to, so
    // the picker is waiting for the window we opened to finish painting.
    pub picker_awaiting_window: Mutex<bool>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            open_files: Mutex::new(HashMap::new()),
            pending_files: Mutex::new(HashMap::new()),
            window_counter: Mutex::new(0),
            last_created_label: Mutex::new(None),
            last_focused_label: Mutex::new(None),
            window_positions: Mutex::new(HashMap::new()),
            zoom_levels: Mutex::new(HashMap::new()),
            recent_files: Mutex::new(Vec::new()),
            context_menu: Mutex::new(None),
            pending_update: Mutex::new(None),
            picker_awaiting_window: Mutex::new(false),
        }
    }

    pub fn next_label(&self) -> String {
        let mut n = self.window_counter.lock().unwrap();
        *n += 1;
        format!("window-{}", n)
    }

    pub fn find_window_for_file(&self, path: &PathBuf) -> Option<String> {
        self.open_files
            .lock()
            .unwrap()
            .iter()
            .find(|(_, p)| *p == path)
            .map(|(label, _)| label.clone())
    }

    pub fn arm_pending_picker(&self) {
        *self.picker_awaiting_window.lock().unwrap() = true;
    }

    // Claim-once: whichever path first reports a window on screen opens the
    // picker, and the others find nothing to do. Both signal_ready and the
    // visibility safety net call this, so an armed picker can't be lost if the
    // renderer never signals, and can't fire twice if it does.
    pub fn take_pending_picker(&self) -> bool {
        let mut pending = self.picker_awaiting_window.lock().unwrap();
        std::mem::replace(&mut *pending, false)
    }
}

#[cfg(test)]
mod tests {
    use super::AppState;

    #[test]
    fn pending_picker_is_claimed_exactly_once() {
        let state = AppState::new();

        // Nothing armed: nobody opens a picker.
        assert!(!state.take_pending_picker());

        state.arm_pending_picker();
        // First caller wins; the second (the safety net racing signal_ready,
        // or a second window painting) must not open another picker.
        assert!(state.take_pending_picker());
        assert!(!state.take_pending_picker());

        // Arming again after a claim works.
        state.arm_pending_picker();
        assert!(state.take_pending_picker());
    }
}
