import os
import sys

# Keep this helper aligned with Diesel migrations; migrations remain source of truth.
script_dir = os.path.dirname(os.path.abspath(__file__))
filepath = os.path.join(script_dir, "src", "schema", "vesta.rs")

with open(filepath, "r", encoding="utf-8") as handle:
    schema = handle.read()

# Add saved_themes only if absent, matching Diesel's sqlite text timestamps.
themes_table = """
diesel::table! {
    saved_themes (id) {
        id -> Text,
        name -> Text,
        theme_data -> Text,
        created_at -> Text,
        updated_at -> Text,
    }
}
"""

task_state_anchor = "diesel::table! {\n    task_state (id) {"
if "saved_themes (id)" not in schema and task_state_anchor in schema:
    schema = schema.replace(task_state_anchor, themes_table + "\n" + task_state_anchor, 1)

allow_tables_anchor = "    resource_project,\n    task_state,"
if "    saved_themes,\n" not in schema and allow_tables_anchor in schema:
    schema = schema.replace(
        allow_tables_anchor,
        "    resource_project,\n    saved_themes,\n    task_state,",
        1,
    )

with open(filepath, "w", encoding="utf-8") as handle:
    handle.write(schema)

sys.exit(0)
