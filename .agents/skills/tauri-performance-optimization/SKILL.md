---
name: tauri-performance-optimization
description: Best practices and guidelines for optimizing the performance of Tauri applications. Use this skill when the user asks to improve the performance, reduce the bundle size, or optimize the Rust/Frontend code of a Tauri app.
---

# Tauri Performance Optimization Guide

Tauri applications generally offer excellent performance due to using native webviews and Rust. However, achieving maximum efficiency requires optimizing the Frontend, the Rust backend, the Inter-Process Communication (IPC), and the build configurations.

## 1. General Optimization Strategies
- **Measure Before Optimizing:** Always profile first. Use `cargo-bloat` to identify what takes up space in the Rust binary, `cargo-expand` for macros, and `rollup-plugin-visualizer` to analyze the frontend bundle size. Use Chrome DevTools to detect memory leaks in the frontend.
- **Leverage Platform-Specific Code:** Remember that Tauri uses different webviews (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux). You might need to add platform-specific handling or Polyfills for older targets.
- **Window Management:** Explicitly close and clean up windows. Use `window.close().unwrap()` and listen to the `on_window_close` event to free up memory on both the Rust and Javascript sides.

## 2. Frontend (Webview) Optimizations
- **Minimize Bundle Size:** Keep dependencies to a minimum. Use lightweight alternatives to bulky libraries (e.g., date-fns instead of moment.js).
- **Asset Offloading:** Don't bundle large static files (videos, massive images, heavy translation files) if you don't need to. Fetch them dynamically from the internet, or read them from the local file system via Tauri's `fs` module to save frontend RAM.
- **Avoid Heavy CSS & Animations:** Continuous CSS animations (`backdrop-blur`, box-shadows over animations) can trigger constant repaints on webviews. Keep CSS transitions efficient.
- **Garbage Collection:** Ensure you don't keep references hanging in the global scope `window` object to allow the webview to garbage-collect properly.

## 3. Rust Backend Optimizations
- **Efficient IPC (Inter-Process Communication):** 
  - **Minimize Calls:** Sending data between the Webview and Rust via `invoke` is heavily serialized via JSON (using `serde`). This adds overhead. Batch multiple requests together if possible.
  - **Do NOT Send Large Files via IPC:** Don't pass large image buffers or videos through `invoke`. Instead, write them to a local file in Rust and pass the *path* to the frontend, letting the webview load the file natively using `convertFileSrc`.
- **Concurrency for Heavy Tasks:**
  - If you have CPU-heavy Rust logic inside a Tauri command, DO NOT block the main thread. It will freeze the app. Wrap it in `tauri::async_runtime::spawn_blocking`.
  - Use worker pools like `rayon` or `tokio` for massive parallel data processing.
- **Memory Management:** Be careful with `.clone()`. Use smart pointers like `Arc` or `Rc` to share data across different Tauri commands and threads without unnecessary allocations.

## 4. Build-Time Configuration (Cargo.toml)
To reduce the final executable size and maximize runtime performance, update the `[profile.release]` section in `src-tauri/Cargo.toml`:

```toml
[profile.release]
panic = "abort" # Strip expensive panic clean-up logic
codegen-units = 1 # Compile crates one after another so the compiler can optimize better
lto = true # Enables link to optimizations
opt-level = "s" # Optimize for binary size. ("3" if you prefer maximum speed over size)
strip = true # Automatically strip symbols from the binary
```

## 5. Tauri Config Optimizations (tauri.conf.json)
- **Strict Allowlist:** In `tauri.conf.json`, only enable the specific Tauri APIs (file system, dialog, shell) that you actually use. Disabled APIs will be removed from the compiled binary, saving space.
- **Asset Compression:** Tauri compresses embedded assets (HTML, CSS, JS) with Brotli. If your frontend bundle is already extremely small, turning off Brotli compression might theoretically reduce the startup time, though usually, leaving it on is better for binary size.

## 6. Development Workflow
To speed up the local development loop:
- **Use the LLD Linker:** Set `RUSTFLAGS="-C link-arg=-fuse-ld=lld"` for noticeably faster Rust compilation times on Windows and Linux.
- **Target App Separation:** Ensure your Rust analyzer uses a different target directory than `tauri dev` to prevent file-locking crashes.
