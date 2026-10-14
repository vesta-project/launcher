# Vesta Launcher frontend (Solid 2)

This directory holds the new Solid 2 client. It reuses the existing Rust/Tauri project in `vesta-launcher/src-tauri`; it does not create a second native backend.

Install and run the web client from this directory:

```sh
bun install
bun dev
```

Vite binds to `http://localhost:1430` and fails if that port is already occupied. To run the same frontend inside the existing Tauri application, use:

```sh
bun run tauri:dev
```

The native command selects the overlay at `apps/desktop-solid/tauri.conf.json`. Tauri merges it with the existing `vesta-launcher/src-tauri/tauri.conf.json`, keeping the existing version, capabilities, plugins, and Rust backend while overriding the frontend hooks, dev URL, static asset directory, and fixture identity. Updater artifacts are disabled for this development fixture, so local builds do not need release signing keys. Rust build output is isolated under `.tauri-target/` in this directory.

The overlay gives this rewrite fixture a separate `Vesta Launcher (Rewrite)` product name and `com.vesta.launcher.rewrite` identifier. Native dev uses a fresh `.dev-profile/` data directory unless `VESTA_DEV_PROFILE_DIR` is already set. The Rust profile override is debug-only; release builds continue using the existing profile behavior.

Build the static client and native application with:

```sh
bun run build
bun run tauri:build
```

The static client is emitted to `dist/client`. The new frontend imports native APIs from `@tauri-apps/api`; command coverage and launch behavior remain owned by the existing Rust application.
