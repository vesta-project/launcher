use crate::tasks::installers::schemas::{ArtifactRecord, InstallIndexRecord, LoaderKind};

#[test]
fn artifact_record_roundtrip() {
    let rec = ArtifactRecord {
        sha256: "deadbeef".into(),
        size: 1234,
        signature: None,
        source_url: Some("https://example.com/lib.jar".into()),
        refs: 0,
    };
    let json = serde_json::to_string(&rec).expect("serialize");
    let back: ArtifactRecord = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(back.sha256, rec.sha256);
    assert_eq!(back.size, rec.size);
    assert_eq!(back.source_url, rec.source_url);
}

#[test]
fn install_index_record_roundtrip() {
    let idx = InstallIndexRecord {
        version_id: "1.20.1-fabric-0.15.11".into(),
        loader: LoaderKind::Fabric,
        components: vec![],
        processors: vec![],
        libraries: vec![],
        reachability: Default::default(),
    };
    let json = serde_json::to_string(&idx).expect("serialize");
    let back: InstallIndexRecord = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(back.version_id, idx.version_id);
    match back.loader {
        LoaderKind::Fabric => (),
        _ => panic!("loader mismatch"),
    }
}
