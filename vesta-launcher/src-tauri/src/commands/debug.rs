use serde::{Deserialize, Serialize};
use tauri::Emitter;
use crate::utils::db_manager::{get_config_db, get_data_db};

#[derive(Serialize, Deserialize, Clone)]
struct TestPayload {
    title: String,
    message: String,
}

#[tauri::command]
pub fn test_command(app_handle: tauri::AppHandle) {
    app_handle.emit("core://crash", TestPayload { title: "Test".to_string(), message: "Test message".to_string()}).unwrap();
    println!("Test command invoked");
}

#[tauri::command]
pub fn debug_check_tables() -> Result<Vec<String>, String> {
    let config_db = get_config_db().map_err(|e| e.to_string())?;
    let data_db = get_data_db().map_err(|e| e.to_string())?;
    
    let config_conn = config_db.get_connection();
    let data_conn = data_db.get_connection();
    
    let mut stmt = config_conn.prepare("SELECT 'CONFIG: ' || name FROM sqlite_master WHERE type='table' ORDER BY name")
        .map_err(|e| e.to_string())?;
    
    let mut tables: Vec<String> = stmt.query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    
    let mut stmt2 = data_conn.prepare("SELECT 'DATA: ' || name FROM sqlite_master WHERE type='table' ORDER BY name")
        .map_err(|e| e.to_string())?;
    
    let data_tables: Vec<String> = stmt2.query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    
    tables.extend(data_tables);
    
    println!("Tables in databases:\n{}", tables.join("\n"));
    Ok(tables)
}

#[tauri::command]
pub fn debug_rerun_migrations() -> Result<String, String> {
    let mut results = Vec::new();
    
    // Force re-init logic (this is debug only, might need adjustment if we want to force run migrations)
    // Since get_config_db uses Once, we can't easily re-run it.
    // But we can manually call the init functions if we expose them or just return a message saying "Restart app"
    
    results.push("Migrations run on startup. Restart app to re-run if needed.".to_string());
    
    let result = results.join("\n");
    println!("{}", result);
    Ok(result)
}
