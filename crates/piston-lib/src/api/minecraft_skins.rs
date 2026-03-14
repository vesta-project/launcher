use crate::models::common::{Skin, MinecraftSkinVariant};
pub use crate::api::embedded_skins::EMBEDDED_SKINS;

pub fn detect_skin_variant(image_bytes: &[u8]) -> MinecraftSkinVariant {
    if let Ok(img) = image::load_from_memory(image_bytes) {
        let rgba = img.to_rgba8();
        if rgba.width() >= 64 && rgba.height() >= 32 {
            if rgba.get_pixel(54, 20)[3] == 0 { return MinecraftSkinVariant::Slim; }
        }
    }
    MinecraftSkinVariant::Classic
}

pub fn get_default_skins() -> Vec<Skin> {
    EMBEDDED_SKINS.clone()
}
