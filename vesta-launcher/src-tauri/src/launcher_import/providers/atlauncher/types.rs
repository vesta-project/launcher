use serde::{Deserialize, Deserializer};

fn deserialize_id_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    struct IdVisitor;

    impl<'de> serde::de::Visitor<'de> for IdVisitor {
        type Value = String;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a string or integer identifier")
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(value.to_string())
        }

        fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(value)
        }

        fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(value.to_string())
        }

        fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(value.to_string())
        }
    }

    deserializer.deserialize_any(IdVisitor)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ATResourceHint {
    pub project_id: String,
    pub version_id: String,
    pub platform: String,
    pub file_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum ATLauncherSourceLink {
    Modrinth {
        project_id: String,
        version_id: String,
    },
    Curseforge {
        project_id: String,
        version_id: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ATInstance {
    pub id: String,
    pub launcher: ATLauncherData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ATLauncherData {
    pub name: String,
    #[serde(default)]
    pub loader_version: Option<ATLoaderVersion>,
    #[serde(default, rename = "modrinthProject")]
    pub modrinth_project: Option<ATPackProject>,
    #[serde(default, rename = "modrinthVersion")]
    pub modrinth_version: Option<ATPackVersion>,
    #[serde(default, rename = "curseForgeProject")]
    pub curseforge_project: Option<ATPackProject>,
    #[serde(default, rename = "curseForgeFile")]
    pub curseforge_file: Option<ATPackVersion>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ATLoaderVersion {
    pub r#type: String,
    pub version: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct ATPackProject {
    #[serde(deserialize_with = "deserialize_id_string")]
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct ATPackVersion {
    #[serde(deserialize_with = "deserialize_id_string")]
    pub id: String,
    #[serde(default, rename = "fileName")]
    pub file_name: Option<String>,
}
