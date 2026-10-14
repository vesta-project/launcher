use crate::schema::installed_resource;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

/// A recognized original artifact is provenance, not installed release identity.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecognizedSource {
    pub platform: String,
    pub project_id: String,
    pub version_id: String,
    pub version_number: String,
    pub display_name: String,
    pub icon_url: Option<String>,
    pub web_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ManualSourceScope {
    Instance,
    World { world_id: uuid::Uuid },
}

#[derive(
    Debug, Clone, Serialize, Deserialize, PartialEq, Eq, diesel::AsExpression, diesel::FromSqlRow,
)]
#[diesel(sql_type = diesel::sql_types::Text)]
#[serde(rename_all = "camelCase")]
pub struct ManualSourceEvidence {
    pub original_sha1: String,
    pub installed_sha1: String,
    pub resource_type: String,
    pub scope: ManualSourceScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<RecognizedSource>,
}

/// Decode optional persistence independently: corrupt provenance must never
/// prevent loading the installed resource or managing a different world.
#[derive(diesel::FromSqlRow)]
#[diesel(sql_type = diesel::sql_types::Nullable<diesel::sql_types::Text>)]
pub struct OptionalManualSourceEvidence(Option<ManualSourceEvidence>);

impl From<OptionalManualSourceEvidence> for Option<ManualSourceEvidence> {
    fn from(value: OptionalManualSourceEvidence) -> Self {
        value.0
    }
}

impl
    diesel::deserialize::FromSql<
        diesel::sql_types::Nullable<diesel::sql_types::Text>,
        diesel::sqlite::Sqlite,
    > for OptionalManualSourceEvidence
{
    fn from_sql(
        value: diesel::sqlite::SqliteValue<'_, '_, '_>,
    ) -> diesel::deserialize::Result<Self> {
        Self::from_nullable_sql(Some(value))
    }

    fn from_nullable_sql(
        value: Option<diesel::sqlite::SqliteValue<'_, '_, '_>>,
    ) -> diesel::deserialize::Result<Self> {
        let json = <Option<String> as diesel::deserialize::FromSql<
            diesel::sql_types::Nullable<diesel::sql_types::Text>,
            diesel::sqlite::Sqlite,
        >>::from_nullable_sql(value)
        .ok()
        .flatten();
        Ok(Self(json.and_then(|json| serde_json::from_str(&json).ok())))
    }
}

pub(crate) fn optional_evidence<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(serde_json::from_value(value).ok())
}

impl diesel::serialize::ToSql<diesel::sql_types::Text, diesel::sqlite::Sqlite>
    for ManualSourceEvidence
{
    fn to_sql<'b>(
        &'b self,
        out: &mut diesel::serialize::Output<'b, '_, diesel::sqlite::Sqlite>,
    ) -> diesel::serialize::Result {
        out.set_value(serde_json::to_string(self)?);
        Ok(diesel::serialize::IsNull::No)
    }
}

impl diesel::deserialize::FromSql<diesel::sql_types::Text, diesel::sqlite::Sqlite>
    for ManualSourceEvidence
{
    fn from_sql(
        value: diesel::sqlite::SqliteValue<'_, '_, '_>,
    ) -> diesel::deserialize::Result<Self> {
        let json = <String as diesel::deserialize::FromSql<
            diesel::sql_types::Text,
            diesel::sqlite::Sqlite,
        >>::from_sql(value)?;
        Ok(serde_json::from_str(&json)?)
    }
}

#[derive(Debug, Serialize, Deserialize, Queryable, Selectable, Insertable, AsChangeset, Clone)]
#[diesel(table_name = installed_resource)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct InstalledResource {
    pub id: i32,
    pub instance_id: i32,
    pub platform: String,
    pub remote_id: String,
    pub remote_version_id: String,
    pub resource_type: String,
    pub local_path: String,
    pub display_name: String,
    pub current_version: String,
    pub is_manual: bool,
    pub is_enabled: bool,
    pub last_updated: String,
    pub release_type: String,
    pub hash: Option<String>,
    pub file_size: i64,
    pub file_mtime: i64,
    pub source_kind: String,
    pub source_modpack_id: Option<String>,
    pub source_modpack_version_id: Option<String>,
    pub source_modpack_platform: Option<String>,
    #[serde(
        default,
        deserialize_with = "optional_evidence",
        rename = "manualSourceEvidence",
        alias = "manual_source_evidence"
    )]
    #[diesel(deserialize_as = OptionalManualSourceEvidence)]
    pub manual_source_evidence: Option<ManualSourceEvidence>,
}

#[derive(Insertable, Debug, Clone)]
#[diesel(table_name = installed_resource)]
pub struct NewInstalledResource {
    pub instance_id: i32,
    pub platform: String,
    pub remote_id: String,
    pub remote_version_id: String,
    pub resource_type: String,
    pub local_path: String,
    pub display_name: String,
    pub current_version: String,
    pub is_manual: bool,
    pub is_enabled: bool,
    pub last_updated: String,
    pub release_type: String,
    pub hash: Option<String>,
    pub file_size: i64,
    pub file_mtime: i64,
    pub source_kind: String,
    pub source_modpack_id: Option<String>,
    pub source_modpack_version_id: Option<String>,
    pub source_modpack_platform: Option<String>,
    pub manual_source_evidence: Option<ManualSourceEvidence>,
}
