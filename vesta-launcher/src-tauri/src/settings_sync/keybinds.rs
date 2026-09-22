//! Keybinds has its own store and category filter; file operations share one lock.
use super::{bundle, Category, Preferences, Snapshot};
use diesel::SqliteConnection;
use std::collections::BTreeMap;
pub(crate) fn populate(conn: &mut SqliteConnection, snapshot: &mut Snapshot) -> Result<(), String> {
    bundle::populate(conn, snapshot)
}
pub(crate) async fn configure(
    app: &tauri::AppHandle,
    revision: i64,
    previous: Preferences,
    preferences: Preferences,
    changes: BTreeMap<String, String>,
) -> Result<Snapshot, String> {
    bundle::configure(
        app,
        Category::Keybinds,
        revision,
        previous,
        preferences,
        changes,
    )
    .await
}
pub(crate) async fn apply_under_play_guard(id: i32) -> Result<(), String> {
    bundle::reconcile(Category::Keybinds, id, true).await
}
pub(crate) async fn restore_after_pack_update(id: i32) -> Result<(), String> {
    bundle::reconcile(Category::Keybinds, id, false).await
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keybind_filter_accepts_named_and_legacy_numeric_values() {
        let shared = super::super::bundle::seed(
            Category::Keybinds,
            &BTreeMap::from([
                ("key_key.forward".into(), "key.keyboard.w".into()),
                ("key_key.jump".into(), "32".into()),
                ("fov".into(), "0".into()),
            ]),
            "1.21.1",
        );
        assert!(shared.values.contains_key("key_key.forward"));
        assert_eq!(shared.values["key_key.jump"].value, "32");
        assert!(!shared.values.contains_key("fov"));
    }
}
