//! Remote first-time backup setup and complete profile-set replacement.
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupProfileConfig {
    pub name: String,
    pub mode: String,
    #[serde(default)]
    pub keep_total: u32,
    #[serde(default)]
    pub keep_hourly: u32,
    pub keep_last: u32,
    pub keep_daily: u32,
    pub keep_weekly: u32,
    pub keep_monthly: u32,
    pub on_mutation: String,
    pub warn_seconds: u32,
    pub max_snapshots: Option<u32>,
    pub include: Vec<String>,
    pub exclude: Vec<String>,
}
impl BackupProfileConfig {
    fn wire(&self) -> Value {
        json!({"name":self.name,"mode":self.mode,"keep_total":self.keep_total,"keep_hourly":self.keep_hourly,"keep_last":self.keep_last,"keep_daily":self.keep_daily,
            "keep_weekly":self.keep_weekly,"keep_monthly":self.keep_monthly,"on_mutation":self.on_mutation,
            "warn_seconds":self.warn_seconds,"max_snapshots":self.max_snapshots,"include":self.include,"exclude":self.exclude})
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupConfigLimits {
    pub max_snapshots: Option<u32>,
    pub max_repository_bytes: Option<u64>,
    pub min_free_bytes: u64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupConfigDraft {
    pub profiles: Vec<BackupProfileConfig>,
    pub limits: BackupConfigLimits,
    pub initialize_repository: bool,
}
impl BackupConfigDraft {
    pub fn wire(&self, expected: Option<u64>) -> Result<Value> {
        if expected.is_some_and(|r| r == 0 || r > 9_007_199_254_740_991)
            || self.profiles.len() > 16
            || self
                .limits
                .max_repository_bytes
                .is_some_and(|v| v > 9_007_199_254_740_991)
            || self.limits.min_free_bytes > 9_007_199_254_740_991
        {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        Ok(
            json!({"expected_revision":expected,"profiles":self.profiles.iter().map(BackupProfileConfig::wire).collect::<Vec<_>>(),
            "limits":{"max_snapshots":self.limits.max_snapshots,"max_repository_bytes":self.limits.max_repository_bytes,"min_free_bytes":self.limits.min_free_bytes},
            "initialize_repository":self.initialize_repository}),
        )
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRepositoryView {
    pub kind: String,
    pub location: Option<String>,
    pub initialized: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupConfiguration {
    pub source: String,
    pub revision: Option<u64>,
    pub profiles: Vec<BackupProfileConfig>,
    pub limits: BackupConfigLimits,
    pub repository: BackupRepositoryView,
    pub backups_configured: bool,
    pub schedule_owner: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupConfigOutcome {
    pub revision: u64,
}

impl Client {
    pub async fn backup_configuration(&self) -> Result<BackupConfiguration> {
        from_wire(
            self.request(
                Method::GET,
                "/api/v3/manage/backups/config",
                None,
                None,
                true,
                "backups.configure",
            )
            .await?,
        )
    }
    pub async fn backup_configure(
        &self,
        draft: BackupConfigDraft,
        expected: Option<u64>,
        intent: &str,
    ) -> Result<BackupConfigOutcome> {
        let body = draft.wire(expected)?;
        from_wire(
            self.management_mutate(
                Method::PUT,
                "backups/config",
                Some(body),
                intent,
                "backups.configure",
            )
            .await?,
        )
    }
}
