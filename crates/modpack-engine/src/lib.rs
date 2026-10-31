//! Pure pack policy. Adapters own serialization, hashing, network and filesystem IO.
pub mod classifier;
pub fn recorded_hash_matches(recorded: Option<&str>, current: Option<&str>) -> bool {
    matches!((recorded, current), (Some(a), Some(b)) if a.eq_ignore_ascii_case(b))
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision { Add, Update, Remove, Merge, Current, Protect, Keep, None }
/// Launcher three-way policy. Untracked paths never enter this function.
pub fn decide(text: bool, old: bool, new: bool, recorded: Option<&str>, current: Option<&str>, incoming: Option<&str>) -> Decision {
    use Decision::*;
    if text { return match (old,new) {
        (true,true) if recorded_hash_matches(recorded,current) => Add,
        (true,true) => Merge, (false,true) => Add, (true,false) => Keep, _ => None,
    }; }
    match (old,new) {
        (true,true) if recorded.is_some() && current.is_some() && !recorded_hash_matches(recorded,current) => Protect,
        (true,true) if current.map(str::to_lowercase) == incoming.map(str::to_lowercase) => Current,
        (true,true) => Update, (false,true) => Add,
        (true,false) if current.is_none() || recorded.is_none() || recorded_hash_matches(recorded,current) => Remove,
        (true,false) => Protect, _ => None,
    }
}
pub fn side_supported(value: Option<&str>) -> bool { value != Some("unsupported") }
pub fn override_roots(server: bool) -> [&'static str; 2] {
    ["overrides", if server { "server-overrides" } else { "client-overrides" }]
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn adapter_parity_fixtures() {
        for (old,new,recorded,current,incoming,expected) in [
            (true,true,Some("a"),Some("A"),Some("b"),Decision::Update),
            (true,true,Some("a"),Some("user"),Some("b"),Decision::Protect),
            (true,false,Some("a"),Some("A"),None,Decision::Remove),
            (true,false,Some("a"),Some("user"),None,Decision::Protect),
            (false,false,None,Some("user"),None,Decision::None),
            (false,true,None,None,Some("b"),Decision::Add),
            (true,true,Some("a"),Some("A"),Some("a"),Decision::Current),
        ] { assert_eq!(decide(false,old,new,recorded,current,incoming),expected); }
        assert_eq!(decide(true,true,true,Some("a"),Some("user"),Some("b")),Decision::Merge);
        assert_eq!(decide(true,true,false,Some("a"),Some("a"),None),Decision::Keep);
        assert!(!side_supported(Some("unsupported")));
        assert_eq!(override_roots(true),["overrides","server-overrides"]);
    }
}
