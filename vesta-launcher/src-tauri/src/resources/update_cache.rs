use anyhow::{anyhow, Result};
use chrono::NaiveDateTime;
use diesel::prelude::*;

use crate::models::instance::Instance;
use crate::models::instance_resource_update_check::InstanceResourceUpdateCheck;
use crate::models::resource_update::{
    InstanceUpdateCheckResult, InstanceUpdateSnapshotData, InstanceUpdateSnapshotResponse,
};
use crate::schema::vesta::instance_resource_update_check::dsl as iruc_dsl;
use crate::utils::db::get_vesta_conn;

pub const VERSION_CACHE_TTL_MINUTES: i64 = 30;
pub const INSTANCE_UPDATE_CHECK_TTL_MINUTES: i64 = 5;

pub fn instance_update_fingerprint(inst: &Instance) -> String {
    format!(
        "{}|{}|{}",
        inst.minecraft_version,
        inst.modloader.as_deref().unwrap_or("vanilla"),
        inst.modpack_version_id.as_deref().unwrap_or("")
    )
}

fn parse_naive_datetime(value: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
        .ok()
        .or_else(|| {
            chrono::DateTime::parse_from_rfc3339(value)
                .ok()
                .map(|dt| dt.naive_utc())
        })
}

pub fn now_datetime_str() -> String {
    chrono::Utc::now()
        .naive_utc()
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

pub fn is_checked_at_fresh(checked_at: &str, ttl_minutes: i64) -> bool {
    let Some(parsed) = parse_naive_datetime(checked_at) else {
        return false;
    };
    let now = chrono::Utc::now().naive_utc();
    (now - parsed).num_minutes() < ttl_minutes
}

pub fn is_snapshot_fresh(record: &InstanceResourceUpdateCheck, fingerprint: &str) -> bool {
    record.instance_fingerprint == fingerprint
        && is_checked_at_fresh(&record.checked_at, INSTANCE_UPDATE_CHECK_TTL_MINUTES)
}

pub fn load_instance_update_snapshot(
    instance_id: i32,
) -> Result<Option<InstanceResourceUpdateCheck>> {
    let mut conn = get_vesta_conn().map_err(|e| anyhow!(e.to_string()))?;
    iruc_dsl::instance_resource_update_check
        .filter(iruc_dsl::instance_id.eq(instance_id))
        .first::<InstanceResourceUpdateCheck>(&mut conn)
        .optional()
        .map_err(|e| anyhow!("Failed to load instance update snapshot: {}", e))
}

pub fn snapshot_to_result(record: &InstanceResourceUpdateCheck) -> Result<InstanceUpdateCheckResult> {
    let data: InstanceUpdateSnapshotData = serde_json::from_str(&record.results_json)
        .map_err(|e| anyhow!("Failed to parse instance update snapshot: {}", e))?;
    Ok(InstanceUpdateCheckResult {
        resource_updates: data.resource_updates,
        modpack_versions: data.modpack_versions,
    })
}

pub fn get_instance_update_snapshot_response(
    instance_id: i32,
    inst: &Instance,
) -> Result<Option<InstanceUpdateSnapshotResponse>> {
    let fingerprint = instance_update_fingerprint(inst);
    let Some(record) = load_instance_update_snapshot(instance_id)? else {
        return Ok(None);
    };

    let data = snapshot_to_result(&record)?;
    let is_stale = !is_snapshot_fresh(&record, &fingerprint);

    Ok(Some(InstanceUpdateSnapshotResponse {
        checked_at: record.checked_at,
        resource_updates: data.resource_updates,
        modpack_versions: data.modpack_versions,
        is_stale,
    }))
}

pub fn save_instance_update_snapshot(
    instance_id: i32,
    fingerprint: &str,
    result: &InstanceUpdateCheckResult,
) -> Result<()> {
    let data = InstanceUpdateSnapshotData {
        resource_updates: result.resource_updates.clone(),
        modpack_versions: result.modpack_versions.clone(),
    };
    let results_json = serde_json::to_string(&data)
        .map_err(|e| anyhow!("Failed to serialize instance update snapshot: {}", e))?;

    let record = InstanceResourceUpdateCheck {
        instance_id,
        checked_at: now_datetime_str(),
        results_json,
        instance_fingerprint: fingerprint.to_string(),
    };

    let mut conn = get_vesta_conn().map_err(|e| anyhow!(e.to_string()))?;
    diesel::insert_into(iruc_dsl::instance_resource_update_check)
        .values(&record)
        .on_conflict(iruc_dsl::instance_id)
        .do_update()
        .set((
            iruc_dsl::checked_at.eq(&record.checked_at),
            iruc_dsl::results_json.eq(&record.results_json),
            iruc_dsl::instance_fingerprint.eq(&record.instance_fingerprint),
        ))
        .execute(&mut conn)
        .map_err(|e| anyhow!("Failed to save instance update snapshot: {}", e))?;

    Ok(())
}

pub fn invalidate_instance_update_snapshot(instance_id: i32) -> Result<()> {
    let mut conn = get_vesta_conn().map_err(|e| anyhow!(e.to_string()))?;
    diesel::delete(
        iruc_dsl::instance_resource_update_check.filter(iruc_dsl::instance_id.eq(instance_id)),
    )
    .execute(&mut conn)
    .map_err(|e| anyhow!("Failed to invalidate instance update snapshot: {}", e))?;
    Ok(())
}

pub fn clear_all_instance_update_snapshots() -> Result<()> {
    let mut conn = get_vesta_conn().map_err(|e| anyhow!(e.to_string()))?;
    diesel::delete(iruc_dsl::instance_resource_update_check)
        .execute(&mut conn)
        .map_err(|e| anyhow!("Failed to clear instance update snapshots: {}", e))?;
    Ok(())
}
