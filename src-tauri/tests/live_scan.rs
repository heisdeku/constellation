//! Exercises the real scanner against this machine.
//!
//! The unit tests cover parsing with fixed samples; this checks the whole pipeline —
//! lsof, ps, cwd resolution and project detection — against live system state.

use system_manager_lib::ports;

#[test]
fn scans_real_listening_ports() {
    let result = ports::scan(false).expect("scan should succeed on a normal macOS machine");

    assert!(
        !result.entries.is_empty(),
        "a running Mac always has something listening"
    );
    assert!(result.scanned_at > 0);

    for e in &result.entries {
        assert!(e.port > 0, "port must be set");
        assert_eq!(e.protocol, "TCP", "UDP was not requested");
        assert!(e.pid > 0, "every socket must map to a pid");
        assert!(!e.addresses.is_empty(), "a listener must have an address");
        assert!(!e.process.name.is_empty(), "process name must resolve");
        assert!(
            matches!(e.scope.as_str(), "loopback" | "lan" | "specific"),
            "unexpected scope {}",
            e.scope
        );
        assert_eq!(
            e.id,
            format!("tcp-{}-{}", e.port, e.pid),
            "id must be stable and derivable"
        );
    }

    // IPv4 and IPv6 bindings of the same port must collapse into a single row.
    let mut ids: Vec<_> = result.entries.iter().map(|e| e.id.clone()).collect();
    let before = ids.len();
    ids.sort();
    ids.dedup();
    assert_eq!(before, ids.len(), "duplicate rows for the same port+pid");

    eprintln!("\n--- {} listening TCP ports ---", result.entries.len());
    eprintln!(
        "{:>6}  {:<20} {:<9} {:>7}  {:<24} {}",
        "PORT", "PROCESS", "REACH", "PID", "PROJECT", "CWD"
    );
    for e in result.entries.iter().take(30) {
        eprintln!(
            "{:>6}  {:<20} {:<9} {:>7}  {:<24} {}",
            e.port,
            truncate(&e.process.name, 20),
            e.scope,
            e.pid,
            e.process
                .project
                .as_ref()
                .map(|p| truncate(&p.name, 24))
                .unwrap_or_else(|| "—".into()),
            e.process.cwd.as_deref().unwrap_or("(unavailable)")
        );
    }

    let with_project = result
        .entries
        .iter()
        .filter(|e| e.process.project.is_some())
        .count();
    let mine = result.entries.iter().filter(|e| e.process.owned_by_me).count();
    eprintln!(
        "\nproject folder resolved for {}/{} ports · {} owned by you\n",
        with_project,
        result.entries.len(),
        mine
    );
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n - 1).chain(std::iter::once('…')).collect()
    }
}

/// A process can outlive the directory it was started in — a deleted git worktree
/// whose dev server is still holding a port. Those must be flagged, not linked to.
#[test]
fn flags_working_directories_that_no_longer_exist() {
    let result = ports::scan(false).expect("scan should succeed");
    for e in &result.entries {
        let Some(cwd) = e.process.cwd.as_deref() else {
            assert!(!e.process.cwd_exists, "no cwd means nothing to open");
            continue;
        };
        assert_eq!(
            e.process.cwd_exists,
            std::path::Path::new(cwd).is_dir(),
            "cwd_exists must match the filesystem for {cwd}"
        );
        if e.process.project.is_some() {
            assert!(e.process.cwd_exists, "a project root we read must still exist");
        }
    }

    let stale: Vec<_> = result
        .entries
        .iter()
        .filter(|e| e.process.cwd.is_some() && !e.process.cwd_exists)
        .map(|e| (e.port, e.pid, e.process.cwd.clone().unwrap()))
        .collect();
    eprintln!("\n{} port(s) held by processes whose folder is gone:", stale.len());
    for (port, pid, cwd) in &stale {
        eprintln!("  {port} (pid {pid}) -> {cwd}");
    }
}
