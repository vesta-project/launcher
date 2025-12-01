use piston_lib::game::metadata::PistonMetadata;
use std::sync::{Arc, RwLock};

#[derive(Clone)]
pub struct MetadataCache(pub Arc<RwLock<Option<PistonMetadata>>>);

impl MetadataCache {
    pub fn new() -> Self {
        Self(Arc::new(RwLock::new(None)))
    }

    pub fn get(&self) -> Option<PistonMetadata> {
        self.0.read().ok().and_then(|g| g.clone())
    }

    pub fn set(&self, meta: &PistonMetadata) {
        if let Ok(mut guard) = self.0.write() {
            *guard = Some(meta.clone());
        }
    }
}
