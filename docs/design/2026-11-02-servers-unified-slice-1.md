# Unified servers, slice 1 implementation

Branch: `r8/quickplay`. Scope: instance destinations only; no registry, recent list, Overview shortcuts, ping, or servers.dat editing.

## Launch support policy

| Minecraft | Loader | Direct worlds / servers |
| --- | --- | --- |
| Stable numeric 1.20.x and 1.21.x (including 1.20 and 1.21) | Vanilla, Fabric | Enabled only if the installed merged manifest evaluates to exactly one correct path and selected destination flag, with no other destination flags |
| Older versions, snapshots, prereleases, other release families | All | Hidden / rejected |
| Any version | Forge, NeoForge, Quilt, unknown loaders | Hidden / rejected pending passthrough validation |

No legacy `--server` / `--port` fallback is implemented. Absence of Quick Play flags is not taken as evidence of legacy support. Unsupported or conflicting targets fail before starting Java; ordinary Play and target Play share the existing command and signed-pack enforcement.

Evidence:

- Mojang's [23w14a release notes](https://www.minecraft.net/en-us/article/minecraft-snapshot-23w14a) document the four Quick Play arguments, world folder identity, optional logging, and removal of legacy server/port flags.
- `crates/piston-lib/src/test_fixtures/quickplay-1.21.json` is the official Mojang 1.21 version JSON, downloaded through `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json` on 2026-11-02. Its actual path feature is **has_quick_plays_support** (plural); both this and the design's singular alias are recognized.
- `quickplay-fabric-1.21.json` is `https://meta.fabricmc.net/v2/versions/loader/1.21/0.16.14/profile/json`, downloaded on the same date. Tests merge these actual manifests.
- Fabric's [MinecraftGameProvider](https://github.com/FabricMC/fabric-loader/blob/0.16.14/minecraft/src/main/java/net/fabricmc/loader/impl/game/minecraft/MinecraftGameProvider.java), `getLaunchArguments` / `launch`, forwards the argument array to the Minecraft entry point. This supports enabling Fabric; a real game join is still unverified.

The instance support query resolves the installed runtime manifest and evaluates probe targets through the same argument builder and validator used at launch. It returns false for absent manifests and malformed or duplicate flag groups. Launch checks again against the final runtime plan.

## Boundaries

- LaunchTarget is an exclusive enum (none, folder, host + optional port, Realm ID). No Realm UI.
- World rows retain the existing WorldRef directory identity and inventory. The native command uses the existing world resolver; piston-lib rechecks existence and canonical confinement under saves. Saves mutation exclusion is held through launch.
- Servers are bounded, uncompressed, read-only NBT. Missing/malformed documents produce an empty projection; malformed rows and hidden entries are skipped. Invalid addresses remain visible without Play. IPv6 brackets and explicit/default ports are handled without resolving or rewriting DNS names.
- Supported launches record `<game dir>/.vesta/quickplay.json`, including ordinary launches; the directory is created and the path is logged. Redirected log paths are rejected. Log schema/retention and actual joins remain unverified, so there is no history UI.
- Destination launches never stop a running instance, redirect to another instance, or silently resume an installation without preserving the target.

## Validation

Frontend typecheck and production build pass. Localization, alignment, theme tokens, instance model, interaction, detail mapping, and shortcut checks pass. New coverage includes exact instance/target dispatch and refusing to stop an already running game.

Rust tests cover actual merged vanilla/Fabric arguments, mutually exclusive destinations, whitespace, IPv6/ports, missing/traversing worlds, legacy/custom flag conflicts, unknown false-valued features, last-match ordering, the support policy, read-only NBT with hidden/malformed entries, and missing-manifest flags. Native validation: 52 piston-lib launcher tests, 2 new Tauri destination tests, and 57 existing world tests passed. The Tauri test executable needed the documented Common-Controls v6 manifest workaround (embedded only into the generated executable). Frontend: 28 checks passed across the seven requested/related files. Build emits its existing chunk-size advisory; native compilation emits existing unused/dead-code warnings.

Build artifacts were moved from this worktree's `target` to `C:/Users/eatha/AppData/Local/Temp/vesta-unified-servers-target` after V: ran out of space. No project build configuration was changed. Real world/server launch is not verified.
