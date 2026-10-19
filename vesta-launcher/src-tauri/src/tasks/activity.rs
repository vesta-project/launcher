//! In-memory presentation snapshot of this Task Manager lifetime, independent of notifications.
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize)]
pub struct ActivityRecord {
    pub revision: u64,
    pub activity: Value,
}

#[derive(Serialize)]
pub struct ActivitySnapshot {
    pub epoch: String,
    pub revision: u64,
    pub activities: Vec<ActivityRecord>,
}

#[derive(Clone, Serialize)]
struct ActivityEvent {
    epoch: String,
    #[serde(flatten)]
    record: ActivityRecord,
}

struct State {
    epoch: String,
    revision: u64,
    rows: HashMap<String, ActivityRecord>,
}

pub struct TaskActivityStore(Mutex<State>);
impl Default for TaskActivityStore {
    fn default() -> Self {
        Self(Mutex::new(State {
            epoch: uuid::Uuid::new_v4().to_string(),
            revision: 0,
            rows: HashMap::new(),
        }))
    }
}

fn terminal(row: &Value) -> bool {
    matches!(
        row.get("state").and_then(Value::as_str),
        Some("done" | "failed" | "cancelled")
    )
}

impl TaskActivityStore {
    fn record(&self, patch: &Value) -> Option<ActivityEvent> {
        let fields = patch.as_object()?;
        let id = fields.get("id")?.as_str()?;
        let mut state = self.0.lock().unwrap_or_else(|error| error.into_inner());
        let new_attempt = fields.get("state").and_then(Value::as_str) == Some("queued");
        let old = state.rows.get(id);
        // Late asynchronous reporter callbacks cannot revive or modify finished work.
        if !new_attempt && old.map_or(true, |row| terminal(&row.activity)) {
            return None;
        }
        if !new_attempt
            && fields.get("attempt").is_some_and(|attempt| {
                old.and_then(|row| row.activity.get("attempt")) != Some(attempt)
            })
        {
            return None;
        }
        let previous_state = old
            .and_then(|row| row.activity.get("state"))
            .and_then(Value::as_str);
        let now = chrono::Utc::now().timestamp_millis();
        let mut row = if new_attempt {
            let mut row = Map::new();
            row.insert("startedAt".into(), now.into());
            row.insert("progress".into(), (-1).into());
            row.insert("overallProgress".into(), (-1).into());
            row
        } else {
            old?.activity.as_object()?.clone()
        };
        for (key, value) in fields {
            if !value.is_null() {
                row.insert(key.clone(), value.clone());
            }
        }
        if previous_state == Some("queued")
            && row.get("state").and_then(Value::as_str) == Some("running")
        {
            row.insert("startedAt".into(), now.into());
        }
        // A phase reset must also retire the previous phase's counters.
        if fields.get("progress").and_then(Value::as_i64) == Some(-1) {
            for key in ["currentStep", "totalSteps"] {
                row.insert(key.into(), fields.get(key).cloned().unwrap_or(Value::Null));
            }
        }
        if !new_attempt {
            if let (Some(previous), Some(next)) = (
                old.and_then(|row| row.activity.get("overallProgress"))
                    .and_then(Value::as_i64),
                row.get("overallProgress").and_then(Value::as_i64),
            ) {
                if previous >= 0 && next < previous {
                    row.insert("overallProgress".into(), previous.into());
                }
            }
        }
        let mut activity = Value::Object(row);
        if terminal(&activity) {
            activity["finishedAt"] = now.into();
            activity["cancellable"] = false.into();
            if activity["state"] == "done" {
                activity["progress"] = 100.into();
                if activity["overallProgress"]
                    .as_i64()
                    .is_some_and(|value| value >= 0)
                {
                    activity["overallProgress"] = 100.into();
                }
            }
        }
        state.revision += 1;
        let record = ActivityRecord {
            revision: state.revision,
            activity,
        };
        state.rows.insert(id.to_string(), record.clone());
        if terminal(&record.activity) {
            // Active work is never evicted; terminal presentation history is bounded.
            let mut finished = state
                .rows
                .iter()
                .filter(|(_, row)| terminal(&row.activity))
                .map(|(id, row)| (row.revision, id.clone()))
                .collect::<Vec<_>>();
            finished.sort_unstable_by(|a, b| b.0.cmp(&a.0));
            for (_, id) in finished.into_iter().skip(50) {
                state.rows.remove(&id);
            }
        }
        Some(ActivityEvent {
            epoch: state.epoch.clone(),
            record,
        })
    }

    pub fn snapshot(&self) -> ActivitySnapshot {
        let state = self.0.lock().unwrap_or_else(|error| error.into_inner());
        let mut activities = state.rows.values().cloned().collect::<Vec<_>>();
        activities.sort_unstable_by_key(|row| row.revision);
        ActivitySnapshot {
            epoch: state.epoch.clone(),
            revision: state.revision,
            activities,
        }
    }
}

/// Preserve old events for existing consumers and publish a revisioned full row for recovery.
pub fn publish(app: &AppHandle, legacy_event: &str, patch: Value) {
    if let Some(manager) = app.try_state::<super::manager::TaskManager>() {
        if let Some(event) = manager.activity.record(&patch) {
            let _ = app.emit("core://activity-state", event);
        }
    }
    let _ = app.emit(legacy_event, patch);
}
