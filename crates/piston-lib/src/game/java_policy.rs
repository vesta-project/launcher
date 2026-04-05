pub const LEGACY_JAVA_MAJOR: u32 = 8;

/// Normalize declared Java requirements to launcher policy.
///
/// Current policy: treat Java 16 requirements as Java 17.
pub fn preferred_java_major(major: u32) -> u32 {
    if major == 16 {
        17
    } else {
        major
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_java_16_to_17() {
        assert_eq!(preferred_java_major(16), 17);
    }

    #[test]
    fn preserves_other_versions() {
        assert_eq!(preferred_java_major(8), 8);
        assert_eq!(preferred_java_major(17), 17);
        assert_eq!(preferred_java_major(21), 21);
        assert_eq!(preferred_java_major(25), 25);
    }
}
