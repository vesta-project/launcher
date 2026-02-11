# Desktop Shortcuts

Vesta Launcher provides cross-platform desktop shortcut creation, allowing users to create quick access links to instances, resources, and pages directly on their desktop. Shortcuts support custom icons, different launch modes, and platform-specific implementations.

## Overview

The shortcut system enables users to create desktop shortcuts that:
- Launch instances directly
- Open specific pages in the launcher
- Use branded icons with Vesta's logo overlay
- Work across Windows, macOS, and Linux

## Shortcut Types

### Launch Shortcuts
- **Purpose**: Directly launch a Minecraft instance without opening the launcher UI
- **Arguments**: `--launch-instance <instance-slug>`
- **Use Case**: Quick game launching from desktop

### Page Shortcuts
- **Purpose**: Open a specific page in the launcher
- **Arguments**: `--open-instance <instance-slug>` or `--open-resource <platform> <project-id>`
- **Use Case**: Quick access to frequently used instances or resources

## Platform Implementations

### Windows (.lnk files)

Windows shortcuts are created using PowerShell and the Windows Script Host:

```powershell
$WshShell = New-Object -ComObject WScript.Shell;
$Shortcut = $WshShell.CreateShortcut('path\to\shortcut.lnk');
$Shortcut.TargetPath = 'path\to\vesta-launcher.exe';
$Shortcut.Arguments = '--launch-instance vanilla-1-20-1';
$Shortcut.IconLocation = 'path\to\icon.ico,0';
$Shortcut.WorkingDirectory = 'path\to\launcher\directory';
$Shortcut.WindowStyle = 1;  # Normal window
$Shortcut.Save();
```

**Features:**
- Native Windows .lnk format
- Custom icon support
- Working directory specification
- Normal window style (not minimized/maximized)

### macOS (.inetloc files)

macOS uses Internet Location files that leverage Vesta's deep link system:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>URL</key>
    <string>vesta://launch-instance/vanilla-1-20-1</string>
</dict>
</plist>
```

**Features:**
- Converts CLI arguments to `vesta://` deep links
- Uses .inetloc (Internet Location) format
- Integrates with macOS URL handling

### Linux (.desktop files)

Linux uses freedesktop.org desktop entry specification:

```ini
[Desktop Entry]
Version=1.0
Type=Application
Name=Vesta Shortcut
Exec=/path/to/vesta-launcher --launch-instance vanilla-1-20-1
Icon=/path/to/icon.png
Terminal=false
Categories=Game;Launcher;
```

**Features:**
- Standard .desktop file format
- Executable permissions (0755)
- Proper categorization for desktop environments
- Icon support with fallback to application icon

## Icon Branding

### Automatic Branding Process

1. **Input Processing**: Accepts URLs, data URIs, or file paths
2. **Download/Cache**: Downloads remote images or loads local files
3. **Resize**: Scales base image to 256x256 pixels
4. **Overlay**: Adds Vesta logo (80x80) to bottom-right corner
5. **Format Conversion**: Converts to appropriate format (.ico for Windows, .png for others)
6. **Caching**: Stores processed icons in `app_cache_dir/shortcuts/`

### Icon Sources

- **Resource Icons**: From Modrinth/CurseForge project icons
- **Instance Icons**: Custom instance icons or defaults
- **Fallback**: Vesta application icon

### Caching Strategy

```rust
let cache_dir = app_handle.path().app_cache_dir()?.join("shortcuts");
let hash = calculate_hash(input_url);
let cached_path = cache_dir.join(format!("{}.branded.ico", hash));
```

**Benefits:**
- Avoids re-processing identical icons
- Reduces network requests
- Fast shortcut creation after first use

## API Integration

### Backend Command

```rust
#[command]
pub async fn create_desktop_shortcut(
    app_handle: AppHandle,
    mut name: String,
    target_args: String,
    icon_path: Option<String>,
) -> Result<(), String>
```

**Parameters:**
- `name`: Display name (sanitized for filesystem)
- `target_args`: CLI arguments (e.g., "--launch-instance slug")
- `icon_path`: URL, data URI, or file path for icon

### Frontend Usage

#### From Pinned Items
```typescript
const handleCreateShortcut = async (quickLaunch = false) => {
    const suffix = quickLaunch ? " (Launch)" : " (Open Page)";
    const name = pin.label + suffix;
    
    let args = "";
    if (pin.page_type === "instance") {
        args = quickLaunch 
            ? `--launch-instance ${pin.target_id}` 
            : `--open-instance ${pin.target_id}`;
    }
    
    await invoke("create_desktop_shortcut", {
        name,
        targetArgs: args,
        iconPath: pin.icon_url,
    });
};
```

#### From Page Options Menu
```typescript
const createShortcut = async (quickLaunch: boolean) => {
    const info = getCurrentPageInfo();
    const suffix = quickLaunch ? " (Launch)" : " (Open Page)";
    const name = info.label + suffix;
    
    let args = "";
    if (info.type === "instance") {
        args = quickLaunch 
            ? `--launch-instance ${info.id}` 
            : `--open-instance ${info.id}`;
    }
    
    await invoke("create_desktop_shortcut", {
        name,
        targetArgs: args,
        iconPath: info.icon,
    });
};
```

## CLI Argument Handling

### Supported Arguments

- `--launch-instance <slug>`: Launch instance directly
- `--open-instance <slug>`: Open instance page in launcher
- `--open-resource <platform> <id>`: Open resource details page

### Deep Link Conversion

For macOS, CLI arguments are converted to deep links:

```rust
let deep_link = if target_args.starts_with("--") {
    let parts: Vec<&str> = target_args.split_whitespace().collect();
    if parts.len() >= 2 {
        let action = parts[0].trim_start_matches("--");
        format!("vesta://{}/{}", action, parts[1])
    } else {
        format!("vesta://{}", parts[0].trim_start_matches("--"))
    }
} else {
    target_args.clone()
};
```

## User Interface

### Context Menus

Shortcuts can be created from:
- **Pinned Items**: Right-click context menu on sidebar pins
- **Page Options**: Titlebar menu (⋯) on instance/resource pages

### Menu Options

- **Create Shortcut (Open Page)**: Opens the page in launcher
- **Create Shortcut (Launch)**: Directly launches instance (instances only)

### Feedback

- **Success Toast**: "Shortcut Created - Added [Name] to your desktop"
- **Error Toast**: Shows specific error message
- **Validation**: Prevents duplicate names, sanitizes filenames

## Error Handling

### Common Issues

- **Permission Denied**: Cannot write to desktop directory
- **Invalid Paths**: Icon URLs that fail to download
- **Name Conflicts**: Automatic renaming for duplicates
- **Icon Processing**: Fallback to default icon on processing failure

### Platform-Specific Considerations

#### Windows
- PowerShell execution policy restrictions
- UAC prompts for desktop writes
- Long path name limitations

#### macOS
- Gatekeeper restrictions on unsigned applications
- Deep link registration requirements

#### Linux
- Desktop environment compatibility
- Icon theme integration
- File permission issues

## Security Considerations

### Input Sanitization
- **Name Cleaning**: Removes invalid filesystem characters `\/:*?"<>|`
- **Path Escaping**: Prevents command injection in PowerShell/scripts
- **URL Validation**: Basic validation for icon URLs

### Permission Model
- **Desktop Access**: Requires write access to user desktop
- **Icon Downloads**: Network access for remote icons
- **Cache Storage**: Local cache directory access

## Performance Optimization

### Icon Processing
- **Lazy Processing**: Icons processed only when needed
- **Caching**: Avoids re-downloading identical icons
- **Async Operations**: Non-blocking icon processing
- **Memory Limits**: Reasonable timeouts for downloads

### Shortcut Creation
- **Fast Path**: Local icons don't require network requests
- **Batch Operations**: Could be extended for multiple shortcuts
- **Error Recovery**: Continues with defaults on partial failures

## Future Enhancements

### Planned Features
- **Shortcut Management**: List, edit, and delete existing shortcuts
- **Custom Categories**: Organize shortcuts in folders
- **Advanced Icons**: Multiple icon sizes, animated icons
- **Shortcut Templates**: Predefined shortcut configurations
- **Cloud Sync**: Sync shortcuts across devices

### Technical Improvements
- **Better macOS Support**: True app aliases with arguments
- **Linux Integration**: Better desktop environment detection
- **Icon Optimization**: WebP support, better compression
- **Accessibility**: Screen reader support for shortcut creation