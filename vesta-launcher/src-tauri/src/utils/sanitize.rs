use std::borrow::Cow;

/// Convert a user-provided instance name into a filesystem-safe slug suitable
/// for using as an instance ID and folder name.
pub fn sanitize_instance_name(name: &str) -> String {
    // Quick normalization: trim and lower-case
    let n = name.trim().to_lowercase();

    // Build an ASCII-friendly slug: allow a-z, 0-9, hyphen and underscore
    // convert whitespace and other punctuation into single hyphens
    let mut out = String::with_capacity(n.len());
    let mut last_was_dash = false;

    for ch in n.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_was_dash = false;
        } else if ch == '-' || ch == '_' {
            out.push(ch);
            last_was_dash = false;
        } else if ch.is_whitespace() || ch.is_ascii_punctuation() {
            if !last_was_dash {
                out.push('-');
                last_was_dash = true;
            }
        } else {
            // skip other characters (non-ascii, combining marks, etc.)
            // This deliberately removes characters which might be unsafe on
            // some platforms or lead to confusing filesystem names.
            if !last_was_dash {
                out.push('-');
                last_was_dash = true;
            }
        }
    }

    // Trim leading/trailing dashes
    let slug = out.trim_matches('-');

    // Fallback to "instance" if empty
    let slug = if slug.is_empty() { "instance" } else { slug };

    // Limit length to a reasonable maximum (64 characters)
    let s: Cow<'_, str> = if slug.len() > 64 {
        Cow::Owned(slug[..64].to_string())
    } else {
        Cow::Borrowed(slug)
    };

    s.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_slug() {
        assert_eq!(sanitize_instance_name("My Instance"), "my-instance");
        assert_eq!(sanitize_instance_name("  Hello__World!! "), "hello__world");
        assert_eq!(sanitize_instance_name("../weird/name\\"), "weird-name");
        assert_eq!(sanitize_instance_name(""), "instance");
        let s = sanitize_instance_name("A very long name that should be truncated because it exceeds the maximum length allowed by the slug function");
        assert!(s.len() <= 64, "slug should be at most 64 characters");
        assert!(s.starts_with("a-very-long-name-that-should-be-truncated-because-it-exceeds"));
    }
}
