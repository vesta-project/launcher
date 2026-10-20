//! Single revision authority for built-in settings, library and confirmed selection.
use super::{
    author_css,
    rewrite_theme::{self, Theme},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    path::Path,
};

pub const FILE: &str = "rewrite-theme-v2.json";
pub const MAX_INPUT: usize = 256 * 1024;
const MAX_STORE: usize = 3 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AuthorFile {
    #[serde(rename = "type")]
    kind: String,
    format_version: u32,
    pub contract_version: u32,
    pub name: String,
    pub css: String,
    #[serde(default)]
    pub base: Theme,
}
impl AuthorFile {
    fn validate(&self) -> Result<String, String> {
        if self.kind != "vesta-author-theme"
            || self.format_version != 1
            || self.contract_version != 1
        {
            return Err("Expected vesta-author-theme formatVersion 1, contractVersion 1; legacy files are unsupported".into());
        }
        if self.name.trim().is_empty()
            || self.name.chars().count() > 128
            || self.name.chars().any(char::is_control)
        {
            return Err("Author name must contain 1–128 printable characters".into());
        }
        self.base.validate()?;
        author_css::canonicalize(&self.css)
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    source: AuthorFile,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Confirmed {
    built_in: Theme,
    selected: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Store {
    #[serde(rename = "type")]
    kind: String,
    schema_version: u32,
    pub revision: u64,
    pub built_in: Theme,
    pub imports: Vec<Entry>,
    pub selected: Option<String>,
    previous_confirmed: Option<Confirmed>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTheme {
    pub id: String,
    pub name: String,
    pub contract_version: u32,
    pub base: Theme,
    pub css: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSnapshot {
    pub revision: u64,
    pub built_in: Theme,
    pub selected: Option<String>,
    pub imports: Vec<ImportedTheme>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
    #[serde(skip)]
    pub(crate) safe_fallback: bool,
}
const HEADER_HELP: &str = "A .css theme must start with a header comment: /* @vesta-theme name: My theme */";

/// Authors write either the `.vestatheme` JSON envelope or a plain stylesheet whose first
/// comment is a `@vesta-theme` header (`name:`, optional `contract:` and `base:` lines).
/// Either form may give a partial `base`; it is merged over the deterministic defaults, and
/// unknown keys are still rejected.
pub fn parse_author_source(contents: &str) -> Result<AuthorFile, String> {
    let text = contents.trim_start_matches('\u{feff}');
    let mut value: serde_json::Value = if text.trim_start().starts_with('{') {
        serde_json::from_str(text).map_err(|e| format!("Invalid .vestatheme JSON: {e}"))?
    } else {
        css_envelope(text)?
    };
    if let Some(base) = value.get_mut("base") {
        let partial = base
            .as_object()
            .ok_or("Theme base must be an object, e.g. { \"mode\": \"light\" }")?
            .clone();
        let mut full = serde_json::to_value(Theme::default()).map_err(|e| e.to_string())?;
        for (key, entry) in partial {
            full[key] = entry;
        }
        *base = full;
    }
    serde_json::from_value(value).map_err(|e| format!("Invalid theme file: {e}"))
}

fn css_envelope(text: &str) -> Result<serde_json::Value, String> {
    let body = text.trim_start().strip_prefix("/*").ok_or(HEADER_HELP)?;
    let end = body.find("*/").ok_or(HEADER_HELP)?;
    let (header, css) = (&body[..end], &body[end + 2..]);
    let mut name = None;
    let mut contract = 1u32;
    let mut base = None;
    let mut tagged = false;
    for (index, raw) in header.lines().enumerate() {
        let line = raw.trim().trim_start_matches('*').trim();
        if line.is_empty() {
            continue;
        }
        if !tagged {
            let rest = line.strip_prefix("@vesta-theme").ok_or(HEADER_HELP)?.trim();
            tagged = true;
            if rest.is_empty() {
                continue;
            }
            return Err(format!("Theme header line {}: put each setting on its own line", index + 1));
        }
        let (key, value) = line
            .split_once(':')
            .ok_or_else(|| format!("Theme header line {}: expected `key: value`", index + 1))?;
        let value = value.trim();
        match key.trim() {
            "name" => name = Some(value.to_string()),
            "contract" => {
                contract = value.parse().map_err(|_| {
                    format!("Theme header line {}: contract must be a number", index + 1)
                })?
            }
            "base" => {
                base = Some(serde_json::from_str::<serde_json::Value>(value).map_err(|e| {
                    format!("Theme header line {}: base must be a JSON object ({e})", index + 1)
                })?)
            }
            other => {
                return Err(format!(
                    "Theme header line {}: unknown key `{other}` (use name, contract or base)",
                    index + 1
                ))
            }
        }
    }
    if !tagged {
        return Err(HEADER_HELP.into());
    }
    let mut value = serde_json::json!({
        "type": "vesta-author-theme",
        "formatVersion": 1,
        "contractVersion": contract,
        "name": name.ok_or("Theme header needs a `name:` line")?,
        "css": css.trim(),
    });
    if let Some(base) = base {
        value["base"] = base;
    }
    Ok(value)
}

pub fn bounded_read(path: &Path, max: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > max {
        return Err("Appearance file exceeds size limit".into());
    }
    Ok(bytes)
}
impl Store {
    fn fresh(built_in: Theme) -> Self {
        Self {
            kind: "vesta-rewrite-appearance".into(),
            schema_version: 2,
            revision: 0,
            built_in,
            imports: vec![],
            selected: None,
            previous_confirmed: None,
        }
    }
    pub fn read(root: &Path) -> Result<Self, String> {
        if !root.join(FILE).exists() {
            return Ok(Self::fresh(rewrite_theme::read_v1(root)?));
        }
        let bytes = bounded_read(&root.join(FILE), MAX_STORE)?;
        let store: Self =
            serde_json::from_slice(&bytes).map_err(|e| format!("Invalid appearance store: {e}"))?;
        if store.kind != "vesta-rewrite-appearance" || store.schema_version != 2 {
            return Err("Unsupported appearance store version; file preserved".into());
        }
        store.built_in.validate()?;
        if store.revision >= 9_007_199_254_740_991 || store.imports.len() > 16 {
            return Err("Invalid appearance store budget/revision".into());
        }
        let mut ids = HashSet::new();
        if store
            .imports
            .iter()
            .any(|e| uuid::Uuid::parse_str(&e.id).is_err() || !ids.insert(&e.id))
        {
            return Err("Invalid imported theme IDs".into());
        }
        Ok(store)
    }
    pub fn snapshot(&self) -> AppearanceSnapshot {
        let mut warning = None;
        let imports: Vec<_> = self
            .imports
            .iter()
            .filter_map(|e| match e.source.validate() {
                Ok(css) => Some(ImportedTheme {
                    id: e.id.clone(),
                    name: e.source.name.clone(),
                    contract_version: 1,
                    base: e.source.base.clone(),
                    css,
                }),
                Err(_) => {
                    warning =
                        Some("Invalid imported theme ignored; original store preserved".into());
                    None
                }
            })
            .collect();
        let selected = self
            .selected
            .clone()
            .filter(|id| imports.iter().any(|e| &e.id == id));
        if selected != self.selected {
            warning =
                Some("Selected author theme is unavailable; using built-in appearance".into());
        }
        let safe_fallback = self.selected != selected;
        AppearanceSnapshot {
            revision: self.revision,
            built_in: self.built_in.clone(),
            selected,
            imports,
            warning,
            safe_fallback,
        }
    }
    pub fn check(&self, expected: u64) -> Result<(), String> {
        if self.revision != expected {
            return Err(format!(
                "Appearance revision conflict: expected {expected}, current {}",
                self.revision
            ));
        }
        Ok(())
    }
    fn remember(&mut self) {
        self.previous_confirmed = Some(Confirmed {
            built_in: self.built_in.clone(),
            selected: self.selected.clone(),
        });
    }
    pub fn persist(&mut self, root: &Path) -> Result<AppearanceSnapshot, String> {
        self.revision = self
            .revision
            .checked_add(1)
            .filter(|r| *r < 9_007_199_254_740_991)
            .ok_or("Appearance revision exhausted")?;
        let bytes = serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_STORE {
            return Err("Appearance library exceeds size limit".into());
        }
        let mut temp = tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?;
        use std::io::Write;
        temp.write_all(&bytes).map_err(|e| e.to_string())?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist(root.join(FILE)).map_err(|e| e.to_string())?;
        Ok(self.snapshot())
    }
    pub fn import(&mut self, contents: &str) -> Result<(), String> {
        if contents.len() > MAX_INPUT {
            return Err("Theme file exceeds 256 KiB".into());
        }
        if self.imports.len() >= 16 {
            return Err("Theme library is full (16 entries)".into());
        }
        let source = parse_author_source(contents)?;
        source.validate()?;
        if self
            .imports
            .iter()
            .any(|e| e.source.css == source.css && e.source.name == source.name)
        {
            return Err("This author theme is already imported".into());
        }
        self.imports.push(Entry {
            id: uuid::Uuid::new_v4().to_string(),
            source,
        });
        Ok(())
    }
    pub fn select(&mut self, id: Option<String>) -> Result<(), String> {
        if let Some(id) = &id {
            self.imports
                .iter()
                .find(|e| &e.id == id)
                .ok_or("Unknown imported theme")?
                .source
                .validate()?;
        }
        self.remember();
        self.selected = id;
        Ok(())
    }
    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        if !self.imports.iter().any(|e| e.id == id) {
            return Err("Unknown imported theme".into());
        }
        if self.selected.as_deref() == Some(id) {
            self.select(None)?;
        }
        self.imports.retain(|e| e.id != id);
        Ok(())
    }
    pub fn update_builtin(
        &mut self,
        updates: HashMap<String, serde_json::Value>,
    ) -> Result<(), String> {
        let mut value = serde_json::to_value(&self.built_in).map_err(|e| e.to_string())?;
        let fields = value.as_object_mut().ok_or("Invalid built-in theme")?;
        let selecting = updates.contains_key("id");
        for (key, value) in updates {
            if !fields.contains_key(&key) {
                return Err(format!("Unknown rewrite theme field: {key}"));
            }
            fields.insert(key, value);
        }
        let theme: Theme = serde_json::from_value(value).map_err(|e| e.to_string())?;
        theme.validate()?;
        self.remember();
        self.built_in = theme;
        if selecting {
            self.selected = None;
        }
        Ok(())
    }
}
pub fn load_snapshot(root: &Path) -> AppearanceSnapshot {
    match Store::read(root) {
        Ok(s) => s.snapshot(),
        Err(error) => {
            let mut s = Store::fresh(Theme::default()).snapshot();
            s.warning = Some(error);
            s.safe_fallback = true;
            s
        }
    }
}
/// Shared by first-launch and second-instance recovery. No library deletion,
/// built-in changes, legacy writes or source-CSS validation is needed to disable.
pub fn recover(root: &Path, revision_floor: u64) -> Result<AppearanceSnapshot, String> {
    match Store::read(root) {
        Ok(mut s) => {
            if s.selected.is_some() || s.revision < revision_floor {
                s.revision = s.revision.max(revision_floor);
                s.select(None)?;
                s.persist(root)
            } else {
                Ok(s.snapshot())
            }
        }
        Err(_) => Ok(load_snapshot(root)),
    }
}

/// Reset does not require validating author CSS. A bounded version inspection
/// protects future schemas; corrupt evidence is copied before atomic replacement.
pub fn reset(
    root: &Path,
    expected: u64,
    revision_floor: u64,
) -> Result<AppearanceSnapshot, String> {
    match Store::read(root) {
        Ok(mut s) => {
            if expected != s.revision.max(revision_floor) {
                return Err("Appearance revision conflict; reload before reset".into());
            }
            s.revision = s.revision.max(revision_floor);
            s.remember();
            s.selected = None;
            s.built_in = Theme::default();
            s.persist(root)
        }
        Err(_) => {
            // An oversized future schema cannot be identified safely within this
            // version's read budget. Preserve it and keep the safe load fallback.
            if std::fs::metadata(root.join(FILE)).is_ok_and(|m| m.len() > MAX_STORE as u64) {
                return Err(
                    "Oversized appearance store preserved; safe built-in fallback is active".into(),
                );
            }
            if let Ok(bytes) = bounded_read(&root.join(FILE), MAX_STORE) {
                if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                    if v.get("schemaVersion")
                        .and_then(|v| v.as_u64())
                        .is_some_and(|v| v > 2)
                    {
                        return Err("Unsupported future appearance schema; reset refused".into());
                    }
                }
            }
            if expected != revision_floor {
                return Err("Appearance revision conflict; reload before reset".into());
            }
            if root.join(FILE).exists() {
                std::fs::copy(
                    root.join(FILE),
                    root.join(format!(
                        "rewrite-theme-v2.corrupt-{}.json",
                        uuid::Uuid::new_v4()
                    )),
                )
                .map_err(|e| e.to_string())?;
            }
            let mut fresh = Store::fresh(Theme::default());
            fresh.revision = revision_floor;
            fresh.persist(root)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn file(name: &str, css: &str) -> String {
        serde_json::json!({"type":"vesta-author-theme","formatVersion":1,"contractVersion":1,"name":name,"css":css}).to_string()
    }
    #[test]
    fn actual_classic_file_imports_inactive_and_returns_only_canonical_css() {
        let root = tempfile::tempdir().unwrap();
        let mut s = Store::read(root.path()).unwrap();
        s.import(include_str!(
            "../../../../apps/desktop-solid/examples/windows-2000.vestatheme"
        ))
        .unwrap();
        let saved = s.persist(root.path()).unwrap();
        assert!(saved.selected.is_none());
        assert_eq!(saved.imports.len(), 1);
        assert!(saved.imports[0].css.starts_with("@layer theme.author {"));
        assert!(saved.imports[0].css.contains("[data-vesta"));
        assert!(!saved.imports[0].css.contains("data-vesta-theme-example"));
        assert_eq!(
            serde_json::to_value(&saved.imports[0].base).unwrap()["mode"],
            "light"
        );
        assert_eq!(
            serde_json::to_value(&saved.built_in).unwrap()["mode"],
            "system"
        );
        assert_eq!(
            Store::read(root.path()).unwrap().snapshot().imports[0].css,
            saved.imports[0].css
        );
    }
    #[test]
    fn classic_stylesheet_form_imports_like_the_envelope() {
        let root = tempfile::tempdir().unwrap();
        let mut s = Store::read(root.path()).unwrap();
        s.import(include_str!("../../../../apps/desktop-solid/examples/windows-2000.css"))
            .unwrap();
        let saved = s.persist(root.path()).unwrap();
        assert_eq!(saved.imports[0].name, "Windows 2000");
        assert!(saved.imports[0].css.starts_with("@layer theme.author {"));
        let base = serde_json::to_value(&saved.imports[0].base).unwrap();
        assert_eq!(base["mode"], "light");
        assert_eq!(base["material"], "flat");
        // Unlisted settings come from the defaults.
        assert_eq!(base["id"], "vesta");
    }
    #[test]
    fn stylesheet_headers_report_their_line() {
        for (input, needle) in [
            ("a{color:red}", "header comment"),
            ("/* @vesta-theme\n * colour: red\n */ a{color:red}", "line 2: unknown key"),
            ("/* @vesta-theme\n * base: {mode}\n */ a{color:red}", "line 2: base must be a JSON object"),
            ("/* @vesta-theme */ a{color:red}", "needs a `name:` line"),
            ("/* @vesta-theme\n name: X\n base: {\"shade\": 1}\n */ a{color:red}", "unknown field"),
        ] {
            let error = parse_author_source(input).unwrap_err();
            assert!(error.contains(needle), "{input:?} gave {error:?}");
        }
        let partial = parse_author_source(
            &file("Partial", "a{color:red}").replace("\"css\"", "\"base\":{\"mode\":\"dark\"},\"css\""),
        )
        .unwrap();
        assert_eq!(serde_json::to_value(&partial.base).unwrap()["mode"], "dark");
    }
    #[test]
    fn strict_envelope_bounds_and_reset_preserve_library() {
        let root = tempfile::tempdir().unwrap();
        let mut s = Store::read(root.path()).unwrap();
        for bad in [
            "{}".to_owned(),
            file("", "a{color:red}"),
            file("Good", "a{color:red}").replace("formatVersion\":1", "formatVersion\":2"),
            file("Good", "a{color:red}").replace("contractVersion\":1", "contractVersion\":2"),
            " ".repeat(MAX_INPUT + 1),
        ] {
            assert!(s.import(&bad).is_err());
            assert!(s.imports.is_empty());
        }
        let mut unknown: serde_json::Value =
            serde_json::from_str(&file("Good", "a{color:red}")).unwrap();
        unknown["path"] = serde_json::json!("/tmp/file");
        assert!(s.import(&unknown.to_string()).is_err());
        s.import(&file("Good", "a{color:red}")).unwrap();
        s.select(Some(s.imports[0].id.clone())).unwrap();
        let saved = s.persist(root.path()).unwrap();
        let recovered = recover(root.path(), 0).unwrap();
        assert!(recovered.selected.is_none());
        assert_eq!(recovered.imports.len(), 1);
        assert_eq!(recovered.revision, saved.revision + 1);
        assert_eq!(
            recover(root.path(), 0).unwrap().revision,
            recovered.revision
        );
        let reset = reset(root.path(), recovered.revision, 0).unwrap();
        assert_eq!(reset.imports.len(), 1);
        assert!(reset.selected.is_none());
        let path = root.path().join("bounded");
        std::fs::write(&path, [0; 32]).unwrap();
        assert!(bounded_read(&path, 31).is_err());
    }
    #[test]
    fn builtin_mutations_share_revision_and_selection_authority() {
        let root = tempfile::tempdir().unwrap();
        let mut s = Store::read(root.path()).unwrap();
        s.import(&file("Good", "a{color:red}")).unwrap();
        s.select(Some(s.imports[0].id.clone())).unwrap();
        s.persist(root.path()).unwrap();
        s.update_builtin(HashMap::from([("hue".into(), serde_json::json!(42))]))
            .unwrap();
        assert!(s.selected.is_some());
        s.persist(root.path()).unwrap();
        assert!(s.check(1).is_err());
        s.update_builtin(HashMap::from([("id".into(), serde_json::json!("slate"))]))
            .unwrap();
        assert!(s.selected.is_none());
        assert!(s
            .update_builtin(HashMap::from([("id".into(), serde_json::json!("custom"))]))
            .is_err());
        s.persist(root.path()).unwrap();
        assert_eq!(
            serde_json::to_value(Store::read(root.path()).unwrap().built_in).unwrap()["hue"],
            42.0
        );
    }
    #[test]
    fn inactive_import_ids_revision_and_active_delete() {
        let root = tempfile::tempdir().unwrap();
        let mut s = Store::read(root.path()).unwrap();
        s.import(&file("Classic", "a{color:red}")).unwrap();
        s.import(&file("Classic", "a{color:blue}")).unwrap();
        assert_ne!(s.imports[0].id, s.imports[1].id);
        assert!(s.selected.is_none());
        let snap = s.persist(root.path()).unwrap();
        assert_eq!(snap.revision, 1);
        assert!(s.check(0).is_err());
        let id = s.imports[0].id.clone();
        s.select(Some(id.clone())).unwrap();
        s.persist(root.path()).unwrap();
        s.remove(&id).unwrap();
        s.persist(root.path()).unwrap();
        assert!(Store::read(root.path()).unwrap().selected.is_none());
    }
    #[test]
    fn rejection_and_failed_write_preserve_disk() {
        let root = tempfile::tempdir().unwrap();
        let mut s = Store::read(root.path()).unwrap();
        s.persist(root.path()).unwrap();
        let before = std::fs::read(root.path().join(FILE)).unwrap();
        assert!(s.import(&file("Bad", "a{--x:url(bad)}")).is_err());
        assert!(s
            .import(&file("Bad", "a{--x:image-set('bad' 1x)}"))
            .is_err());
        assert!(s.persist(&root.path().join("missing")).is_err());
        assert_eq!(before, std::fs::read(root.path().join(FILE)).unwrap());
    }
    #[test]
    fn corrupt_recovery_and_future_protection() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join(FILE), "bad").unwrap();
        assert!(load_snapshot(root.path()).warning.is_some());
        reset(root.path(), 0, 0).unwrap();
        std::fs::write(root.path().join(FILE), r#"{"schemaVersion":99}"#).unwrap();
        assert!(reset(root.path(), 0, 0).is_err());
    }
    #[test]
    fn revalidate_on_load_and_preserve_legacy() {
        let root = tempfile::tempdir().unwrap();
        let legacy = serde_json::json!({"schemaVersion":1,"theme":Theme::default()}).to_string();
        std::fs::write(root.path().join("rewrite-theme-v1.json"), &legacy).unwrap();
        let mut s = Store::read(root.path()).unwrap();
        s.import(&file("Good", "a{color:red}")).unwrap();
        s.selected = Some(s.imports[0].id.clone());
        s.imports[0].source.css = "a{background:url(bad)}".into();
        s.persist(root.path()).unwrap();
        let snap = load_snapshot(root.path());
        assert!(snap.selected.is_none());
        assert!(snap.imports.is_empty());
        assert!(snap.warning.is_some());
        assert_eq!(
            legacy,
            std::fs::read_to_string(root.path().join("rewrite-theme-v1.json")).unwrap()
        );
    }
}
