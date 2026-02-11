# System Tray

## Overview

Vesta Launcher includes system tray functionality to allow the application to run in the background and provide quick access to common actions. The tray icon enables minimizing to tray behavior and window restoration.

## Features

### Tray Icon Visibility

- **Configuration**: `show_tray_icon` boolean in app config
- **Default Value**: `true`
- **Purpose**: Controls whether the system tray icon is displayed
- **API**: `set_tray_icon_visibility()` command

### Minimize to Tray

- **Configuration**: `minimize_to_tray` boolean in app config
- **Default Value**: `false`
- **Purpose**: When enabled, minimizing the main window hides it to the system tray instead of the taskbar
- **API**: `set_minimize_to_tray()` command

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

**Current State**: The tray configuration and API commands are fully implemented. However, the actual tray icon creation in `setup.rs` is commented out and needs to be enabled.

**Blocked Features**:
- Tray icon display
- Tray menu with actions
- Minimize-to-tray window event handling

## Future Enhancements

### Planned Features

- **Tray Icon Setup**: Enable the commented tray icon builder in setup.rs
- **Tray Menu**: Context menu with options like:
  - Show/Hide window
  - Launch favorite instances
  - Check for updates
  - Exit application
- **Platform-Specific Behavior**: Different tray implementations for Windows, macOS, and Linux
- **Notifications**: Tray icon updates for background events (downloads complete, etc.)

### Technical Requirements

- Uncomment and complete the `TrayIconBuilder` setup in `src-tauri/src/setup.rs`
- Handle `WindowEvent::Minimized` for automatic tray minimization
- Add tray event handlers for menu actions

This system will provide better desktop integration and user experience for users who prefer background operation of the launcher.