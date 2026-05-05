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
