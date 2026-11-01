//! World collision policy; adapters supply hashes and a unique backup suffix.
pub fn needs_rotation(recorded: Option<&str>, current: Option<&str>) -> bool {
    matches!((recorded,current), (Some(a),Some(b)) if !a.eq_ignore_ascii_case(b))
}
pub fn quarantine_path(folder: &str, suffix: &str) -> String { format!("{folder}_{suffix}") }
#[cfg(test)] mod tests { use super::*;
#[test] fn world_adapter_parity() {
 assert!(needs_rotation(Some("base"),Some("played")));
 assert!(!needs_rotation(Some("base"),Some("BASE")));
 assert!(!needs_rotation(Some("base"),None));
 assert_eq!(quarantine_path("saves/world","backup"),"saves/world_backup");
 assert_eq!(quarantine_path("world","backup"),"world_backup");
}}
