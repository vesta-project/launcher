# System Tray

## Overview

Vesta Launcher uses a Tauri v2 tray integration to keep the app available in the background, expose window controls, and support launch-time behavior automation.

## Features

### Tray Icon Visibility

- **Configuration**: `show_tray_icon` boolean in app config
- **Default Value**: `true`
- **Purpose**: Controls whether the system tray icon is displayed
- **API**: `set_tray_icon_visibility()` command

### Close Button Hides To Tray

- **Configuration**: `minimize_to_tray` boolean in app config
- **Default Value**: `false`
- **Purpose**: When enabled, clicking the main window close button hides the launcher to tray instead of triggering exit flow
- **API**: `set_minimize_to_tray()` command

### Launcher Action On Game Launch

- **Configuration**: `default_launcher_action_on_launch` in app config
- **Default Value**: `stay-open`
- **Allowed Values**: `stay-open`, `minimize`, `hide-to-tray`, `quit`
- **Per-instance Override**: `use_global_launcher_action` + `launcher_action_on_launch`
- **Quit Semantics**: routes through guarded exit flow (`core://exit-requested` + `exit_check`)

### Window Restoration

- **Function**: Restores the main window from tray and brings it to focus
- **API**: `show_window_from_tray()` command
- **Use Case**: Clicking tray icon or selecting "Show" from tray menu

## Configuration Storage

Tray settings are persisted in the application configuration:

```json
{
  "show_tray_icon": true,
  "minimize_to_tray": false
}
```

## Backend Implementation

### Commands

- `get_tray_settings()`: Retrieves current tray configuration
- `set_tray_icon_visibility(app, visible)`: Updates tray icon visibility setting
- `set_minimize_to_tray(app, enabled)`: Updates minimize-to-tray setting
- `show_window_from_tray(app)`: Shows and focuses the main window

### Data Structure

```rust
#[derive(serde::Serialize)]
pub struct TraySettings {
    pub show_tray_icon: bool,
    pub minimize_to_tray: bool,
}
```

## Implementation Status

**Current State**: Implemented.

- Tray is created at startup with stable id and menu actions (`Show`, `Hide`, `Quit`).
- Tray visibility is driven by persisted `show_tray_icon` and can be toggled at runtime.
- Main-window close behavior checks `minimize_to_tray` and `show_tray_icon` before deciding to hide or request guarded exit.
- Launch-time action policy is resolved from instance override (if enabled) or global default.

## Future Enhancements

### Platform Caveats

- **Linux**: menu-first behavior is required; tray click interactions are not relied on.
- **Linux Runtime Dependencies**: appindicator/ayatana-appindicator and GTK dependencies may be required by distro.
- **Windows**: tray title/tooltips may have platform limitations depending on shell behavior.
- **macOS**: use menu-bar-friendly tray icon assets for best readability.

### Technical Requirements

- Uncomment and complete the `TrayIconBuilder` setup in `src-tauri/src/setup.rs`
- Handle `WindowEvent::Minimized` for automatic tray minimization
- Add tray event handlers for menu actions

This system will provide better desktop integration and user experience for users who prefer background operation of the launcher.