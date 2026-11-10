/// Normalizes a URL by stripping out the query string and any trailing slashes.
/// This ensures consistent path segment comparison regardless of the original URL's
/// formatting, which is particularly useful for identifying slugs or project IDs
/// from URLs where users might have pasted them with trackers or additional paths.
///
/// # Example
///
/// ```
/// use vesta_launcher::utils::url::normalize_url;
/// let url = "https://www.curseforge.com/minecraft/mc-mods/geckolib/?page=1";
/// let normalized = normalize_url(url);
/// assert_eq!(normalized, "https://www.curseforge.com/minecraft/mc-mods/geckolib");
/// ```
pub fn normalize_url(url: &str) -> &str {
    url.split('?').next().unwrap_or(url).trim_end_matches('/')
}
