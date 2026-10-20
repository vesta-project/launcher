use anyhow::Result;
use serde::{Deserialize, Serialize};
use tauri::command;

const GITHUB_RELEASES_URL: &str = "https://api.github.com/repos/Vesta-Project/launcher/releases";

#[derive(Debug, Serialize, Deserialize)]
pub struct GithubRelease {
    pub tag_name: String,
    /// GitHub sends null for an untitled release or one without notes.
    #[serde(default, deserialize_with = "null_as_empty")]
    pub name: String,
    #[serde(default, deserialize_with = "null_as_empty")]
    pub body: String,
    #[serde(default, deserialize_with = "null_as_empty")]
    pub published_at: String,
    pub html_url: String,
}

fn null_as_empty<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

#[command]
pub async fn get_changelog() -> Result<Vec<GithubRelease>, String> {
    let response = piston_lib::client::shared_client()
        .get(GITHUB_RELEASES_URL)
        .query(&[("per_page", "50")])
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error body".to_string());
        return Err(format!(
            "GitHub API returned error {}: {}",
            status, error_body
        ));
    }

    let releases: Vec<GithubRelease> = response.json().await.map_err(|e| {
        format!(
            "Failed to decode response: {}. Make sure the repository has releases.",
            e
        )
    })?;

    Ok(releases)
}
