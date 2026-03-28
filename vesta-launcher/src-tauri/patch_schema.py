import sys

filepath = '/Users/eatham/Vesta/launcher/vesta-launcher/src-tauri/src/schema/vesta.rs'
with open(filepath, 'r') as f:
    schema = f.read()

# Add window_transparency_enabled
schema = schema.replace(
    'cape_data -> Nullable<Text>,\n    }',
    'cape_data -> Nullable<Text>,\n        window_transparency_enabled -> Nullable<Bool>,\n    }'
)

# Add saved_themes
themes_table = """
diesel::table! {
    saved_themes (id) {
        id -> Text,
        name -> Text,
        theme_data -> Text,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}
"""
schema = schema.replace(
    'diesel::table! {\n    task_state (id) {',
    themes_table + '\ndiesel::table! {\n    task_state (id) {'
)

# Add to allow_tables_to_appear_in_same_query
schema = schema.replace(
    '    resource_project,\n    task_state,',
    '    resource_project,\n    saved_themes,\n    task_state,'
)

with open(filepath, 'w') as f:
    f.write(schema)

sys.exit(0)
