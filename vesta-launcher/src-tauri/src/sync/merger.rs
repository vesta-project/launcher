use std::collections::BTreeMap;

/// Result of attempting to merge a config file.
#[derive(Debug, Clone)]
pub enum MergeResult {
    /// Successfully merged — contains the new content
    Merged(String),
    /// File was corrupted / unparseable — should be moved to .corrupted
    Corrupted(String),
    /// Format not yet supported — fallback: rename old to .user, place new
    Unsupported,
}

/// The priority matrix for a single key:
///   Is the key in New Base (N)?
///     YES: Has the user changed it from Old Base? (C != O)
///       YES -> Keep User Value (C)
///       NO  -> Apply New Base Value (N)
///     NO: Was it manually added by the user? (In C, but not O or N)
///       YES -> Keep User Value (C)
///       NO  -> Drop Key (Author removed it)
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyDecision {
    KeepUserValue(String),
    ApplyNewValue(String),
    Drop,
}

/// Merge two config files at the key-value level.
/// `old_content` = $O$ value, `current_content` = $C$ value, `new_content` = $N$ value.
/// Returns the merged file content.
pub fn merge_config(
    path: &str,
    old_content: Option<&str>,
    current_content: Option<&str>,
    new_content: Option<&str>,
) -> MergeResult {
    let lower = path.to_lowercase();

    if lower.ends_with(".properties") {
        merge_properties(old_content, current_content, new_content)
    } else if lower.ends_with(".json") {
        merge_json(old_content, current_content, new_content)
    } else {
        // TOML, CFG, YML, etc. — not yet supported
        MergeResult::Unsupported
    }
}

// ─── Properties file merging ───────────────────────────────────────────────

fn merge_properties(
    old_content: Option<&str>,
    current_content: Option<&str>,
    new_content: Option<&str>,
) -> MergeResult {
    // Parse each version into KV maps
    let old_kv = parse_properties(old_content.unwrap_or(""));
    let current_kv = parse_properties(current_content.unwrap_or(""));
    let new_kv = parse_properties(new_content.unwrap_or(""));

    // Use the new file as the structural template (preserves author formatting/comments)
    // but override values based on the priority matrix.
    let template = new_content.unwrap_or("");
    let result = apply_properties_merge(template, &old_kv, &current_kv, &new_kv);

    MergeResult::Merged(result)
}

/// Parse .properties content into a key→value map.
/// Preserves only the last value for duplicate keys (standard behavior).
fn parse_properties(content: &str) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        // Skip comments and empty lines
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
            continue;
        }
        // Parse key=value (or key:value, or key value)
        if let Some((key, value)) = parse_key_value(trimmed) {
            map.insert(key, value);
        }
    }
    map
}

/// Parse a single "key = value" line.
fn parse_key_value(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim_start();
    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
        return None;
    }

    // Try = separator first
    if let Some(pos) = line.find('=') {
        let key = line[..pos].trim().to_string();
        let value = line[pos + 1..].trim().to_string();
        return Some((key, value));
    }
    // Try : separator (Java properties format)
    if let Some(pos) = line.find(':') {
        let key = line[..pos].trim().to_string();
        let value = line[pos + 1..].trim().to_string();
        return Some((key, value));
    }
    // Try whitespace separator
    if let Some(pos) = line.find(|c: char| c.is_whitespace()) {
        let key = line[..pos].trim().to_string();
        let value = line[pos..].trim().to_string();
        if !key.is_empty() {
            return Some((key, value));
        }
    }
    None
}

/// Walk the new file line-by-line, copying comments verbatim and applying
/// the priority matrix to each key's value.
fn apply_properties_merge(
    template: &str,
    old_kv: &BTreeMap<String, String>,
    current_kv: &BTreeMap<String, String>,
    new_kv: &BTreeMap<String, String>,
) -> String {
    let mut output = String::new();
    let mut processed_keys: BTreeMap<String, bool> = BTreeMap::new();

    for line in template.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
            // Copy comment / blank line verbatim
            output.push_str(line);
            output.push('\n');
            continue;
        }

        if let Some((key, _)) = parse_key_value(trimmed) {
            processed_keys.insert(key.clone(), true);
            let old_val = old_kv.get(&key);
            let cur_val = current_kv.get(&key);
            let new_val = new_kv.get(&key);

            let decision = decide_key(old_val, cur_val, new_val);

            match decision {
                KeyDecision::KeepUserValue(v) => {
                    output.push_str(&format!("{}={}\n", key, v));
                }
                KeyDecision::ApplyNewValue(v) => {
                    output.push_str(&format!("{}={}\n", key, v));
                }
                KeyDecision::Drop => {
                    // Comment out the key rather than deleting it
                    output.push_str(&format!("# {} (removed by modpack author)\n", line));
                }
            }
        } else {
            // Unparseable line — preserve as-is
            output.push_str(line);
            output.push('\n');
        }
    }

    // Append user-added keys (in C but not in N or O) at the end
    let mut user_added: Vec<String> = Vec::new();
    for (key, val) in current_kv.iter() {
        if !processed_keys.contains_key(key) && !new_kv.contains_key(key) {
            user_added.push(format!("# User-added key\n{}={}\n", key, val));
        }
    }
    if !user_added.is_empty() {
        output.push_str("\n# ── User-added settings (preserved) ──\n");
        for entry in user_added {
            output.push_str(&entry);
        }
    }

    output
}

/// The core priority matrix for a single key.
fn decide_key(
    old_val: Option<&String>,
    cur_val: Option<&String>,
    new_val: Option<&String>,
) -> KeyDecision {
    let cur = match cur_val {
        Some(v) => v.clone(),
        None => {
            // Key not in current — apply new if available
            return match new_val {
                Some(v) => KeyDecision::ApplyNewValue(v.clone()),
                None => KeyDecision::Drop,
            };
        }
    };

    let new = new_val;

    if let Some(nv) = new {
        // Key IS in new manifest
        if let Some(ov) = old_val {
            if &cur != ov {
                // User changed it → keep user value
                KeyDecision::KeepUserValue(cur)
            } else {
                // User didn't change it → apply author's new value
                KeyDecision::ApplyNewValue(nv.clone())
            }
        } else {
            // Key wasn't in old manifest (new key from author)
            KeyDecision::ApplyNewValue(nv.clone())
        }
    } else {
        // Key NOT in new manifest
        if old_val.is_some() {
            // Author removed it → drop
            KeyDecision::Drop
        } else {
            // User-added key → keep
            KeyDecision::KeepUserValue(cur)
        }
    }
}

// ─── JSON file merging ─────────────────────────────────────────────────────

fn merge_json(
    old_content: Option<&str>,
    current_content: Option<&str>,
    new_content: Option<&str>,
) -> MergeResult {
    let old_kv = old_content.and_then(|c| flatten_json(c).ok());
    let current_kv = current_content.and_then(|c| flatten_json(c).ok());
    let new_kv = new_content.and_then(|c| flatten_json(c).ok());

    // If any of them fail to parse, treat as corrupted
    if new_content.is_some() && new_kv.is_none() {
        return MergeResult::Corrupted("Failed to parse new JSON".into());
    }

    // Build merged KV map
    let mut merged = BTreeMap::new();

    // Start with new values as base
    if let Some(ref nk) = new_kv {
        for (k, v) in nk {
            merged.insert(k.clone(), v.clone());
        }
    }

    // Apply priority matrix to each key
    if let (Some(ref ok), Some(ref ck)) = (&old_kv, &current_kv) {
        for (key, cur_value) in ck {
            let old_val = ok.get(key);
            let new_val = new_kv.as_ref().and_then(|nk| nk.get(key));

            match decide_key(old_val, Some(cur_value), new_val) {
                KeyDecision::KeepUserValue(v) => {
                    merged.insert(key.clone(), v);
                }
                KeyDecision::ApplyNewValue(_v) => {
                    // Already set from new_kv
                }
                KeyDecision::Drop => {
                    merged.remove(key);
                }
            }
        }
    }

    // Reconstruct JSON from the merged flat map
    match reconstruct_json(&merged) {
        Ok(json_str) => MergeResult::Merged(json_str),
        Err(_) => MergeResult::Corrupted("Failed to reconstruct merged JSON".into()),
    }
}

/// Flatten a JSON object into key→value pairs using dot notation.
/// Only handles objects — arrays and primitives at top level are ignored.
fn flatten_json(content: &str) -> Result<BTreeMap<String, String>, String> {
    let value: serde_json::Value =
        serde_json::from_str(content).map_err(|e| format!("JSON parse error: {}", e))?;

    let mut map = BTreeMap::new();
    flatten_value(&value, "", &mut map);
    Ok(map)
}

fn flatten_value(value: &serde_json::Value, prefix: &str, map: &mut BTreeMap<String, String>) {
    match value {
        serde_json::Value::Object(obj) => {
            for (k, v) in obj {
                let key = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{}.{}", prefix, k)
                };
                flatten_value(v, &key, map);
            }
        }
        serde_json::Value::Array(_arr) => {
            // Arrays are treated as opaque — serialize to string
            map.insert(prefix.to_string(), value.to_string());
        }
        serde_json::Value::Null => {
            map.insert(prefix.to_string(), "null".to_string());
        }
        _ => {
            // String, Number, Bool
            map.insert(
                prefix.to_string(),
                match value {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                },
            );
        }
    }
}

/// Reconstruct a JSON object from a flat key→value map using dot notation.
fn reconstruct_json(map: &BTreeMap<String, String>) -> Result<String, String> {
    let mut root = serde_json::Map::new();

    for (key, value) in map {
        let parts: Vec<&str> = key.split('.').collect();
        insert_nested(&mut root, &parts, value)
            .map_err(|e| format!("Failed to insert key '{}': {}", key, e))?;
    }

    let json = serde_json::Value::Object(root);
    serde_json::to_string_pretty(&json).map_err(|e| format!("JSON serialize error: {}", e))
}

fn insert_nested(
    obj: &mut serde_json::Map<String, serde_json::Value>,
    parts: &[&str],
    value: &str,
) -> Result<(), String> {
    if parts.is_empty() {
        return Ok(());
    }

    let key = parts[0].to_string();

    if parts.len() == 1 {
        // Leaf node — try to parse the value
        let parsed: serde_json::Value = serde_json::from_str(value)
            .unwrap_or_else(|_| serde_json::Value::String(value.to_string()));
        obj.insert(key, parsed);
    } else {
        // Intermediate node
        let child = obj
            .entry(key)
            .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
        if let serde_json::Value::Object(ref mut child_map) = child {
            insert_nested(child_map, &parts[1..], value)?;
        } else {
            return Err(format!("Key conflict: '{}' is not an object", parts[0]));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_properties() {
        let content = "key1=value1\n# comment\nkey2 = value2\n! another comment\nkey3:value3\n";
        let map = parse_properties(content);
        assert_eq!(map.get("key1").unwrap(), "value1");
        assert_eq!(map.get("key2").unwrap(), "value2");
        assert_eq!(map.get("key3").unwrap(), "value3");
    }

    #[test]
    fn test_parse_key_value() {
        assert_eq!(
            parse_key_value("key=value"),
            Some(("key".into(), "value".into()))
        );
        assert_eq!(
            parse_key_value("key = value with spaces"),
            Some(("key".into(), "value with spaces".into()))
        );
        assert_eq!(
            parse_key_value("key:value"),
            Some(("key".into(), "value".into()))
        );
        assert_eq!(parse_key_value("# comment"), None);
    }

    #[test]
    fn test_decide_key_keep_user_value() {
        // User changed value from old → keep user value
        let result = decide_key(
            Some(&"old_val".to_string()),
            Some(&"user_val".to_string()),
            Some(&"new_val".to_string()),
        );
        assert_eq!(result, KeyDecision::KeepUserValue("user_val".into()));
    }

    #[test]
    fn test_decide_key_apply_new_value() {
        // User didn't change value → apply new
        let result = decide_key(
            Some(&"old_val".to_string()),
            Some(&"old_val".to_string()),
            Some(&"new_val".to_string()),
        );
        assert_eq!(result, KeyDecision::ApplyNewValue("new_val".into()));
    }

    #[test]
    fn test_decide_key_drop() {
        // Author removed key, user didn't add it
        let result = decide_key(
            Some(&"old_val".to_string()),
            Some(&"old_val".to_string()),
            None,
        );
        assert_eq!(result, KeyDecision::Drop);
    }

    #[test]
    fn test_decide_key_user_added() {
        // User added key, not in old or new
        let result = decide_key(None, Some(&"user_val".to_string()), None);
        assert_eq!(result, KeyDecision::KeepUserValue("user_val".into()));
    }

    #[test]
    fn test_merge_properties_preserves_comments() {
        let old = "# Old config\nmax_fps=60\nrender_distance=12\n";
        let current = "# Old config\nmax_fps=144\nrender_distance=12\n";
        let new = "# New config\nmax_fps=60\nrender_distance=16\nchunk_updates=1\n";

        let result = merge_properties(Some(old), Some(current), Some(new));
        if let MergeResult::Merged(output) = result {
            // User changed max_fps — should keep 144
            assert!(output.contains("max_fps=144"));
            // User didn't change render_distance — should get new value 16
            assert!(output.contains("render_distance=16"));
            // New key added by author
            assert!(output.contains("chunk_updates=1"));
            // Comment preserved
            assert!(output.contains("# New config"));
        } else {
            panic!("Expected Merged, got {:?}", result);
        }
    }

    #[test]
    fn test_merge_config_empty_new_content_not_used() {
        let current = "max_fps=144\nrender_distance=12\n";
        let result = merge_config(
            "config/test.properties",
            Some("max_fps=60\nrender_distance=12\n"),
            Some(current),
            None,
        );
        if let MergeResult::Merged(output) = result {
            assert!(
                !output.is_empty(),
                "Merge with missing new content should not produce empty file when current exists"
            );
        }
    }

    #[test]
    fn test_flatten_json() {
        let content = r#"{"graphics": {"vsync": true, "max_fps": 60}}"#;
        let map = flatten_json(content).unwrap();
        assert_eq!(map.get("graphics.vsync").unwrap(), "true");
        assert_eq!(map.get("graphics.max_fps").unwrap(), "60");
    }

    #[test]
    fn test_reconstruct_json() {
        let mut map = BTreeMap::new();
        map.insert("graphics.vsync".to_string(), "true".to_string());
        map.insert("graphics.max_fps".to_string(), "120".to_string());
        let json = reconstruct_json(&map).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["graphics"]["vsync"], true);
        assert_eq!(parsed["graphics"]["max_fps"], 120);
    }
}
