use std::collections::HashMap;

/// Generate SQL for creating a table from column definitions
/// Useful for generating migrations programmatically
pub fn generate_create_table_sql(
    table_name: &str,
    columns: &HashMap<String, (Vec<String>, String)>,
) -> String {
    let columns_sql: Vec<String> = columns
        .iter()
        .map(|(name, (options, type_))| format!("{} {} {}", name, type_, options.join(" ")))
        .collect();

    format!(
        "CREATE TABLE IF NOT EXISTS {} ({})",
        table_name,
        columns_sql.join(", ")
    )
}

/// Generate SQL for dropping a table
pub fn generate_drop_table_sql(table_name: &str) -> String {
    format!("DROP TABLE IF EXISTS {}", table_name)
}

/// Generate SQL for creating an index
pub fn generate_create_index_sql(index_name: &str, table_name: &str, columns: &[&str]) -> String {
    format!(
        "CREATE INDEX {} ON {}({})",
        index_name,
        table_name,
        columns.join(", ")
    )
}

/// Generate SQL for dropping an index
pub fn generate_drop_index_sql(index_name: &str) -> String {
    format!("DROP INDEX IF EXISTS {}", index_name)
}

/// Generate SQL for adding a column to an existing table
pub fn generate_add_column_sql(
    table_name: &str,
    column_name: &str,
    column_type: &str,
    options: &[String],
) -> String {
    format!(
        "ALTER TABLE {} ADD COLUMN {} {} {}",
        table_name,
        column_name,
        column_type,
        options.join(" ")
    )
}

/// Generate SQL for dropping a column (SQLite requires table recreation)
/// Returns a vector of SQL statements needed to drop a column
pub fn generate_drop_column_sql(
    table_name: &str,
    column_name: &str,
    remaining_columns: &[&str],
    column_definitions: &HashMap<String, (Vec<String>, String)>,
) -> Vec<String> {
    let temp_table = format!("{}_old", table_name);

    let columns_sql: Vec<String> = column_definitions
        .iter()
        .filter(|(name, _)| name.as_str() != column_name)
        .map(|(name, (options, type_))| format!("{} {} {}", name, type_, options.join(" ")))
        .collect();

    vec![
        format!("ALTER TABLE {} RENAME TO {}", table_name, temp_table),
        format!("CREATE TABLE {} ({})", table_name, columns_sql.join(", ")),
        format!(
            "INSERT INTO {} ({}) SELECT {} FROM {}",
            table_name,
            remaining_columns.join(", "),
            remaining_columns.join(", "),
            temp_table
        ),
        format!("DROP TABLE {}", temp_table),
    ]
}

/// Generate SQL for modifying a column type (SQLite requires table recreation)
/// Returns a vector of SQL statements needed to modify a column
pub fn generate_modify_column_sql(
    table_name: &str,
    column_definitions: &HashMap<String, (Vec<String>, String)>,
    column_list: &[&str],
) -> Vec<String> {
    let temp_table = format!("{}_temp", table_name);

    let columns_sql: Vec<String> = column_definitions
        .iter()
        .map(|(name, (options, type_))| format!("{} {} {}", name, type_, options.join(" ")))
        .collect();

    vec![
        format!("CREATE TABLE {} ({})", temp_table, columns_sql.join(", ")),
        format!(
            "INSERT INTO {} ({}) SELECT {} FROM {}",
            temp_table,
            column_list.join(", "),
            column_list.join(", "),
            table_name
        ),
        format!("DROP TABLE {}", table_name),
        format!("ALTER TABLE {} RENAME TO {}", temp_table, table_name),
    ]
}

/// Generate SQL for renaming a column
pub fn generate_rename_column_sql(table_name: &str, old_name: &str, new_name: &str) -> String {
    format!(
        "ALTER TABLE {} RENAME COLUMN {} TO {}",
        table_name, old_name, new_name
    )
}
