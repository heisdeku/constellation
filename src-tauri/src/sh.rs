//! Thin wrapper around `std::process::Command` that never lets the UI hang.
//!
//! `lsof` in particular can block indefinitely on stale network mounts, so every
//! external command we run gets a hard deadline and is killed if it overruns.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// Run `program` with `args`, returning its stdout as a String.
///
/// The child is killed and an `Err` returned if it does not close stdout within
/// `timeout`. stderr is discarded — these are diagnostic tools and their warnings
/// (e.g. lsof's permission notices) are expected noise.
pub fn run(program: &str, args: &[&str], timeout: Duration) -> Result<String, String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not launch `{program}`: {e}"))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("`{program}` produced no stdout pipe"))?;

    // Drain the pipe on a worker thread: a child writing more than the pipe buffer
    // would deadlock if we waited on exit before reading.
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });

    match rx.recv_timeout(timeout) {
        Ok(buf) => {
            let _ = child.wait();
            Ok(String::from_utf8_lossy(&buf).into_owned())
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(format!(
                "`{program}` did not finish within {}ms",
                timeout.as_millis()
            ))
        }
    }
}

/// Run a command for its side effect, reporting only whether it succeeded.
///
/// Used for `open -b <bundle-id>`, which exits non-zero when the app isn't installed —
/// that exit code is how we pick the user's editor.
pub fn run_ok(program: &str, args: &[&str], timeout: Duration) -> Result<bool, String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not launch `{program}`: {e}"))?;

    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status.success()),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "`{program}` did not finish within {}ms",
                        timeout.as_millis()
                    ));
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err(e) => return Err(format!("`{program}` failed: {e}")),
        }
    }
}
