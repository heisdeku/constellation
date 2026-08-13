//! Scanning listening sockets and joining them to the process that owns them.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::proc::{self, ProcessInfo};
use crate::sh;

const LSOF_TIMEOUT: Duration = Duration::from_millis(8000);
const DOCKER_TIMEOUT: Duration = Duration::from_millis(2500);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerInfo {
    pub container_id: String,
    pub name: String,
    pub image: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortEntry {
    /// Stable across scans, so the UI can keep a row selected while it refreshes.
    pub id: String,
    /// "TCP" or "UDP".
    pub protocol: String,
    pub port: u16,
    /// Every address this pid bound for this port — IPv4 and IPv6 collapse into one row.
    pub addresses: Vec<String>,
    pub ip_versions: Vec<String>,
    /// loopback | lan | specific — how far the socket is reachable.
    pub scope: String,
    pub pid: i32,
    pub process: ProcessInfo,
    /// Set when the port is published by a Docker container rather than a plain process.
    pub docker: Option<DockerInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub entries: Vec<PortEntry>,
    pub scanned_at: u64,
    /// Non-fatal problems (e.g. UDP scan failed) surfaced to the UI rather than swallowed.
    pub warnings: Vec<String>,
}

struct RawSocket {
    pid: i32,
    protocol: String,
    ip_version: String,
    address: String,
    port: u16,
}

/// Parse `lsof -F` field output into one record per socket.
///
/// Field output is a flat stream: `p`/`c`/`L` lines open a process section, `f`
/// lines open a file section within it, and `t`/`P`/`n` describe that file.
fn parse_lsof(out: &str) -> Vec<RawSocket> {
    let mut sockets = Vec::new();
    let mut pid: Option<i32> = None;
    let mut ip_version = String::new();
    let mut protocol = String::new();

    for line in out.lines() {
        // Field output is `<tag><value>`; skip anything that isn't shaped that way
        // rather than risk slicing off a char boundary.
        let Some(tag) = line.get(..1) else { continue };
        let value = &line[1..];
        match tag {
            "p" => {
                pid = value.parse::<i32>().ok();
                ip_version.clear();
                protocol.clear();
            }
            "f" => {
                ip_version.clear();
                protocol.clear();
            }
            "t" => ip_version = value.to_string(),
            "P" => protocol = value.to_string(),
            "n" => {
                // Connected sockets (`a->b`) are not listeners; skip them.
                if value.contains("->") {
                    continue;
                }
                let (Some(pid), Some((addr, port))) = (pid, value.rsplit_once(':')) else {
                    continue;
                };
                let Ok(port) = port.parse::<u16>() else { continue };
                // lsof brackets specific IPv6 addresses: `[::1]:8080`.
                let addr = addr.trim_start_matches('[').trim_end_matches(']');
                sockets.push(RawSocket {
                    pid,
                    protocol: if protocol.is_empty() {
                        "TCP".to_string()
                    } else {
                        protocol.clone()
                    },
                    ip_version: if ip_version.is_empty() {
                        "IPv4".to_string()
                    } else {
                        ip_version.clone()
                    },
                    address: addr.to_string(),
                    port,
                });
            }
            _ => {}
        }
    }
    sockets
}

fn is_wildcard(addr: &str) -> bool {
    matches!(addr, "*" | "0.0.0.0" | "::" | "[::]")
}

fn is_loopback(addr: &str) -> bool {
    addr == "127.0.0.1" || addr == "::1" || addr.starts_with("127.")
}

fn scope_of(addresses: &[String]) -> &'static str {
    if addresses.iter().any(|a| is_wildcard(a)) {
        "lan"
    } else if addresses.iter().all(|a| is_loopback(a)) {
        "loopback"
    } else {
        "specific"
    }
}

/// Map published host port -> container, so Docker's ports show the container that
/// owns them instead of the opaque `com.docker.backend` process.
fn docker_port_map() -> HashMap<u16, DockerInfo> {
    let mut map = HashMap::new();
    let Ok(out) = sh::run(
        "docker",
        &[
            "ps",
            "--no-trunc",
            "--format",
            "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}",
        ],
        DOCKER_TIMEOUT,
    ) else {
        return map;
    };

    for line in out.lines() {
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() < 4 {
            continue;
        }
        let info = DockerInfo {
            container_id: fields[0].chars().take(12).collect(),
            name: fields[1].to_string(),
            image: fields[2].to_string(),
        };
        // e.g. "0.0.0.0:5432->5432/tcp, :::5432->5432/tcp"
        for mapping in fields[3].split(',') {
            let Some((host, _)) = mapping.trim().split_once("->") else {
                continue;
            };
            let Some((_, port)) = host.rsplit_once(':') else {
                continue;
            };
            if let Ok(port) = port.trim().parse::<u16>() {
                map.entry(port).or_insert_with(|| info.clone());
            }
        }
    }
    map
}

fn looks_like_docker(p: &ProcessInfo) -> bool {
    let name = p.name.to_ascii_lowercase();
    name.contains("docker") || name.contains("vpnkit") || name.contains("colima")
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Scan every listening socket on the machine.
///
/// `include_udp` is opt-in: UDP has no listen state, so the list is long and mostly
/// system chatter (mDNS, AirDrop, …).
pub fn scan(include_udp: bool) -> Result<ScanResult, String> {
    let mut warnings = Vec::new();

    let udp = if include_udp {
        Some(std::thread::spawn(|| {
            sh::run("lsof", &["-nP", "-w", "-iUDP", "-F", "pftPn"], LSOF_TIMEOUT)
        }))
    } else {
        None
    };

    let tcp_out = sh::run(
        "lsof",
        &["-nP", "-w", "-iTCP", "-sTCP:LISTEN", "-F", "pftPn"],
        LSOF_TIMEOUT,
    )
    .map_err(|e| format!("could not list TCP listeners: {e}"))?;

    let mut sockets = parse_lsof(&tcp_out);

    if let Some(handle) = udp {
        match handle.join() {
            Ok(Ok(out)) => sockets.extend(parse_lsof(&out)),
            Ok(Err(e)) => warnings.push(format!("UDP scan skipped: {e}")),
            Err(_) => warnings.push("UDP scan skipped: worker thread panicked".to_string()),
        }
    }

    let pids: HashSet<i32> = sockets.iter().map(|s| s.pid).collect();
    let processes = proc::describe(&pids)?;

    // Collapse the IPv4/IPv6 pair (and any extra bind addresses) into one row per
    // protocol+port+pid.
    let mut grouped: HashMap<(String, u16, i32), PortEntry> = HashMap::new();
    for s in sockets {
        let Some(process) = processes.get(&s.pid) else {
            // Process exited between the lsof call and the ps call.
            continue;
        };
        let key = (s.protocol.clone(), s.port, s.pid);
        let entry = grouped.entry(key).or_insert_with(|| PortEntry {
            id: format!("{}-{}-{}", s.protocol.to_lowercase(), s.port, s.pid),
            protocol: s.protocol.clone(),
            port: s.port,
            addresses: Vec::new(),
            ip_versions: Vec::new(),
            scope: "specific".to_string(),
            pid: s.pid,
            process: process.clone(),
            docker: None,
        });
        if !entry.addresses.contains(&s.address) {
            entry.addresses.push(s.address);
        }
        if !entry.ip_versions.contains(&s.ip_version) {
            entry.ip_versions.push(s.ip_version);
        }
    }

    let mut entries: Vec<PortEntry> = grouped.into_values().collect();
    for e in &mut entries {
        e.addresses.sort();
        e.ip_versions.sort();
        e.scope = scope_of(&e.addresses).to_string();
    }

    if entries.iter().any(|e| looks_like_docker(&e.process)) {
        let containers = docker_port_map();
        for e in &mut entries {
            if looks_like_docker(&e.process) {
                e.docker = containers.get(&e.port).cloned();
            }
        }
    }

    entries.sort_by(|a, b| a.port.cmp(&b.port).then(a.protocol.cmp(&b.protocol)));

    Ok(ScanResult {
        entries,
        scanned_at: now_millis(),
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real `lsof -nP -w -iTCP -sTCP:LISTEN -F pftPn` shape: one `p` section per
    /// process, one `f` section per socket.
    const SAMPLE: &str = "p748\nf23\ntIPv4\nPTCP\nn127.0.0.1:53454\nf24\ntIPv6\nPTCP\nn[::1]:53454\np806\nf11\ntIPv4\nPTCP\nn*:50215\n";

    #[test]
    fn parses_each_socket_with_its_process() {
        let s = parse_lsof(SAMPLE);
        assert_eq!(s.len(), 3);
        assert_eq!(s[0].pid, 748);
        assert_eq!(s[0].port, 53454);
        assert_eq!(s[0].address, "127.0.0.1");
        assert_eq!(s[0].protocol, "TCP");
        assert_eq!(s[2].pid, 806, "pid must advance at the next `p` line");
        assert_eq!(s[2].address, "*");
    }

    #[test]
    fn strips_brackets_from_ipv6_addresses() {
        let s = parse_lsof(SAMPLE);
        assert_eq!(s[1].address, "::1");
        assert_eq!(s[1].ip_version, "IPv6");
    }

    #[test]
    fn skips_connected_sockets() {
        let out = parse_lsof("p1\nf3\ntIPv4\nPTCP\nn127.0.0.1:5000->127.0.0.1:6000\n");
        assert!(out.is_empty(), "an established connection is not a listener");
    }

    #[test]
    fn tolerates_blank_and_malformed_lines() {
        // Must not panic on empty lines or unparseable ports.
        let out = parse_lsof("\np1\n\nf3\ntIPv4\nPTCP\nnnot-an-address\nn*:notaport\n");
        assert!(out.is_empty());
    }

    #[test]
    fn classifies_reach_from_bind_addresses() {
        assert_eq!(scope_of(&["127.0.0.1".into(), "::1".into()]), "loopback");
        assert_eq!(scope_of(&["*".into()]), "lan");
        assert_eq!(scope_of(&["0.0.0.0".into()]), "lan");
        assert_eq!(scope_of(&["192.168.1.5".into()]), "specific");
        // A wildcard anywhere in the set wins: it is reachable from the network.
        assert_eq!(scope_of(&["127.0.0.1".into(), "*".into()]), "lan");
    }
}
