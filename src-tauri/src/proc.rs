//! Building a snapshot of the process table, and working out where each process
//! "lives" on disk so the UI can link straight to that folder.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use crate::sh;

const PS_TIMEOUT: Duration = Duration::from_millis(4000);
const LSOF_TIMEOUT: Duration = Duration::from_millis(6000);

/// How a process's working directory maps onto a project on disk.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    /// Absolute path to the project root.
    pub path: String,
    /// Display name — the `name` field from package.json where available, else the folder name.
    pub name: String,
    /// Which marker identified it: node, rust, go, python, ruby, php, deno, dart, git.
    pub kind: String,
    /// The file/folder that identified the root, e.g. "package.json".
    pub marker: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: i32,
    pub ppid: i32,
    /// Short display name, e.g. "node" or "Google Chrome".
    pub name: String,
    /// Absolute path to the executable.
    pub exe: String,
    /// Full command line including arguments.
    pub command: String,
    pub user: String,
    /// running | sleeping | idle | paused | zombie | waiting | unknown
    pub state: String,
    /// True when the kernel has the process suspended (ps state `T`) — i.e. we paused it.
    pub paused: bool,
    pub cpu: f32,
    pub mem: f32,
    /// Seconds since the process started.
    pub uptime_seconds: u64,
    /// Current working directory, when readable.
    pub cwd: Option<String>,
    /// False when the cwd has since been deleted — a stale dev server from a removed
    /// worktree still holds its port, and there is nothing to open in Finder.
    pub cwd_exists: bool,
    pub project: Option<ProjectInfo>,
    /// For GUI apps, the enclosing `.app` bundle path.
    pub app_bundle: Option<String>,
    /// False for processes owned by other users — signalling them would fail with EPERM.
    pub owned_by_me: bool,
    /// True for processes we refuse to signal (launchd, WindowServer, ourselves, …).
    pub protected: bool,
}

/// Processes that keep the machine usable. Refusing these is cheaper than explaining
/// to someone why their session died.
const PROTECTED_NAMES: &[&str] = &[
    "launchd",
    "kernel_task",
    "WindowServer",
    "loginwindow",
    "logd",
    "systemstats",
    "configd",
    "opendirectoryd",
    "securityd",
    "notifyd",
    "diskarbitrationd",
    "coreaudiod",
    "distnoted",
    "UserEventAgent",
    "mDNSResponder",
    "syslogd",
    "hidd",
    "powerd",
    "SystemUIServer",
    "Dock",
    "Finder",
];

/// Manifest files that mark a project root, in the order we trust them.
const PROJECT_MARKERS: &[(&str, &str)] = &[
    ("package.json", "node"),
    ("Cargo.toml", "rust"),
    ("go.mod", "go"),
    ("pyproject.toml", "python"),
    ("requirements.txt", "python"),
    ("Gemfile", "ruby"),
    ("composer.json", "php"),
    ("deno.json", "deno"),
    ("deno.jsonc", "deno"),
    ("pubspec.yaml", "dart"),
    ("mix.exs", "elixir"),
    ("build.gradle", "java"),
    ("build.gradle.kts", "java"),
    ("pom.xml", "java"),
];

struct PsRow {
    ppid: i32,
    state: String,
    user: String,
    cpu: f32,
    mem: f32,
    uptime_seconds: u64,
}

/// Snapshot the whole process table. Three `ps` invocations, run in parallel.
fn ps_snapshot() -> Result<
    (
        HashMap<i32, PsRow>,
        HashMap<i32, String>,
        HashMap<i32, String>,
    ),
    String,
> {
    let stats = std::thread::spawn(|| {
        sh::run(
            "ps",
            &["-axo", "pid=,ppid=,state=,user=,%cpu=,%mem=,etime="],
            PS_TIMEOUT,
        )
    });
    // `comm` and `command` are read separately: both can contain spaces, so each
    // needs to be the last (greedy) column of its own invocation.
    let comms = std::thread::spawn(|| sh::run("ps", &["-axo", "pid=,comm="], PS_TIMEOUT));
    let cmdlines = sh::run("ps", &["-axo", "pid=,command="], PS_TIMEOUT)?;

    let stats = stats.join().map_err(|_| "ps stats thread panicked")??;
    let comms = comms.join().map_err(|_| "ps comm thread panicked")??;

    let mut rows = HashMap::new();
    for line in stats.lines() {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 7 {
            continue;
        }
        let Ok(pid) = f[0].parse::<i32>() else { continue };
        rows.insert(
            pid,
            PsRow {
                ppid: f[1].parse().unwrap_or(0),
                state: f[2].to_string(),
                user: f[3].to_string(),
                cpu: f[4].parse().unwrap_or(0.0),
                mem: f[5].parse().unwrap_or(0.0),
                uptime_seconds: parse_etime(f[6]),
            },
        );
    }

    Ok((rows, split_pid_rest(&comms), split_pid_rest(&cmdlines)))
}

/// Parse `ps -o pid=,<greedy>=` output where the remainder of the line may contain spaces.
fn split_pid_rest(out: &str) -> HashMap<i32, String> {
    let mut map = HashMap::new();
    for line in out.lines() {
        let line = line.trim_start();
        let Some(split) = line.find(char::is_whitespace) else {
            continue;
        };
        let Ok(pid) = line[..split].parse::<i32>() else {
            continue;
        };
        map.insert(pid, line[split..].trim().to_string());
    }
    map
}

/// `ps` elapsed time: `[[dd-]hh:]mm:ss`.
fn parse_etime(raw: &str) -> u64 {
    let (days, rest) = match raw.split_once('-') {
        Some((d, r)) => (d.parse::<u64>().unwrap_or(0), r),
        None => (0, raw),
    };
    let parts: Vec<u64> = rest.split(':').map(|p| p.parse().unwrap_or(0)).collect();
    let hms = match parts.as_slice() {
        [h, m, s] => h * 3600 + m * 60 + s,
        [m, s] => m * 60 + s,
        [s] => *s,
        _ => 0,
    };
    days * 86_400 + hms
}

/// Ask lsof for the working directory of a specific set of pids, in one call.
fn cwds_for(pids: &[i32]) -> HashMap<i32, String> {
    let mut map = HashMap::new();
    if pids.is_empty() {
        return map;
    }
    let list = pids
        .iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join(",");
    // -w suppresses the warnings lsof emits for processes we cannot inspect.
    let Ok(out) = sh::run("lsof", &["-a", "-w", "-p", &list, "-d", "cwd", "-F", "pn"], LSOF_TIMEOUT)
    else {
        return map;
    };

    let mut current: Option<i32> = None;
    for line in out.lines() {
        // Field output is `<tag><value>`; skip anything that isn't shaped that way
        // rather than risk slicing off a char boundary.
        let Some(tag) = line.get(..1) else { continue };
        let value = &line[1..];
        match tag {
            "p" => current = value.parse::<i32>().ok(),
            "n" => {
                if let Some(pid) = current {
                    map.insert(pid, value.to_string());
                }
            }
            _ => {}
        }
    }
    map
}

/// Walk up from `cwd` looking for the folder that best represents "the project".
fn detect_project(cwd: &str) -> Option<ProjectInfo> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut dir: Option<&Path> = Some(Path::new(cwd));

    // A process started at `/` or in `$HOME` isn't "in a project" in any useful sense.
    for _ in 0..24 {
        let d = dir?;
        if d == Path::new("/") || (!home.is_empty() && d == Path::new(&home)) {
            return None;
        }

        for (marker, kind) in PROJECT_MARKERS {
            let candidate = d.join(marker);
            if candidate.is_file() {
                return Some(ProjectInfo {
                    name: project_name(d, kind, &candidate),
                    path: d.to_string_lossy().into_owned(),
                    kind: kind.to_string(),
                    marker: marker.to_string(),
                });
            }
        }
        if d.join(".git").exists() {
            return Some(ProjectInfo {
                name: basename(d),
                path: d.to_string_lossy().into_owned(),
                kind: "git".to_string(),
                marker: ".git".to_string(),
            });
        }

        dir = d.parent();
    }
    None
}

fn project_name(dir: &Path, kind: &str, manifest: &Path) -> String {
    if kind == "node" {
        if let Ok(raw) = std::fs::read_to_string(manifest) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(name) = json.get("name").and_then(|n| n.as_str()) {
                    if !name.is_empty() {
                        return name.to_string();
                    }
                }
            }
        }
    }
    basename(dir)
}

fn basename(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| p.to_string_lossy().into_owned())
}

/// For `/Applications/Foo.app/Contents/MacOS/Foo`, return `/Applications/Foo.app`.
fn app_bundle_of(exe: &str) -> Option<String> {
    let idx = exe.find(".app/")?;
    Some(exe[..idx + 4].to_string())
}

/// Human-facing name: the `.app` bundle name for GUI apps, else the executable name.
fn display_name(exe: &str, fallback: &str) -> String {
    if let Some(bundle) = app_bundle_of(exe) {
        let stem = PathBuf::from(&bundle)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned());
        if let Some(stem) = stem {
            return stem;
        }
    }
    let name = Path::new(exe)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if name.is_empty() {
        fallback.to_string()
    } else {
        name
    }
}

fn state_label(raw: &str) -> (&'static str, bool) {
    match raw.chars().next() {
        Some('R') => ("running", false),
        Some('S') => ("sleeping", false),
        Some('I') => ("idle", false),
        Some('T') => ("paused", true),
        Some('U') => ("waiting", false),
        Some('Z') => ("zombie", false),
        _ => ("unknown", false),
    }
}

/// Build `ProcessInfo` for exactly the pids we care about.
///
/// Returns a map keyed by pid; pids that vanished between the port scan and the
/// `ps` call are simply absent.
pub fn describe(pids: &HashSet<i32>) -> Result<HashMap<i32, ProcessInfo>, String> {
    let (rows, comms, cmdlines) = ps_snapshot()?;

    let wanted: Vec<i32> = pids.iter().copied().filter(|p| rows.contains_key(p)).collect();
    let cwds = cwds_for(&wanted);

    let me = std::env::var("USER").unwrap_or_default();
    let own_pid = std::process::id() as i32;
    let is_root = unsafe { libc::geteuid() } == 0;

    let mut out = HashMap::new();
    for pid in wanted {
        let Some(row) = rows.get(&pid) else { continue };

        let exe = comms.get(&pid).cloned().unwrap_or_default();
        let command = cmdlines.get(&pid).cloned().unwrap_or_else(|| exe.clone());
        let name = display_name(&exe, "unknown");
        let (state, paused) = state_label(&row.state);
        let cwd = cwds.get(&pid).cloned();
        let cwd_exists = cwd.as_deref().is_some_and(|p| Path::new(p).is_dir());
        let project = cwd.as_deref().and_then(detect_project);

        let protected = pid <= 1
            || pid == own_pid
            || PROTECTED_NAMES.contains(&name.as_str())
            || exe.starts_with("/System/Library/PrivateFrameworks/");

        out.insert(
            pid,
            ProcessInfo {
                pid,
                ppid: row.ppid,
                name,
                app_bundle: app_bundle_of(&exe),
                exe,
                command,
                owned_by_me: is_root || row.user == me,
                user: row.user.clone(),
                state: state.to_string(),
                paused,
                cpu: row.cpu,
                mem: row.mem,
                uptime_seconds: row.uptime_seconds,
                cwd,
                cwd_exists,
                project,
                protected,
            },
        );
    }
    Ok(out)
}

/// Look up a single process — used by the control commands to re-check state
/// before and after signalling.
pub fn describe_one(pid: i32) -> Result<Option<ProcessInfo>, String> {
    let mut set = HashSet::new();
    set.insert(pid);
    Ok(describe(&set)?.remove(&pid))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ps_elapsed_time() {
        assert_eq!(parse_etime("12"), 12);
        assert_eq!(parse_etime("01:30"), 90);
        assert_eq!(parse_etime("02:00:00"), 7_200);
        assert_eq!(parse_etime("29-21:02:22"), 29 * 86_400 + 21 * 3_600 + 2 * 60 + 22);
        assert_eq!(parse_etime("garbage"), 0);
    }

    #[test]
    fn splits_pid_from_a_value_containing_spaces() {
        let map = split_pid_rest("  384 /Applications/Google Chrome.app/Contents/MacOS/Chrome\n 1 /sbin/launchd\n");
        assert_eq!(
            map.get(&384).map(String::as_str),
            Some("/Applications/Google Chrome.app/Contents/MacOS/Chrome"),
            "the whole remainder is the value, spaces and all"
        );
        assert_eq!(map.get(&1).map(String::as_str), Some("/sbin/launchd"));
    }

    #[test]
    fn maps_ps_state_letters_and_flags() {
        assert_eq!(state_label("T"), ("paused", true));
        assert_eq!(state_label("Ss"), ("sleeping", false));
        assert_eq!(state_label("R+"), ("running", false));
        assert_eq!(state_label("Z"), ("zombie", false));
        assert_eq!(state_label(""), ("unknown", false));
    }

    #[test]
    fn reads_app_bundle_and_display_name_from_exe_path() {
        let exe = "/Applications/Docker.app/Contents/MacOS/com.docker.backend";
        assert_eq!(app_bundle_of(exe).as_deref(), Some("/Applications/Docker.app"));
        assert_eq!(display_name(exe, "?"), "Docker");
        // Plain binaries fall back to the file name.
        assert_eq!(app_bundle_of("/usr/local/bin/ollama"), None);
        assert_eq!(display_name("/usr/local/bin/ollama", "?"), "ollama");
    }

    #[test]
    fn finds_project_root_by_walking_up_to_a_manifest() {
        let root = std::env::temp_dir().join("port-tracker-test-proj");
        let nested = root.join("src/deep/nested");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(root.join("package.json"), br#"{"name":"my-pkg"}"#).unwrap();

        let found = detect_project(nested.to_str().unwrap()).expect("should find the root");
        assert_eq!(found.kind, "node");
        assert_eq!(found.marker, "package.json");
        assert_eq!(found.name, "my-pkg", "package.json name beats the folder name");
        assert_eq!(found.path, root.to_string_lossy());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn does_not_claim_a_project_for_unmarked_directories() {
        let bare = std::env::temp_dir().join("port-tracker-test-bare");
        std::fs::create_dir_all(&bare).unwrap();
        assert!(detect_project(bare.to_str().unwrap()).is_none());
        std::fs::remove_dir_all(&bare).ok();
    }
}
