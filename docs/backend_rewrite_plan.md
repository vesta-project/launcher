# Backend Rewrite Plan (Piston-lib)

Goal: consolidate all Minecraft backend responsibilities inside `crates/piston-lib`, delivering a fast, modular installer pipeline with hash-skip, cache indexing, modular loader adapters, concurrency controls, and transactional safety. `src-tauri` will only act as a thin bridge for UI, notifications, and orchestration.

## Phases

1. **Cache + Hash Store (Step 02)**
   - Add content-addressable artifact cache inside piston-lib (`game/installer/cache.rs`).
   - Manage SHA256 metadata, refcounts, reachability, and GC policies.
   - Provide API to check and reuse artifacts before downloading.

2. **Installer Pipeline + Transactions (Step 01 & 06)**
   - Introduce core traits (`InstallerStage`, `InstallTransaction`) inside piston-lib.
   - Support begin/checkpoint/commit/rollback with backup/quarantine directories.
   - Ensure rewrites remain asynchronous and Send + Sync friendly.

3. **Loader Adapters (Step 04)**
   - Implement modular adapters for Fabric, Quilt, Forge, NeoForge that output install plans (components, processors, libraries).
   - Reuse existing installer logic but expose plan → execute structure for future concurrency improvements.

4. **Concurrency Engine (Step 05)**
   - Add multi-threaded download/hash/extract executor with adaptive throttling.
   - Integrate with progress reporting to avoid spamming notifications.

5. **Manifest Generator Optimization (Step 07)**
   - Implement incremental manifest diffing/memoization inside piston-lib metadata layer.

6. **Bridge & Integration (Step 03 & 08)**
   - Keep `src-tauri` limited to NotificationManager wiring and `piston_bridge`.
   - Update docs/README references and provide sample config files once backend rewrite is stable.

## Immediate Work Items

- [ ] Implement cache module + schemas directly inside piston-lib.
- [ ] Introduce installer transaction + task traits within piston-lib.
- [ ] Wire Fabric adapter to use new cache/transaction APIs while still calling existing install routines for missing pieces.
