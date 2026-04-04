import sys
import os

def remove_saved_themes_table_block(schema_text):
    table_marker = 'saved_themes (id)'
    table_pos = schema_text.find(table_marker)
    if table_pos == -1:
        # Table not found, return original (maybe already removed or not added yet)
        return schema_text

    macro_start = schema_text.rfind('diesel::table!', 0, table_pos)
    if macro_start == -1:
        raise RuntimeError("Could not find diesel::table! block for saved_themes")

    block_start = schema_text.find('{', macro_start)
    if block_start == -1 or block_start > table_pos:
        raise RuntimeError("Malformed diesel::table! block for saved_themes")

    depth = 0
    block_end = None
    for index in range(block_start, len(schema_text)):
        char = schema_text[index]
        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0:
                block_end = index + 1
                break

    if block_end is None:
        raise RuntimeError("Unbalanced braces while removing saved_themes table block")

    # Clean up trailing newlines
    while block_end < len(schema_text) and schema_text[block_end] == '\n':
        block_end += 1

    return schema_text[:macro_start] + schema_text[block_end:]

# Use absolute path if available, else relative
script_dir = os.path.dirname(os.path.abspath(__file__))
filepath = os.path.join(script_dir, 'src', 'schema', 'vesta.rs')
if not os.path.exists(filepath):
    filepath = 'src/schema/vesta.rs' # Fallback

with open(filepath, 'r') as f:
    s = f.read()

s = remove_saved_themes_table_block(s)

with open(filepath, 'w') as f:
    f.write(s)
