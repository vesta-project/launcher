use piston_lib::game::launcher::version_parser::{
    Artifact, ExtractRules, Library, LibraryDownloads,
};
use piston_lib::game::launcher::{extract_natives, maven_to_path, OsType};
use std::collections::HashMap;
use tempfile::TempDir;

#[tokio::test]
async fn integration_installer_launcher_natives_flow() {
    // Create temp dirs to simulate libraries and natives locations
    let libs_tmp = TempDir::new().expect("tmpdir");
    let natives_tmp = TempDir::new().expect("natives_tmp");

    let libraries_dir = libs_tmp.path();
    let natives_dir = natives_tmp.path();

    // Build a fake library where the classifier exists in downloads.classifiers
    let coords = "com.example:libperm:2.0:natives-windows-64";
    let rel_path = maven_to_path(coords).unwrap();

    let mut classifiers = HashMap::new();
    classifiers.insert(
        "natives-windows-64".to_string(),
        Artifact {
            path: Some(rel_path.clone()),
            url: Some("https://example.com/fake.jar".to_string()),
            sha1: Some("deadbeef".to_string()),
            size: Some(123),
        },
    );

    let mut natives = HashMap::new();
    natives.insert("windows".to_string(), "natives-windows-64".to_string());

    let downloads = LibraryDownloads {
        artifact: None,
        classifiers: Some(classifiers),
    };

    let lib = Library {
        name: "com.example:libperm:2.0".to_string(),
        downloads: Some(downloads),
        url: None,
        rules: None,
        natives: Some(natives),
        extract: Some(ExtractRules { exclude: vec![] }),
    };

    // Create the classifier JAR on disk so the launcher can extract it
    let full_path = libraries_dir.join(&rel_path);

    if let Some(p) = full_path.parent() {
        std::fs::create_dir_all(p).unwrap();
    }

    // Create a small zip with one native file inside
    {
        let f = std::fs::File::create(&full_path).unwrap();
        let mut zip = zip::ZipWriter::new(f);
        use zip::write::FileOptions;
        zip.start_file::<&str, ()>("native-int.bin", FileOptions::default())
            .unwrap();
        use std::io::Write;
        zip.write_all(b"integration").unwrap();
        zip.finish().unwrap();
    }

    // Run extract_natives which should detect the classifier and extract the contained file
    let unified = piston_lib::game::launcher::unified_manifest::UnifiedLibrary::from_library(&lib, None, OsType::Windows);
    extract_natives(&unified, libraries_dir, natives_dir, OsType::Windows)
        .await
        .expect("integration extract failed");

    let extracted = natives_dir.join("native-int.bin");
    assert!(extracted.exists(), "Expected extracted file to exist");
}
