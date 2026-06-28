use serde::Serialize;

use super::crash_parser::{
    build_jvm_fixture_crash, parse_launch_log_content, parse_runtime_log_content, CrashDetails,
};

#[derive(Debug, Clone, Serialize)]
pub struct CrashScenarioInfo {
    pub id: String,
    pub label: String,
    pub category: String,
}

pub fn crash_scenario_catalog() -> Vec<CrashScenarioInfo> {
    vec![
        CrashScenarioInfo {
            id: "fabric_missing_api".to_string(),
            label: "Fabric — missing Fabric API".to_string(),
            category: "missing_dependency".to_string(),
        },
        CrashScenarioInfo {
            id: "fabric_missing_sodium".to_string(),
            label: "Fabric — missing Sodium".to_string(),
            category: "missing_dependency".to_string(),
        },
        CrashScenarioInfo {
            id: "forge_missing_dep".to_string(),
            label: "Forge — missing dependency".to_string(),
            category: "missing_dependency".to_string(),
        },
        CrashScenarioInfo {
            id: "duplicate_mod".to_string(),
            label: "Duplicate mod".to_string(),
            category: "duplicate_mod".to_string(),
        },
        CrashScenarioInfo {
            id: "mixin".to_string(),
            label: "Mixin failure".to_string(),
            category: "mixin".to_string(),
        },
        CrashScenarioInfo {
            id: "mod_incompatibility".to_string(),
            label: "Mod incompatibility".to_string(),
            category: "mod_incompatibility".to_string(),
        },
        CrashScenarioInfo {
            id: "java_version".to_string(),
            label: "Java version mismatch".to_string(),
            category: "java_version".to_string(),
        },
        CrashScenarioInfo {
            id: "generic_launch".to_string(),
            label: "Generic launch failure".to_string(),
            category: "launch".to_string(),
        },
        CrashScenarioInfo {
            id: "runtime".to_string(),
            label: "Runtime crash".to_string(),
            category: "runtime".to_string(),
        },
        CrashScenarioInfo {
            id: "jvm".to_string(),
            label: "JVM crash".to_string(),
            category: "jvm".to_string(),
        },
    ]
}

pub fn crash_from_scenario(scenario: &str) -> Option<CrashDetails> {
    let log = match scenario {
        "fabric_missing_api" => Some(FABRIC_MISSING_API_LOG),
        "fabric_missing_sodium" => Some(SODIUM_MISSING_LOG),
        "forge_missing_dep" => Some(FORGE_MISSING_DEP_LOG),
        "duplicate_mod" => Some(DUPLICATE_MOD_LOG),
        "mixin" => Some(MIXIN_LOG),
        "mod_incompatibility" => Some(MOD_INCOMPATIBILITY_LOG),
        "java_version" => Some(JAVA_VERSION_LOG),
        "generic_launch" => Some(GENERIC_LAUNCH_LOG),
        "runtime" => Some(RUNTIME_LOG),
        "jvm" => return Some(build_jvm_fixture_crash()),
        _ => None,
    }?;

    if scenario == "runtime" {
        parse_runtime_log_content(log)
    } else {
        parse_launch_log_content(log)
    }
}

const FABRIC_MISSING_API_LOG: &str = r#"[13:22:19] [main/ERROR]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
	 - Install fabric-api, version 0.149.0 or later.
More details:
	 - Mod 'BetterGrassify' (bettergrass) 1.8.6+fabric.26.1.2 requires any version of fabric-api, which is missing!
	at net.fabricmc.loader.impl.FormattedException.ofLocalized(FormattedException.java:51)"#;

const SODIUM_MISSING_LOG: &str = r#"[18:35:59] [main/ERROR]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
	 - Replace mod 'Iris' (iris) 1.10.9+mc26.1.1 with any version that is compatible with:
		 - Other constraints that can''t be automatically determined
More details:
	 - Mod 'BBE' (betterblockentities) 1.3.4+mc26.1.2 requires version 0.8.7 or later of sodium, which is missing!
	 - Mod 'Iris' (iris) 1.10.9+mc26.1.1 requires any 0.8.x version of sodium, which is missing!
	at net.fabricmc.loader.impl.FormattedException.ofLocalized(FormattedException.java:51)"#;

const FORGE_MISSING_DEP_LOG: &str = r#"net.minecraftforge.fml.ModLoadingException: Missing or unsupported mandatory dependencies:
	Mod ID: curios, Requested by: jei"#;

const DUPLICATE_MOD_LOG: &str = r#"net.minecraftforge.fml.loading.DuplicateModsFoundException: Duplicate mods found
	mod file: appleskin.jar"#;

const MIXIN_LOG: &str = r#"[main/ERROR]: Mixin apply failed
org.spongepowered.asm.mixin.transformer.throwables.MixinTransformerError: bad mixin config for example_mod"#;

const MOD_INCOMPATIBILITY_LOG: &str = r#"[main/ERROR]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
wrong minecraft version for this mod set"#;

const JAVA_VERSION_LOG: &str = r#"java.lang.UnsupportedClassVersionError: com/example/Mod has been compiled by a more recent version of the Java Runtime"#;

const GENERIC_LAUNCH_LOG: &str = r#"[main/ERROR]: Failed to bootstrap Minecraft"#;

const RUNTIME_LOG: &str = r#"[Render thread/ERROR]: Reported exception thrown!
java.lang.IllegalStateException: Simulated runtime crash in dev tools"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_catalog_scenario_parses() {
        for scenario in crash_scenario_catalog() {
            let crash = crash_from_scenario(&scenario.id)
                .unwrap_or_else(|| panic!("scenario {} should parse", scenario.id));
            assert_eq!(
                crash.category, scenario.category,
                "scenario {}",
                scenario.id
            );
        }
    }

    #[test]
    fn fabric_missing_api_has_structured_suspects() {
        let crash = crash_from_scenario("fabric_missing_api").expect("crash");
        assert!(crash.message.contains("fabric-api") || crash.message.contains("Fabric API"));
        assert!(crash.suspects.iter().any(|s| s.suspect_kind == "missing_dependency"));
    }

    #[test]
    fn fabric_missing_sodium_infers_sodium() {
        let crash = crash_from_scenario("fabric_missing_sodium").expect("crash");
        assert!(crash.message.contains("Sodium"));
    }
}
