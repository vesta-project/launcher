//! Allowlisted server resource DTOs; provider URLs and software tokens stay native.
use super::*;
use serde::{Deserialize, Serialize};
fn invalid() -> Error {
    Error::new(ErrorCode::InvalidInput)
}
fn unsupported() -> Error {
    Error::new(ErrorCode::Unsupported)
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ContentKind {
    Mod,
    Plugin,
    Datapack,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentProvider {
    pub provider: String,
    pub project_id: String,
    pub version_id: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeclaredMetadata {
    pub loader: Option<String>,
    pub side: Option<String>,
    pub name: Option<String>,
    pub version: Option<String>,
    pub dependencies: Vec<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentEntry {
    pub kind: ContentKind,
    pub path: String,
    pub filename: String,
    pub size: String,
    pub enabled: Option<bool>,
    pub sha256: Option<String>,
    pub provider: Option<ContentProvider>,
    pub declared: Option<DeclaredMetadata>,
    pub pending: Option<String>,
    pub pending_id: Option<String>,
    pub pending_error: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentCapabilities {
    pub list: bool,
    pub install: bool,
    pub update: bool,
    pub remove: bool,
    pub toggle: bool,
    pub cancel: bool,
    pub mods_supported: bool,
    pub plugins_supported: bool,
    #[serde(default)]
    pub datapack_toggle_offline: bool,
    #[serde(default)]
    pub datapack_toggle_running: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentInventory {
    pub items: Vec<ContentEntry>,
    pub capabilities: ContentCapabilities,
    pub minecraft_version: String,
    pub software: Option<String>,
    pub truncated: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentChange {
    pub id: String,
    pub state: String,
    pub pending: Option<String>,
    pub path: String,
    pub error: Option<String>,
    pub trash_path: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentInstall {
    pub kind: ContentKind,
    pub provider: String,
    pub project_id: String,
    pub version_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_sha256: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentMutation {
    pub action: String,
    pub kind: ContentKind,
    pub path: String,
    pub expected_sha256: String,
}

impl Client {
    pub async fn content_inventory(&self) -> Result<ContentInventory> {
        let inventory: ContentInventory =
            from_wire(self.get("content", true, "files.list").await?)?;
        if inventory.items.len() > 2000 {
            return Err(unsupported());
        }
        Ok(inventory)
    }
    pub async fn content_install(
        &self,
        input: ContentInstall,
        intent: &str,
    ) -> Result<ContentChange> {
        if !matches!(input.provider.as_str(), "modrinth" | "curseforge") {
            return Err(invalid());
        }
        let route = if input.path.is_some() {
            "content/update"
        } else {
            "content/install"
        };
        let key = self.intent_key(intent)?;
        from_wire(
            self.request(
                Method::POST,
                &format!("/api/v3/manage/{route}"),
                Some(hosting::wire(
                    serde_json::to_value(input).map_err(|_| invalid())?,
                )),
                Some(&key),
                true,
                "content.install",
            )
            .await?,
        )
    }
    pub async fn content_mutate(
        &self,
        input: ContentMutation,
        intent: &str,
    ) -> Result<ContentChange> {
        if !matches!(input.action.as_str(), "remove" | "enable" | "disable") {
            return Err(invalid());
        }
        let key = self.intent_key(intent)?;
        from_wire(
            self.request(
                Method::POST,
                "/api/v3/manage/content/mutate",
                Some(hosting::wire(
                    serde_json::to_value(input).map_err(|_| invalid())?,
                )),
                Some(&key),
                true,
                "content.install",
            )
            .await?,
        )
    }
    pub async fn content_cancel(&self, id: String, intent: &str) -> Result<ContentChange> {
        let key = self.intent_key(intent)?;
        from_wire(
            self.request(
                Method::POST,
                "/api/v3/manage/content/cancel",
                Some(json!({"id":id})),
                Some(&key),
                true,
                "content.install",
            )
            .await?,
        )
    }
    pub async fn content_identify(
        &self,
        path: String,
        intent: &str,
    ) -> Result<Option<ContentProvider>> {
        let key = self.intent_key(intent)?;
        from_wire(
            self.request(
                Method::POST,
                "/api/v3/manage/content/identify",
                Some(json!({"path":path})),
                Some(&key),
                true,
                "content.install",
            )
            .await?,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inventory_decodes_pending_unknown_jars_and_preserves_decimal_sizes() {
        let entry:ContentEntry=from_wire(json!({"kind":"plugin","path":"plugins/custom.jar","filename":"custom.jar","size":"9007199254740993","enabled":true,"sha256":null,"provider":null,"declared":null,"pending":"remove","pending_id":"stage","pending_error":null})).unwrap();
        assert_eq!(entry.kind, ContentKind::Plugin);
        assert_eq!(entry.size, "9007199254740993");
        assert!(entry.provider.is_none());
        assert_eq!(entry.pending_id.as_deref(), Some("stage"));
    }
    #[test]
    fn install_wire_has_no_provider_url_or_client_hash() {
        let value = hosting::wire(
            serde_json::to_value(ContentInstall {
                kind: ContentKind::Datapack,
                provider: "modrinth".into(),
                project_id: "p".into(),
                version_id: "v".into(),
                path: None,
                expected_sha256: None,
            })
            .unwrap(),
        );
        assert_eq!(
            value,
            json!({"kind":"datapack","provider":"modrinth","project_id":"p","version_id":"v"})
        );
    }
}
