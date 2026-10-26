//! Client-pack workspace IPC DTOs. Revisions and sizes remain decimal strings.
use super::*;
use serde::{Deserialize, Serialize};
macro_rules! dto {($name:ident {$($field:ident:$ty:ty),*$(,)?})=>{
    #[derive(Clone,Debug,Deserialize,Serialize)]
    #[serde(rename_all="camelCase",deny_unknown_fields)]
    pub struct $name {$(pub $field:$ty),*}
};}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClientLoader {
    None,
    Fabric,
    Quilt,
    Neoforge,
    Forge,
}
impl ClientLoader {
    pub fn id(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Fabric => "fabric",
            Self::Quilt => "quilt",
            Self::Neoforge => "neoforge",
            Self::Forge => "forge",
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    Mod,
    ResourcePack,
    Shader,
    Datapack,
    ConfigOverride,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    Required,
    Optional,
    Unsupported,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EntrySource {
    Provider {
        provider: String,
        project_id: String,
        version_id: String,
    },
    Upload {
        sha256: String,
    },
    Manual {
        reason: String,
    },
}
dto!(Environment {
    client: Side,
    server: Side
});
dto!(PackIcon {
    mime_type: String,
    content_base64: String
});
dto!(PackEntry {
    id: String,
    kind: EntryKind,
    path: String,
    required: bool,
    environment: Environment,
    source: EntrySource
});
dto!(PackManifest{name:String,summary:String,icon:Option<String>,display_version:String,minecraft_version:String,loader:ClientLoader,loader_version:Option<String>,entries:Vec<PackEntry>});
dto!(PackDraft {
    revision: String,
    manifest: PackManifest
});
dto!(WorkspaceView {
    draft: PackDraft,
    server_minecraft_version: String,
    minecraft_drift: bool,
    published_revision: String,
    minimum_revision: String,
    pending_publication: bool,
    safety_snapshot_recommended: bool
});
dto!(DraftWrite {
    expected_revision: String,
    manifest: PackManifest
});
dto!(DraftAdd{expected_revision:String,entries:Vec<PackEntry>});
dto!(ProviderSelection {
    provider: String,
    project_id: String,
    version_id: String,
    required: bool
});
dto!(BrowseAdd{expected_revision:String,provider:String,project_id:String,version_id:String,dependencies:Vec<ProviderSelection>,required:bool});
dto!(PackSuggestion{id:String,kind:String,entry_id:Option<String>,provider:Option<content::ContentProvider>,path:Option<String>});
dto!(PackSuggestions{draft_revision:String,items:Vec<PackSuggestion>,warnings:Vec<String>,potentially_outdated:bool});
dto!(PackIssue{code:String,entry_id:Option<String>,severity:String});
dto!(EntryDiff {
    before: PackEntry,
    after: PackEntry,
    version_changed: bool
});
dto!(PackDiff{added:Vec<PackEntry>,removed:Vec<PackEntry>,changed:Vec<EntryDiff>,metadata_changed:bool,custom_overrides:Vec<String>,symbolic_links:Vec<String>});
dto!(PreviewRequest{draft_revision:String,resolved_entries:Vec<PackEntry>});
dto!(PackPreview{draft_revision:String,published_revision:String,manifest:PackManifest,issues:Vec<PackIssue>,diff:PackDiff,suggestions:Vec<PackSuggestion>,review_sha256:String,valid:bool,safety_snapshot_recommended:bool});
dto!(WorkspacePublish{expected_revision:String,draft_revision:String,resolved_entries:Vec<PackEntry>,review_sha256:String,required_update:bool,acknowledge_lower_version:bool});
dto!(UploadBegin {
    upload_id: String,
    total_size: String,
    sha256: String,
    archive: bool
});
dto!(UploadChunk {
    upload_id: String,
    offset: String,
    content_base64: String
});
dto!(UploadReceipt {
    upload_id: String,
    size: String,
    sha256: String,
    complete: bool
});
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "source",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ImportRequest {
    Archive {
        expected_revision: String,
        content_base64: String,
    },
    UploadedArchive {
        expected_revision: String,
        upload_id: String,
    },
    Published {
        expected_revision: String,
        expected_published_revision: String,
    },
}
impl Client {
    pub async fn pack_icon(&self) -> Result<Option<PackIcon>> {
        from_wire(self.get("pack/draft/icon", true, "pack.edit").await?)
    }
    async fn pack_mutate<T: Serialize, R: serde::de::DeserializeOwned>(
        &self,
        route: &str,
        input: &T,
        intent: &str,
        capability: &str,
    ) -> Result<R> {
        let body = hosting::wire(
            serde_json::to_value(input).map_err(|_| Error::new(ErrorCode::InvalidInput))?,
        );
        from_wire(
            self.management_mutate(Method::POST, route, Some(body), intent, capability)
                .await?,
        )
    }
    pub async fn pack_draft(&self) -> Result<WorkspaceView> {
        from_wire(self.get("pack/draft", true, "pack.edit").await?)
    }
    pub async fn pack_write(&self, input: DraftWrite, intent: &str) -> Result<PackDraft> {
        self.pack_mutate("pack/draft", &input, intent, "pack.edit")
            .await
    }
    pub async fn pack_add(&self, input: DraftAdd, intent: &str) -> Result<PackDraft> {
        self.pack_mutate("pack/draft/add", &input, intent, "pack.edit")
            .await
    }
    pub async fn pack_browse_add(&self, input: BrowseAdd, intent: &str) -> Result<PackDraft> {
        self.pack_mutate("pack/draft/add", &input, intent, "pack.edit")
            .await
    }
    pub async fn pack_delete(&self, expected: String, intent: &str) -> Result<PackDraft> {
        self.pack_mutate(
            "pack/draft/delete",
            &json!({"expectedRevision":expected}),
            intent,
            "pack.edit",
        )
        .await
    }
    pub async fn pack_import(&self, input: ImportRequest, intent: &str) -> Result<PackDraft> {
        self.pack_mutate("pack/draft/import", &input, intent, "pack.edit")
            .await
    }
    pub async fn pack_suggestions(&self) -> Result<PackSuggestions> {
        from_wire(self.get("pack/suggestions", true, "pack.edit").await?)
    }
    pub async fn pack_preview(&self, input: PreviewRequest) -> Result<PackPreview> {
        from_wire(
            self.request(
                Method::POST,
                "/api/v3/manage/pack/preview",
                Some(hosting::wire(
                    serde_json::to_value(input).map_err(|_| Error::new(ErrorCode::InvalidInput))?,
                )),
                None,
                true,
                "pack.build",
            )
            .await?,
        )
    }
    pub async fn pack_publish_workspace(
        &self,
        input: WorkspacePublish,
        intent: &str,
    ) -> Result<management::PackOutcome> {
        self.pack_mutate("pack/publish", &input, intent, "pack.publish")
            .await
    }
    pub async fn pack_upload_begin(
        &self,
        input: UploadBegin,
        intent: &str,
    ) -> Result<UploadReceipt> {
        self.pack_mutate("pack/draft/uploads/begin", &input, intent, "pack.edit")
            .await
    }
    pub async fn pack_upload_chunk(
        &self,
        input: UploadChunk,
        intent: &str,
    ) -> Result<UploadReceipt> {
        self.pack_mutate("pack/draft/uploads/chunk", &input, intent, "pack.edit")
            .await
    }
    pub async fn pack_upload_finish(&self, id: String, intent: &str) -> Result<UploadReceipt> {
        self.pack_mutate(
            "pack/draft/uploads/finish",
            &json!({"uploadId":id}),
            intent,
            "pack.edit",
        )
        .await
    }
    pub async fn pack_upload_cancel(&self, id: String, intent: &str) -> Result<bool> {
        self.pack_mutate(
            "pack/draft/uploads/cancel",
            &json!({"uploadId":id}),
            intent,
            "pack.edit",
        )
        .await
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn draft_and_publish_wire_preserve_client_loader_pins_and_decimal_revisions() {
        let input = WorkspacePublish {
            expected_revision: "9007199254740991".into(),
            draft_revision: "4".into(),
            resolved_entries: vec![PackEntry {
                id: "dependency".into(),
                kind: EntryKind::Mod,
                path: "mods/dep.jar".into(),
                required: true,
                environment: Environment {
                    client: Side::Required,
                    server: Side::Unsupported,
                },
                source: EntrySource::Provider {
                    provider: "modrinth".into(),
                    project_id: "dep".into(),
                    version_id: "v1".into(),
                },
            }],
            review_sha256: "a".repeat(64),
            required_update: true,
            acknowledge_lower_version: false,
        };
        let value = hosting::wire(serde_json::to_value(input).unwrap());
        assert_eq!(value["expected_revision"], "9007199254740991");
        assert_eq!(value["resolved_entries"][0]["source"]["version_id"], "v1");
        assert!(value.to_string().find("download_url").is_none());
        let decoded: WorkspacePublish = from_wire(value).unwrap();
        assert!(decoded.required_update);
        assert_eq!(decoded.draft_revision, "4");
    }
    #[test]
    fn provider_source_refuses_untrusted_download_urls() {
        assert!(serde_json::from_value::<EntrySource>(json!({"type":"provider","provider":"modrinth","projectId":"p","versionId":"v","url":"https://evil.invalid"})).is_err());
        let loader: ClientLoader = serde_json::from_value(json!("fabric")).unwrap();
        assert_eq!(loader.id(), "fabric");
    }
}
