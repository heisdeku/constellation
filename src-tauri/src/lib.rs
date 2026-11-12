mod control;
pub mod ports;
pub mod proc;
mod sh;
pub mod storage;

use std::path::PathBuf;

use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

use control::ControlResult;
use ports::ScanResult;
use storage::{CleanResult, DiskUsage, Measurement, Target};

#[tauri::command]
async fn scan_ports(include_udp: bool) -> Result<ScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || ports::scan(include_udp))
        .await
        .map_err(|e| format!("scan task failed: {e}"))?
}

#[tauri::command]
async fn pause_process(pid: i32, expected_name: Option<String>) -> Result<ControlResult, String> {
    tauri::async_runtime::spawn_blocking(move || control::pause(pid, expected_name.as_deref()))
        .await
        .map_err(|e| format!("pause task failed: {e}"))?
}

#[tauri::command]
async fn resume_process(pid: i32, expected_name: Option<String>) -> Result<ControlResult, String> {
    tauri::async_runtime::spawn_blocking(move || control::resume(pid, expected_name.as_deref()))
        .await
        .map_err(|e| format!("resume task failed: {e}"))?
}

#[tauri::command]
async fn stop_process(
    pid: i32,
    expected_name: Option<String>,
    force: bool,
    grace_ms: Option<u64>,
) -> Result<ControlResult, String> {
    let grace = grace_ms.unwrap_or(3000);
    tauri::async_runtime::spawn_blocking(move || {
        control::stop(pid, expected_name.as_deref(), force, grace)
    })
    .await
    .map_err(|e| format!("stop task failed: {e}"))?
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    control::reveal(&path)
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    control::open(&path)
}

#[tauri::command]
fn open_in_terminal(path: String) -> Result<(), String> {
    control::open_terminal(&path)
}

#[tauri::command]
fn open_in_editor(path: String) -> Result<String, String> {
    control::open_in_editor(&path)
}

fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set.".to_string())
}

#[tauri::command]
fn disk_usage() -> Result<DiskUsage, String> {
    storage::disk_usage()
}

#[tauri::command]
fn full_disk_access() -> bool {
    storage::has_full_disk_access()
}

#[tauri::command]
fn open_privacy_settings() -> Result<(), String> {
    storage::open_privacy_settings()
}

#[tauri::command]
async fn storage_targets(include_guarded: bool) -> Result<Vec<Target>, String> {
    let home = home()?;
    tauri::async_runtime::spawn_blocking(move || storage::targets(&home, include_guarded))
        .await
        .map_err(|e| format!("storage scan failed: {e}"))
}

#[tauri::command]
async fn storage_children(path: String) -> Result<Vec<Target>, String> {
    let home = home()?;
    tauri::async_runtime::spawn_blocking(move || storage::children(&path, &home))
        .await
        .map_err(|e| format!("browse task failed: {e}"))?
}

#[tauri::command]
async fn measure_target(id: String) -> Result<Measurement, String> {
    let home = home()?;
    tauri::async_runtime::spawn_blocking(move || storage::measure(&id, &home))
        .await
        .map_err(|e| format!("measure task failed: {e}"))?
}

#[tauri::command]
async fn clean_target(id: String) -> Result<CleanResult, String> {
    let home = home()?;
    tauri::async_runtime::spawn_blocking(move || storage::clean(&id, &home))
        .await
        .map_err(|e| format!("clean task failed: {e}"))?
}

const REPO: &str = "https://github.com/heisdeku/mare";

/// The macOS menu bar. Standard items are the system's own; marè's commands carry
/// ids that are forwarded to the window as `menu` events.
fn menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, accel: Option<&str>| {
        MenuItem::with_id(app, id, label, true, accel)
    };
    let about = AboutMetadata {
        website: Some(REPO.into()),
        ..Default::default()
    };

    let app_menu = SubmenuBuilder::new(app, "marè")
        .item(&PredefinedMenuItem::about(app, Some("About marè"), Some(about))?)
        .separator()
        .item(&item("settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&item("find", "Find…", Some("CmdOrCtrl+F"))?)
        .item(&item("palette", "Go to…", Some("CmdOrCtrl+K"))?)
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item("ports", "Ports", Some("CmdOrCtrl+1"))?)
        .item(&item("storage", "Storage", Some("CmdOrCtrl+2"))?)
        .separator()
        .item(&item("rescan", "Rescan", Some("CmdOrCtrl+R"))?)
        .separator()
        .fullscreen()
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&item("help", "marè Help", None)?)
        .separator()
        .item(&item("issue", "Report an Issue…", None)?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &edit, &view, &window, &help])
        .build()
}

/// Opens help links in the browser and forwards every other menu id to the window.
fn on_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let url = match id {
        "help" => format!("{REPO}#readme"),
        "issue" => format!("{REPO}/issues/new"),
        _ => {
            let _ = app.emit("menu", id);
            return;
        }
    };
    let _ = std::process::Command::new("open").arg(url).spawn();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(menu)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .invoke_handler(tauri::generate_handler![
            scan_ports,
            pause_process,
            resume_process,
            stop_process,
            reveal_in_finder,
            open_path,
            open_in_terminal,
            open_in_editor,
            disk_usage,
            full_disk_access,
            open_privacy_settings,
            storage_targets,
            storage_children,
            measure_target,
            clean_target,
        ])
        .run(tauri::generate_context!())
        .expect("error while running marè");
}
