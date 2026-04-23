# Tray and Close-To-Tray Guide (Tauri v2)

This guide documents the current Tauri v2 tray implementation and launcher behavior around close/launch actions.

## Runtime Behavior

- Tray icon is created during backend setup with a stable id (`main-tray`).
- Tray menu provides `Show`, `Hide`, and `Quit`.
- `Quit` does not immediately terminate the process; it emits `core://exit-requested` and follows guarded exit checks.
- Main-window close (`X`) is intercepted:
  - if `minimize_to_tray` and `show_tray_icon` are true, the window is hidden,
  - otherwise guarded exit flow is requested.

## Launch Action Policy

Global config field: `default_launcher_action_on_launch` (`stay-open` by default).

Per-instance override fields:
- `use_global_launcher_action`
- `launcher_action_on_launch`

Allowed actions:
- `stay-open`: leave launcher visible
- `minimize`: minimize launcher window
- `hide-to-tray`: hide launcher (fallback to minimize when tray is unavailable/hidden)
- `quit`: request guarded exit flow

## Platform Notes

- Linux tray icon click behavior is inconsistent across desktop environments; implementation is menu-first.
- Linux may require appindicator/ayatana-appindicator packages and GTK runtime dependencies.
- Windows has some tray title limitations depending on host shell behavior.
- macOS tray/menu bar icons should use menu-bar-friendly assets for readability.