/// Detects the MIME type of an image from its magic bytes (file header signature).
/// Falls back to `image/png` if the format is unknown or the data is too short.
pub fn detect_image_mime(data: &[u8]) -> &'static str {
    if data.len() < 2 {
        return "image/png";
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if data.len() >= 8 && data[..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        return "image/png";
    }
    // GIF87a: 47 49 46 38 37 61
    // GIF89a: 47 49 46 38 39 61
    if data.len() >= 6
        && (data[..6] == [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]
            || data[..6] == [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    {
        return "image/gif";
    }
    // JPEG: FF D8
    if data[..2] == [0xFF, 0xD8] {
        return "image/jpeg";
    }
    // WebP: RIFF + .... + WEBP
    if data.len() >= 12 && data[..4] == [0x52, 0x49, 0x46, 0x46] && &data[8..12] == b"WEBP" {
        return "image/webp";
    }
    // BMP: 42 4D
    if data[..2] == [0x42, 0x4D] {
        return "image/bmp";
    }
    // ICO: 00 00 01 00
    if data.len() >= 4 && data[..4] == [0x00, 0x00, 0x01, 0x00] {
        return "image/x-icon";
    }
    "image/png"
}

/// Prepare bounded list thumbnails while leaving small icons and SVG bytes intact.
pub fn resource_icon_bytes(bytes: &[u8]) -> anyhow::Result<std::borrow::Cow<'_, [u8]>> {
    let header = std::str::from_utf8(&bytes[..bytes.len().min(1024)])
        .unwrap_or("")
        .trim_start();
    if header.starts_with("<svg") || (header.starts_with("<?xml") && header.contains("<svg")) {
        return Ok(std::borrow::Cow::Borrowed(bytes));
    }
    let format = image::guess_format(bytes)?;
    let (width, height) =
        image::ImageReader::with_format(std::io::Cursor::new(bytes), format).into_dimensions()?;
    if width <= 192 && height <= 192 {
        return Ok(std::borrow::Cow::Borrowed(bytes));
    }
    let mut reader = image::ImageReader::with_format(std::io::Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let icon = reader.decode()?.thumbnail(192, 192);
    let mut output = std::io::Cursor::new(Vec::new());
    icon.write_to(&mut output, image::ImageFormat::Png)?;
    Ok(std::borrow::Cow::Owned(output.into_inner()))
}

/// On-disk resource icon thumbnails keyed by their URL.
///
/// Icons were persisted only onto an existing `resource_project` row, so any icon whose URL had
/// no cached project record (server resources, pack contents, uncached browse results) was
/// downloaded again on every visit. This cache does not depend on a project row. It stores the
/// already-bounded thumbnail bytes, writes atomically and keeps a bounded number of files.
pub mod icon_cache {
    use sha2::{Digest, Sha256};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Same bound as the database copy: a thumbnail is at most a few hundred KB.
    pub const MAX_ICON_BYTES: u64 = 2 * 1024 * 1024;
    /// Roughly 100 MB at typical 30-40 KB thumbnails; the oldest are removed first.
    pub const MAX_FILES: usize = 3000;
    const PRUNE_EVERY: usize = 200;
    static WRITES: AtomicUsize = AtomicUsize::new(0);

    pub fn default_dir() -> Option<PathBuf> {
        crate::utils::db_manager::get_app_config_dir()
            .ok()
            .map(|dir| dir.join("cache").join("resource-icons"))
    }

    /// A file name that cannot carry path syntax from the URL.
    pub fn file_name(url: &str) -> String {
        hex::encode(Sha256::digest(url.as_bytes()))
    }

    pub fn read_in(dir: &Path, url: &str) -> Option<Vec<u8>> {
        let path = dir.join(file_name(url));
        let metadata = std::fs::metadata(&path).ok()?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_ICON_BYTES {
            return None;
        }
        std::fs::read(path).ok()
    }

    pub fn write_in(dir: &Path, url: &str, bytes: &[u8]) -> std::io::Result<()> {
        if bytes.is_empty() || bytes.len() as u64 > MAX_ICON_BYTES {
            return Ok(());
        }
        std::fs::create_dir_all(dir)?;
        let name = file_name(url);
        let temp = dir.join(format!("{name}.{}.tmp", std::process::id()));
        std::fs::write(&temp, bytes)?;
        // Rename is atomic on one volume: readers never see a partial icon.
        if let Err(error) = std::fs::rename(&temp, dir.join(&name)) {
            let _ = std::fs::remove_file(&temp);
            return Err(error);
        }
        if WRITES.fetch_add(1, Ordering::Relaxed) % PRUNE_EVERY == PRUNE_EVERY - 1 {
            prune_in(dir, MAX_FILES);
        }
        Ok(())
    }

    /// Keeps the newest `keep` icons by modification time.
    pub fn prune_in(dir: &Path, keep: usize) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| {
                let metadata = entry.metadata().ok()?;
                metadata.is_file().then(|| {
                    (
                        metadata.modified().unwrap_or(std::time::UNIX_EPOCH),
                        entry.path(),
                    )
                })
            })
            .collect();
        if files.len() <= keep {
            return;
        }
        files.sort_by(|a, b| b.0.cmp(&a.0));
        for (_, path) in files.into_iter().skip(keep) {
            let _ = std::fs::remove_file(path);
        }
    }

    pub fn read(url: &str) -> Option<Vec<u8>> {
        read_in(&default_dir()?, url)
    }

    pub fn write(url: &str, bytes: &[u8]) {
        if let Some(dir) = default_dir() {
            if let Err(error) = write_in(&dir, url, bytes) {
                log::debug!("[resource-icon] cache write failed: {error}");
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn icons_round_trip_by_url_and_never_collide() {
            let dir = tempfile::tempdir().unwrap();
            write_in(dir.path(), "https://cdn.example/a.png", b"first").unwrap();
            write_in(dir.path(), "https://cdn.example/b.png", b"second").unwrap();
            assert_eq!(
                read_in(dir.path(), "https://cdn.example/a.png").as_deref(),
                Some(&b"first"[..])
            );
            assert_eq!(
                read_in(dir.path(), "https://cdn.example/b.png").as_deref(),
                Some(&b"second"[..])
            );
            assert_eq!(read_in(dir.path(), "https://cdn.example/missing.png"), None);
            // Rewriting replaces the icon in place.
            write_in(dir.path(), "https://cdn.example/a.png", b"third").unwrap();
            assert_eq!(
                read_in(dir.path(), "https://cdn.example/a.png").as_deref(),
                Some(&b"third"[..])
            );
        }

        #[test]
        fn file_names_carry_no_path_syntax_from_urls() {
            let name = file_name("https://cdn.example/../../etc/passwd?x=../y");
            assert_eq!(name.len(), 64);
            assert!(name.chars().all(|c| c.is_ascii_hexdigit()));
        }

        #[test]
        fn empty_and_oversized_icons_are_not_stored_or_read() {
            let dir = tempfile::tempdir().unwrap();
            write_in(dir.path(), "https://cdn.example/empty.png", b"").unwrap();
            assert_eq!(read_in(dir.path(), "https://cdn.example/empty.png"), None);
            let big = vec![0u8; (MAX_ICON_BYTES + 1) as usize];
            write_in(dir.path(), "https://cdn.example/big.png", &big).unwrap();
            assert_eq!(read_in(dir.path(), "https://cdn.example/big.png"), None);
            assert_eq!(
                std::fs::read_dir(dir.path())
                    .map(|entries| entries.count())
                    .unwrap_or(0),
                0
            );
        }

        #[test]
        fn pruning_keeps_the_newest_icons() {
            let dir = tempfile::tempdir().unwrap();
            for index in 0..5 {
                write_in(
                    dir.path(),
                    &format!("https://cdn.example/{index}.png"),
                    b"icon",
                )
                .unwrap();
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            prune_in(dir.path(), 2);
            assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
            assert!(read_in(dir.path(), "https://cdn.example/4.png").is_some());
            assert!(read_in(dir.path(), "https://cdn.example/3.png").is_some());
            assert!(read_in(dir.path(), "https://cdn.example/0.png").is_none());
        }
    }
}

#[cfg(test)]
mod resource_icon_tests {
    use super::*;
    fn png(width: u32, height: u32) -> Vec<u8> {
        let image = image::DynamicImage::new_rgba8(width, height);
        let mut bytes = std::io::Cursor::new(Vec::new());
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        bytes.into_inner()
    }
    #[test]
    fn large_icons_are_bounded_without_changing_aspect_ratio() {
        let original = png(1024, 512);
        let thumbnail = resource_icon_bytes(&original).unwrap();
        let decoded = image::load_from_memory(&thumbnail).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (192, 96));
    }
    #[test]
    fn small_icons_and_svg_are_reused_without_reencoding() {
        let original = png(32, 32);
        assert!(matches!(
            resource_icon_bytes(&original).unwrap(),
            std::borrow::Cow::Borrowed(_)
        ));
        let svg = b"<svg xmlns='http://www.w3.org/2000/svg' width='500' height='500'></svg>";
        assert_eq!(resource_icon_bytes(svg).unwrap().as_ref(), svg);
        assert!(resource_icon_bytes(b"not an image").is_err());
    }
}
