use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};

// Bound the native read and IPC payload even for very large single-line logs.
const MAX_TAIL_BYTES: u64 = 1024 * 1024;

pub(crate) fn read_tail(
    mut file: impl Read + Seek,
    last_lines: usize,
) -> std::io::Result<Vec<String>> {
    if last_lines == 0 {
        return Ok(Vec::new());
    }
    let end = file.seek(SeekFrom::End(0))?;
    let start = end.saturating_sub(MAX_TAIL_BYTES);
    let read_from = start.saturating_sub(1);
    file.seek(SeekFrom::Start(read_from))?;
    let mut bytes = Vec::new();
    file.take(end - read_from).read_to_end(&mut bytes)?;
    Ok(parse_tail(&bytes, start > 0, last_lines))
}

pub(crate) fn read_stream_tail(file: impl Read, last_lines: usize) -> std::io::Result<Vec<String>> {
    if last_lines == 0 {
        return Ok(Vec::new());
    }
    // One preceding byte tells us whether the retained suffix starts on a boundary.
    let capacity = MAX_TAIL_BYTES as usize + 1;
    let mut bytes = VecDeque::new();
    let mut reader = BufReader::with_capacity(64 * 1024, file);
    let mut clipped = false;
    loop {
        let chunk = reader.fill_buf()?;
        if chunk.is_empty() {
            break;
        }
        let len = chunk.len();
        let excess = (bytes.len() + len).saturating_sub(capacity);
        clipped |= excess > 0;
        bytes.drain(..excess);
        bytes.extend(chunk);
        reader.consume(len);
    }
    Ok(parse_tail(bytes.make_contiguous(), clipped, last_lines))
}

fn parse_tail(bytes: &[u8], skip_first: bool, last_lines: usize) -> Vec<String> {
    let start = if !skip_first {
        0
    } else {
        bytes
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(bytes.len(), |index| index + 1)
    };
    let text = String::from_utf8_lossy(&bytes[start..]);
    let mut lines: Vec<_> = text
        .lines()
        .rev()
        .take(last_lines)
        .map(str::to_owned)
        .collect();
    lines.reverse();
    lines
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn returns_recent_complete_lines_in_order_with_or_without_trailing_newline() {
        for text in ["one\r\ntwo\r\nthree", "one\r\ntwo\r\nthree\r\n"] {
            assert_eq!(read_tail(Cursor::new(text), 2).unwrap(), ["two", "three"]);
        }
        assert!(read_tail(Cursor::new("one"), 0).unwrap().is_empty());
    }

    #[test]
    fn large_capture_discards_a_partial_first_line() {
        let mut bytes = vec![b'a'; MAX_TAIL_BYTES as usize];
        bytes.extend_from_slice(b"\nrecent\nlast");
        assert_eq!(
            read_tail(Cursor::new(&bytes), 10).unwrap(),
            ["recent", "last"]
        );
        assert_eq!(
            read_stream_tail(Cursor::new(&bytes), 10).unwrap(),
            ["recent", "last"]
        );
    }
}
