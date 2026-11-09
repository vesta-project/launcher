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
    let header = std::str::from_utf8(&bytes[..bytes.len().min(1024)]).unwrap_or("").trim_start();
    if header.starts_with("<svg") || (header.starts_with("<?xml") && header.contains("<svg")) {
        return Ok(std::borrow::Cow::Borrowed(bytes));
    }
    let format = image::guess_format(bytes)?;
    let (width, height) = image::ImageReader::with_format(std::io::Cursor::new(bytes), format).into_dimensions()?;
    if width <= 192 && height <= 192 { return Ok(std::borrow::Cow::Borrowed(bytes)); }
    let mut reader = image::ImageReader::with_format(std::io::Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192); limits.max_image_height = Some(8192); limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let icon = reader.decode()?.thumbnail(192, 192);
    let mut output = std::io::Cursor::new(Vec::new());
    icon.write_to(&mut output, image::ImageFormat::Png)?;
    Ok(std::borrow::Cow::Owned(output.into_inner()))
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
        assert!(matches!(resource_icon_bytes(&original).unwrap(), std::borrow::Cow::Borrowed(_)));
        let svg = b"<svg xmlns='http://www.w3.org/2000/svg' width='500' height='500'></svg>";
        assert_eq!(resource_icon_bytes(svg).unwrap().as_ref(), svg);
        assert!(resource_icon_bytes(b"not an image").is_err());
    }
}
