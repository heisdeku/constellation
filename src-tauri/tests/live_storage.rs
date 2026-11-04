//! Measures the real disk. Read-only: this file must never call `storage::clean`.
//!
//! Ignored by default because it walks every project folder, which takes minutes:
//! `cargo test --test live_storage -- --ignored --nocapture`

use std::path::PathBuf;
use std::sync::Mutex;

use system_manager_lib::storage::{self, Measurement, Target};

#[test]
#[ignore = "walks the whole home folder"]
fn measures_every_target_on_this_machine() {
    let home = PathBuf::from(std::env::var_os("HOME").expect("HOME"));
    let queue = Mutex::new(storage::targets(&home));
    let results: Mutex<Vec<(Target, Measurement)>> = Mutex::new(Vec::new());

    std::thread::scope(|scope| {
        for _ in 0..6 {
            scope.spawn(|| loop {
                let Some(target) = queue.lock().unwrap().pop() else { break };
                let size = storage::measure(&target.id, &home).expect("measure");
                results.lock().unwrap().push((target, size));
            });
        }
    });

    let mut results = results.into_inner().unwrap();
    results.sort_by_key(|(_, size)| std::cmp::Reverse(size.reclaimable_bytes));

    for (target, size) in &results {
        assert!(
            size.reclaimable_bytes <= size.apparent_bytes,
            "{} frees more than it occupies: {size:?}",
            target.label
        );
    }

    let gb = |bytes: u64| bytes as f64 / 1e9;
    eprintln!("\n{:>9} {:>9}  {:<7} LABEL", "FREES", "APPARENT", "TIER");
    for (target, size) in results.iter().take(45) {
        eprintln!(
            "{:>7.2}GB {:>7.2}GB  {:<7} {}",
            gb(size.reclaimable_bytes),
            gb(size.apparent_bytes),
            format!("{:?}", target.safety),
            target.label
        );
    }

    eprintln!("\nCan't be removed here:");
    for (target, size) in results.iter().filter(|(t, _)| t.safety == storage::Safety::Keep) {
        eprintln!(
            "{:>7.2}GB  {} ({} unreadable)",
            gb(size.apparent_bytes),
            target.label,
            size.unreadable
        );
    }

    let disk = storage::disk_usage().expect("disk usage");
    assert!(disk.free_bytes < disk.total_bytes);
    let tier = |safety: storage::Safety| -> u64 {
        results
            .iter()
            .filter(|(t, _)| t.safety == safety)
            .map(|(_, s)| s.reclaimable_bytes)
            .sum()
    };
    let unreadable: u64 = results.iter().map(|(_, s)| s.unreadable).sum();
    eprintln!(
        "\n{} targets · safe {:.1}GB · review {:.1}GB · {} unreadable · {:.1}GB free of {:.1}GB · macOS {:.1}GB",
        results.len(),
        gb(tier(storage::Safety::Safe)),
        gb(tier(storage::Safety::Review)),
        unreadable,
        gb(disk.free_bytes),
        gb(disk.total_bytes),
        gb(disk.system_bytes)
    );
}
