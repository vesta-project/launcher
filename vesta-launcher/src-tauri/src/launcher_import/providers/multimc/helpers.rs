use std::path::Path;

use base64::{Engine as _, engine::general_purpose};

pub(super) fn encode_png_as_data_url(path: &Path) -> Option<String> {
    if !path.exists() || !path.is_file() {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let encoded = general_purpose::STANDARD.encode(bytes);
    Some(format!("data:image/png;base64,{encoded}"))
}
