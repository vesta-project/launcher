use anyhow::Result;
use serde::{Deserialize, Serialize};
use tauri::command;

const GITHUB_RELEASES_URL: &str = "https://api.github.com/repos/Vesta-Project/launcher/releases";

#[derive(Debug, Serialize, Deserialize)]
pub struct GithubRelease {
    pub tag_name: String,
    pub name: String,
    pub body: String,
    pub published_at: String,
    pub html_url: String,
}

#[command]
pub async fn get_changelog() -> Result<Vec<GithubRelease>, String> {
    let response = piston_lib::client::shared_client()
        .get(GITHUB_RELEASES_URL)
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
