# Direct launch evidence (2026-11-02)

Support remains bounded to stable Minecraft 1.20.x and 1.21.x. NeoForge starts
at 1.20.2. Snapshots, prereleases and other release families remain disabled.
The UI calls `direct_launch_supported`, resolves the installed RuntimePlan and
probes both world and server arguments via `validate_target_arguments`.
An unrecognized Forge/NeoForge/Quilt main class or missing/duplicated manifest
Quick Play flags disables direct launch. There is no synthetic argument fallback.

## Installed profiles

The adjacent JSON fixtures retain id, mainClass, inheritsFrom and arguments from
the same launcher-meta profiles consumed by `resolve_loader_profile` and
`profile_to_version_manifest`; libraries and installer processors are trimmed.

| Loader | Reviewed profile | Entry point |
| --- | --- | --- |
| NeoForge | https://launcher-meta.modrinth.com/neo/v0/versions/21.1.265.json | cpw.mods.bootstraplauncher.BootstrapLauncher |
| NeoForge 1.20.2 | https://launcher-meta.modrinth.com/neo/v0/versions/20.2.93.json | cpw.mods.bootstraplauncher.BootstrapLauncher |
| Forge | https://launcher-meta.modrinth.com/forge/v0/versions/52.1.20.json | net.minecraftforge.bootstrap.ForgeBootstrap |
| Forge 1.20.1 | https://launcher-meta.modrinth.com/forge/v0/versions/47.4.28.json | cpw.mods.bootstraplauncher.BootstrapLauncher |
| Quilt | https://launcher-meta.modrinth.com/quilt/v1/version-group/v1/loader-version/0.30.2 | org.quiltmc.loader.impl.launch.knot.KnotClient |

Quilt's group profile has a Minecraft version placeholder, expanded by the
installer. Its empty game argument list inherits vanilla arguments. Forge and
NeoForge add their own loader arguments to vanilla. The regression merges these
profiles with Mojang's existing 1.21 fixture, resolves no target/world/server,
and checks the manifest's instance-local quickPlayPath and target flags.

## Source argument forwarding

- [BootstrapLauncher](https://github.com/McModLauncher/bootstraplauncher/blob/main/src/main/java/cpw/mods/bootstraplauncher/BootstrapLauncher.java):
  main -> run -> launch provider Consumer.accept(args).
- [ModLauncher ArgumentHandler](https://github.com/McModLauncher/modlauncher/blob/main/src/main/java/cpw/mods/modlauncher/ArgumentHandler.java):
  allowsUnrecognizedOptions; buildArgumentList retains nonOptionArguments.
- [NeoForge FML 4 CommonLaunchHandler](https://github.com/neoforged/FancyModLoader/blob/4.0/loader/src/main/java/net/neoforged/fml/loading/targets/CommonLaunchHandler.java):
  preLaunch returns arguments; clientService invokes net.minecraft.client.main.Main
  with the argument array. CommonClientLaunchHandler delegates to clientService.
- NeoForge 20.2.93 installs FML loader 1.0.16. Its exact
  [published sources JAR](https://maven.neoforged.net/releases/net/neoforged/fancymodloader/loader/1.0.16/loader-1.0.16-sources.jar)
  was also inspected: CommonLaunchHandler.preLaunch returns arguments,
  clientService calls runTarget with them, and runTarget invokes Minecraft main
  with the same array. This verifies the 1.20.2 lower boundary.
- [Forge 1.20.x CommonLaunchHandler](https://github.com/MinecraftForge/MinecraftForge/blob/1.20.x/fmlloader/src/main/java/net/minecraftforge/fml/loading/targets/CommonLaunchHandler.java):
  makeService -> runTarget -> main(String[]) receives arguments unchanged.
- [ForgeBootstrap](https://github.com/MinecraftForge/Bootstrap/blob/master/src/main/java/net/minecraftforge/bootstrap/ForgeBootstrap.java)
  main -> start(args); [Bootstrap](https://github.com/MinecraftForge/Bootstrap/blob/master/src/main/java/net/minecraftforge/bootstrap/Bootstrap.java)
  passes args through bootstrapMain/moduleMain to loader.main(args).
- [Quilt MinecraftGameProvider](https://github.com/QuiltMC/quilt-loader/blob/develop/minecraft/src/main/java/org/quiltmc/loader/impl/game/minecraft/MinecraftGameProvider.java):
  launch invokes Minecraft main with arguments.toArray().

This establishes argument forwarding, not a successful authenticated game join.
Actual installed manifest validation remains required for each instance.

## Modrinth regression fixture provenance

`aero-versions-v2.json` and `aero-versions-v3.json` in the launcher's source
fixtures were fetched from the respective `/project/aero-server/version` APIs
on this date. Only the first release and last synthetic version are retained;
embedded dependencies are trimmed. The synthetic v3 record omits game_versions,
has no files and must not invalidate the installable releases. The v3 release
uses loaders=[mrpack], mrpack_loaders=[neoforge].
The live v3 query with loaders=[neoforge] returned zero versions, while the
unfiltered query returned 21. Runtime-loader filtering therefore runs locally
after normalization, covering Versions, install selection and update callers.

## Process supervision finding

The supervisor JAR is Java 8 bytecode and a basic Java child probe succeeds.
The handler writes status for a normal nonzero child exit and caught startup
exceptions, so an ordinary NeoForge crash alone does not explain missing status.
Before this fix, supervisor stdout/stderr went to null and child.wait discarded
the OS exit status. A JVM failure before ExitHandler.main therefore lost both
diagnostics and exit code, and reconciliation substituted an internal missing
file message. Both observations are now retained. The child's authoritative
status wins; fallback OS status is recorded only after no surviving game PID
is found. Nonzero exits without a recognized crash pattern retain the session
log and its tail in crash details.

The original Aero session log/exit code is unavailable in this worktree. No
claim is made about its specific JVM failure or successful Aero gameplay.

## Validation

- `cargo check -p vesta-launcher`: passed, existing warnings only.
- `cargo test -p piston-lib --lib game::launcher`: 54 passed.
- Vesta test executable: Modrinth source 10 passed, lifecycle 7 passed,
  destinations/UI support 2 passed. Used the existing Common-Controls manifest
  on the generated executable and package test debug=0 to limit disk use.
- Rebuilt Java 8-compatible exit-handler.jar; actual child probes for codes
  0 and 23 retained matching OS/JSON codes and stderr in the session log.
- All Cargo commands used `V:/launcher-wt-t2-terra/target`.
