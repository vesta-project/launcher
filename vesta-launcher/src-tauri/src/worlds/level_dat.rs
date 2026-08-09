use fastnbt::Value;
use flate2::read::GzDecoder;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_DECOMPRESSED_LEVEL_DAT_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LevelStatus {
    Valid,
    Recovered,
    Unreadable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageFamily {
    Alpha,
    McRegion,
    Anvil,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct LevelDat {
    pub level_name: Option<String>,
    pub last_played_millis: Option<i64>,
    pub data_version: Option<i32>,
    pub version_name: Option<String>,
    pub version_id: Option<i32>,
    pub legacy_version: Option<i32>,
    pub storage_family: StorageFamily,
    pub status: LevelStatus,
    pub source_path: PathBuf,
}

impl LevelDat {
    fn unreadable(world_root: &Path) -> Self {
        Self {
            level_name: None,
            last_played_millis: None,
            data_version: None,
            version_name: None,
            version_id: None,
            legacy_version: None,
            storage_family: StorageFamily::Unknown,
            status: LevelStatus::Unreadable,
            source_path: world_root.join("level.dat"),
        }
    }
}

pub fn read_world_level(world_root: &Path) -> LevelDat {
    let primary = world_root.join("level.dat");
    if is_regular_file_without_following_links(&primary) {
        if let Ok(mut parsed) = read_level_file(&primary) {
            parsed.status = LevelStatus::Valid;
            return parsed;
        }
    }

    let backup = world_root.join("level.dat_old");
    if is_regular_file_without_following_links(&backup) {
        if let Ok(mut parsed) = read_level_file(&backup) {
            parsed.status = LevelStatus::Recovered;
            return parsed;
        }
    }

    LevelDat::unreadable(world_root)
}

pub fn has_level_marker(world_root: &Path) -> bool {
    is_regular_file_without_following_links(&world_root.join("level.dat"))
        || is_regular_file_without_following_links(&world_root.join("level.dat_old"))
}

fn is_regular_file_without_following_links(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_file())
        .unwrap_or(false)
}

fn read_level_file(path: &Path) -> Result<LevelDat, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let bytes = decompress_level_dat(GzDecoder::new(file), path)?;
    parse_nbt_bytes(&bytes, path)
}

pub fn read_level_gzip_bytes(bytes: &[u8]) -> Result<LevelDat, String> {
    let decoded = decompress_level_dat(GzDecoder::new(bytes), Path::new("level.dat"))?;
    parse_nbt_bytes(&decoded, Path::new("level.dat"))
}

fn decompress_level_dat(reader: impl Read, path: &Path) -> Result<Vec<u8>, String> {
    let mut bounded = reader.take(MAX_DECOMPRESSED_LEVEL_DAT_BYTES + 1);
    let mut decoded = Vec::new();
    bounded
        .read_to_end(&mut decoded)
        .map_err(|error| format!("Failed to decompress {}: {error}", path.display()))?;
    if decoded.len() as u64 > MAX_DECOMPRESSED_LEVEL_DAT_BYTES {
        return Err(format!(
            "{} expands beyond the supported level.dat size",
            path.display()
        ));
    }
    Ok(decoded)
}

fn parse_nbt_bytes(bytes: &[u8], path: &Path) -> Result<LevelDat, String> {
    let root: HashMap<String, Value> = fastnbt::from_bytes(bytes)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))?;
    let data = root
        .get("Data")
        .and_then(as_compound)
        .ok_or_else(|| format!("{} has no Data compound", path.display()))?;

    let level_name = data
        .get("LevelName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string);
    let last_played_millis = data.get("LastPlayed").and_then(number_as_i64);
    let data_version = data
        .get("DataVersion")
        .and_then(number_as_i64)
        .and_then(|value| i32::try_from(value).ok());
    let version = data.get("Version").and_then(as_compound);
    let version_name = version
        .and_then(|value| value.get("Name"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string);
    let version_id = version
        .and_then(|value| value.get("Id"))
        .and_then(number_as_i64)
        .and_then(|value| i32::try_from(value).ok());
    let legacy_version = data
        .get("version")
        .and_then(number_as_i64)
        .and_then(|value| i32::try_from(value).ok());

    let storage_family = match legacy_version {
        Some(19_132) => StorageFamily::McRegion,
        Some(19_133) => StorageFamily::Anvil,
        Some(_) => StorageFamily::Unknown,
        None if data_version.is_some() || version_id.is_some() => StorageFamily::Anvil,
        None => StorageFamily::Alpha,
    };

    Ok(LevelDat {
        level_name,
        last_played_millis,
        data_version,
        version_name,
        version_id,
        legacy_version,
        storage_family,
        status: LevelStatus::Valid,
        source_path: path.to_path_buf(),
    })
}

fn as_compound(value: &Value) -> Option<&HashMap<String, Value>> {
    match value {
        Value::Compound(compound) => Some(compound),
        _ => None,
    }
}

fn number_as_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use serde::Serialize;
    use std::io::Write;
    use tempfile::TempDir;

    #[derive(Serialize)]
    #[serde(rename_all = "PascalCase")]
    struct Root<T> {
        data: T,
    }

    fn write_level<T: Serialize>(path: &Path, data: T) {
        let nbt = fastnbt::to_bytes(&Root { data }).expect("encode NBT");
        let file = File::create(path).expect("create level.dat");
        let mut encoder = GzEncoder::new(file, Compression::default());
        encoder.write_all(&nbt).expect("compress NBT");
        encoder.finish().expect("finish gzip");
    }

    #[test]
    fn reads_legacy_alpha_world_without_data_version() {
        #[derive(Serialize)]
        #[serde(rename_all = "PascalCase")]
        struct Data {
            level_name: String,
        }
        let temp = TempDir::new().unwrap();
        write_level(
            &temp.path().join("level.dat"),
            Data {
                level_name: "Infdev".into(),
            },
        );
        let level = read_world_level(temp.path());
        assert_eq!(level.level_name.as_deref(), Some("Infdev"));
        assert_eq!(level.storage_family, StorageFamily::Alpha);
    }

    #[test]
    fn recognizes_mcregion_and_anvil_storage_versions() {
        #[derive(Serialize)]
        struct Data {
            version: i32,
        }
        for (value, expected) in [
            (19_132, StorageFamily::McRegion),
            (19_133, StorageFamily::Anvil),
        ] {
            let temp = TempDir::new().unwrap();
            write_level(&temp.path().join("level.dat"), Data { version: value });
            assert_eq!(read_world_level(temp.path()).storage_family, expected);
        }
    }

    #[test]
    fn reads_modern_version_and_tolerates_unknown_fields() {
        #[derive(Serialize)]
        #[serde(rename_all = "PascalCase")]
        struct Version {
            name: String,
            id: i32,
        }
        #[derive(Serialize)]
        #[serde(rename_all = "PascalCase")]
        struct Data {
            data_version: i32,
            version: Version,
            dimensions: serde_json::Value,
        }
        let temp = TempDir::new().unwrap();
        write_level(
            &temp.path().join("level.dat"),
            Data {
                data_version: 4671,
                version: Version {
                    name: "26.1".into(),
                    id: 4671,
                },
                dimensions: serde_json::json!({"minecraft:overworld": {"future": 1}}),
            },
        );
        let level = read_world_level(temp.path());
        assert_eq!(level.version_name.as_deref(), Some("26.1"));
        assert_eq!(level.data_version, Some(4671));
        assert_eq!(level.storage_family, StorageFamily::Anvil);
    }

    #[test]
    fn tolerates_unknown_nbt_array_fields_used_by_java_26_1() {
        #[derive(Serialize)]
        #[serde(rename_all = "PascalCase")]
        struct Data {
            level_name: String,
            #[serde(rename = "singleplayer_uuid")]
            singleplayer_uuid: fastnbt::ByteArray,
        }
        let temp = TempDir::new().unwrap();
        write_level(
            &temp.path().join("level.dat"),
            Data {
                level_name: "Java 26.1".into(),
                singleplayer_uuid: fastnbt::ByteArray::new(vec![1; 16]),
            },
        );

        let level = read_world_level(temp.path());
        assert_eq!(level.status, LevelStatus::Valid);
        assert_eq!(level.level_name.as_deref(), Some("Java 26.1"));
    }

    #[test]
    fn falls_back_to_valid_level_dat_old() {
        #[derive(Serialize)]
        #[serde(rename_all = "PascalCase")]
        struct Data {
            level_name: String,
        }
        let temp = TempDir::new().unwrap();
        std::fs::write(temp.path().join("level.dat"), b"not gzip").unwrap();
        write_level(
            &temp.path().join("level.dat_old"),
            Data {
                level_name: "Recovered".into(),
            },
        );
        let level = read_world_level(temp.path());
        assert_eq!(level.status, LevelStatus::Recovered);
        assert_eq!(level.level_name.as_deref(), Some("Recovered"));
    }

    #[test]
    fn rejects_excessive_decompressed_level_data() {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
        let chunk = vec![0_u8; 1024 * 1024];
        for _ in 0..=32 {
            encoder.write_all(&chunk).unwrap();
        }
        let compressed = encoder.finish().unwrap();
        assert!(read_level_gzip_bytes(&compressed)
            .unwrap_err()
            .contains("supported level.dat size"));
    }
}
