#[cfg(target_os = "windows")]
use piston_lib::utils::process::PistonCommandExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
use std::process::Command;
use tauri::{command, AppHandle, Manager};

const ICON_SIZE: u32 = 256;
const BADGE_SIZE: u32 = 80;
const BADGE_PADDING: u32 = 12;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ShortcutKind {
    LaunchInstance,
    OpenInstance,
    OpenResource,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutTarget {
    pub kind: ShortcutKind,
    pub slug: Option<String>,
    pub platform: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutCreationResult {
    pub shortcut_path: String,
    pub icon_path: Option<String>,
    pub icon_applied: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
struct RenderedTarget {
    #[cfg(any(target_os = "windows", target_os = "linux", test))]
    argv: Vec<String>,
    deep_link: String,
}

#[derive(Debug)]
struct ProcessedIcon {
    #[cfg(target_os = "windows")]
    ico_path: PathBuf,
    png_path: PathBuf,
    #[cfg(target_os = "macos")]
    icns_path: Option<PathBuf>,
    warnings: Vec<String>,
}

fn sanitize_shortcut_name(name: &str) -> String {
    let mut sanitized: String = name
        .chars()
        .filter(|c| !r#"\/:*?"<>|"#.contains(*c))
        .collect();
    sanitized = sanitized.trim().to_string();
    if sanitized.is_empty() {
        sanitized = "Vesta Shortcut".to_string();
    }
    if sanitized.len() > 100 {
        sanitized.truncate(100);
    }
    sanitized
}

fn require_target_field(value: &Option<String>, name: &str) -> Result<String, String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("Missing {name} for shortcut target"))
}

fn encode_query_value(value: &str) -> String {
    urlencoding::encode(value).into_owned()
}

fn render_target(target: &ShortcutTarget) -> Result<RenderedTarget, String> {
    match target.kind {
        ShortcutKind::LaunchInstance => {
            let slug = require_target_field(&target.slug, "slug")?;
            Ok(RenderedTarget {
                #[cfg(any(target_os = "windows", target_os = "linux", test))]
                argv: vec!["--launch-instance".to_string(), slug.clone()],
                deep_link: format!("vesta://launch-instance?slug={}", encode_query_value(&slug)),
            })
        }
        ShortcutKind::OpenInstance => {
            let slug = require_target_field(&target.slug, "slug")?;
            Ok(RenderedTarget {
                #[cfg(any(target_os = "windows", target_os = "linux", test))]
                argv: vec!["--open-instance".to_string(), slug.clone()],
                deep_link: format!("vesta://open-instance?slug={}", encode_query_value(&slug)),
            })
        }
        ShortcutKind::OpenResource => {
            let platform = require_target_field(&target.platform, "platform")?;
            let project_id = require_target_field(&target.project_id, "projectId")?;
            Ok(RenderedTarget {
                #[cfg(any(target_os = "windows", target_os = "linux", test))]
                argv: vec![
                    "--open-resource".to_string(),
                    platform.clone(),
                    project_id.clone(),
                ],
                deep_link: format!(
                    "vesta://open-resource?platform={}&projectId={}",
                    encode_query_value(&platform),
                    encode_query_value(&project_id)
                ),
            })
        }
    }
}

#[cfg(target_os = "windows")]
fn powershell_single_quote(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(any(target_os = "windows", target_os = "linux", test))]
fn shell_quote(value: &str) -> String {
    shlex::try_quote(value)
        .map(|quoted| quoted.into_owned())
        .unwrap_or_else(|_| {
            let escaped = value.replace('\'', "'\\''");
            format!("'{escaped}'")
        })
}

#[cfg(any(target_os = "windows", target_os = "linux", test))]
fn render_cli_args(argv: &[String]) -> String {
    argv.iter()
        .map(|arg| shell_quote(arg))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(any(target_os = "linux", test))]
fn desktop_entry_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\r', "")
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn hash_values(values: &[&str]) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for value in values {
        value.hash(&mut hasher);
    }
    hasher.finish()
}

fn center_crop_square(img: image::DynamicImage) -> image::DynamicImage {
    let width = img.width();
    let height = img.height();
    let side = width.min(height);
    let x = (width - side) / 2;
    let y = (height - side) / 2;
    img.crop_imm(x, y, side, side)
}

fn render_branded_icon(
    source_img: image::DynamicImage,
    badge_img: Option<image::DynamicImage>,
) -> image::DynamicImage {
    let base_img = center_crop_square(source_img).resize_exact(
        ICON_SIZE,
        ICON_SIZE,
        image::imageops::FilterType::Lanczos3,
    );
    let mut final_img = base_img.to_rgba8();

    if let Some(badge_img) = badge_img {
        let badge_img = center_crop_square(badge_img).resize_exact(
            BADGE_SIZE,
            BADGE_SIZE,
            image::imageops::FilterType::Lanczos3,
        );
        let badge_img = badge_img.to_rgba8();
        image::imageops::overlay(
            &mut final_img,
            &badge_img,
            i64::from(ICON_SIZE - BADGE_SIZE - BADGE_PADDING),
            i64::from(ICON_SIZE - BADGE_SIZE - BADGE_PADDING),
        );
    }

    image::DynamicImage::ImageRgba8(final_img)
}

fn write_icon_artifacts(
    cache_dir: &Path,
    cache_key: &str,
    source_img: image::DynamicImage,
    badge_img: Option<image::DynamicImage>,
) -> Result<(PathBuf, PathBuf), String> {
    fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
    let png_path = cache_dir.join(format!("{cache_key}.branded.png"));
    let ico_path = cache_dir.join(format!("{cache_key}.branded.ico"));

    if png_path.exists() && ico_path.exists() {
        return Ok((png_path, ico_path));
    }

    let branded = render_branded_icon(source_img, badge_img);
    branded.save(&png_path).map_err(|e| e.to_string())?;
    branded.save(&ico_path).map_err(|e| e.to_string())?;

    Ok((png_path, ico_path))
}

async fn load_icon_bytes(input: &str) -> Result<Vec<u8>, String> {
    if input.starts_with("https://") || input.starts_with("http://") {
        let client = piston_lib::client::shared_client();
        return client
            .get(input)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .bytes()
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(|e| e.to_string());
    }

    if input.starts_with("data:image") {
        let encoded = input
            .split_once(',')
            .map(|(_, data)| data)
            .ok_or_else(|| "Malformed data image URI".to_string())?;
        return base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
            .map_err(|e| e.to_string());
    }

    if input.starts_with("asset:") || input.starts_with("blob:") {
        return Err("Webview-only icon URL cannot be read by the shortcut service".to_string());
    }

    fs::read(input).map_err(|e| e.to_string())
}

async fn process_icon(
    app_handle: &AppHandle,
    input: Option<String>,
    cache_hint: &str,
) -> Result<ProcessedIcon, String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("shortcuts");
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;
    let fallback_icon_path = resource_dir.join("icons/icon.png");
    let badge_img = image::open(&fallback_icon_path).ok();
    let mut warnings = Vec::new();

    let source_img = match input.as_deref().filter(|value| !value.trim().is_empty()) {
        Some(icon_source) => match load_icon_bytes(icon_source).await {
            Ok(bytes) => match image::load_from_memory(&bytes) {
                Ok(img) => img,
                Err(error) => {
                    warnings.push(format!(
                        "Could not decode shortcut icon; used Vesta icon instead: {error}"
                    ));
                    image::open(&fallback_icon_path).map_err(|e| e.to_string())?
                }
            },
            Err(error) => {
                warnings.push(format!(
                    "Could not load shortcut icon; used Vesta icon instead: {error}"
                ));
                image::open(&fallback_icon_path).map_err(|e| e.to_string())?
            }
        },
        None => {
            warnings.push("No shortcut icon was provided; used Vesta icon instead".to_string());
            image::open(&fallback_icon_path).map_err(|e| e.to_string())?
        }
    };

    let source_key = input.as_deref().unwrap_or("vesta-fallback");
    let cache_key = hash_values(&[source_key, cache_hint]).to_string();
    let (png_path, ico_path) = write_icon_artifacts(&cache_dir, &cache_key, source_img, badge_img)?;
    #[cfg(not(target_os = "windows"))]
    let _ = &ico_path;

    #[cfg(target_os = "macos")]
    let icns_path = match build_icns_from_png(&png_path, &cache_dir, &cache_key) {
        Ok(path) => Some(path),
        Err(error) => {
            warnings.push(format!(
                "Could not prepare a macOS icon bundle; Finder may show a generic app icon: {error}"
            ));
            None
        }
    };

    Ok(ProcessedIcon {
        #[cfg(target_os = "windows")]
        ico_path,
        png_path,
        #[cfg(target_os = "macos")]
        icns_path,
        warnings,
    })
}

#[cfg(target_os = "macos")]
fn build_icns_from_png(
    png_path: &Path,
    cache_dir: &Path,
    cache_key: &str,
) -> Result<PathBuf, String> {
    let icns_path = cache_dir.join(format!("{cache_key}.branded.icns"));
    if icns_path.exists() {
        return Ok(icns_path);
    }

    let source = image::open(png_path).map_err(|e| e.to_string())?;
    let iconset_dir = cache_dir.join(format!("{cache_key}.iconset"));
    fs::create_dir_all(&iconset_dir).map_err(|e| e.to_string())?;

    for (size, scale, name) in [
        (16, 1, "icon_16x16.png"),
        (16, 2, "icon_16x16@2x.png"),
        (32, 1, "icon_32x32.png"),
        (32, 2, "icon_32x32@2x.png"),
        (128, 1, "icon_128x128.png"),
        (128, 2, "icon_128x128@2x.png"),
        (256, 1, "icon_256x256.png"),
        (256, 2, "icon_256x256@2x.png"),
        (512, 1, "icon_512x512.png"),
    ] {
        let pixel_size = size * scale;
        let resized = source.resize_exact(
            pixel_size,
            pixel_size,
            image::imageops::FilterType::Lanczos3,
        );
        resized
            .save(iconset_dir.join(name))
            .map_err(|e| e.to_string())?;
    }

    let output = Command::new("iconutil")
        .args(["-c", "icns", "-o"])
        .arg(&icns_path)
        .arg(&iconset_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(icns_path)
}

#[cfg(any(target_os = "linux", test))]
fn linux_desktop_content(name: &str, exe_path: &Path, argv: &[String], icon_path: &Path) -> String {
    format!(
        "[Desktop Entry]\n\
         Version=1.0\n\
         Type=Application\n\
         Name={}\n\
         Exec={} {}\n\
         Icon={}\n\
         Terminal=false\n\
         Categories=Game;Launcher;\n",
        desktop_entry_escape(name),
        shell_quote(&exe_path.to_string_lossy()),
        render_cli_args(argv),
        icon_path.to_string_lossy()
    )
}

#[cfg(target_os = "macos")]
fn macos_info_plist(name: &str, bundle_identifier: &str, icon_file: Option<&str>) -> String {
    let icon_entry = icon_file
        .map(|icon_file| {
            format!(
                "\n    <key>CFBundleIconFile</key>\n    <string>{}</string>",
                plist_escape(icon_file)
            )
        })
        .unwrap_or_default();

    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
         <plist version=\"1.0\">\n\
         <dict>\n\
             <key>CFBundleDisplayName</key>\n\
             <string>{}</string>\n\
             <key>CFBundleExecutable</key>\n\
             <string>launch</string>\n\
             <key>CFBundleIdentifier</key>\n\
             <string>{}</string>{}\n\
             <key>CFBundleName</key>\n\
             <string>{}</string>\n\
             <key>CFBundlePackageType</key>\n\
             <string>APPL</string>\n\
             <key>LSBackgroundOnly</key>\n\
             <true/>\n\
         </dict>\n\
         </plist>\n",
        plist_escape(name),
        plist_escape(bundle_identifier),
        icon_entry,
        plist_escape(name)
    )
}

#[cfg(target_os = "macos")]
fn plist_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[command]
pub async fn create_desktop_shortcut(
    app_handle: AppHandle,
    name: String,
    target: ShortcutTarget,
    icon_source: Option<String>,
) -> Result<ShortcutCreationResult, String> {
    let name = sanitize_shortcut_name(&name);
    let rendered_target = render_target(&target)?;
    let desktop_dir = app_handle.path().desktop_dir().map_err(|e| e.to_string())?;
    let cache_hint = format!("{name}:{}", rendered_target.deep_link);
    let processed_icon = process_icon(&app_handle, icon_source, &cache_hint).await?;
    #[cfg(target_os = "linux")]
    let mut warnings = processed_icon.warnings;
    #[cfg(not(target_os = "linux"))]
    let warnings = processed_icon.warnings;
    let mut icon_applied = true;
    let shortcut_path: PathBuf;

    #[cfg(target_os = "windows")]
    {
        let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
        shortcut_path = desktop_dir.join(format!("{name}.lnk"));

        let shortcut_path_str = powershell_single_quote(&shortcut_path.to_string_lossy());
        let exe_path_str = powershell_single_quote(&exe_path.to_string_lossy());
        let working_dir = powershell_single_quote(
            &exe_path
                .parent()
                .unwrap_or_else(|| Path::new(""))
                .to_string_lossy(),
        );
        let safe_target_args = powershell_single_quote(&render_cli_args(&rendered_target.argv));
        let icon_path_str = powershell_single_quote(&processed_icon.ico_path.to_string_lossy());

        let ps_script = format!(
            "$WshShell = New-Object -ComObject WScript.Shell; \
             $Shortcut = $WshShell.CreateShortcut('{}'); \
             $Shortcut.TargetPath = '{}'; \
             $Shortcut.Arguments = '{}'; \
             $Shortcut.IconLocation = '{},0'; \
             $Shortcut.WorkingDirectory = '{}'; \
             $Shortcut.WindowStyle = 1; \
             $Shortcut.Save()",
            shortcut_path_str, exe_path_str, safe_target_args, icon_path_str, working_dir
        );

        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-Command", &ps_script]);
        cmd.suppress_console();

        let output = cmd.output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
    }

    #[cfg(target_os = "macos")]
    {
        shortcut_path = desktop_dir.join(format!("{name}.app"));
        let contents_dir = shortcut_path.join("Contents");
        let macos_dir = contents_dir.join("MacOS");
        let resources_dir = contents_dir.join("Resources");

        fs::create_dir_all(&macos_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(&resources_dir).map_err(|e| e.to_string())?;

        let icon_file = if let Some(icns_path) = processed_icon.icns_path.as_ref() {
            fs::copy(icns_path, resources_dir.join("shortcut.icns")).map_err(|e| e.to_string())?;
            Some("shortcut")
        } else {
            icon_applied = false;
            None
        };

        let bundle_id = format!(
            "com.vesta.launcher.shortcut.{}",
            hash_values(&[&rendered_target.deep_link]).to_string()
        );
        fs::write(
            contents_dir.join("Info.plist"),
            macos_info_plist(&name, &bundle_id, icon_file),
        )
        .map_err(|e| e.to_string())?;

        let launcher_script = format!(
            "#!/bin/sh\n/usr/bin/open {}\n",
            shell_single_quote(&rendered_target.deep_link)
        );
        let launcher_path = macos_dir.join("launch");
        fs::write(&launcher_path, launcher_script).map_err(|e| e.to_string())?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&launcher_path)
                .map_err(|e| e.to_string())?
                .permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&launcher_path, perms).map_err(|e| e.to_string())?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
        let file_name = format!("{}.desktop", name.to_lowercase().replace(' ', "-"));
        shortcut_path = desktop_dir.join(file_name);
        let content = linux_desktop_content(
            &name,
            &exe_path,
            &rendered_target.argv,
            &processed_icon.png_path,
        );
        fs::write(&shortcut_path, content).map_err(|e| e.to_string())?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&shortcut_path)
                .map_err(|e| e.to_string())?
                .permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&shortcut_path, perms).map_err(|e| e.to_string())?;
        }

        if Command::new("gio")
            .args([
                "set",
                &shortcut_path.to_string_lossy(),
                "metadata::trusted",
                "true",
            ])
            .output()
            .is_err()
        {
            warnings.push(
                "Linux desktop environment may require marking the shortcut as trusted".to_string(),
            );
        }
    }

    Ok(ShortcutCreationResult {
        shortcut_path: shortcut_path.to_string_lossy().into_owned(),
        icon_path: Some(processed_icon.png_path.to_string_lossy().into_owned()),
        icon_applied,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgba};

    fn instance_target(kind: ShortcutKind, slug: &str) -> ShortcutTarget {
        ShortcutTarget {
            kind,
            slug: Some(slug.to_string()),
            platform: None,
            project_id: None,
        }
    }

    #[test]
    fn renders_launch_instance_target() {
        let rendered = render_target(&instance_target(ShortcutKind::LaunchInstance, "my world"))
            .expect("target");

        assert_eq!(rendered.argv, vec!["--launch-instance", "my world"]);
        assert_eq!(
            rendered.deep_link,
            "vesta://launch-instance?slug=my%20world"
        );
    }

    #[test]
    fn renders_open_resource_target_with_all_fields() {
        let rendered = render_target(&ShortcutTarget {
            kind: ShortcutKind::OpenResource,
            slug: None,
            platform: Some("modrinth".to_string()),
            project_id: Some("fabric api".to_string()),
        })
        .expect("target");

        assert_eq!(
            rendered.argv,
            vec!["--open-resource", "modrinth", "fabric api"]
        );
        assert_eq!(
            rendered.deep_link,
            "vesta://open-resource?platform=modrinth&projectId=fabric%20api"
        );
    }

    #[test]
    fn rejects_missing_resource_project_id() {
        let error = render_target(&ShortcutTarget {
            kind: ShortcutKind::OpenResource,
            slug: None,
            platform: Some("modrinth".to_string()),
            project_id: None,
        })
        .expect_err("missing project id");

        assert!(error.contains("projectId"));
    }

    #[test]
    fn linux_desktop_content_quotes_paths_and_args() {
        let content = linux_desktop_content(
            "My Pack",
            Path::new("/Applications/Vesta Launcher/vesta"),
            &["--launch-instance".to_string(), "my pack".to_string()],
            Path::new("/tmp/icon file.png"),
        );

        assert!(content.contains("Name=My Pack"));
        assert!(content
            .contains("Exec='/Applications/Vesta Launcher/vesta' --launch-instance 'my pack'"));
        assert!(content.contains("Icon=/tmp/icon file.png"));
    }

    #[test]
    fn branded_icon_has_badge_in_bottom_right() {
        let source = DynamicImage::ImageRgba8(image::ImageBuffer::from_pixel(
            300,
            200,
            Rgba([10, 20, 30, 255]),
        ));
        let badge = DynamicImage::ImageRgba8(image::ImageBuffer::from_pixel(
            100,
            100,
            Rgba([250, 0, 0, 255]),
        ));

        let branded = render_branded_icon(source, Some(badge)).to_rgba8();

        assert_eq!(branded.width(), ICON_SIZE);
        assert_eq!(branded.height(), ICON_SIZE);
        assert_eq!(
            branded.get_pixel(ICON_SIZE - BADGE_PADDING - 1, ICON_SIZE - BADGE_PADDING - 1),
            &Rgba([250, 0, 0, 255])
        );
    }

    #[test]
    fn writes_png_and_ico_artifacts() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let source = DynamicImage::ImageRgba8(image::ImageBuffer::from_pixel(
            256,
            256,
            Rgba([10, 20, 30, 255]),
        ));

        let (png_path, ico_path) =
            write_icon_artifacts(temp_dir.path(), "test", source, None).expect("artifacts");

        assert!(png_path.exists());
        assert!(ico_path.exists());
    }
}
