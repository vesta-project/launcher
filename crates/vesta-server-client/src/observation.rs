//! Bounded, network-independent scheduling for a server's active operation set.
use crate::model::ServerOperation;
use std::collections::HashMap;
use std::time::Duration;

pub const ACTIVE_OPERATION_LIMIT: usize = 32;

#[derive(Default)]
pub struct OperationObservation {
    seen: HashMap<String, (String, i64, Option<u8>, bool)>,
    missing_cursor: usize,
    active_cursor: usize,
    unchanged: u32,
}
impl OperationObservation {
    /// Rotate the durable backlog so 32 unresolved old IDs cannot starve new work.
    pub fn active_window(&mut self, ids: &[String]) -> Vec<String> {
        if ids.is_empty() {
            self.retain(ids);
            return Vec::new();
        }
        let start = self.active_cursor % ids.len();
        let count = ids.len().min(ACTIVE_OPERATION_LIMIT);
        let active = (0..count)
            .map(|offset| ids[(start + offset) % ids.len()].clone())
            .collect::<Vec<_>>();
        self.active_cursor = (start + count) % ids.len();
        self.retain(&active);
        active
    }
    pub fn known(&self, id: &str) -> bool {
        self.seen.contains_key(id)
    }
    /// Keep only currently tracked IDs; history cannot grow this map indefinitely.
    pub fn retain(&mut self, active: &[String]) {
        self.seen
            .retain(|id, _| active.iter().any(|entry| entry == id));
    }
    pub fn changed(&mut self, operation: &ServerOperation) -> bool {
        let value = (
            operation.state.clone(),
            operation.updated_at_ms,
            operation.progress_percent,
            operation.reconciling,
        );
        if self.seen.get(&operation.operation_id) == Some(&value) {
            return false;
        }
        if self.seen.len() == ACTIVE_OPERATION_LIMIT
            && !self.seen.contains_key(&operation.operation_id)
        {
            return false;
        }
        self.seen.insert(operation.operation_id.clone(), value);
        true
    }
    /// One rotating detail read per cycle covers IDs outside the newest list page.
    pub fn missing<'a>(&mut self, active: &'a [String], present: &[String]) -> Option<&'a str> {
        let missing: Vec<_> = active.iter().filter(|id| !present.contains(id)).collect();
        if missing.is_empty() {
            return None;
        }
        let next = missing[self.missing_cursor % missing.len()];
        self.missing_cursor = self.missing_cursor.wrapping_add(1);
        Some(next.as_str())
    }
    pub fn delay(&mut self, changed: bool, visible: bool, retry_after_ms: Option<u64>) -> Duration {
        self.unchanged = if changed {
            0
        } else {
            self.unchanged.saturating_add(1)
        };
        let cap = if visible { 10 } else { 30 };
        let normal = 2_u64.saturating_add(u64::from(self.unchanged) * 2).min(cap);
        Duration::from_millis((normal * 1000).max(retry_after_ms.unwrap_or(0).min(3_600_000)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detail_fallback_rotates_and_idle_hidden_work_backs_off() {
        let mut state = OperationObservation::default();
        let ids = vec!["one".into(), "two".into(), "three".into()];
        let page = vec!["one".into()];
        assert_eq!(state.missing(&ids, &page), Some("two"));
        assert_eq!(state.missing(&ids, &page), Some("three"));
        assert_eq!(state.missing(&ids, &page), Some("two"));
        assert!(state.missing(&ids, &ids).is_none());
        for _ in 0..40 {
            state.delay(false, false, None);
        }
        assert_eq!(state.delay(false, false, None), Duration::from_secs(30));
        assert_eq!(state.delay(true, true, None), Duration::from_secs(2));
        assert_eq!(
            state.delay(false, true, Some(20_000)),
            Duration::from_secs(20)
        );
    }
    #[test]
    fn durable_backlog_larger_than_window_does_not_starve_later_ids() {
        let mut state = OperationObservation::default();
        let ids = (0..70).map(|n| format!("op{n}")).collect::<Vec<_>>();
        let mut covered = std::collections::HashSet::new();
        for _ in 0..3 {
            let window = state.active_window(&ids);
            assert_eq!(window.len(), ACTIVE_OPERATION_LIMIT);
            covered.extend(window);
        }
        assert_eq!(covered.len(), 70);
        assert!(state.active_window(&[]).is_empty());
    }
    #[test]
    fn observations_dedupe_bound_memory_and_retire_finished_ids() {
        let mut state = OperationObservation::default();
        for n in 0..64 {
            let operation = crate::operations::decode(serde_json::json!({"operation_id":format!("op{n}"),"state":"running","created_at_ms":0,"updated_at_ms":1}), None).unwrap();
            assert_eq!(state.changed(&operation), n < ACTIVE_OPERATION_LIMIT);
            assert!(!state.changed(&operation));
        }
        assert_eq!(state.seen.len(), ACTIVE_OPERATION_LIMIT);
        state.retain(&["op0".into()]);
        assert_eq!(state.seen.len(), 1);
    }
}
