use base64::{engine::general_purpose, Engine as _};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn normalize_uuid(uuid: &str) -> String {
    uuid.replace('-', "").to_lowercase()
}

fn sanitize_cape_id(cape_id: &str) -> String {
    let cleaned: String = cape_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();

    if !cleaned.is_empty() {
        return cleaned.to_lowercase();
    }

    let mut hasher = Sha256::new();
    hasher.update(cape_id.as_bytes());
    let hash = hex::encode(hasher.finalize());
    format!("cape-{}", &hash[..16])
}

fn short_hash(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let hash = hex::encode(hasher.finalize());
    hash[..16].to_string()
}

fn resolve_cache_dir(app_handle: Option<&AppHandle>) -> Result<PathBuf, String> {
    let base_dir = if let Some(app) = app_handle {
        app.path().app_cache_dir().map_err(|e| e.to_string())?
    } else {
        crate::utils::db_manager::get_app_config_dir()
            .map_err(|e| e.to_string())?
            .join("cache")
    };

    let cache_dir = base_dir.join("account_capes");
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create cape cache directory: {}", e))?;

    Ok(cache_dir)
}

fn resolve_cache_path(
    app_handle: Option<&AppHandle>,
    account_uuid: &str,
    cape_id: &str,
    cape_url: &str,
) -> Result<PathBuf, String> {
    let cache_dir = resolve_cache_dir(app_handle)?;
    let normalized_uuid = normalize_uuid(account_uuid);
    let safe_cape_id = sanitize_cape_id(cape_id);
    let url_hash = short_hash(cape_url);

    Ok(cache_dir.join(format!(
        "{}_{}_{}.png",
        normalized_uuid, safe_cape_id, url_hash
    )))
}

fn decode_data_uri_bytes(data_uri: &str) -> Result<Vec<u8>, String> {
    let clean_base64 = if let Some(pos) = data_uri.find(',') {
        &data_uri[pos + 1..]
    } else {
        data_uri
    };

    general_purpose::STANDARD
        .decode(clean_base64)
        .map_err(|e| format!("Failed to decode data URI for cape cache: {}", e))
}

pub fn bytes_to_png_data_uri(bytes: &[u8]) -> String {
    format!(
        "data:image/png;base64,{}",
        general_purpose::STANDARD.encode(bytes)
    )
}

pub async fn read_cached_cape_bytes(
    app_handle: Option<&AppHandle>,
    account_uuid: &str,
    cape_id: &str,
    cape_url: &str,
) -> Result<Option<Vec<u8>>, String> {
    let cache_path = resolve_cache_path(app_handle, account_uuid, cape_id, cape_url)?;
    if !tokio::fs::try_exists(&cache_path)
        .await
        .map_err(|e| format!("Failed to check cached cape path: {}", e))?
    {
        return Ok(None);
    }

    let bytes = tokio::fs::read(&cache_path)
        .await
        .map_err(|e| format!("Failed to read cached cape file: {}", e))?;

    if bytes.is_empty() {
        return Ok(None);
    }

    Ok(Some(bytes))
}

pub async fn cache_cape_from_url(
    app_handle: Option<&AppHandle>,
    account_uuid: &str,
    cape_id: &str,
    cape_url: &str,
) -> Result<Vec<u8>, String> {
    if cape_url.trim().is_empty() {
        return Err("Cape URL is empty".to_string());
    }

    let bytes = if cape_url.starts_with("data:") {
        decode_data_uri_bytes(cape_url)?
    } else {
        let response = reqwest::get(cape_url)
            .await
            .map_err(|e| format!("Failed to download cape image: {}", e))?;

        if !response.status().is_success() {
            return Err(format!(
                "Failed to download cape image: HTTP {}",
                response.status()
            ));
        }

        response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read downloaded cape bytes: {}", e))?
            .to_vec()
    };

    if bytes.is_empty() {
        return Err("Downloaded cape image is empty".to_string());
    }

    let cache_path = resolve_cache_path(app_handle, account_uuid, cape_id, cape_url)?;
    tokio::fs::write(&cache_path, &bytes)
        .await
        .map_err(|e| format!("Failed to write cached cape file: {}", e))?;

    Ok(bytes)
}

pub async fn get_or_cache_cape_bytes(
    app_handle: Option<&AppHandle>,
    account_uuid: &str,
    cape_id: &str,
    cape_url: &str,
) -> Result<Option<Vec<u8>>, String> {
    if cape_url.trim().is_empty() {
        return Ok(None);
    }

    if let Some(bytes) = read_cached_cape_bytes(app_handle, account_uuid, cape_id, cape_url).await? {
        return Ok(Some(bytes));
    }

    let bytes = cache_cape_from_url(app_handle, account_uuid, cape_id, cape_url).await?;
    Ok(Some(bytes))
}
