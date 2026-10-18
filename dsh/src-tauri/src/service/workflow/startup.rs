use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::config;

static SPAWN_AT_MS: AtomicU64 = AtomicU64::new(0);
static HTTP_AT_MS: AtomicU64 = AtomicU64::new(0);
static READY_RECORDED: AtomicBool = AtomicBool::new(false);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

fn elapsed_since_spawn_ms() -> Option<u64> {
    let spawn_at = SPAWN_AT_MS.load(Ordering::SeqCst);
    (spawn_at > 0).then(|| now_ms().saturating_sub(spawn_at))
}

pub(super) fn note_spawn() {
    SPAWN_AT_MS.store(now_ms(), Ordering::SeqCst);
    HTTP_AT_MS.store(0, Ordering::SeqCst);
    READY_RECORDED.store(false, Ordering::SeqCst);
}

pub(super) fn note_http_answer() {
    let Some(elapsed_ms) = elapsed_since_spawn_ms() else {
        return;
    };
    if HTTP_AT_MS
        .compare_exchange(0, now_ms(), Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    log::info!(
        "STARTUP_HTTP: Harness answered the boot probe, spawn_to_first_response_ms={elapsed_ms}"
    );
}

pub(super) fn note_client_modules_ready(ready: usize, total: usize) {
    let Some(elapsed_ms) = elapsed_since_spawn_ms() else {
        return;
    };
    if READY_RECORDED.swap(true, Ordering::SeqCst) {
        return;
    }
    log::info!("STARTUP_READY: client modules {ready}/{total} ready, spawn_to_ready_ms={elapsed_ms}");
    let spawn_at = SPAWN_AT_MS.load(Ordering::SeqCst);
    let http_at = HTTP_AT_MS.load(Ordering::SeqCst);
    let http_ms = (http_at > 0 && http_at >= spawn_at).then(|| http_at - spawn_at);
    if let Some(report) = slow_startup_report(elapsed_ms, http_ms, config::SLOW_STARTUP_THRESHOLD) {
        log::warn!("{report}");
    }
}

pub(super) fn slow_startup_report(
    ready_ms: u64,
    http_ms: Option<u64>,
    threshold: Duration,
) -> Option<String> {
    let threshold_ms = threshold.as_millis() as u64;
    if ready_ms <= threshold_ms {
        return None;
    }
    let split = match http_ms {
        Some(http_ms) => format!(
            "spawn_to_http_ms={http_ms}, http_to_ready_ms={}",
            ready_ms.saturating_sub(http_ms)
        ),
        None => "spawn_to_http_ms=unknown".to_string(),
    };
    Some(format!(
        "STARTUP_SLOW: spawn_to_ready_ms={ready_ms} exceeds {threshold_ms}ms ({split}); \
         inspect the STARTUP_* lines above and the dsh-web.log child output"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_spawn_recorded_yields_no_elapsed() {
        assert!(elapsed_since_spawn_ms().is_none());
    }

    #[test]
    fn report_is_silent_below_threshold() {
        assert!(slow_startup_report(5_000, Some(4_000), Duration::from_secs(15)).is_none());
        assert!(slow_startup_report(15_000, Some(14_000), Duration::from_secs(15)).is_none());
    }

    #[test]
    fn report_splits_child_boot_from_module_readiness() {
        let report = slow_startup_report(39_240, Some(39_180), Duration::from_secs(15)).unwrap();
        assert!(report.starts_with("STARTUP_SLOW:"));
        assert!(report.contains("spawn_to_ready_ms=39240"));
        assert!(report.contains("spawn_to_http_ms=39180"));
        assert!(report.contains("http_to_ready_ms=60"));
        assert!(report.contains("15000ms"));
    }

    #[test]
    fn report_keeps_total_when_http_stamp_missing() {
        let report = slow_startup_report(20_000, None, Duration::from_secs(15)).unwrap();
        assert!(report.contains("spawn_to_ready_ms=20000"));
        assert!(report.contains("spawn_to_http_ms=unknown"));
    }
}
