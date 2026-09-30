//! GameOptions has its own store and category filter; file operations share one lock.
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
        Category::GameOptions,
        revision,
        previous,
        preferences,
        changes,
    )
    .await
}
pub(crate) async fn apply_under_play_guard(id: i32) -> Result<(), String> {
    bundle::reconcile(Category::GameOptions, id, true).await
}
pub(crate) async fn restore_after_pack_update(id: i32) -> Result<(), String> {
    bundle::reconcile(Category::GameOptions, id, false).await
}
pub(crate) async fn after_exit(app: tauri::AppHandle, slug: String) {
    bundle::after_exit(app, slug).await
}
#[cfg(test)]
use super::{SharedBundle, SharedValue};
#[cfg(test)]
use std::collections::BTreeSet;
#[cfg(test)]
mod tests {
    use super::*;
    use diesel::connection::SimpleConnection;
    use diesel::Connection;

    fn schema(conn: &mut SqliteConnection) {
        conn.batch_execute(include_str!(
            "../../migrations/config/2026-09-13-000000_settings_sync/up.sql"
        ))
        .unwrap();
        conn.batch_execute(include_str!(
            "../../migrations/config/2026-09-13-000001_shared_settings/up.sql"
        ))
        .unwrap();
    }

    #[test]
    fn seed_accepts_unknown_safe_options_and_rejects_keybinds_and_protected_values() {
        let values = BTreeMap::from([
            ("fov".into(), "0".into()),
            ("renderDistance".into(), "12".into()),
            ("mod.customSetting".into(), "true".into()),
            ("key_key.forward".into(), "key.keyboard.w".into()),
            ("version".into(), "4903".into()),
        ]);
        let shared = super::super::bundle::seed(Category::GameOptions, &values, "1.21.1");
        assert!(shared.values.contains_key("fov"));
        assert!(shared.values.contains_key("renderDistance"));
        assert!(shared.values.contains_key("mod.customSetting"));
        assert!(!shared.values.contains_key("key_key.forward"));
        assert!(!shared.values.contains_key("version"));
    }

    #[test]
    fn readd_prunes_baseline_and_never_imports_local_while_out() {
        let mut conn = SqliteConnection::establish(":memory:").unwrap();
        schema(&mut conn);
        let mut shared = SharedBundle {
            values: BTreeMap::from([(
                "renderDistance".into(),
                SharedValue {
                    key: "renderDistance".into(),
                    value: "12".into(),
                },
            )]),
            applied: BTreeMap::from([(
                1,
                BTreeMap::from([("renderDistance".into(), "12".into())]),
            )]),
        };
        let prefs = Preferences {
            enabled: true,
            instance_ids: vec![1],
            selected_keys: Some(vec!["renderDistance".into()]),
            ..Default::default()
        };
        super::super::bundle::persist(
            &mut conn,
            Category::GameOptions,
            0,
            prefs.clone(),
            shared.clone(),
        )
        .unwrap();
        shared = super::super::bundle::load(&mut conn, Category::GameOptions).unwrap();
        shared.applied.clear(); // The instance is out and is added again.
        super::super::bundle::capture(
            Category::GameOptions,
            &mut shared,
            &prefs,
            1,
            "1.21.1",
            &BTreeMap::from([("renderDistance".into(), "32".into())]),
        );
        assert_eq!(shared.values["renderDistance"].value, "12");
    }

    #[test]
    fn selected_game_options_never_include_keybinds() {
        let shared = SharedBundle {
            values: BTreeMap::from([
                (
                    "fov".into(),
                    SharedValue {
                        key: "fov".into(),
                        value: "0".into(),
                    },
                ),
                (
                    "key_key.forward".into(),
                    SharedValue {
                        key: "key_key.forward".into(),
                        value: "17".into(),
                    },
                ),
            ]),
            ..Default::default()
        };
        let values = super::super::bundle::patch(
            Category::GameOptions,
            &shared,
            &Preferences::default(),
            "1.21.1",
            &BTreeMap::from([
                ("fov".into(), "0".into()),
                ("key_key.forward".into(), "17".into()),
            ]),
        );
        assert_eq!(
            values.keys().collect::<BTreeSet<_>>(),
            BTreeSet::from([&"fov".into()])
        );
    }
}
