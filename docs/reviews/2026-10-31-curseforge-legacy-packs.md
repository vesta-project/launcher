# CurseForge legacy packs — 2026-10-31

## Live evidence

Queried `GET https://api.curseforge.com/v1/mods/285109/files/4612979`
with `CURSEFORGE_API_KEY` from the launcher's existing dotenv path
(`V:/launcher/.env`, consumed without logging the key). Downloaded both API-selected
archives from ForgeCDN. No credentials or archives are committed.

The current response differs from the reported empty-version case:

```json
{
  "id": 4612979,
  "modId": 285109,
  "fileName": "RLCraft 1.12.2 - Release v2.9.3.zip",
  "gameVersions": ["1.12.2"],
  "sortableGameVersions": [{
    "gameVersionName": "1.12.2",
    "gameVersionPadded": "0000000001.0000000012.0000000002",
    "gameVersion": "1.12.2",
    "gameVersionReleaseDate": "2017-09-18T05:00:00Z",
    "gameVersionTypeId": 628
  }],
  "serverPackFileId": 4612990,
  "isServerPack": false,
  "downloadUrl": "https://edge.forgecdn.net/files/4612/979/RLCraft%201.12.2%20-%20Release%20v2.9.3.zip"
}
```

There is no Forge tag or loader version. `sortableGameVersions` contains the same
Minecraft version and cannot recover the loader. The client ZIP's root manifest has:

```json
{"name":"RLCraft","version":"2.9.3","minecraft":{"version":"1.12.2","modLoaders":[{"id":"forge-14.23.5.2860","primary":true}]},"overrides":"overrides"}
```

The client archive lists mod project/file references and contains an `overrides/`
tree. File 4612990 is marked `isServerPack: true`, also has `gameVersions:
["1.12.2"]`, and has a working API download URL. Its ZIP is a ready server game
folder: root `config/`, `mods/`, `server.properties`, options and changelog files;
it has no root pack manifest. Runtime must come from the client manifest, not from
assuming this server ZIP is another CurseForge export.
The client manifest references 187 mod files; the server ZIP contains 180 mod JARs
and 3,568 files overall. This server pack does not bundle a root Forge server JAR,
so installing the managed Forge runtime is still required.

## Reproduction and decisions

* Launcher: `onlinePackInfo` previously interpreted the absent loader as vanilla.
  An empty `game_versions` also produced an empty Minecraft version. Regression
  coverage reproduces both shapes and resolves them to 1.12.2 / Forge / 14.23.5.2860.
* Agent: whole-pack review already downloaded and parsed the client manifest.
  Live reproduction first refused `overrides/config/forgeendertech/Biomes/minecraft$mutated_ice_flats.cfg`
  under `safe_relative_path`. The server ZIP also contains `mods/Level Up! 2-1.1.23-1.12.jar`.
  The catalogue path policy now permits `$` and `!`, matching portable game filenames;
  Windows dollar-suffixed device aliases remain forbidden. Path regression tests cover both.
  The other defect was selecting client contents for server installation, including
  optional client mods, and ignoring the dedicated server pack. It did not require
  API version tags to parse a client manifest.
  After the filename fix, live review also reproduced `pack_path_protected` for
  the ready folder's `server.properties`. Dedicated server-pack parsing now skips
  managed server settings, account lists, root startup scripts/JARs and `libraries/`,
  with an explicit warning for every skipped file. Runtime is installed through
  the managed software installer. Game `mods/` and configuration files remain in
  the review. Generic archive imports retain their existing protected-file rules.
* Launcher now downloads and inspects the pinned client archive during preflight
  when either game version or supported loader metadata is absent. It reuses the
  existing bounded archive cache and native manifest parser. Errors stop Create;
  runtime is never silently guessed. Project and client release identity survive.
* Create and server review display **Version from pack manifest** when derived.
  Tests include the observed missing-loader shape and fully empty API tags.
* Agent reads `serverPackFileId`, verifies the referenced file is a server pack,
  downloads it with the existing provider hash verification, and plans its game
  contents with runtime copied from the client manifest. Client publication keeps
  the original client project/file reference. A broken explicit server reference
  fails review instead of silently installing the client archive.
* The exact Forge software plan initially failed `InvalidMetadata`: build 2860 uses
  installer `spec: 0`, while the existing legacy adapter accepted only `spec: 1`
  or the older `install` shape. The adapter now retains `version.json`, reads its
  pinned launch libraries for spec 0, selects only the embedded server JAR's
  declared classpath, and verifies that every classpath member is accounted for.
  Unsupported spec values and spec-0 processors/data remain refused. The live
  1.12.2 / Forge 14.23.5.2860 software resolver now succeeds with Java 8.
  Executable destination and path checks continue to apply to server archives.
* A null `downloadUrl` is not itself proof of manual-only distribution. Both
  resolvers already construct a fixed ForgeCDN URL from provider-bound ID/name;
  the agent verifies the API hash. CDN refusal remains an error with file identity.
  RLCraft's observed URLs are non-null; manual download was not needed for it.

## Validation

* `bun run typecheck` and `bun run build`: pass.
* All 44 `checks/servers-*.test.js` and `checks/browse-*.test.js` files were run.
  The combined final run had 492 passes and one timing-sensitive failure:
  `console batches publish once and clear survives reactive history recovery`
  (`HOT_SCOPE_TIME` for `console-check:rows`, 8 ms budget). Every file passed in
  isolated runs after retrying that file; its final targeted run also passed.
  No console/reactivity implementation was changed for this task.
* Launcher native modpack tests: 15 pass, including the downloaded RLCraft archive
  (187 manifest mod references); dropped-file test: 1 pass. Stale dropped-file tests
  were updated from removed `pack_bytes` to streaming `pack_sources` in a separate
  commit. The Windows test executable compiled but could not start without a Common
  Controls v6 activation manifest (`STATUS_ENTRYPOINT_NOT_FOUND`, `TaskDialogIndirect`).
  Validation used a temporary copy with that manifest embedded via SDK `mt.exe`;
  no test assertions or production binaries were bypassed or changed.
* Agent import tests: 9 pass, covering manifest runtime and dedicated server-folder
  filtering; install tests: 8 pass, covering path safety and existing review behavior
  (live tests excluded).
  Catalogue sync/path tests: 23 pass. Server installer suite: 208 pass, 2 ignored.
* Live exact Forge software resolution: pass, Minecraft 1.12.2 / Forge
  14.23.5.2860 / Java 8. This reproduced `InvalidMetadata` before the spec-0 fix.
* Live agent RLCraft 4612979 plan: pass, `valid=true`, Minecraft 1.12.2,
  Forge 14.23.5.2860, server file 4612990 selected, 3,554 reviewed files. The debug
  test took 366 seconds, mostly archive spooling/hash verification. It planned
  against a disposable empty server, without applying the plan or launching Java.
* Both downloaded ZIPs matched API SHA-1: client
  `11b0261e4dde9169173b24b88cbc1622859f4a68` (51,324,367 bytes), server
  `b3e070b5ef61597e434383875d630758d9ebb132` (334,397,653 bytes).
