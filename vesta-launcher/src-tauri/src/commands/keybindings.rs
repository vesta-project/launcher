use crate::schema::config::keybinding_commands;
use crate::utils::db::get_config_conn;
use diesel::prelude::*;
use diesel::result::{DatabaseErrorKind, Error as DieselError};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::Emitter;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandDefinitionInput {
    pub command_id: String,
    pub handler_id: String,
    pub label: String,
    pub description: String,
    pub category: String,
    pub default_chord: Option<String>,
    pub sort_order: i32,
}

#[derive(Clone, Debug, Queryable, Selectable, Serialize)]
#[diesel(table_name = keybinding_commands)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
#[serde(rename_all = "camelCase")]
pub struct KeybindingCommand {
    pub command_id: String,
    pub handler_id: String,
    pub label: String,
    pub description: String,
    pub category: String,
    pub default_chord: Option<String>,
    pub current_chord: Option<String>,
    pub customized: bool,
    pub available: bool,
    pub sort_order: i32,
}

#[derive(Insertable)]
#[diesel(table_name = keybinding_commands)]
struct NewKeybindingCommand<'a> {
    command_id: &'a str,
    handler_id: &'a str,
    label: &'a str,
    description: &'a str,
    category: &'a str,
    default_chord: Option<&'a str>,
    current_chord: Option<&'a str>,
    customized: bool,
    available: bool,
    sort_order: i32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingMutationResult {
    pub command: KeybindingCommand,
    pub conflict: Option<KeybindingCommand>,
    pub applied: bool,
}

fn validate_definition(definition: &CommandDefinitionInput) -> Result<(), String> {
    if definition.command_id.trim().is_empty() {
        return Err("Command ID cannot be empty".to_string());
    }
    if definition.handler_id.trim().is_empty() {
        return Err(format!(
            "Command {} has an empty handler ID",
            definition.command_id
        ));
    }
    if definition.label.trim().is_empty() {
        return Err(format!(
            "Command {} has an empty label",
            definition.command_id
        ));
    }
    Ok(())
}

fn is_unique_violation(error: &DieselError) -> bool {
    matches!(
        error,
        DieselError::DatabaseError(DatabaseErrorKind::UniqueViolation, _)
    )
}

fn list_available(conn: &mut SqliteConnection) -> Result<Vec<KeybindingCommand>, DieselError> {
    keybinding_commands::table
        .filter(keybinding_commands::available.eq(true))
        .order((
            keybinding_commands::category.asc(),
            keybinding_commands::sort_order.asc(),
            keybinding_commands::label.asc(),
        ))
        .select(KeybindingCommand::as_select())
        .load(conn)
}

fn get_command(
    conn: &mut SqliteConnection,
    command_id: &str,
) -> Result<KeybindingCommand, DieselError> {
    keybinding_commands::table
        .find(command_id)
        .select(KeybindingCommand::as_select())
        .first(conn)
}

fn find_conflict(
    conn: &mut SqliteConnection,
    command_id: &str,
    chord: &str,
) -> Result<Option<KeybindingCommand>, DieselError> {
    keybinding_commands::table
        .filter(keybinding_commands::command_id.ne(command_id))
        .filter(keybinding_commands::current_chord.eq(chord))
        .select(KeybindingCommand::as_select())
        .first(conn)
        .optional()
}

fn reconcile_catalog(
    conn: &mut SqliteConnection,
    definitions: &[CommandDefinitionInput],
) -> Result<Vec<KeybindingCommand>, String> {
    let mut seen = HashSet::new();
    for definition in definitions {
        validate_definition(definition)?;
        if !seen.insert(definition.command_id.as_str()) {
            return Err(format!("Duplicate command ID: {}", definition.command_id));
        }
    }

    conn.transaction::<_, DieselError, _>(|conn| {
        diesel::update(keybinding_commands::table)
            .set(keybinding_commands::available.eq(false))
            .execute(conn)?;

        for definition in definitions {
            let existing = keybinding_commands::table
                .find(&definition.command_id)
                .select(KeybindingCommand::as_select())
                .first(conn)
                .optional()?;

            if let Some(existing) = existing {
                let desired_chord = if existing.customized {
                    existing.current_chord
                } else {
                    definition.default_chord.clone()
                };

                let update_result =
                    diesel::update(keybinding_commands::table.find(&definition.command_id))
                        .set((
                            keybinding_commands::handler_id.eq(&definition.handler_id),
                            keybinding_commands::label.eq(&definition.label),
                            keybinding_commands::description.eq(&definition.description),
                            keybinding_commands::category.eq(&definition.category),
                            keybinding_commands::default_chord.eq(&definition.default_chord),
                            keybinding_commands::current_chord.eq(&desired_chord),
                            keybinding_commands::available.eq(true),
                            keybinding_commands::sort_order.eq(definition.sort_order),
                        ))
                        .execute(conn);

                if let Err(error) = update_result {
                    if !existing.customized && is_unique_violation(&error) {
                        diesel::update(keybinding_commands::table.find(&definition.command_id))
                            .set((
                                keybinding_commands::handler_id.eq(&definition.handler_id),
                                keybinding_commands::label.eq(&definition.label),
                                keybinding_commands::description.eq(&definition.description),
                                keybinding_commands::category.eq(&definition.category),
                                keybinding_commands::default_chord.eq(&definition.default_chord),
                                keybinding_commands::current_chord.eq::<Option<String>>(None),
                                keybinding_commands::available.eq(true),
                                keybinding_commands::sort_order.eq(definition.sort_order),
                            ))
                            .execute(conn)?;
                    } else {
                        return Err(error);
                    }
                }
            } else {
                let new_command = NewKeybindingCommand {
                    command_id: &definition.command_id,
                    handler_id: &definition.handler_id,
                    label: &definition.label,
                    description: &definition.description,
                    category: &definition.category,
                    default_chord: definition.default_chord.as_deref(),
                    current_chord: definition.default_chord.as_deref(),
                    customized: false,
                    available: true,
                    sort_order: definition.sort_order,
                };

                if let Err(error) = diesel::insert_into(keybinding_commands::table)
                    .values(&new_command)
                    .execute(conn)
                {
                    if is_unique_violation(&error) {
                        diesel::insert_into(keybinding_commands::table)
                            .values(NewKeybindingCommand {
                                current_chord: None,
                                ..new_command
                            })
                            .execute(conn)?;
                    } else {
                        return Err(error);
                    }
                }
            }
        }

        list_available(conn)
    })
    .map_err(|error| format!("Failed to reconcile keybinding catalog: {error}"))
}

fn assign_binding(
    conn: &mut SqliteConnection,
    command_id: &str,
    chord: Option<&str>,
    customized: bool,
    replace_conflict: bool,
) -> Result<BindingMutationResult, String> {
    conn.transaction::<_, anyhow::Error, _>(|conn| {
        let command = get_command(conn, command_id)
            .map_err(|error| anyhow::anyhow!("Unknown command {command_id}: {error}"))?;

        let conflict = match chord {
            Some(chord) => find_conflict(conn, command_id, chord)
                .map_err(|error| anyhow::anyhow!("Failed to check shortcut conflict: {error}"))?,
            None => None,
        };

        if conflict.is_some() && !replace_conflict {
            return Ok(BindingMutationResult {
                command,
                conflict,
                applied: false,
            });
        }

        if let Some(conflict) = &conflict {
            diesel::update(keybinding_commands::table.find(&conflict.command_id))
                .set((
                    keybinding_commands::current_chord.eq::<Option<String>>(None),
                    keybinding_commands::customized.eq(true),
                ))
                .execute(conn)
                .map_err(|error| {
                    anyhow::anyhow!("Failed to clear conflicting shortcut: {error}")
                })?;
        }

        diesel::update(keybinding_commands::table.find(command_id))
            .set((
                keybinding_commands::current_chord.eq(chord),
                keybinding_commands::customized.eq(customized),
            ))
            .execute(conn)
            .map_err(|error| anyhow::anyhow!("Failed to update shortcut: {error}"))?;

        let command = get_command(conn, command_id)
            .map_err(|error| anyhow::anyhow!("Failed to reload updated command: {error}"))?;
        Ok(BindingMutationResult {
            command,
            conflict,
            applied: true,
        })
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn reconcile_keybinding_catalog(
    definitions: Vec<CommandDefinitionInput>,
) -> Result<Vec<KeybindingCommand>, String> {
    let mut conn = get_config_conn().map_err(|error| error.to_string())?;
    reconcile_catalog(&mut conn, &definitions)
}

#[tauri::command]
pub fn list_keybinding_commands() -> Result<Vec<KeybindingCommand>, String> {
    let mut conn = get_config_conn().map_err(|error| error.to_string())?;
    list_available(&mut conn)
        .map_err(|error| format!("Failed to load keybinding commands: {error}"))
}

#[tauri::command]
pub fn set_keybinding(
    app: tauri::AppHandle,
    command_id: String,
    chord: String,
    replace_conflict: bool,
) -> Result<BindingMutationResult, String> {
    let chord = chord.trim();
    if chord.is_empty() {
        return Err("Shortcut cannot be empty".to_string());
    }
    let mut conn = get_config_conn().map_err(|error| error.to_string())?;
    let result = assign_binding(&mut conn, &command_id, Some(chord), true, replace_conflict)?;
    emit_binding_update(&app, &result);
    Ok(result)
}

#[tauri::command]
pub fn clear_keybinding(
    app: tauri::AppHandle,
    command_id: String,
) -> Result<BindingMutationResult, String> {
    let mut conn = get_config_conn().map_err(|error| error.to_string())?;
    let result = assign_binding(&mut conn, &command_id, None, true, false)?;
    emit_binding_update(&app, &result);
    Ok(result)
}

#[tauri::command]
pub fn reset_keybinding(
    app: tauri::AppHandle,
    command_id: String,
    replace_conflict: bool,
) -> Result<BindingMutationResult, String> {
    let mut conn = get_config_conn().map_err(|error| error.to_string())?;
    let command = get_command(&mut conn, &command_id)
        .map_err(|error| format!("Unknown command {command_id}: {error}"))?;
    let result = assign_binding(
        &mut conn,
        &command_id,
        command.default_chord.as_deref(),
        false,
        replace_conflict,
    )?;
    emit_binding_update(&app, &result);
    Ok(result)
}

fn emit_binding_update(app: &tauri::AppHandle, result: &BindingMutationResult) {
    if !result.applied {
        return;
    }
    if let Err(error) = app.emit("core://keybindings-updated", result) {
        log::warn!("Failed to broadcast keybinding update: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::connection::SimpleConnection;

    fn connection() -> SqliteConnection {
        let mut conn = SqliteConnection::establish(":memory:").unwrap();
        conn.batch_execute(
            "
            CREATE TABLE keybinding_commands (
                command_id TEXT PRIMARY KEY NOT NULL,
                handler_id TEXT NOT NULL,
                label TEXT NOT NULL,
                description TEXT NOT NULL,
                category TEXT NOT NULL,
                default_chord TEXT,
                current_chord TEXT,
                customized BOOLEAN NOT NULL DEFAULT 0,
                available BOOLEAN NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE UNIQUE INDEX keybinding_commands_current_chord_unique
            ON keybinding_commands (current_chord)
            WHERE current_chord IS NOT NULL;
            ",
        )
        .unwrap();
        conn
    }

    fn definition(id: &str, chord: Option<&str>) -> CommandDefinitionInput {
        CommandDefinitionInput {
            command_id: id.to_string(),
            handler_id: id.to_string(),
            label: id.to_string(),
            description: format!("Run {id}"),
            category: "General".to_string(),
            default_chord: chord.map(str::to_string),
            sort_order: 0,
        }
    }

    #[test]
    fn reconcile_inserts_updates_and_marks_missing_commands_unavailable() {
        let mut conn = connection();
        reconcile_catalog(
            &mut conn,
            &[
                definition("app.reload", Some("Mod+KeyR")),
                definition("app.close", None),
            ],
        )
        .unwrap();

        let updated = CommandDefinitionInput {
            label: "Reload page".to_string(),
            default_chord: Some("Mod+Shift+KeyR".to_string()),
            ..definition("app.reload", Some("Mod+KeyR"))
        };
        let commands = reconcile_catalog(&mut conn, &[updated]).unwrap();

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].label, "Reload page");
        assert_eq!(commands[0].current_chord.as_deref(), Some("Mod+Shift+KeyR"));
        let missing = get_command(&mut conn, "app.close").unwrap();
        assert!(!missing.available);
    }

    #[test]
    fn customized_and_explicitly_unbound_commands_survive_reconciliation() {
        let mut conn = connection();
        reconcile_catalog(&mut conn, &[definition("app.reload", Some("Mod+KeyR"))]).unwrap();
        assign_binding(&mut conn, "app.reload", None, true, false).unwrap();

        reconcile_catalog(
            &mut conn,
            &[definition("app.reload", Some("Mod+Shift+KeyR"))],
        )
        .unwrap();
        let command = get_command(&mut conn, "app.reload").unwrap();

        assert!(command.customized);
        assert_eq!(command.current_chord, None);
        assert_eq!(command.default_chord.as_deref(), Some("Mod+Shift+KeyR"));
    }

    #[test]
    fn replacement_unbinds_the_conflicting_command() {
        let mut conn = connection();
        reconcile_catalog(
            &mut conn,
            &[
                definition("app.reload", Some("Mod+KeyR")),
                definition("app.close", Some("Mod+KeyW")),
            ],
        )
        .unwrap();

        let conflict =
            assign_binding(&mut conn, "app.close", Some("Mod+KeyR"), true, false).unwrap();
        assert!(!conflict.applied);
        assert_eq!(
            conflict.conflict.unwrap().command_id,
            "app.reload".to_string()
        );

        let replaced =
            assign_binding(&mut conn, "app.close", Some("Mod+KeyR"), true, true).unwrap();
        assert!(replaced.applied);
        assert_eq!(
            get_command(&mut conn, "app.reload").unwrap().current_chord,
            None
        );
        assert_eq!(replaced.command.current_chord.as_deref(), Some("Mod+KeyR"));
    }
}
