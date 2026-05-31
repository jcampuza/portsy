use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Debug, thiserror::Error)]
pub enum PortsyError {
    #[error("invalid port range {start}-{end}")]
    InvalidRange { start: u16, end: u16 },
    #[error("failed to run {program}: {source}")]
    CommandFailed {
        program: &'static str,
        #[source]
        source: std::io::Error,
    },
    #[error("{program} exited with status {status}: {stderr}")]
    CommandStatus {
        program: &'static str,
        status: String,
        stderr: String,
    },
    #[error("pid {pid} is not listening on watched port {port}")]
    PortOwnerChanged { pid: u32, port: u16 },
    #[error("refusing to terminate the current Portsy process")]
    RefuseCurrentProcess,
    #[error("process {pid} cannot be killed: {reason}")]
    KillDisabled { pid: u32, reason: String },
    #[error("signal {signal} failed for pid {pid}: {source}")]
    SignalFailed {
        pid: u32,
        signal: i32,
        #[source]
        source: std::io::Error,
    },
}

pub type Result<T> = std::result::Result<T, PortsyError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortRange {
    pub start: u16,
    pub end: u16,
}

impl PortRange {
    pub fn new(start: u16, end: u16) -> Result<Self> {
        if start == 0 || start > end {
            return Err(PortsyError::InvalidRange { start, end });
        }
        Ok(Self { start, end })
    }

    pub fn contains(&self, port: u16) -> bool {
        self.start <= port && port <= self.end
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorConfig {
    pub ranges: Vec<PortRange>,
    pub refresh_interval_ms: u64,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self {
            ranges: vec![PortRange {
                start: 3000,
                end: 9999,
            }],
            refresh_interval_ms: 2_000,
        }
    }
}

impl MonitorConfig {
    pub fn validate(&self) -> Result<()> {
        for range in &self.ranges {
            PortRange::new(range.start, range.end)?;
        }
        Ok(())
    }

    pub fn watches(&self, port: u16) -> bool {
        self.ranges.iter().any(|range| range.contains(port))
    }

    pub fn interval(&self) -> Duration {
        Duration::from_millis(self.refresh_interval_ms.max(500))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortEntry {
    pub protocol: String,
    pub port: u16,
    pub pid: u32,
    pub process_name: String,
    pub command: String,
    pub user: String,
    pub bind_addresses: Vec<String>,
    pub kill_disabled_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortSnapshot {
    pub scanned_at_ms: u128,
    pub ranges: Vec<PortRange>,
    pub entries: Vec<PortEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KillReport {
    pub port: u16,
    pub pid: u32,
    pub process_name: String,
    pub terminated: bool,
    pub forced: bool,
    pub message: String,
}

pub fn scan_now(config: &MonitorConfig) -> Result<PortSnapshot> {
    config.validate()?;
    let output = Command::new("lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcLnP"])
        .output()
        .map_err(|source| PortsyError::CommandFailed {
            program: "lsof",
            source,
        })?;

    // lsof exits non-zero when no files match. Treat that as an empty snapshot.
    if !output.status.success() && output.stdout.is_empty() {
        return Ok(empty_snapshot(config));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut snapshot = parse_lsof_output(&stdout, config);
    enrich_commands(&mut snapshot);
    Ok(snapshot)
}

pub fn kill_pid_for_port(config: &MonitorConfig, pid: u32, port: u16) -> Result<KillReport> {
    let snapshot = scan_now(config)?;
    let entry = snapshot
        .entries
        .iter()
        .find(|entry| entry.pid == pid && entry.port == port)
        .ok_or(PortsyError::PortOwnerChanged { pid, port })?;

    kill_entry(config, entry)
}

pub fn kill_all_watched(
    config: &MonitorConfig,
    snapshot: &PortSnapshot,
) -> Vec<Result<KillReport>> {
    snapshot
        .entries
        .iter()
        .filter(|entry| config.watches(entry.port))
        .map(|entry| kill_entry(config, entry))
        .collect()
}

pub fn parse_lsof_output(output: &str, config: &MonitorConfig) -> PortSnapshot {
    let mut current_pid: Option<u32> = None;
    let mut current_command = String::new();
    let mut current_user = String::new();
    let mut current_protocol = String::from("tcp");
    let mut entries: BTreeMap<(u32, u16, String), DraftEntry> = BTreeMap::new();

    for raw_line in output.lines() {
        if raw_line.len() < 2 {
            continue;
        }

        let (field, value) = raw_line.split_at(1);
        match field {
            "p" => {
                current_pid = value.parse::<u32>().ok();
                current_command.clear();
                current_user.clear();
                current_protocol = String::from("tcp");
            }
            "c" => current_command = value.to_string(),
            "L" => current_user = value.to_string(),
            "P" => current_protocol = value.to_ascii_lowercase(),
            "n" => {
                let Some(pid) = current_pid else {
                    continue;
                };
                let Some((bind_address, port)) = parse_name_field(value) else {
                    continue;
                };
                if !config.watches(port) {
                    continue;
                }

                let key = (pid, port, current_protocol.clone());
                let entry = entries.entry(key).or_insert_with(|| DraftEntry {
                    protocol: current_protocol.clone(),
                    port,
                    pid,
                    process_name: current_command.clone(),
                    user: current_user.clone(),
                    bind_addresses: BTreeSet::new(),
                });
                entry.bind_addresses.insert(bind_address);
            }
            _ => {}
        }
    }

    let current_pid = std::process::id();
    let current_user = std::env::var("USER").unwrap_or_default();
    let entries = entries
        .into_values()
        .map(|draft| {
            let kill_disabled_reason = kill_disabled_reason(&draft, current_pid, &current_user);
            PortEntry {
                protocol: draft.protocol,
                port: draft.port,
                pid: draft.pid,
                process_name: draft.process_name,
                command: String::new(),
                user: draft.user,
                bind_addresses: draft.bind_addresses.into_iter().collect(),
                kill_disabled_reason,
            }
        })
        .collect::<Vec<_>>();

    let mut snapshot = PortSnapshot {
        scanned_at_ms: now_ms(),
        ranges: config.ranges.clone(),
        entries,
    };
    snapshot
        .entries
        .sort_by(|left, right| left.port.cmp(&right.port).then(left.pid.cmp(&right.pid)));
    snapshot
}

pub struct PortWatcher {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl PortWatcher {
    pub fn spawn<F>(config: MonitorConfig, mut on_snapshot: F) -> Self
    where
        F: FnMut(Result<PortSnapshot>) + Send + 'static,
    {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_thread = Arc::clone(&stop);
        let interval = config.interval();
        let handle = thread::spawn(move || {
            while !stop_thread.load(Ordering::SeqCst) {
                on_snapshot(scan_now(&config));
                sleep_interruptible(interval, &stop_thread);
            }
        });

        Self {
            stop,
            handle: Some(handle),
        }
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for PortWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}

fn kill_entry(config: &MonitorConfig, entry: &PortEntry) -> Result<KillReport> {
    if !config.watches(entry.port) {
        return Err(PortsyError::PortOwnerChanged {
            pid: entry.pid,
            port: entry.port,
        });
    }
    if entry.pid == std::process::id() {
        return Err(PortsyError::RefuseCurrentProcess);
    }
    if let Some(reason) = &entry.kill_disabled_reason {
        return Err(PortsyError::KillDisabled {
            pid: entry.pid,
            reason: reason.clone(),
        });
    }

    signal(entry.pid, libc::SIGTERM)?;
    thread::sleep(Duration::from_millis(1_500));

    let after_term = scan_now(config)?;
    let still_listening = after_term
        .entries
        .iter()
        .any(|candidate| candidate.pid == entry.pid && candidate.port == entry.port);

    if still_listening {
        signal(entry.pid, libc::SIGKILL)?;
        Ok(KillReport {
            port: entry.port,
            pid: entry.pid,
            process_name: entry.process_name.clone(),
            terminated: true,
            forced: true,
            message: "Sent SIGTERM, then SIGKILL because the port was still in use.".to_string(),
        })
    } else {
        Ok(KillReport {
            port: entry.port,
            pid: entry.pid,
            process_name: entry.process_name.clone(),
            terminated: true,
            forced: false,
            message: "Sent SIGTERM and the port was released.".to_string(),
        })
    }
}

fn signal(pid: u32, signal: i32) -> Result<()> {
    let result = unsafe { libc::kill(pid as libc::pid_t, signal) };
    if result == 0 {
        Ok(())
    } else {
        Err(PortsyError::SignalFailed {
            pid,
            signal,
            source: std::io::Error::last_os_error(),
        })
    }
}

fn enrich_commands(snapshot: &mut PortSnapshot) {
    for entry in &mut snapshot.entries {
        entry.command = process_args(entry.pid).unwrap_or_else(|| entry.process_name.clone());
    }
}

fn process_args(pid: u32) -> Option<String> {
    let output = Command::new("ps")
        .args(["-ww", "-p", &pid.to_string(), "-o", "args="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let args = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if args.is_empty() {
        None
    } else {
        Some(args)
    }
}

fn parse_name_field(value: &str) -> Option<(String, u16)> {
    let (address, port_text) = value.rsplit_once(':')?;
    let digits = port_text
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>();
    let port = digits.parse::<u16>().ok()?;
    Some((address.to_string(), port))
}

fn kill_disabled_reason(
    draft: &DraftEntry,
    current_pid: u32,
    current_user: &str,
) -> Option<String> {
    if draft.pid == current_pid {
        return Some("Portsy owns this process.".to_string());
    }
    if draft.user == "root" {
        return Some("Root-owned process; Portsy will not request sudo.".to_string());
    }
    if !current_user.is_empty() && !draft.user.is_empty() && draft.user != current_user {
        return Some(format!("Owned by user {}.", draft.user));
    }
    None
}

fn empty_snapshot(config: &MonitorConfig) -> PortSnapshot {
    PortSnapshot {
        scanned_at_ms: now_ms(),
        ranges: config.ranges.clone(),
        entries: Vec::new(),
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn sleep_interruptible(duration: Duration, stop: &AtomicBool) {
    let slice = Duration::from_millis(100);
    let mut slept = Duration::ZERO;
    while slept < duration && !stop.load(Ordering::SeqCst) {
        let next = slice.min(duration - slept);
        thread::sleep(next);
        slept += next;
    }
}

#[derive(Debug)]
struct DraftEntry {
    protocol: String,
    port: u16,
    pid: u32,
    process_name: String,
    user: String,
    bind_addresses: BTreeSet<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> MonitorConfig {
        MonitorConfig {
            ranges: vec![PortRange {
                start: 3000,
                end: 9999,
            }],
            refresh_interval_ms: 2_000,
        }
    }

    #[test]
    fn parses_and_deduplicates_ipv4_ipv6_rows() {
        let input = "\
p123
cnode
Ljoseph
f10
PTCP
n*:3000
f11
PTCP
n[::1]:3000
";

        let snapshot = parse_lsof_output(input, &config());

        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].pid, 123);
        assert_eq!(snapshot.entries[0].port, 3000);
        assert_eq!(snapshot.entries[0].process_name, "node");
        assert_eq!(
            snapshot.entries[0].bind_addresses,
            vec!["*".to_string(), "[::1]".to_string()]
        );
    }

    #[test]
    fn filters_ports_outside_configured_ranges() {
        let input = "\
p123
cnode
Ljoseph
PTCP
n*:2999
n*:3000
n*:10000
";

        let snapshot = parse_lsof_output(input, &config());

        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].port, 3000);
    }

    #[test]
    fn ignores_malformed_name_fields() {
        let input = "\
p123
cnode
Ljoseph
PTCP
nnot-a-port
n*:abc
";

        let snapshot = parse_lsof_output(input, &config());

        assert!(snapshot.entries.is_empty());
    }

    #[test]
    fn kill_all_only_targets_watched_ranges() {
        let config = config();
        let snapshot = PortSnapshot {
            scanned_at_ms: 0,
            ranges: config.ranges.clone(),
            entries: vec![PortEntry {
                protocol: "tcp".to_string(),
                port: 10000,
                pid: 999999,
                process_name: "outside".to_string(),
                command: "outside".to_string(),
                user: std::env::var("USER").unwrap_or_default(),
                bind_addresses: vec!["*".to_string()],
                kill_disabled_reason: None,
            }],
        };

        let reports = kill_all_watched(&config, &snapshot);

        assert!(reports.is_empty());
    }
}
