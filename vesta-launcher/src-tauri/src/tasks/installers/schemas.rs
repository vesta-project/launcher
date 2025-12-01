cuse serde::{Deserialize, Serialize};

/// Artifact metadata persisted in cache/artifacts.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactRecord {
    pub sha256: String,
    pub size: u64,
    #[serde(default)]
    pub signature: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
    /// Computed refcount; managed by store logic
    pub refs: u32,
}

/// Install index persisted in cache/install_index.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallIndexRecord {
    pub version_id: String,
    pub loader: LoaderKind,
    #[serde(default)]
    pub components: Vec<ComponentItem>,
    #[serde(default)]
    pub processors: Vec<ProcessorItem>,
    #[serde(default)]
    pub libraries: Vec<LibraryItem>,
    /// Reachability graph: sha256 -> labels referencing usage
    #[serde(default)]
    pub reachability: std::collections::HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LoaderKind {
    #[serde(rename = "vanilla")]
    Vanilla,
    #[serde(rename = "fabric")]
    Fabric,
    #[serde(rename = "quilt")]
    Quilt,
    #[serde(rename = "forge")]
    Forge,
    #[serde(rename = "neoforge")]
    NeoForge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentItem {
    pub name: String,
    pub sha256: String,
    #[serde(default)]
    pub path_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessorItem {
    pub id: String,
    pub sha256: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryItem {
    pub maven: String,
    pub sha256: String,
    #[serde(default)]
    pub natives: Option<String>,
}
