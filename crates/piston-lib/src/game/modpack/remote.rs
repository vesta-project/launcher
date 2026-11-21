//! Reads a modpack's root manifest straight from its download URL with HTTP range requests,
//! so the launcher can learn a pack's Minecraft version, loader and mod list without
//! downloading the whole archive (CurseForge packs are often hundreds of megabytes).
//!
//! It reads the end of the file (the zip's central directory), finds `modrinth.index.json` or
//! `manifest.json` at the root, then fetches just that entry. A server that ignores ranges,
//! an archive with an odd layout or anything over the caps fails, and the caller falls back to
//! a full download.
use anyhow::{anyhow, bail, Context, Result};
use std::io::Read;

use super::parser::metadata_from_manifest;
use super::types::ModpackMetadata;
use crate::artifact_http;

/// End of central directory record plus the longest possible comment.
const TAIL: u64 = 22 + 65_535;
const MAX_CENTRAL_DIRECTORY: u64 = 16 * 1024 * 1024;
const MAX_MANIFEST: u64 = 16 * 1024 * 1024;
const MANIFESTS: [&str; 2] = ["modrinth.index.json", "manifest.json"];

/// Fetches one byte range and the file's total size. Only a `206` answer is read.
async fn fetch(url: &str, range: String) -> Result<(Vec<u8>, u64)> {
    let response = artifact_http::get_range(url, &range).await?;
    if response.status().as_u16() != 206 {
        // Never read a full-file answer: that is the download this module exists to avoid.
        bail!("range_unsupported");
    }
    let total = response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit('/').next())
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| anyhow!("range_total_missing"))?;
    let bytes = response.bytes().await.context("range_body")?.to_vec();
    Ok((bytes, total))
}

fn u16_at(bytes: &[u8], at: usize) -> Result<u16> {
    bytes
        .get(at..at + 2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .ok_or_else(|| anyhow!("zip_truncated"))
}
fn u32_at(bytes: &[u8], at: usize) -> Result<u32> {
    bytes
        .get(at..at + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or_else(|| anyhow!("zip_truncated"))
}
fn u64_at(bytes: &[u8], at: usize) -> Result<u64> {
    bytes
        .get(at..at + 8)
        .and_then(|b| b.try_into().ok())
        .map(u64::from_le_bytes)
        .ok_or_else(|| anyhow!("zip_truncated"))
}

/// Where the central directory is, as (offset, size), from the tail of the archive.
fn locate_central_directory(tail: &[u8], tail_start: u64) -> Result<(u64, u64)> {
    let eocd = (0..tail.len().saturating_sub(21))
        .rev()
        .find(|&at| tail[at..at + 4] == [0x50, 0x4b, 0x05, 0x06])
        .ok_or_else(|| anyhow!("zip_end_missing"))?;
    let size = u32_at(tail, eocd + 12)?;
    let offset = u32_at(tail, eocd + 16)?;
    if size != u32::MAX && offset != u32::MAX {
        return Ok((offset as u64, size as u64));
    }
    // Zip64: a locator sits just before the end record and points at the zip64 end record.
    let locator = eocd
        .checked_sub(20)
        .ok_or_else(|| anyhow!("zip64_locator_missing"))?;
    if tail[locator..locator + 4] != [0x50, 0x4b, 0x06, 0x07] {
        bail!("zip64_locator_missing");
    }
    let record = u64_at(tail, locator + 8)?
        .checked_sub(tail_start)
        .ok_or_else(|| anyhow!("zip64_record_outside_tail"))? as usize;
    if tail.get(record..record + 4) != Some(&[0x50, 0x4b, 0x06, 0x06][..]) {
        bail!("zip64_record_missing");
    }
    Ok((u64_at(tail, record + 48)?, u64_at(tail, record + 40)?))
}

#[derive(Debug)]
struct Entry {
    method: u16,
    compressed: u64,
    uncompressed: u64,
    local_header: u64,
}

/// The root manifest listed in the central directory, Modrinth's before CurseForge's.
fn find_manifest(directory: &[u8]) -> Result<Option<(&'static str, Entry)>> {
    let mut found: Vec<(&'static str, Entry)> = Vec::new();
    let mut at = 0;
    while at + 46 <= directory.len() && directory[at..at + 4] == [0x50, 0x4b, 0x01, 0x02] {
        let method = u16_at(directory, at + 10)?;
        let mut compressed = u32_at(directory, at + 20)? as u64;
        let mut uncompressed = u32_at(directory, at + 24)? as u64;
        let name_len = u16_at(directory, at + 28)? as usize;
        let extra_len = u16_at(directory, at + 30)? as usize;
        let comment_len = u16_at(directory, at + 32)? as usize;
        let mut local_header = u32_at(directory, at + 42)? as u64;
        let name = directory
            .get(at + 46..at + 46 + name_len)
            .ok_or_else(|| anyhow!("zip_truncated"))?;
        if let Some(manifest) = MANIFESTS
            .iter()
            .find(|candidate| candidate.as_bytes() == name)
        {
            // Zip64 extra field: the values that overflowed, in this order.
            let extra = directory
                .get(at + 46 + name_len..at + 46 + name_len + extra_len)
                .ok_or_else(|| anyhow!("zip_truncated"))?;
            let mut field = 0;
            while field + 4 <= extra.len() {
                let id = u16_at(extra, field)?;
                let len = u16_at(extra, field + 2)? as usize;
                if id == 1 {
                    let mut cursor = field + 4;
                    for value in [&mut uncompressed, &mut compressed] {
                        if *value == u32::MAX as u64 {
                            *value = u64_at(extra, cursor)?;
                            cursor += 8;
                        }
                    }
                    if local_header == u32::MAX as u64 {
                        local_header = u64_at(extra, cursor)?;
                    }
                }
                field += 4 + len;
            }
            found.push((
                manifest,
                Entry {
                    method,
                    compressed,
                    uncompressed,
                    local_header,
                },
            ));
        }
        at += 46 + name_len + extra_len + comment_len;
    }
    found.sort_by_key(|(name, _)| MANIFESTS.iter().position(|candidate| candidate == name));
    Ok(found.into_iter().next())
}

/// The entry's data, decompressed. `local` holds the archive from the entry's local header on.
fn entry_data(local: &[u8], entry: &Entry) -> Result<Vec<u8>> {
    if local.get(0..4) != Some(&[0x50, 0x4b, 0x03, 0x04][..]) {
        bail!("zip_local_header_missing");
    }
    let data = 30 + u16_at(local, 26)? as usize + u16_at(local, 28)? as usize;
    let raw = local
        .get(data..data + entry.compressed as usize)
        .ok_or_else(|| anyhow!("zip_truncated"))?;
    match entry.method {
        0 => Ok(raw.to_vec()),
        8 => {
            let mut out = Vec::with_capacity(entry.uncompressed.min(MAX_MANIFEST) as usize);
            flate2::read::DeflateDecoder::new(raw)
                .take(MAX_MANIFEST + 1)
                .read_to_end(&mut out)
                .context("manifest_inflate")?;
            if out.len() as u64 > MAX_MANIFEST {
                bail!("manifest_too_large");
            }
            Ok(out)
        }
        other => bail!("zip_method_unsupported_{other}"),
    }
}

async fn read_entry(url: &str, entry: &Entry) -> Result<Vec<u8>> {
    if entry.compressed > MAX_MANIFEST || entry.uncompressed > MAX_MANIFEST {
        bail!("manifest_too_large");
    }
    // The local header repeats the name and may carry its own extra field; ask for some slack
    // so one request usually covers header and data, and ask again when it didn't.
    let start = entry.local_header;
    let (mut bytes, _) = fetch(
        url,
        format!("bytes={start}-{}", start + 30 + 1024 + entry.compressed - 1),
    )
    .await?;
    if bytes.len() >= 30 {
        let needed =
            30 + u16_at(&bytes, 26)? as u64 + u16_at(&bytes, 28)? as u64 + entry.compressed;
        if needed > bytes.len() as u64 {
            bytes = fetch(url, format!("bytes={start}-{}", start + needed - 1))
                .await?
                .0;
        }
    }
    entry_data(&bytes, entry)
}

/// CurseForge's `edge` host answers 404 to any range request (it only redirects whole-file
/// GETs to `mediafilez`), so ranges go straight to `mediafilez`, the same files under the same
/// path (the launcher already treats the two as aliases).
fn range_url(url: &str) -> String {
    match reqwest::Url::parse(url) {
        Ok(mut parsed) if parsed.host_str() == Some("edge.forgecdn.net") => {
            let _ = parsed.set_host(Some("mediafilez.forgecdn.net"));
            parsed.to_string()
        }
        _ => url.to_string(),
    }
}

/// The pack's metadata from its root manifest, read with range requests only.
pub async fn metadata_from_url(url: &str) -> Result<ModpackMetadata> {
    let url = &range_url(url);
    let (tail, total) = fetch(url, format!("bytes=-{TAIL}")).await?;
    let tail_start = total.saturating_sub(tail.len() as u64);
    let (offset, size) = locate_central_directory(&tail, tail_start)?;
    if size == 0 || size > MAX_CENTRAL_DIRECTORY {
        bail!("zip_directory_size");
    }
    let directory = if offset >= tail_start && offset + size <= total {
        tail[(offset - tail_start) as usize..(offset - tail_start + size) as usize].to_vec()
    } else {
        fetch(url, format!("bytes={offset}-{}", offset + size - 1))
            .await?
            .0
    };
    let (name, entry) = find_manifest(&directory)?.ok_or_else(|| anyhow!("manifest_missing"))?;
    let bytes = read_entry(url, &entry).await?;
    metadata_from_manifest(name, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = std::io::Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut out);
            for (name, bytes) in entries {
                zip.start_file(*name, zip::write::SimpleFileOptions::default())
                    .unwrap();
                zip.write_all(bytes).unwrap();
            }
            zip.finish().unwrap();
        }
        out.into_inner()
    }

    #[test]
    fn reads_the_root_manifest_through_the_central_directory() {
        let manifest = br#"{"minecraft":{"version":"1.20.1","modLoaders":[{"id":"forge-47.2.0","primary":true}]},"manifestType":"minecraftModpack","manifestVersion":1,"name":"Pack","version":"1","files":[{"projectID":1,"fileID":2,"required":true},{"projectID":3,"fileID":4,"required":true}],"overrides":"overrides"}"#;
        let bytes = archive(&[
            ("overrides/config/a.toml", b"a = 1"),
            ("manifest.json", manifest),
            ("overrides/manifest.json", b"{}"),
        ]);
        // A tail that starts partway through the file, as a suffix range would return.
        let tail_start = 10;
        let (offset, size) =
            locate_central_directory(&bytes[tail_start..], tail_start as u64).unwrap();
        let directory = &bytes[offset as usize..(offset + size) as usize];
        let (name, entry) = find_manifest(directory).unwrap().unwrap();
        assert_eq!(name, "manifest.json");
        let data = entry_data(&bytes[entry.local_header as usize..], &entry).unwrap();
        let metadata = metadata_from_manifest(name, &data).unwrap();
        assert_eq!(metadata.minecraft_version, "1.20.1");
        assert_eq!(metadata.modloader_type, "forge");
        assert_eq!(metadata.mods.len(), 2);
    }

    /// Network check against a real pack: `VESTA_REMOTE_PACK_URL=<url> cargo test -p piston-lib remote -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn reads_a_live_pack() {
        let url = std::env::var("VESTA_REMOTE_PACK_URL").expect("VESTA_REMOTE_PACK_URL");
        let metadata = metadata_from_url(&url).await.unwrap();
        println!(
            "{} {} {} mods",
            metadata.minecraft_version,
            metadata.modloader_type,
            metadata.mods.len()
        );
        assert!(!metadata.mods.is_empty());
    }

    #[test]
    fn broken_archives_are_errors_not_panics() {
        assert!(locate_central_directory(&[0; 64], 0).is_err());
        assert!(find_manifest(&[]).unwrap().is_none());
        let entry = Entry {
            method: 8,
            compressed: 10,
            uncompressed: 10,
            local_header: 0,
        };
        assert!(entry_data(&[0x50, 0x4b, 0x03, 0x04], &entry).is_err());
    }
}
