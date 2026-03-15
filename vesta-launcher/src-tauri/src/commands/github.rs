use anyhow::Result;
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use tauri::command;

const GITHUB_RELEASES_URL: &str = "https://api.github.com/repos/Vesta-Project/launcher/releases";

lazy_static! {
    static ref REQWEST_CLIENT: reqwest::Client = reqwest::Client::builder()
        .user_agent("Vesta-Launcher")
        .build()
        .expect("Failed to build reqwest client");
}

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
    let releases: Vec<GithubRelease> = REQWEST_CLIENT
        .get(GITHUB_RELEASES_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    Ok(releases)
}
