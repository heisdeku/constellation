//! Pausing, resuming and stopping the process behind a port, plus the Finder /
//! terminal / editor jump-offs.
//!
//! Every signal goes through [`guard`], which refuses anything that would take the
//! machine or the app itself down.

use std::path::Path;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::proc::{self, ProcessInfo};
use crate::sh;

const OPEN_TIMEOUT: Duration = Duration::from_millis(4000);
/// Editors tried in order for "Open in editor", by bundle identifier.
const EDITOR_BUNDLES: &[&str] = &[
    "com.todesktop.230313mzl4w4u92", // Cursor
    "com.microsoft.VSCode",
    "dev.zed.Zed",
    "com.sublimetext.4",
    "com.jetbrains.WebStorm",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlResult {
    /// True when the process is gone after the operation.
    pub exited: bool,
    /// True when SIGTERM was ignored and we had to escalate to SIGKILL.
    pub escalated: bool,
    /// Fresh state, so the UI can update without waiting for the next scan.
    pub process: Option<ProcessInfo>,
    /// Plain-language summary for the toast.
    pub message: String,
}

fn alive(pid: i32) -> bool {
    // signal 0 performs the permission and existence checks without delivering anything.
    let rc = unsafe { libc::kill(pid, 0) };
    if rc == 0 {
        return true;
    }
    // EPERM means it exists but belongs to somebody else.
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

/// Validate that `pid` is something we're willing to signal.
///
/// `expected_name` guards against pid reuse: the UI sends the name it last saw, and
/// we refuse if the pid now points at a different program.
fn guard(pid: i32, expected_name: Option<&str>) -> Result<ProcessInfo, String> {
    if pid <= 1 {
        return Err("Refusing to signal pid 1 or lower.".to_string());
    }
    if pid == std::process::id() as i32 {
        return Err("That's System Manager itself.".to_string());
    }

    let info = proc::describe_one(pid)?
        .ok_or_else(|| format!("Process {pid} is no longer running."))?;

    if let Some(expected) = expected_name {
        if !expected.is_empty() && info.name != expected {
            return Err(format!(
                "Process {pid} is now `{}`, not `{expected}` — it was replaced since the last scan. Refresh and try again.",
                info.name
            ));
        }
    }
    if info.protected {
        return Err(format!(
            "`{}` is a protected system process — System Manager won't signal it.",
            info.name
        ));
    }
    if !info.owned_by_me {
        return Err(format!(
            "`{}` runs as `{}`, not you. macOS won't let System Manager signal it.",
            info.name, info.user
        ));
    }
    Ok(info)
}

fn send(pid: i32, signal: libc::c_int) -> Result<(), String> {
    if unsafe { libc::kill(pid, signal) } == 0 {
        return Ok(());
    }
    let err = std::io::Error::last_os_error();
    Err(match err.raw_os_error() {
        Some(libc::EPERM) => format!("Not permitted to signal process {pid}."),
        Some(libc::ESRCH) => format!("Process {pid} already exited."),
        _ => format!("Could not signal process {pid}: {err}"),
    })
}

/// Freeze the process with SIGSTOP. It keeps the port bound but stops doing work,
/// and [`resume`] brings it back exactly where it left off.
pub fn pause(pid: i32, expected_name: Option<&str>) -> Result<ControlResult, String> {
    let info = guard(pid, expected_name)?;
    if info.paused {
        return Ok(ControlResult {
            exited: false,
            escalated: false,
            message: format!("`{}` was already paused.", info.name),
            process: Some(info),
        });
    }
    send(pid, libc::SIGSTOP)?;
    let after = proc::describe_one(pid)?;
    Ok(ControlResult {
        exited: after.is_none(),
        escalated: false,
        message: format!("Paused `{}` (PID {pid}). Its ports stay bound.", info.name),
        process: after,
    })
}

/// Undo a pause with SIGCONT.
pub fn resume(pid: i32, expected_name: Option<&str>) -> Result<ControlResult, String> {
    let info = guard(pid, expected_name)?;
    send(pid, libc::SIGCONT)?;
    let after = proc::describe_one(pid)?;
    Ok(ControlResult {
        exited: after.is_none(),
        escalated: false,
        message: format!("Resumed `{}`.", info.name),
        process: after,
    })
}

/// Ask the process to exit with SIGTERM, then escalate to SIGKILL if it ignores us.
///
/// A paused process can't act on SIGTERM, so it gets SIGCONT first — otherwise
/// "stop" would silently do nothing to anything you'd previously paused.
pub fn stop(
    pid: i32,
    expected_name: Option<&str>,
    force: bool,
    grace_ms: u64,
) -> Result<ControlResult, String> {
    let info = guard(pid, expected_name)?;
    let name = info.name.clone();

    if info.paused {
        let _ = send(pid, libc::SIGCONT);
    }

    // Losing the race to a process that exits on its own is the outcome we wanted,
    // not an error worth showing.
    if let Err(e) = send(pid, libc::SIGTERM) {
        if !alive(pid) {
            return Ok(ControlResult {
                exited: true,
                escalated: false,
                message: format!("`{name}` had already exited."),
                process: None,
            });
        }
        return Err(e);
    }

    if !wait_for_exit(pid, Duration::from_millis(grace_ms.clamp(0, 15_000))) {
        if !force {
            return Ok(ControlResult {
                exited: false,
                escalated: false,
                message: format!(
                    "`{name}` ignored SIGTERM after {grace_ms}ms. Use Force stop to send SIGKILL."
                ),
                process: proc::describe_one(pid)?,
            });
        }
        send(pid, libc::SIGKILL)?;
        let exited = wait_for_exit(pid, Duration::from_millis(3000));
        return Ok(ControlResult {
            exited,
            escalated: true,
            message: if exited {
                format!("Force stopped `{name}` with SIGKILL.")
            } else {
                format!("`{name}` survived SIGKILL — it may be stuck in the kernel.")
            },
            process: proc::describe_one(pid)?,
        });
    }

    Ok(ControlResult {
        exited: true,
        escalated: false,
        message: format!("Stopped `{name}`."),
        process: None,
    })
}

fn wait_for_exit(pid: i32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if !alive(pid) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(40));
    }
}

fn existing(path: &str) -> Result<&Path, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("`{path}` no longer exists on disk."));
    }
    Ok(p)
}

/// Reveal a path in Finder with it selected.
pub fn reveal(path: &str) -> Result<(), String> {
    existing(path)?;
    sh::run_ok("open", &["-R", path], OPEN_TIMEOUT).map(|_| ())
}

/// Open a folder in Finder, or a file with its default application.
pub fn open(path: &str) -> Result<(), String> {
    existing(path)?;
    sh::run_ok("open", &[path], OPEN_TIMEOUT).map(|_| ())
}

/// Open a Terminal window at `path`.
pub fn open_terminal(path: &str) -> Result<(), String> {
    existing(path)?;
    sh::run_ok("open", &["-a", "Terminal", path], OPEN_TIMEOUT).map(|_| ())
}

/// Open `path` in the first installed editor from [`EDITOR_BUNDLES`], falling back
/// to Finder when none of them are present.
pub fn open_in_editor(path: &str) -> Result<String, String> {
    existing(path)?;
    for bundle in EDITOR_BUNDLES {
        if sh::run_ok("open", &["-b", bundle, path], OPEN_TIMEOUT).unwrap_or(false) {
            return Ok((*bundle).to_string());
        }
    }
    open(path)?;
    Ok("finder".to_string())
}
