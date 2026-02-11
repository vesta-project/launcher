# Tray and Minimize Functionality Guide

This guide covers the implementation of system tray integration and minimize-to-tray functionality in Vesta Launcher, providing a seamless background experience for users.

## Overview

System tray integration allows the launcher to:
- Run in the background when minimized
- Provide quick access to common actions
- Show status notifications
- Maintain presence without a visible window

## Tauri Implementation

### System Tray Setup

```rust
use tauri::{SystemTray, SystemTrayMenu, SystemTrayMenuItem, CustomMenuItem};

fn main() {
    let quit = CustomMenuItem::new("quit".to_string(), "Quit");
    let hide = CustomMenuItem::new("hide".to_string(), "Hide");
    let show = CustomMenuItem::new("show".to_string(), "Show");

    let tray_menu = SystemTrayMenu::new()
        .add_item(show)
        .add_item(hide)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(quit);

    let system_tray = SystemTray::new()
        .with_menu(tray_menu)
        .with_tooltip("Vesta Launcher");

    tauri::Builder::default()
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::MenuItemClick { id, .. } => {
                match id.as_str() {
                    "quit" => {
                        std::process::exit(0);
                    }
                    "hide" => {
                        let window = app.get_window("main").unwrap();
                        window.hide().unwrap();
                    }
                    "show" => {
                        let window = app.get_window("main").unwrap();
                        window.show().unwrap();
                        window.set_focus().unwrap();
                    }
                    _ => {}
                }
            }
            SystemTrayEvent::LeftClick { .. } => {
                let window = app.get_window("main").unwrap();
                window.show().unwrap();
                window.set_focus().unwrap();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Window Minimize Behavior

```rust
// In window event handler
tauri::WindowEvent::CloseRequested { api, .. } => {
    // Prevent actual close, minimize to tray instead
    api.prevent_close();
    let window = app.get_window("main").unwrap();
    window.hide().unwrap();
}
```

## Frontend Integration

### Tray State Management

```typescript
// stores/tray-store.ts
import { createStore } from "solid-js/store";

type TrayState = {
    visible: boolean;
    tooltip: string;
};

const [trayState, setTrayState] = createStore<TrayState>({
    visible: true,
    tooltip: "Vesta Launcher",
});

export { trayState, setTrayState };
```

### Minimize on Launch

```typescript
// In launch handler
export async function launchInstance(instance: Instance) {
    // ... existing launch logic ...

    // Minimize to tray after successful launch
    if (shouldMinimizeOnLaunch()) {
        await invoke("minimize_to_tray");
    }
}
```

## Configuration Options

### User Preferences

- `minimize_on_launch`: boolean - Whether to minimize when launching a game
- `show_tray_icon`: boolean - Whether to show the system tray icon
- `tray_tooltip`: string - Custom tooltip text
- `close_to_tray`: boolean - Whether closing the window minimizes to tray

### Platform-Specific Behavior

#### Windows
- Uses Windows system tray
- Supports custom icons
- Integrates with Windows notifications

#### macOS
- Uses macOS menu bar
- Supports dark/light mode icons
- Follows macOS human interface guidelines

#### Linux
- Uses X11/AppIndicator or StatusNotifierItem
- Fallback to basic tray if not supported

## Menu Items

### Standard Menu
- **Show/Hide**: Toggle main window visibility
- **Launch Game**: Quick launch last played instance
- **Check Updates**: Manual update check
- **Settings**: Open settings window
- **Quit**: Exit the application

### Dynamic Items
- **Running Instances**: List currently running games with stop options
- **Recent Instances**: Quick access to recently played instances

## Notifications Integration

### Tray Icon Updates
- Change icon to indicate running games
- Show progress in tooltip
- Animate icon for active downloads/installs

### System Notifications
- Launch success/failure alerts
- Update availability notifications
- Game crash notifications

## Best Practices

### User Experience
- Always provide a way to restore the window from tray
- Use consistent iconography
- Respect system theme preferences
- Avoid excessive notifications

### Performance
- Minimize tray operations to prevent UI lag
- Cache tray menu state
- Use efficient event handling

### Accessibility
- Support keyboard navigation for tray menus
- Provide screen reader support
- Respect high contrast settings

## Troubleshooting

### Common Issues
- **Tray not appearing**: Check system tray settings, ensure icon is not hidden
- **Minimize not working**: Verify window event handlers are properly set
- **Menu not responding**: Check for event handler conflicts

### Platform-Specific Fixes
- **Windows**: Ensure app has tray permissions
- **macOS**: Check menu bar settings
- **Linux**: Verify tray protocol support

## Future Enhancements

- **Custom tray icons** for different game states
- **Tray-based instance management**
- **Integration with system notifications**
- **Multi-instance tray menus**