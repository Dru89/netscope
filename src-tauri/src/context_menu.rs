use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, EventTarget, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::state::AppState;

// The request-row context menu. The menu itself is native (built here,
// popped at the cursor); the copy actions round-trip to the webview, which
// runs the pure TypeScript copy formatters over the entry data it already
// holds and hands the result back to the set_clipboard command. That keeps
// the formatters — and their unit tests — as the single implementation.

// What Rust needs to remember between popping the menu and the click event.
pub struct ContextMenuState {
    pub label: String,
    pub url: String,
    pub sort_field: String,
    pub sort_direction: String,
}

const SORT_FIELDS: [(&str, &str); 7] = [
    ("Name", "name"),
    ("Method", "method"),
    ("Status", "status"),
    ("Type", "type"),
    ("Size", "size"),
    ("Time", "time"),
    ("Waterfall", "waterfall"),
];

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ContextMenuActionPayload {
    target_label: String,
    action: String,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ContextMenuSortPayload {
    target_label: String,
    field: String,
    direction: String,
}

pub fn show(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    url: String,
    sort_field: String,
    sort_direction: String,
) -> tauri::Result<()> {
    *app.state::<AppState>().context_menu.lock().unwrap() = Some(ContextMenuState {
        label: window.label().to_string(),
        url,
        sort_field: sort_field.clone(),
        sort_direction: sort_direction.clone(),
    });

    let copy_menu = Submenu::with_items(
        app,
        "Copy",
        true,
        &[
            &item(app, "ctx:copy_url", "Copy URL")?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "ctx:copy_curl", "Copy as cURL")?,
            &item(app, "ctx:copy_fetch", "Copy as fetch")?,
            &item(app, "ctx:copy_fetch_node", "Copy as fetch (Node.js)")?,
            &item(app, "ctx:copy_powershell", "Copy as PowerShell")?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "ctx:copy_response", "Copy Response")?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "ctx:copy_all_urls", "Copy All Listed URLs")?,
            &item(app, "ctx:copy_all_curl", "Copy All Listed as cURL")?,
            &item(app, "ctx:copy_all_fetch", "Copy All Listed as fetch")?,
            &item(
                app,
                "ctx:copy_all_fetch_node",
                "Copy All Listed as fetch (Node.js)",
            )?,
            &item(
                app,
                "ctx:copy_all_powershell",
                "Copy All Listed as PowerShell",
            )?,
        ],
    )?;

    let sort_menu = Submenu::new(app, "Sort By", true)?;
    for (label, field) in SORT_FIELDS {
        let active = *field == sort_field;
        let text = if active {
            format!(
                "{label} ({})",
                if sort_direction == "asc" { "↑" } else { "↓" }
            )
        } else {
            label.to_string()
        };
        sort_menu.append(&CheckMenuItem::with_id(
            app,
            format!("ctx:sort:{field}"),
            text,
            true,
            active,
            None::<&str>,
        )?)?;
    }

    let menu = Menu::with_items(
        app,
        &[
            &item(app, "ctx:open_in_browser", "Open in Browser")?,
            &PredefinedMenuItem::separator(app)?,
            &copy_menu,
            &PredefinedMenuItem::separator(app)?,
            &sort_menu,
        ],
    )?;

    window.popup_menu(&menu)
}

fn item(
    app: &tauri::AppHandle,
    id: &str,
    text: &str,
) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::with_id(app, id, text, true, None::<&str>)
}

// Handles menu events with the "ctx:" prefix; returns false for other ids.
pub fn handle_event(app: &tauri::AppHandle, id: &str) -> bool {
    let Some(action) = id.strip_prefix("ctx:") else {
        return false;
    };
    let state = app.state::<AppState>();
    let Some(ctx) = state.context_menu.lock().unwrap().take() else {
        return true;
    };

    if action == "open_in_browser" {
        let _ = app.opener().open_url(&ctx.url, None::<&str>);
        return true;
    }

    if let Some(field) = action.strip_prefix("sort:") {
        // Toggle direction if the field is already active, else ascending —
        // same rule as clicking a column header.
        let direction = if field == ctx.sort_field {
            if ctx.sort_direction == "asc" {
                "desc"
            } else {
                "asc"
            }
        } else {
            "asc"
        };
        let _ = app.emit_to(
            EventTarget::WebviewWindow {
                label: ctx.label.clone(),
            },
            "context-menu-sort",
            ContextMenuSortPayload {
                target_label: ctx.label,
                field: field.to_string(),
                direction: direction.to_string(),
            },
        );
        return true;
    }

    // Copy actions: the webview owns the entry data and the formatters.
    let _ = app.emit_to(
        EventTarget::WebviewWindow {
            label: ctx.label.clone(),
        },
        "context-menu-action",
        ContextMenuActionPayload {
            target_label: ctx.label,
            action: action.to_string(),
        },
    );
    true
}
