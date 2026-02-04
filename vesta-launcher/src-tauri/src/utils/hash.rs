use anyhow::Result;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

const READ_CHUNK_SIZE: usize = 16384;

/// Calculates a CurseForge fingerprint (MurmurHash2 32-bit)
/// It skips whitespace bytes: 9 (TAB), 10 (LF), 13 (CR), 32 (SPACE)
pub fn calculate_curseforge_fingerprint(path: &Path) -> Result<u32> {
    let metadata = std::fs::metadata(path)?;
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut data = Vec::with_capacity(metadata.len() as usize);

    let mut buffer = [0u8; READ_CHUNK_SIZE];
    loop {
        let n = reader.read(&mut buffer)?;
        if n == 0 {
            break;
        }

        for &b in &buffer[..n] {
            if b != 9 && b != 10 && b != 13 && b != 32 {
                data.push(b);
            }
        }
    }

    Ok(murmur2::murmur2(&data, 1))
}

/// Calculates a raw MurmurHash2 32-bit (no bytes skipped)
pub fn calculate_murmur2_raw(path: &Path) -> Result<u32> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut data = Vec::new();
    reader.read_to_end(&mut data)?;
    Ok(murmur2::murmur2(&data, 1))
}

pub fn calculate_sha1(path: &Path) -> Result<String> {
    use sha1::{Digest, Sha1};
    let mut file = File::open(path)?;
    let mut hasher = Sha1::new();
    let mut buffer = [0; 8192];

    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_sha1() -> Result<()> {
        let mut file = NamedTempFile::new()?;
        file.write_all(b"hello world")?;
        let hash = calculate_sha1(file.path())?;
        assert_eq!(hash, "2aae6c35c94fcfb415dbe95f408b9ce91ee846ed");
        Ok(())
    }

    #[test]
    fn test_curseforge_fingerprint_skips_whitespace() -> Result<()> {
        let mut file1 = NamedTempFile::new()?;
        file1.write_all(b"hello world")?; // "hello world"

        let mut file2 = NamedTempFile::new()?;
        file2.write_all(b"hello\n \r \tworld")?; // Same but with whitespace chars 9, 10, 13, 32

        let fp1 = calculate_curseforge_fingerprint(file1.path())?;
        let fp2 = calculate_curseforge_fingerprint(file2.path())?;

        assert_eq!(fp1, fp2);
        Ok(())
    }
}
