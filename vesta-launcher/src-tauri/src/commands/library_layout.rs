use crate::schema::config::library_layout;
use crate::utils::db::get_config_conn;
use diesel::prelude::*;

/// The layout is a small JSON document; anything larger is a bug, not a library.
const MAX_LAYOUT_BYTES: usize = 256 * 1024;

fn load(conn: &mut SqliteConnection) -> Result<Option<String>, diesel::result::Error> {
    library_layout::table
        .find(1)
        .select(library_layout::layout)
        .first(conn)
        .optional()
}

fn store(conn: &mut SqliteConnection, layout: &str) -> Result<(), String> {
    if layout.len() > MAX_LAYOUT_BYTES {
        return Err("Library layout is too large to save".to_string());
    }
    serde_json::from_str::<serde_json::Value>(layout)
        .map_err(|error| format!("Library layout is not valid JSON: {error}"))?;
    diesel::replace_into(library_layout::table)
        .values((library_layout::id.eq(1), library_layout::layout.eq(layout)))
        .execute(conn)
        .map_err(|error| format!("Failed to save library layout: {error}"))?;
    Ok(())
}

/// Returns the saved layout document, or `None` if one was never saved.
#[tauri::command]
pub fn get_library_layout() -> Result<Option<String>, String> {
    let mut conn = get_config_conn().map_err(|error| error.to_string())?;
    load(&mut conn).map_err(|error| format!("Failed to load library layout: {error}"))
}

#[tauri::command]
pub fn set_library_layout(layout: String) -> Result<(), String> {
    let mut conn = get_config_conn().map_err(|error| error.to_string())?;
    store(&mut conn, &layout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::connection::SimpleConnection;

    fn connection() -> SqliteConnection {
        let mut conn = SqliteConnection::establish(":memory:").unwrap();
        conn.batch_execute(include_str!(
            "../../migrations/config/2026-10-03-000000_library_layout/up.sql"
        ))
        .unwrap();
        conn
    }

    #[test]
    fn missing_layout_loads_as_none() {
        assert_eq!(load(&mut connection()).unwrap(), None);
    }

    #[test]
    fn saving_twice_keeps_a_single_latest_row() {
        let mut conn = connection();
        store(&mut conn, r#"{"version":1,"sort":"name"}"#).unwrap();
        store(&mut conn, r#"{"version":1,"sort":"custom"}"#).unwrap();
        assert_eq!(
            load(&mut conn).unwrap().as_deref(),
            Some(r#"{"version":1,"sort":"custom"}"#)
        );
        let rows: i64 = library_layout::table.count().get_result(&mut conn).unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn rejects_invalid_or_oversized_documents() {
        let mut conn = connection();
        assert!(store(&mut conn, "not json").is_err());
        let huge = format!("\"{}\"", "x".repeat(MAX_LAYOUT_BYTES));
        assert!(store(&mut conn, &huge).is_err());
        assert_eq!(load(&mut conn).unwrap(), None);
    }
}
