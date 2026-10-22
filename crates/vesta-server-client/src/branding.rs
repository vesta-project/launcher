//! Server branding uses management metadata, not pack metadata or game files.
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::header::{HeaderMap, CONTENT_TYPE, IF_MATCH, IF_NONE_MATCH};
use serde::{Deserialize, Serialize};

pub const MAX_ICON_BYTES: usize = 256 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerBranding {
    pub name: String,
    pub description: Option<String>,
    pub revision: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamedDevice {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrandingPatch {
    pub name: Option<String>,
    pub description: Option<String>,
}
impl BrandingPatch {
    pub fn wire(&self, expected: &str) -> Result<Value> {
        let revision = expected
            .parse::<i64>()
            .ok()
            .filter(|n| *n >= 0 && n.to_string() == expected);
        if revision.is_none() || (self.name.is_none() && self.description.is_none()) {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        let mut value = json!({"expected_revision":expected});
        if let Some(name) = &self.name {
            value["name"] = json!(name);
        }
        if let Some(description) = &self.description {
            value["description"] = json!(description);
        }
        Ok(value)
    }
}
pub fn decode_icon(png: &str) -> Result<Vec<u8>> {
    if png.len() > MAX_ICON_BYTES.div_ceil(3) * 4 {
        return Err(Error::new(ErrorCode::InvalidInput));
    }
    let bytes = STANDARD
        .decode(png)
        .map_err(|_| Error::new(ErrorCode::InvalidInput))?;
    if bytes.len() > MAX_ICON_BYTES || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(Error::new(ErrorCode::InvalidInput));
    }
    Ok(bytes)
}
fn strong_etag(value: &str) -> bool {
    value.len() == 66
        && value.starts_with('"')
        && value.ends_with('"')
        && value.as_bytes()[1..65]
            .iter()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
}
impl Client {
    pub async fn branding(&self) -> Result<ServerBranding> {
        from_wire(self.get("server", true, "config.view").await?)
    }
    pub async fn branding_update(
        &self,
        patch: BrandingPatch,
        expected: &str,
        intent: &str,
    ) -> Result<ServerBranding> {
        from_wire(
            self.management_mutate(
                Method::PATCH,
                "server",
                Some(patch.wire(expected)?),
                intent,
                "config.edit",
            )
            .await?,
        )
    }
    async fn icon_read(&self) -> Result<Option<(String, String)>> {
        let response = self
            .file_request(crate::file_transport::Request {
                method: Method::GET,
                path: "/api/v3/manage/server/icon".into(),
                body: vec![],
                headers: HeaderMap::new(),
                key: None,
                bulk: false,
            })
            .await;
        let response = match response {
            Ok(v) => v,
            Err(e) if e.code == ErrorCode::NotFound => return Ok(None),
            Err(e) => return Err(e),
        };
        if response.header("content-type")?.split(';').next() != Some("image/png") {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        let etag = response.header("etag")?.to_owned();
        if !strong_etag(&etag) {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        let bytes = response.bytes(MAX_ICON_BYTES).await?;
        if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        Ok(Some((STANDARD.encode(bytes), etag)))
    }
    pub async fn icon(&self) -> Result<Option<String>> {
        Ok(self.icon_read().await?.map(|(png, _)| png))
    }
    pub async fn icon_set(&self, png: &str, intent: &str) -> Result<()> {
        let bytes = decode_icon(png)?;
        self.icon_mutate(Some(bytes), intent).await
    }
    pub async fn icon_clear(&self, intent: &str) -> Result<()> {
        self.icon_mutate(None, intent).await
    }
    async fn icon_mutate(&self, bytes: Option<Vec<u8>>, intent: &str) -> Result<()> {
        let key = self.intent_key(intent)?;
        // A fresh read captures the validator natively. A concurrent edit is a 412, never retried.
        let current = self.icon_read().await?;
        if bytes.is_none() && current.is_none() {
            return Ok(());
        }
        let mut headers = HeaderMap::new();
        match current {
            Some((_, etag)) => {
                headers.insert(
                    IF_MATCH,
                    etag.parse()
                        .map_err(|_| Error::new(ErrorCode::Unsupported))?,
                );
            }
            None => {
                headers.insert(IF_NONE_MATCH, "*".parse().expect("static header"));
            }
        }
        headers.insert(CONTENT_TYPE, "image/png".parse().expect("static header"));
        let method = if bytes.is_some() {
            Method::PUT
        } else {
            Method::DELETE
        };
        self.file_request(crate::file_transport::Request {
            method,
            path: "/api/v3/manage/server/icon".into(),
            body: bytes.unwrap_or_default(),
            headers,
            key: Some(key),
            bulk: false,
        })
        .await?
        .json(64 * 1024)
        .await?;
        Ok(())
    }
    pub async fn device_rename(&self, id: &str, name: &str, intent: &str) -> Result<RenamedDevice> {
        let value = self
            .management_mutate(
                Method::PATCH,
                &format!("devices/{}", management::segment(id)?),
                Some(json!({"name":name})),
                intent,
                "",
            )
            .await?;
        from_wire(value)
    }
}
