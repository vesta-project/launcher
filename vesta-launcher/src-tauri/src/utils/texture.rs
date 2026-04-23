use sha2::{Digest, Sha256};

/// Computes a stable, content-based texture key for image bytes.
///
/// We normalize to RGBA8 and include dimensions so semantically identical
/// image content maps to one key regardless of original PNG/JPEG encoding.
pub fn compute_texture_key(image_bytes: &[u8]) -> String {
    if let Ok(img) = image::load_from_memory(image_bytes) {
        let rgba = img.to_rgba8();
        let (width, height) = rgba.dimensions();

        let mut hasher = Sha256::new();
        hasher.update(rgba.as_raw());
        hasher.update(width.to_le_bytes());
        hasher.update(height.to_le_bytes());
        return hex::encode(hasher.finalize());
    }

    // Fallback to raw-byte hashing for malformed or unsupported image payloads.
    let mut hasher = Sha256::new();
    hasher.update(image_bytes);
    hex::encode(hasher.finalize())
}
