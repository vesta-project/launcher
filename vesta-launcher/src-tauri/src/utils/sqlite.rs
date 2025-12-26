use crate::utils::migrations::{Migration, MigrationRunner, SQLiteMigrationRunner};
use anyhow::{anyhow, Error};
use piston_macros::SqlTable;
use rusqlite::types::{Null, ToSqlOutput};
use rusqlite::{params, params_from_iter, Connection, Statement};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::{fmt, fs};

pub enum VersionVerification {
    Equal,
    GreaterOrEqual,
    LessOrEqual,
    Any,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq, Default, Clone, Copy)]
pub enum AUTOINCREMENT {
    #[default]
    INIT,
    VALUE(i32),
}

impl AUTOINCREMENT {
    /// Convert to i32, returning 0 for INIT
    pub fn as_i32(&self) -> i32 {
        match self {
            AUTOINCREMENT::INIT => 0,
            AUTOINCREMENT::VALUE(i) => *i,
        }
    }
}

impl<T: Eq> PartialEq<T> for AUTOINCREMENT
where
    i32: PartialEq<T>,
{
    fn eq(&self, other: &T) -> bool {
        match self {
            AUTOINCREMENT::INIT => false,
            AUTOINCREMENT::VALUE(i) => i == other,
        }
    }
}

impl rusqlite::ToSql for AUTOINCREMENT {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        match self {
            AUTOINCREMENT::INIT => Ok(ToSqlOutput::from(Null)),
            AUTOINCREMENT::VALUE(i) => i.to_sql(),
        }
    }
}

pub trait SqlTable {
    /// Key, Attributes, Type
    fn columns() -> HashMap<String, (Vec<String>, String)>;

    fn values(&self) -> anyhow::Result<(Vec<Box<dyn rusqlite::ToSql>>, Vec<String>)>;

    fn name() -> String;

    fn get_auto_increment(&self) -> Option<(String, &AUTOINCREMENT)>;

    /// The migration version this table schema corresponds to
    /// Default: "0.1.0"
    fn migration_version() -> String {
        "0.1.0".to_string()
    }

    /// Generate the complete CREATE TABLE SQL for this table
    /// This becomes the single source of truth for schema
    fn schema_sql() -> String {
        let columns = Self::columns();
        let table_name = Self::name();

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

    /// Generate a migration description for this table
    /// Override this to provide custom description
    fn migration_description() -> String {
        format!("Create {} table", Self::name())
    }

    /// Generate default data SQL (INSERT statements)
    /// Override this to provide default data for the table
    fn default_data_sql() -> Vec<String> {
        vec![]
    }
}

#[derive(Debug, Deserialize, Serialize)]
struct ItemInHome {
    name: String,
    age: i32,
}

#[derive(Debug, Deserialize, Serialize, SqlTable)]
struct CustomTableStruct {
    #[primary_key]
    #[autoincrement]
    id: AUTOINCREMENT,
    first_name: String,
    last_name: String,
    age: i32,
    #[table_name]
    custom_table_name1: String,
}

#[test]
fn test() {
    let path = std::env::temp_dir().join("vesta_sqlite_test");

    let db = SQLiteDB::new(
        path,
        "test.db".to_string(),
        "1.0.5".to_string(),
        VersionVerification::LessOrEqual,
    )
    .unwrap();

    let data = CustomTableStruct::new("AnotherOne".to_string(), "John".to_string(), 20);

    db.create_new_table_serde::<CustomTableStruct>().unwrap();
    db.insert_data_if_not_exists_serde(&data).unwrap();

    #[derive(Debug, Deserialize, Serialize)]
    struct CustomTableStruct2 {
        id: i32,
        first_name: String,
        last_name: String,
        age: i32,
    }

    let results = db
        .search_data_serde::<CustomTableStruct, &str, CustomTableStruct2>(
            SQLiteSelect::ALL,
            "last_name",
            "John",
        )
        .unwrap();

    println!("{:?}", results);
}

pub struct SQLiteDB {
    conn: Connection,
    /// The directory of the db
    dir: PathBuf,
    /// The name of the db including the extension
    name: String,
    /// The full path to the db
    full_path: PathBuf,
    /// The version of the db
    version: String,
}

impl SQLiteDB {
    /// Creates a new SQLiteDB instance
    ///
    /// # Errors
    /// Returns an error if we fail to create the path to the database
    /// Returns an error if the version check fails
    pub fn new(
        dir: PathBuf,
        name: String,
        version: String,
        v_type: VersionVerification,
    ) -> Result<Self, Error> {
        let full_path = dir.join(&name);
        fs::create_dir_all(&dir)?;

        let db = SQLiteDB {
            conn: Connection::open(&full_path)?,
            dir,
            name,
            full_path,
            version,
        };

        if db.verify_version(&db.version, v_type)? {
            db.update_db_version()?;
            Ok(db)
        } else {
            Err(anyhow::anyhow!("Version verification failed"))
        }
    }

    pub fn get_version(&self) -> String {
        self.version.clone()
    }

    /// Updates the version of the db
    ///
    /// # Errors
    /// Returns an error if we fail to update the db in the call to [`Self::update_db_version`]
    pub fn update_version(
        &mut self,
        version: String,
        v_type: VersionVerification,
    ) -> Result<(), Error> {
        if self.verify_version(&version, v_type)? {
            self.version = version;
            self.update_db_version()
        } else {
            Err(anyhow::anyhow!("Version verification failed"))
        }
    }

    /// Updates the directory that the db is stored in
    ///
    /// # Errors
    /// Returns an error if we fail to create the directory when it doesn't exist
    pub fn update_dir(&mut self, dir: PathBuf) -> Result<(), Error> {
        fs::create_dir_all(&self.dir)?;
        self.dir = dir;
        self.full_path = self.dir.join(&self.name);
        Ok(())
    }

    pub fn update_name(&mut self, name: String) {
        self.name = name;
        self.full_path = self.dir.join(&self.name);
    }

    /// Updates the database with a new version
    /// Not public because this should only be used from within the struct
    /// Instead use [`Self::update_version`]
    ///
    /// # Errors
    /// Will return the following errors
    /// - If we fail to open a connection to the database
    /// - if we fail to execute a command
    fn update_db_version(&self) -> Result<(), Error> {
        self.conn.execute("BEGIN TRANSACTION;", [])?;

        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS db_version (
            id	TEXT,
            PRIMARY KEY(id)
        );",
            (),
        )?;

        let mut stmt = self.conn.prepare("SELECT COUNT(*) FROM db_version")?;
        let row_exists: bool = stmt
            .query_map(params![], |row| row.get(0))?
            .next()
            .unwrap_or(Ok(false))?;

        if row_exists {
            self.conn
                .execute("UPDATE db_version SET id =?", params![self.version])?;
        } else {
            self.conn.execute(
                "INSERT INTO db_version (id) VALUES (?)",
                params![self.version],
            )?;
        }

        self.conn.execute("COMMIT;", [])?;

        Ok(())
    }

    /// Returns true if the version is verified or if the table doesn't exist
    /// Returns false if the version is not verified according to the [`VersionVerification`] type
    ///
    /// # Errors
    /// Returns an error if we fail to execute a query
    fn verify_version(
        &self,
        new_version: &str,
        v_type: VersionVerification,
    ) -> Result<bool, Error> {
        let Ok(mut stmt) = self.conn.prepare("SELECT id FROM db_version") else {
            return Ok(true);
        };

        // Execute the prepared statement
        let mut version_result = stmt.query_map(params![], |row| row.get(0))?;

        // Check if we got a valid result
        if let Some(version) = version_result.next() {
            // There is a version in the table, proceed with verification
            let version: String = match version {
                Ok(v) => v,
                _ => return Ok(true), // Return true if no version is found
            };

            let v_a = version_compare::Version::from(new_version);
            let v_b = version_compare::Version::from(&version);

            Ok(match v_type {
                VersionVerification::Equal => v_a == v_b,
                VersionVerification::GreaterOrEqual => v_a >= v_b,
                VersionVerification::LessOrEqual => v_a <= v_b,
                VersionVerification::Any => true,
            })
        } else {
            // No version found in the table, return true
            Ok(true)
        }
    }

    pub fn get_connection(&self) -> &Connection {
        &self.conn
    }

    /// Run database migrations to bring the schema up to the specified version
    ///
    /// # Errors
    /// Returns an error if migrations fail to execute
    pub fn run_migrations(
        &self,
        migrations: Vec<Migration>,
        target_version: &str,
    ) -> Result<(), Error> {
        let runner = SQLiteMigrationRunner::new(&self.conn, migrations);
        runner.migrate_up(target_version)
    }

    /// Get the current database schema version from migrations
    ///
    /// # Errors
    /// Returns an error if unable to query migration history
    pub fn get_schema_version(&self) -> Result<String, Error> {
        let runner = SQLiteMigrationRunner::new(&self.conn, vec![]);
        runner.get_current_version()
    }

    /// Get list of applied migrations
    ///
    /// # Errors
    /// Returns an error if unable to query migration history
    pub fn get_applied_migrations(&self) -> Result<Vec<String>, Error> {
        let runner = SQLiteMigrationRunner::new(&self.conn, vec![]);
        runner.get_applied_migrations()
    }

    /// Automatically sync database schema with a SqlTable struct definition.
    /// 
    /// This is the "magic" auto-migration method:
    /// 1. Creates the table if it doesn't exist (using full schema from struct)
    /// 2. Detects any missing columns and adds them via ALTER TABLE
    /// 3. No manual migrations needed - just change the struct!
    /// 
    /// # Type Parameters
    /// * `T` - A type implementing SqlTable trait
    /// 
    /// # Returns
    /// * `Ok(Vec<String>)` - List of columns that were added (empty if none)
    /// * `Err` - If schema sync fails
    /// 
    /// # Example
    /// ```rust
    /// // Just change your struct and call sync_schema - that's it!
    /// let added_columns = db.sync_schema::<AppConfig>()?;
    /// if !added_columns.is_empty() {
    ///     println!("Added columns: {:?}", added_columns);
    /// }
    /// ```
    pub fn sync_schema<T: SqlTable>(&self) -> Result<Vec<String>, Error> {
        let table_name = T::name();
        let struct_columns = T::columns();
        
        // Step 1: Create table if it doesn't exist
        self.create_new_table_serde::<T>()?;
        
        // Step 2: Get existing columns from the database
        let mut stmt = self.conn.prepare(&format!("PRAGMA table_info({})", table_name))?;
        let existing_columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(Result::ok)
            .map(|s| s.to_lowercase())
            .collect();
        
        // Step 3: Find and add missing columns
        let mut added_columns = Vec::new();
        
        for (column_name, (options, column_type)) in &struct_columns {
            let column_name_lower = column_name.to_lowercase();
            
            if !existing_columns.contains(&column_name_lower) {
                // Column is missing - add it!
                let options_str = options.join(" ");
                
                // Determine default value based on type
                let default_clause = if options_str.contains("NOT NULL") {
                    // Need a default for NOT NULL columns
                    match column_type.to_uppercase().as_str() {
                        "INTEGER" => " DEFAULT 0",
                        "TEXT" => " DEFAULT ''",
                        "REAL" => " DEFAULT 0.0",
                        _ => " DEFAULT NULL",
                    }
                } else {
                    ""
                };
                
                let sql = format!(
                    "ALTER TABLE {} ADD COLUMN \"{}\" {} {}{}",
                    table_name, column_name, column_type, options_str, default_clause
                );
                
                self.conn.execute(&sql, [])?;
                added_columns.push(column_name.clone());
                println!("✓ Auto-added column: {}.{}", table_name, column_name);
            }
        }
        
        Ok(added_columns)
    }

    /// Initialize database with all migrations up to current version
    ///
    /// # Errors
    /// Returns an error if migrations fail to execute
    pub fn initialize_with_migrations(&self) -> Result<(), Error> {
        let migrations = crate::utils::migrations::get_data_migrations();
        let target_version = &self.version;
        self.run_migrations(migrations, target_version)
    }

    /// Create a table using SqlTable trait and optionally add to migration system
    /// This bridges the gap between SqlTable definitions and migration tracking
    ///
    /// # Errors
    /// Returns an error if table creation fails
    pub fn create_table_from_trait<T: SqlTable>(&self) -> Result<String, Error> {
        let columns = T::columns();
        let table_name = T::name();

        let columns_sql: Vec<String> = columns
            .iter()
            .map(|(name, (options, type_))| format!("{} {} {}", name, type_, options.join(" ")))
            .collect();

        let create_sql = format!(
            "CREATE TABLE IF NOT EXISTS {} ({})",
            table_name,
            columns_sql.join(", ")
        );

        Ok(create_sql)
    }

    /// Modify a column by recreating the table (SQLite limitation)
    /// This is the safe way to modify columns in SQLite
    ///
    /// # Arguments
    /// * `table_name` - Name of the table to modify
    /// * `new_columns` - Complete new column definitions
    /// * `preserve_columns` - Optional list of columns to preserve (defaults to all)
    ///
    /// # Errors
    /// Returns an error if table modification fails
    ///
    /// # Example
    /// ```rust
    /// let new_columns = vec![
    ///     SQLiteColumn::new("id", SQLiteColumnType::INTEGER, vec![SQLiteColumnOptions::PrimaryKey]),
    ///     SQLiteColumn::new("memory_mb", SQLiteColumnType::INTEGER, vec![]), // Changed from BIGINT
    /// ];
    /// db.modify_table_schema("instances", new_columns, None)?;
    /// ```
    pub fn modify_table_schema(
        &self,
        table_name: &str,
        new_columns: Vec<SQLiteColumn>,
        preserve_columns: Option<Vec<&str>>,
    ) -> Result<(), Error> {
        let temp_table = format!("{}_temp", table_name);

        // Get column names to preserve
        let column_list = if let Some(cols) = preserve_columns {
            cols.join(", ")
        } else {
            // Get all current columns from the table
            let mut stmt = self
                .conn
                .prepare(&format!("PRAGMA table_info({})", table_name))?;
            let columns: Vec<String> = stmt
                .query_map([], |row| row.get::<_, String>(1))?
                .filter_map(Result::ok)
                .collect();
            columns.join(", ")
        };

        // Create new table with updated schema
        self.create_new_table(&temp_table, new_columns)?;

        // Copy data from old table
        self.conn.execute(
            &format!(
                "INSERT INTO {} SELECT {} FROM {}",
                temp_table, column_list, table_name
            ),
            [],
        )?;

        // Drop old table
        self.conn
            .execute(&format!("DROP TABLE {}", table_name), [])?;

        // Rename temp table to original name
        self.conn.execute(
            &format!("ALTER TABLE {} RENAME TO {}", temp_table, table_name),
            [],
        )?;

        Ok(())
    }

    /// Add a column to an existing table
    /// This is safe in SQLite and doesn't require table recreation
    ///
    /// # Errors
    /// Returns an error if column addition fails
    pub fn add_column(&self, table_name: &str, column: SQLiteColumn) -> Result<(), Error> {
        let mut column_sql = format!("{} {}", column.name, column.column_type);

        for option in &column.column_options {
            column_sql.push_str(&format!(" {}", option));
        }

        self.conn.execute(
            &format!("ALTER TABLE {} ADD COLUMN {}", table_name, column_sql),
            [],
        )?;

        Ok(())
    }

    /// Drop a column from a table (requires table recreation in SQLite)
    ///
    /// # Errors
    /// Returns an error if column drop fails
    pub fn drop_column(&self, table_name: &str, column_name: &str) -> Result<(), Error> {
        // Get all columns except the one to drop
        let mut stmt = self
            .conn
            .prepare(&format!("PRAGMA table_info({})", table_name))?;
        let columns: Vec<(String, String, String)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(1)?, // name
                    row.get::<_, String>(2)?, // type
                    row.get::<_, String>(3)?, // notnull/pk etc
                ))
            })?
            .filter_map(Result::ok)
            .filter(|(name, _, _)| name != column_name)
            .collect();

        let column_list = columns
            .iter()
            .map(|(name, _, _)| name.as_str())
            .collect::<Vec<_>>()
            .join(", ");

        let new_columns: Vec<SQLiteColumn> = columns
            .iter()
            .map(|(name, type_, _)| {
                SQLiteColumn::new(
                    name,
                    match type_.to_uppercase().as_str() {
                        "INTEGER" => SQLiteColumnType::INTEGER,
                        "TEXT" => SQLiteColumnType::TEXT,
                        "BLOB" => SQLiteColumnType::BLOB,
                        "REAL" => SQLiteColumnType::REAL,
                        _ => SQLiteColumnType::NUMERIC,
                    },
                    vec![],
                )
            })
            .collect();

        self.modify_table_schema(
            table_name,
            new_columns,
            Some(column_list.split(", ").collect()),
        )?;

        Ok(())
    }

    /// Rename a column in a table
    ///
    /// # Errors
    /// Returns an error if column rename fails
    pub fn rename_column(
        &self,
        table_name: &str,
        old_name: &str,
        new_name: &str,
    ) -> Result<(), Error> {
        self.conn.execute(
            &format!(
                "ALTER TABLE {} RENAME COLUMN {} TO {}",
                table_name, old_name, new_name
            ),
            [],
        )?;

        Ok(())
    }

    // Utilities
    pub fn create_new_table(&self, name: &str, columns: Vec<SQLiteColumn>) -> Result<(), Error> {
        let columns_sql: Vec<String> = columns
            .iter()
            .map(|column| {
                let mut column_sql = format!("{} {}", column.name, column.column_type);

                for option in &column.column_options {
                    column_sql.push_str(&format!(" {option}"));
                }

                column_sql
            })
            .collect();

        let sql = format!(
            "CREATE TABLE IF NOT EXISTS {} ({});",
            name,
            columns_sql.join(", ")
        );

        self.conn.execute(&sql, [])?;
        Ok(())
    }

    pub fn create_new_table_serde<T: SqlTable>(&self) -> Result<(), Error> {
        let columns_sql: HashMap<String, (Vec<String>, String)> = T::columns();
        let name = T::name();
        let columns_string = columns_sql
            .iter()
            .map(|(k, v)| format!("\"{}\" {} {}", k, v.1, v.0.join(" ")))
            .collect::<Vec<String>>()
            .join(",");
        let sql = format!("CREATE TABLE IF NOT EXISTS {name} ({columns_string});");

        self.conn.execute(&sql, [])?;
        Ok(())
    }

    pub fn insert_data<P>(
        &self,
        table_name: &str,
        columns: Vec<&str>,
        values: P,
    ) -> Result<(), rusqlite::Error>
    where
        P: rusqlite::Params,
    {
        let columns_str = columns.join(", ");
        let placeholders: Vec<String> = vec!["?".to_string(); columns.len()];
        let placeholders_str = placeholders.join(", ");

        let sql = format!("INSERT INTO {table_name} ({columns_str}) VALUES ({placeholders_str})");

        self.conn.execute(&sql, values)?;
        Ok(())
    }

    pub fn insert_data_serde<P>(&self, data: &P) -> Result<(), Error>
    where
        P: SqlTable,
    {
        let (values, columns) = data.values()?;
        let columns_str = columns
            .iter()
            .map(|x| format!("\"{0}\"", x))
            .collect::<Vec<String>>()
            .join(", ");
        let placeholders: Vec<String> = vec!["?".to_string(); columns.len()];
        let placeholders_str = placeholders.join(", ");

        let sql = format!(
            "INSERT INTO {} ({columns_str}) VALUES ({placeholders_str})",
            P::name()
        );

        self.conn.execute(&sql, params_from_iter(values))?;
        Ok(())
    }

    pub fn insert_data_if_not_exists_serde<T>(&self, data: &T) -> Result<(), Error>
    where
        T: SqlTable + serde::de::DeserializeOwned,
    {
        match data.get_auto_increment() {
            Some((name, AUTOINCREMENT::VALUE(term))) => {
                let info: Vec<T> = self.search_data(
                    SQLiteSelect::ONLY(vec![name.clone()]),
                    &T::name(),
                    &name,
                    term,
                )?;

                if info.is_empty() {
                    self.insert_data_serde(data)?;
                } else {
                    panic!("Duplicate found")
                }

                Ok(())
            }
            Some((_name, AUTOINCREMENT::INIT)) => {
                // For INIT (new records), just insert directly
                self.insert_data_serde(data)?;
                Ok(())
            }
            None => Err(anyhow!("Auto increment not found")),
        }
    }

    fn create_search_stmt(
        &self,
        select: SQLiteSelect,
        table_name: &str,
        column_name: &str,
    ) -> Result<Statement<'_>, Error> {
        Ok(match select {
            SQLiteSelect::ALL => self.conn.prepare(&format!(
                "SELECT * FROM {} WHERE {} = ?",
                table_name, column_name
            ))?,
            SQLiteSelect::ONLY(columns) => self.conn.prepare(&format!(
                "SELECT {} FROM {} WHERE {} = ?",
                columns
                    .iter()
                    .map(|x| format!("\"{0}\"", x))
                    .collect::<Vec<String>>()
                    .join(", "),
                table_name,
                column_name
            ))?,
        })
    }

    pub fn search_data<T, S>(
        &self,
        select: SQLiteSelect,
        table_name: &str,
        column_name: &str,
        search_term: S,
    ) -> Result<Vec<T>, Error>
    where
        T: serde::de::DeserializeOwned,
        S: rusqlite::ToSql,
    {
        // TODO: Maybe not use a mut. This is a bit of a hack
        let mut stmt = self.create_search_stmt(select, table_name, column_name)?;
        let mut persons: Vec<T> = Vec::new();
        let then = stmt.query_and_then(params!(search_term), |row| -> Result<(), Error> {
            persons.push(serde_rusqlite::from_row::<T>(row)?);
            Ok(())
        })?;
        then.enumerate().for_each(|i| {
            i.1.unwrap();
        });
        Ok(persons)
    }

    pub fn search_data_serde<T, S, R>(
        &self,
        select: SQLiteSelect,
        column_name: &str,
        search_term: S,
    ) -> Result<Vec<R>, Error>
    where
        T: SqlTable,
        S: rusqlite::ToSql,
        R: serde::de::DeserializeOwned,
    {
        // TODO: Use a macro to generate R
        // TODO: Maybe not use a mut. This is a bit of a hack
        let mut stmt = self.create_search_stmt(select, &T::name(), column_name)?;
        let mut persons: Vec<R> = Vec::new();
        let then = stmt.query_and_then(params!(search_term), |row| -> Result<(), Error> {
            persons.push(serde_rusqlite::from_row::<R>(row)?);
            Ok(())
        })?;
        for (idx, result) in then.enumerate() {
            result.map_err(|e| anyhow::anyhow!("Failed to deserialize row {}: {}", idx, e))?;
        }
        Ok(persons)
    }

    pub fn get_all_data<T: DeserializeOwned>(&self, table_name: &str) -> Result<Vec<T>, Error> {
        let mut stmt = self.conn.prepare(&format!("SELECT * FROM {table_name}"))?;
        let mut persons: Vec<T> = Vec::new();
        let then = stmt.query_and_then([], |row| -> Result<(), Error> {
            persons.push(serde_rusqlite::from_row::<T>(row)?);
            Ok(())
        })?;
        for (idx, result) in then.enumerate() {
            result.map_err(|e| anyhow::anyhow!("Failed to deserialize row {}: {}", idx, e))?;
        }
        Ok(persons)
    }

    pub fn get_all_data_serde<T: SqlTable, R: DeserializeOwned>(&self) -> Result<Vec<R>, Error> {
        let mut stmt = self.conn.prepare(&format!("SELECT * FROM {}", T::name()))?;
        let mut persons: Vec<R> = Vec::new();
        let then = stmt.query_and_then([], |row| -> Result<(), Error> {
            persons.push(serde_rusqlite::from_row::<R>(row)?);
            Ok(())
        })?;
        for (idx, result) in then.enumerate() {
            result.map_err(|e| anyhow::anyhow!("Failed to deserialize row {}: {}", idx, e))?;
        }
        Ok(persons)
    }

    /// Update data using SqlTable
    /// Updates a row identified by the primary key
    pub fn update_data_serde<T, K>(
        &self,
        data: &T,
        pk_column: &str,
        pk_value: K,
    ) -> Result<(), Error>
    where
        T: SqlTable,
        K: rusqlite::ToSql,
    {
        let (values, columns) = data.values()?;

        // Build SET clause (excluding primary key)
        let set_clauses: Vec<String> = columns
            .iter()
            .filter(|col| *col != pk_column)
            .map(|col| format!("\"{}\" = ?", col))
            .collect();

        if set_clauses.is_empty() {
            return Err(anyhow!("No columns to update"));
        }

        let sql = format!(
            "UPDATE {} SET {} WHERE {} = ?",
            T::name(),
            set_clauses.join(", "),
            pk_column
        );

        // Build parameters (excluding primary key column value, then add pk_value at end)
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = values
            .into_iter()
            .zip(columns.iter())
            .filter(|(_, col)| *col != pk_column)
            .map(|(val, _)| val)
            .collect();

        params.push(Box::new(pk_value));

        self.conn.execute(&sql, params_from_iter(params))?;
        Ok(())
    }
}

pub enum SQLiteColumnType {
    INTEGER,
    TEXT,
    BLOB,
    NUMERIC,
    REAL,
}

#[derive(Deserialize, Serialize)]
pub enum SQLiteSelect {
    ALL,
    ONLY(Vec<String>),
}

/*pub enum SQLiteColumnType {
    INTEGER(i64),
    TEXT(String),
    BLOB(Vec<u8>),
    NUMERIC(f64),
    REAL(f64)
}*/

/*impl SQLiteColumnType {
    pub fn get_type(&self) -> &str {
        match &self {
            SQLiteColumnType::INTEGER => "INTEGER",
            SQLiteColumnType::TEXT => "TEXT",
            SQLiteColumnType::BLOB => "BLOB",
            SQLiteColumnType::NUMERIC => "NUMERIC",
            SQLiteColumnType::REAL => "REAL",
        }
    }

    pub fn get_value(&self) -> String {
        match &self {
            SQLiteColumnType::INTEGER(val) => val.to_string(),
            SQLiteColumnType::TEXT(val) => val.clone(),
            SQLiteColumnType::BLOB(val) => format!("{:?}", val),
            SQLiteColumnType::NUMERIC(val) => val.to_string(),
            SQLiteColumnType::REAL(val) => val.to_string(),
        }
    }
}*/

impl fmt::Display for SQLiteColumnType {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            SQLiteColumnType::INTEGER => write!(f, "INTEGER"),
            SQLiteColumnType::TEXT => write!(f, "TEXT"),
            SQLiteColumnType::BLOB => write!(f, "BLOB"),
            SQLiteColumnType::NUMERIC => write!(f, "NUMERIC"),
            SQLiteColumnType::REAL => write!(f, "REAL"),
        }
    }
}

pub enum SQLiteColumnOptions {
    PrimaryKey,
    AutoIncrement,
    Unique,
    NotNull,
}

impl fmt::Display for SQLiteColumnOptions {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            SQLiteColumnOptions::PrimaryKey => write!(f, "PRIMARY KEY"),
            SQLiteColumnOptions::AutoIncrement => write!(f, "AUTOINCREMENT"),
            SQLiteColumnOptions::Unique => write!(f, "UNIQUE"),
            SQLiteColumnOptions::NotNull => write!(f, "NOT NULL"),
        }
    }
}

pub struct SQLiteColumn {
    pub name: String,
    pub column_type: SQLiteColumnType,
    column_options: Vec<SQLiteColumnOptions>,
}

impl SQLiteColumn {
    pub fn new(
        name: &str,
        column_type: SQLiteColumnType,
        column_options: Vec<SQLiteColumnOptions>,
    ) -> Self {
        Self {
            name: name.to_string(),
            column_type,
            column_options,
        }
    }
}
