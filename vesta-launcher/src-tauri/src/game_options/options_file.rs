use std::collections::BTreeMap;

/// UTF-8 options document. Untouched lines retain their exact bytes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OptionsDocument(String);

fn entry(line: &str) -> Option<(&str, &str)> {
    let body = line.trim_end_matches('\n').trim_end_matches('\r');
    if body.starts_with('#') || body.starts_with("//") {
        return None;
    }
    let (key, value) = body.split_once(':')?;
    valid_key(key).then_some((key, value))
}

fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && !key.starts_with('#')
        && !key.starts_with("//")
        && !key
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || c == ':' || c == '\u{feff}')
}

impl OptionsDocument {
    pub fn parse(bytes: &[u8]) -> Result<Self, &'static str> {
        let text = std::str::from_utf8(bytes).map_err(|_| "Options must use UTF-8 encoding")?;
        if text.contains('\0') {
            return Err("Options contain a NUL byte");
        }
        Ok(Self(text.to_owned()))
    }

    pub fn empty(data_version: Option<u32>) -> Self {
        Self(
            data_version
                .map(|v| format!("version:{v}\n"))
                .unwrap_or_default(),
        )
    }

    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }

    /// Last duplicate wins, as it does when the game reads its options.
    pub fn values(&self) -> BTreeMap<&str, &str> {
        self.0
            .trim_start_matches('\u{feff}')
            .split_inclusive('\n')
            .filter_map(entry)
            .collect()
    }

    /// Validate the entire patch before applying any edits.
    pub fn patched(&self, changes: &BTreeMap<String, String>) -> Result<Self, &'static str> {
        for (key, value) in changes {
            if !valid_key(key) || value.chars().any(|c| c == '\n' || c == '\r' || c == '\0') {
                return Err("Invalid option key or multiline value");
            }
        }
        let bom = self.0.starts_with('\u{feff}');
        let body = self.0.strip_prefix('\u{feff}').unwrap_or(&self.0);
        let mut lines: Vec<String> = body.split_inclusive('\n').map(str::to_owned).collect();
        let newline = if body.contains("\r\n") { "\r\n" } else { "\n" };
        let trailing_newline = body.ends_with('\n');
        for (key, value) in changes {
            if let Some(index) = lines
                .iter()
                .rposition(|line| entry(line).is_some_and(|(k, _)| k == key))
            {
                if entry(&lines[index]).is_some_and(|(_, v)| v == value) {
                    continue;
                }
                let ending = if lines[index].ends_with("\r\n") {
                    "\r\n"
                } else if lines[index].ends_with('\n') {
                    "\n"
                } else {
                    ""
                };
                lines[index] = format!("{key}:{value}{ending}");
            } else {
                if let Some(last) = lines.last_mut() {
                    if !last.ends_with('\n') {
                        last.push_str(newline);
                    }
                }
                lines.push(format!(
                    "{key}:{value}{}",
                    if trailing_newline { newline } else { "" }
                ));
            }
        }
        Ok(Self(format!(
            "{}{}",
            if bom { "\u{feff}" } else { "" },
            lines.concat()
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patch(key: &str, value: &str) -> BTreeMap<String, String> {
        BTreeMap::from([(key.into(), value.into())])
    }

    #[test]
    fn preserves_document_and_edits_only_effective_duplicate() {
        let bytes = b"\xef\xbb\xbf# comment\r\nfov:0.0\r\nmalformed\ncustom:host:port\nfov:0.5";
        let doc = OptionsDocument::parse(bytes).unwrap();
        assert_eq!(doc.patched(&BTreeMap::new()).unwrap().as_bytes(), bytes);
        assert_eq!(doc.values()["custom"], "host:port");
        assert_eq!(doc.values()["fov"], "0.5");
        assert_eq!(
            doc.patched(&patch("fov", "0.25")).unwrap().as_bytes(),
            b"\xef\xbb\xbf# comment\r\nfov:0.0\r\nmalformed\ncustom:host:port\nfov:0.25"
        );
    }

    #[test]
    fn appends_with_existing_newline_style_and_final_newline_policy() {
        for (input, expected) in [
            ("a:1\r\n", "a:1\r\nb:2\r\n"),
            ("a:1", "a:1\nb:2"),
            ("", "b:2"),
        ] {
            assert_eq!(
                OptionsDocument::parse(input.as_bytes())
                    .unwrap()
                    .patched(&patch("b", "2"))
                    .unwrap()
                    .as_bytes(),
                expected.as_bytes()
            );
        }
        assert_eq!(
            OptionsDocument::empty(Some(100)).as_bytes(),
            b"version:100\n"
        );
        assert!(OptionsDocument::empty(None).as_bytes().is_empty());
    }

    #[test]
    fn rejects_corrupt_encoding_and_injection_without_mutating_source() {
        assert!(OptionsDocument::parse(&[0xff]).is_err());
        assert!(OptionsDocument::parse(b"x:\0").is_err());
        let doc = OptionsDocument::empty(None);
        for (key, value) in [
            ("x:y", "1"),
            ("#x", "1"),
            ("x", "1\ny:2"),
            ("x", "\r"),
            ("", "1"),
        ] {
            assert!(doc.patched(&patch(key, value)).is_err());
            assert!(doc.as_bytes().is_empty());
        }
    }
}
