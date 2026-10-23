# Vesta Launcher frontend (Solid 2)

This directory holds the new Solid 2 client and its own Tauri 2 application in `src-tauri/`. Both the rewrite and the existing launcher have separate Tauri entrypoints, configurations, app identifiers, and development outputs. The rewrite backend imports the existing Rust backend as a shared library, so launcher commands and services continue to come from the maintained Rust implementation.

Install and run the web client from this directory:

```sh
bun install
bun dev
```

Vite binds to `http://localhost:1430` and fails if that port is already occupied. To run the frontend inside the rewrite's Tauri application, use:

```sh
bun run tauri:dev
```

`bun run tauri dev` is an equivalent alias and now uses the same wrapper, profile
and Rust output. The wrapper invokes the installed CLI directly, without another
package-script hop. Avoid mixing a direct `bunx tauri dev` session with these
commands: it bypasses the configured build/profile isolation.

Vite can become ready before Rust finishes compiling. An older native window may
reconnect to that frontend while the new native binary is still building. Closing
a window may hide it to the tray according to your settings; use Quit to exit an
old instance. Stop the complete dev session with Ctrl+C rather than killing just
a compiler process. The wrapper does not forcibly terminate unrelated or already
running launcher instances.

The native command uses the independent configuration at `src-tauri/tauri.conf.json`. The new app has its own capabilities and frontend hooks while reusing the old Rust backend as a path dependency. Local updater artifacts are disabled so development builds do not need release signing keys. Rust build output is isolated under `.tauri-target/` in this directory.

The rewrite uses the `Vesta Launcher Rewrite` product name and `com.vesta.launcher.rewrite` identifier. Native dev uses a fresh `.dev-profile/` data directory unless `VESTA_DEV_PROFILE_DIR` is already set. The Rust profile override is debug-only; release builds continue using the existing profile behavior until pre-release data handling is planned.

Build the static client and native application with:

```sh
bun run build
bun run tauri:build
```

The static client is emitted to `dist/client`. The new frontend imports native APIs from `@tauri-apps/api`; launcher commands and services are provided by the shared Rust backend library.
