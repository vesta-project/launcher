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
dto!(PublishedRevision { revision:String,published_at:i64,published_by:Option<String>,required_update:bool,entry_count:Option<u64>,override_count:Option<u64>,provider_version:Option<String> });

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
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackManifest {
    pub name: String,
    pub summary: String,
    pub icon: Option<String>,
    pub display_version: String,
    pub minecraft_version: String,
    pub loader: ClientLoader,
    pub loader_version: Option<String>,
    pub entries: Vec<PackEntry>,
    #[serde(default)]
    pub override_files: Vec<OverrideFile>,
}
dto!(OverrideFile {root:String,path:String,sha256:Option<String>,trashed:bool});
dto!(FileRead {
    root: String,
    path: String,
    expected_revision: String
});
dto!(FileBody {
    revision: String,
    sha256: String,
    content_base64: String
});
dto!(FileMutation {
    expected_revision: String,
    change: FileOperation
});
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "operation",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum FileOperation {
    Write {
        root: String,
        path: String,
        content_base64: String,
    },
    Attach {
        root: String,
        path: String,
        sha256: String,
    },
    Mkdir {
        root: String,
        path: String,
    },
    Rename {
        root: String,
        path: String,
        destination: String,
    },
    Trash {
        root: String,
        path: String,
    },
}
dto!(PackDraft {
    revision: String,
    manifest: PackManifest
});
dto!(ServerModpackVersion {
    source: PackInstallSource,
    display_version: String
});
dto!(ServerModpackUpdate {installed:Option<ServerModpackVersion>,pending:Option<ServerModpackVersion>,available:Option<PackInstallSource>});
dto!(ServerModpackLink {installed:Option<ServerModpackVersion>,pending:Option<ServerModpackVersion>,source:PackInstallSource,display_version:String,files:std::collections::BTreeMap<String,String>,state:String,pending_ids:Vec<String>});
#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ClientPackConfig {
    #[serde(default)] pub allow_custom_content: bool,
    pub mode: String,
    pub require_update: bool,
}

dto!(ServerModpackUnlink {
    remove_owned_files: bool
});
dto!(PackInstallProgress { stage: String, completed: usize, total: usize });
dto!(WorkspaceView {
    install_progress: Option<PackInstallProgress>,
    server_modpack:Option<ServerModpackLink>,
    client_pack:ClientPackConfig,
    customizing_provider:bool,
    provider_pack: Option<content::ContentProvider>,
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
dto!(ArchiveInspection {format:String,manifest:PackManifest,entry_count:usize,provider_entries:Vec<content::ContentProvider>,unresolved_files:Vec<String>,overrides:Vec<String>,provider_pack:Option<content::ContentProvider>,warnings:Vec<String>});
dto!(ProviderPackPublish {
    expected_revision: String,
    draft_revision: String,
    provider: String,
    project_id: String,
    version_id: String,
    required_update: bool,
    acknowledge_lower_version: bool
});
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "source",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PackInstallSource {
    Provider {
        provider: String,
        project_id: String,
        version_id: String,
    },
    UploadedArchive {
        upload_id: String,
    },
    Draft {
        revision: String,
    },
    Published {
        revision: String,
    },
}
dto!(PackInstallRequest {
    source: PackInstallSource
});
dto!(PackInstallFile {path:String,sha256:String,expected_sha256:Option<String>,conflict:Option<String>,operation:String});
dto!(SoftwareSwitchTarget {software:String,minecraft_version:String,loader_version:Option<String>});
dto!(SoftwareSwitch {from:SoftwareSwitchTarget,to:SoftwareSwitchTarget});
dto!(InstallWarning {code:String,rule:String,item:String,detail:String});
#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(untagged)]
pub enum PackInstallWarning { Structured(InstallWarning), Legacy(String) }
dto!(PackInstallPlan {software_switch:Option<SoftwareSwitch>,plan_id:String,confirmation_token:String,expires_at_ms:i64,minecraft_version:String,software:String,loader_version:Option<String>,software_switch_required:bool,valid:bool,files:Vec<PackInstallFile>,skipped:Vec<String>,warnings:Vec<PackInstallWarning>,backup_recommended:bool,removed:Vec<(String,String)>});
dto!(PackInstallChoice {
    path: String,
    choice: String
});
#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PackInstallApply {
    #[serde(default)]
    pub acknowledge_warnings: bool,
    #[serde(default)]
    pub acknowledge_software_switch: bool,
    pub plan_id: String,
    pub confirmation_token: String,
    pub choices: Vec<PackInstallChoice>,
    pub set_as_modpack: bool,
}
dto!(PackInstallOutcome {software_job_id:Option<String>,state:String,pending_ids:Vec<String>,modpack_revision:Option<String>,server_modpack:Option<ServerModpackLink>});
impl Client {
    pub async fn server_modpack_link(&self) -> Result<Option<ServerModpackLink>> {
        from_wire(self.get("pack/server-link", true, "pack.edit").await?)
    }
    pub async fn server_modpack_update(&self) -> Result<ServerModpackUpdate> {
        from_wire(
            self.get("pack/server-link/update", true, "pack.edit")
                .await?,
        )
    }
    pub async fn client_pack_mode(
        &self,
        input: ClientPackConfig,
        intent: &str,
    ) -> Result<ClientPackConfig> {
        self.pack_mutate("pack/client-mode", &input, intent, "pack.publish")
            .await
    }
    pub async fn server_modpack_unlink(
        &self,
        input: ServerModpackUnlink,
        intent: &str,
    ) -> Result<PackInstallOutcome> {
        self.pack_mutate("pack/server-link/unlink", &input, intent, "content.install")
            .await
    }
    pub async fn pack_install_plan(&self, input: PackInstallRequest) -> Result<PackInstallPlan> {
        from_wire(
            self.request(
                Method::POST,
                "/api/v3/manage/pack/install/plan",
                Some(hosting::wire(
                    serde_json::to_value(input).map_err(|_| Error::new(ErrorCode::InvalidInput))?,
                )),
                None,
                true,
                "content.install",
            )
            .await?,
        )
    }
    pub async fn pack_install_apply(
        &self,
        input: PackInstallApply,
        intent: &str,
    ) -> Result<PackInstallOutcome> {
        self.pack_mutate("pack/install/apply", &input, intent, "content.install")
            .await
    }

    pub async fn pack_provider_publish(
        &self,
        input: ProviderPackPublish,
        intent: &str,
    ) -> Result<management::PackOutcome> {
        self.pack_mutate("pack/provider/publish", &input, intent, "pack.publish")
            .await
    }

    pub async fn pack_file_read(&self, input: FileRead) -> Result<FileBody> {
        from_wire(
            self.request(
                Method::POST,
                "/api/v3/manage/pack/files/read",
                Some(hosting::wire(
                    serde_json::to_value(input).map_err(|_| Error::new(ErrorCode::InvalidInput))?,
                )),
                None,
                true,
                "pack.edit",
            )
            .await?,
        )
    }
    pub async fn pack_file_mutate(&self, input: FileMutation, intent: &str) -> Result<PackDraft> {
        self.pack_mutate("pack/files/mutate", &input, intent, "pack.edit")
            .await
    }

    pub async fn pack_archive_inspect(&self, upload_id: String) -> Result<ArchiveInspection> {
        from_wire(
            self.request(
                Method::POST,
                "/api/v3/manage/pack/archive/inspect",
                Some(json!({"upload_id":upload_id})),
                None,
                true,
                "pack.edit",
            )
            .await?,
        )
    }

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
    pub async fn pack_history(&self) -> Result<Vec<PublishedRevision>> {
        from_wire(self.get("pack/history", true, "pack.edit").await?)
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
    fn override_and_provider_wire_are_closed_and_keep_decimal_revisions() {
        let input = FileMutation {
            expected_revision: "9007199254740991".into(),
            change: FileOperation::Attach {
                root: "server-overrides".into(),
                path: "config/server.toml".into(),
                sha256: "a".repeat(64),
            },
        };
        let wire = hosting::wire(serde_json::to_value(input).unwrap());
        assert_eq!(wire["expected_revision"], "9007199254740991");
        assert_eq!(wire["change"]["root"], "server-overrides");
        let decoded: FileMutation = from_wire(wire).unwrap();
        assert_eq!(decoded.expected_revision, "9007199254740991");
        assert!(serde_json::from_value::<FileOperation>(json!({"operation":"attach","root":"overrides","path":"config/a","sha256":"a".repeat(64),"url":"https://evil.invalid"})).is_err());
        let manifest:PackManifest=serde_json::from_value(json!({"name":"Old","summary":"","icon":null,"displayVersion":"1","minecraftVersion":"1.21.1","loader":"none","loaderVersion":null,"entries":[]})).unwrap();
        assert!(manifest.override_files.is_empty());
    }
    #[test]
    fn history_wire_keeps_revision_strings_and_legacy_unknown_counts() {
        let rows: Vec<PublishedRevision> = from_wire(json!([{"revision":"9007199254740991","published_at":1791115200000i64,"published_by":"owner","required_update":false,"entry_count":null,"override_count":null,"provider_version":"v1"}])).unwrap();
        assert_eq!(rows[0].revision, "9007199254740991");
        assert_eq!(rows[0].entry_count, None);
        assert_eq!(rows[0].provider_version.as_deref(), Some("v1"));
    }
    #[test]
    fn provider_source_refuses_untrusted_download_urls() {
        assert!(serde_json::from_value::<EntrySource>(json!({"type":"provider","provider":"modrinth","projectId":"p","versionId":"v","url":"https://evil.invalid"})).is_err());
        let loader: ClientLoader = serde_json::from_value(json!("fabric")).unwrap();
        assert_eq!(loader.id(), "fabric");
    }
}
#[cfg(test)]
mod install_wire_tests {
    use super::*;
    #[test]
    fn install_wire_preserves_paths_and_nested_source() {
        let input = PackInstallApply {
            acknowledge_warnings: true,
            acknowledge_software_switch: true,
            plan_id: "plan".into(),
            confirmation_token: "secret".into(),
            choices: vec![PackInstallChoice {
                path: "config/My_Mod.json".into(),
                choice: "keep".into(),
            }],
            set_as_modpack: true,
        };
        let value = hosting::wire(serde_json::to_value(input).unwrap());
        assert_eq!(value["choices"][0]["path"], "config/My_Mod.json");
        assert_eq!(value["set_as_modpack"], true);
        let decoded: PackInstallApply = from_wire(value).unwrap();
        assert_eq!(decoded.choices[0].path, "config/My_Mod.json");
        let source = PackInstallRequest {
            source: PackInstallSource::Provider {
                provider: "modrinth".into(),
                project_id: "project".into(),
                version_id: "version".into(),
            },
        };
        let value = hosting::wire(serde_json::to_value(source).unwrap());
        assert_eq!(value["source"]["project_id"], "project");
        assert_eq!(value["source"]["source"], "provider");
    }
}

#[cfg(test)]
mod server_link_wire_tests {
    use super::*;
    #[test]
    fn update_contract_keeps_confirmed_and_incoming_provider_versions_separate() {
        let version = |id: &str| serde_json::json!({"source":{"source":"provider","provider":"modrinth","project_id":"pack","version_id":id},"display_version":id});
        let update: ServerModpackUpdate = from_wire(serde_json::json!({
            "installed":version("v1"),"pending":version("v2"),"available":null
        }))
        .unwrap();
        assert!(
            matches!(update.installed.unwrap().source,PackInstallSource::Provider{version_id,..} if version_id=="v1")
        );
        assert!(
            matches!(update.pending.unwrap().source,PackInstallSource::Provider{version_id,..} if version_id=="v2")
        );
        assert!(update.available.is_none());
    }
    #[test]
    fn independent_link_contract_preserves_owned_paths_and_source_identity() {
        let link:ServerModpackLink=from_wire(serde_json::json!({"source":{"source":"provider","provider":"modrinth","project_id":"pack","version_id":"v2"},"display_version":"2","files":{"config/my_custom_file.toml":"abc"},"state":"installed","pending_ids":[]})).unwrap();
        assert!(link.files.contains_key("config/my_custom_file.toml"));
        assert!(
            matches!(link.source,PackInstallSource::Provider{version_id,..} if version_id=="v2")
        );
        let config: ClientPackConfig =
            from_wire(serde_json::json!({"mode":"server-modpack","require_update":true})).unwrap();
        assert!(config.require_update);
    }
}
