use std::cmp::Ordering;

#[derive(Debug, PartialEq, Eq, Clone)]
pub struct Version(String);

impl Version {
    pub fn new(v: &str) -> Self {
        Version(v.to_string())
    }

    fn split_parts(s: &str) -> Vec<Part> {
        let mut parts = Vec::new();
        let mut current_numeric = true;
        let mut current_start = 0;

        let chars: Vec<char> = s.chars().collect();
        for i in 0..chars.len() {
            let c = chars[i];
            let is_digit = c.is_ascii_digit();

            if i == 0 {
                current_numeric = is_digit;
            } else if is_digit != current_numeric || c == '.' || c == '-' {
                let part_str: String = chars[current_start..i].iter().collect();
                if !part_str.is_empty() && part_str != "." && part_str != "-" {
                    if current_numeric {
                        parts.push(Part::Numeric(part_str.parse().unwrap_or(0)));
                    } else {
                        parts.push(Part::String(part_str));
                    }
                }
                
                if c == '.' || c == '-' {
                    current_start = i + 1;
                    // Reset numeric based on next char if possible, or just wait for next iteration
                    if i + 1 < chars.len() {
                        current_numeric = chars[i + 1].is_ascii_digit();
                    }
                } else {
                    current_start = i;
                    current_numeric = is_digit;
                }
            }
        }

        // Add last part
        if current_start < chars.len() {
            let part_str: String = chars[current_start..].iter().collect();
            if !part_str.is_empty() && part_str != "." && part_str != "-" {
                if current_numeric {
                    parts.push(Part::Numeric(part_str.parse().unwrap_or(0)));
                } else {
                    parts.push(Part::String(part_str));
                }
            }
        }

        parts
    }
}

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Part {
    Numeric(u64),
    String(String),
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> Ordering {
        // Special case: handle pre-release tags (anything after '-')
        // For Minecraft modloaders, usually version-tag < version
        let (a_base, a_tag) = match self.0.split_once('-') {
            Some((b, t)) => (b, Some(t)),
            None => (self.0.as_str(), None),
        };
        let (b_base, b_tag) = match other.0.split_once('-') {
            Some((b, t)) => (b, Some(t)),
            None => (other.0.as_str(), None),
        };

        let a_base_parts = Self::split_parts(a_base);
        let b_base_parts = Self::split_parts(b_base);

        for (ap, bp) in a_base_parts.iter().zip(b_base_parts.iter()) {
            match ap.cmp(bp) {
                Ordering::Equal => continue,
                ord => return ord,
            }
        }

        match a_base_parts.len().cmp(&b_base_parts.len()) {
            Ordering::Equal => {}
            ord => return ord,
        }

        // Base versions are equal, compare tags
        match (a_tag, b_tag) {
            (None, None) => Ordering::Equal,
            (Some(_), None) => Ordering::Less, // version-tag < version
            (None, Some(_)) => Ordering::Greater, // version > version-tag
            (Some(at), Some(bt)) => {
                let at_parts = Self::split_parts(at);
                let bt_parts = Self::split_parts(bt);
                for (ap, bp) in at_parts.iter().zip(bt_parts.iter()) {
                    match ap.cmp(bp) {
                        Ordering::Equal => continue,
                        ord => return ord,
                    }
                }
                at_parts.len().cmp(&bt_parts.len())
            }
        }
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub fn compare_versions(a: &str, b: &str) -> Ordering {
    Version::new(a).cmp(&Version::new(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_sorting() {
        assert_eq!(compare_versions("1.0.0", "1.0.1"), Ordering::Less);
        assert_eq!(compare_versions("1.0.1", "1.0.0"), Ordering::Greater);
        assert_eq!(compare_versions("1.0.0", "1.0.0"), Ordering::Equal);
        
        // Beta/Suffix tests
        assert_eq!(compare_versions("1.0.0-beta.1", "1.0.0"), Ordering::Less);
        assert_eq!(compare_versions("1.0.0-beta.1", "1.0.0-beta.2"), Ordering::Less);
        assert_eq!(compare_versions("1.0.0-alpha.1", "1.0.0-beta.1"), Ordering::Less);
        
        // Complex versions
        assert_eq!(compare_versions("0.14.22", "0.14.21"), Ordering::Greater);
        assert_eq!(compare_versions("47.2.0", "47.1.0"), Ordering::Greater);
        
        // Mixed beta strings
        assert_eq!(compare_versions("0.0.0-beta.0", "0.0.0"), Ordering::Less);

        // Third zero issue mentioned by user
        assert_eq!(compare_versions("1.20.0", "1.20.1"), Ordering::Less);
        assert_eq!(compare_versions("1.20", "1.20.0"), Ordering::Less); // 1.20 < 1.20.0 is debatable but usually 1.20.0 is more specific
    }
}
