# Cache and Install Index Schemas

This document specifies the content-addressable artifact store and install index used by Vesta to enable hash-skip, reuse, and safe GC.

## Artifact Store (`cache/artifacts.json`)

- id: SHA256 hex (lowercase)
- size: integer bytes
- signature: optional ASCII-armored PGP or detached signature reference
- source_url: optional canonical URL for provenance
- refs: integer refcount (computed), do not edit by hand

Example:

```json
{
  "sha256": "f2a1...",
  "size": 1048576,
  "signature": null,
  "source_url": "https://example.com/lib.jar",
  "refs": 3
}
```

## Install Index (`cache/install_index.json`)

- version_id: string (e.g., "1.20.1-fabric-0.15.11")
- loader: enum { vanilla, fabric, quilt, forge, neoforge }
- components: array of items { name, sha256, path_hint }
- processors: array of items { id, sha256, args }
- libraries: array of items { maven, sha256, natives? }
- reachability: graph edges to artifacts (computed from above)

Example:

```json
{
  "version_id": "1.20.1-fabric-0.15.11",
  "loader": "fabric",
  "components": [
    { "name": "client.jar", "sha256": "a1b2...", "path_hint": "versions/1.20.1/client.jar" }
  ],
  "processors": [
    { "id": "strip_meta", "sha256": "c3d4...", "args": ["--safe"] }
  ],
  "libraries": [
    { "maven": "net.fabricmc.fabric-loader:0.15.11", "sha256": "dead..." }
  ],
  "reachability": {
    "a1b2...": ["client.jar"],
    "dead...": ["fabric-loader"]
  }
}
```

## GC Policy

- Prune only artifacts with `refs == 0` and no incoming edges in `reachability`
- Quarantine suspicious blobs (mismatch hash/signature) instead of deleting
- Respect server/headless profiles; shared libs remain unless explicitly unlinked

## Conventions

- Paths align with `vesta_preferences.md` (`AppData/Vesta/...`) and shared `libraries/`
- All hashes are SHA256; avoid weaker algorithms
- Installer adapters must populate the index consistently
