import sys

filepath = 'src/schema/vesta.rs'
with open(filepath, 'r') as f:
    s = f.read()

# remove one block
s = s.replace('diesel::table! {\n    saved_themes (id) {\n        id -> Text,\n        name -> Text,\n        theme_data -> Text,\n        created_at -> Timestamp,\n        updated_at -> Timestamp,\n    }\n}\n\n', '', 1)

with open(filepath, 'w') as f:
    f.write(s)
