# CLI Arguments and Deep Links

Vesta Launcher supports command-line arguments and deep link protocols for external integration, allowing other applications and websites to interact with the launcher. This enables features like "Open in Vesta" buttons on mod hosting sites and desktop shortcuts.

## Overview

The system provides two main integration methods:
- **CLI Arguments**: Direct command-line invocation with arguments
- **Deep Links**: URL-based protocol handling (vesta:// URLs)
- **Single Instance**: Ensures only one launcher instance runs, forwarding arguments to existing instance

## Single Instance Handling

Vesta uses Tauri's single instance plugin to ensure only one launcher window is open at a time:

```rust
.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
    // Focus existing window
    let _ = app.get_webview_window("main")
               .expect("no main window")
               .set_focus();
    
    // Forward CLI arguments to existing instance
    if args.len() > 1 {
        let _ = app.emit("core://handle-cli", args);
    }
}))
```

**Behavior:**
- If launcher is not running: Launches normally with provided arguments
- If launcher is running: Focuses existing window and forwards arguments
- Arguments are processed via `core://handle-cli` event

## CLI Arguments

### Supported Arguments

#### `--launch-instance <slug>`
Directly launches a Minecraft instance without opening the UI.

```bash
vesta-launcher.exe --launch-instance "vanilla-1-20-1"
```

**Processing:**
```typescript
if (arg === "--launch-instance" && args[i + 1]) {
    const slug = args[i + 1];
    const inst = instancesState.instances.find(inst => 
        inst.slug === slug || inst.name.toLowerCase().replace(/ /g, "-") === slug
    );
    if (inst) {
        setLaunching(slug, true);
        await invoke("launch_instance", { instanceData: inst });
    }
}
```

#### `--open-instance <slug>`
Opens the instance details page in the launcher.

```bash
vesta-launcher.exe --open-instance "vanilla-1-20-1"
```

**Processing:**
```typescript
if (arg === "--open-instance" && args[i + 1]) {
    const slug = args[i + 1];
    router()?.navigate("/instance", { slug });
    setPageViewerOpen(true);
}
```

#### `--open-resource <platform> <project-id>`
Opens the resource details page for a specific mod/resource.

```bash
vesta-launcher.exe --open-resource modrinth "fabric-api"
```

**Processing:**
```typescript
if (arg === "--open-resource" && args[i + 2]) {
    const platform = args[i + 1];
    const id = args[i + 2];
    router()?.navigate("/resource-details", { platform, projectId: id });
    setPageViewerOpen(true);
}
```

### Instance Slug Resolution

CLI arguments accept instance slugs in multiple formats:
- **Exact slug**: `vanilla-1-20-1`
- **Name-based**: `Vanilla 1.20.1` → `vanilla-1-20-1` (lowercase, spaces to hyphens)

```typescript
const inst = instancesState.instances.find(inst => 
    inst.slug === slug || inst.name.toLowerCase().replace(/ /g, "-") === slug
);
```

## Deep Link Protocol

### URL Format

Vesta supports `vesta://` protocol URLs for cross-application integration:

```
vesta://<action>?<parameters>
vesta://<action>/<path>?<parameters>
```

### Supported Actions

#### `install`
Opens the installation page with pre-filled parameters.

**Examples:**
```
vesta://install?version=1.20.1&modloader=fabric
vesta://install?projectId=fabric-api&platform=modrinth
```

**Processing:**
```rust
"install" => {
    Ok(DeepLinkMetadata {
        target: DeepLinkTarget::Install,
        params,
    })
}
```

#### `standalone`
Legacy action for resource handling, redirects based on type.

**Examples:**
```
vesta://standalone?type=modpack&projectId=skyfactory&platform=curseforge
vesta://standalone?type=mod&projectId=fabric-api&platform=modrinth
```

#### `open-resource`
Opens resource details page with platform and project ID.

**Examples:**
```
vesta://open-resource/modrinth/fabric-api
vesta://open-resource/curseforge/jei
```

**Processing:**
```rust
"open-resource" => {
    if segments.len() >= 2 {
        params.insert("platform".to_string(), segments[0].to_string());
        params.insert("projectId".to_string(), segments[1].to_string());
    }
    Ok(DeepLinkMetadata {
        target: DeepLinkTarget::ResourceDetails,
        params,
    })
}
```

### URL Parsing

Deep links are parsed using Rust's `url` crate:

```rust
#[tauri::command]
pub fn parse_vesta_url(url: String) -> Result<DeepLinkMetadata, String> {
    use url::Url;
    let parsed_url = Url::parse(&url)?;
    
    if parsed_url.scheme() != "vesta" {
        return Err("Invalid protocol".to_string());
    }
    
    let action = parsed_url.host_str().unwrap_or("");
    // Extract query parameters and path segments...
}
```

### Frontend Handling

Deep links are processed through the `handleDeepLink` function:

```typescript
async function handleDeepLink(url: string, navigate: ReturnType<typeof useNavigate>) {
    // 1. Check app initialization
    // 2. Check authentication
    // 3. Parse URL via backend
    const metadata = await invoke("parse_vesta_url", { url });
    
    // 4. Map to router paths
    let path = "";
    switch (metadata.target) {
        case "install": path = "/install"; break;
        case "resource-details": path = "/resource-details"; break;
    }
    
    // 5. Navigate to page
    router()?.navigate(path, metadata.params);
    setPageViewerOpen(true);
}
```

## Integration Examples

### Website Integration

Mod hosting sites can add "Open in Vesta" buttons:

```html
<!-- Mod page -->
<a href="vesta://open-resource/modrinth/fabric-api">
    <img src="open-in-vesta-button.png" alt="Open in Vesta">
</a>

<!-- Modpack page -->
<a href="vesta://install?projectId=skyfactory&platform=curseforge&type=modpack">
    Install with Vesta
</a>
```

### Desktop Shortcuts

Shortcuts created from pinned items use CLI arguments:

```typescript
const handleCreateShortcut = async (quickLaunch = false) => {
    let args = "";
    if (pin.page_type === "instance") {
        args = quickLaunch 
            ? `--launch-instance ${pin.target_id}` 
            : `--open-instance ${pin.target_id}`;
    } else {
        args = `--open-resource ${pin.platform} ${pin.target_id}`;
    }
    
    await invoke("create_desktop_shortcut", {
        name: pin.label,
        targetArgs: args,
        iconPath: pin.icon_url,
    });
};
```

### macOS Integration

On macOS, CLI arguments are converted to deep links for .inetloc files:

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

## Security Considerations

### Input Validation

- **Protocol Check**: Only `vesta://` URLs are accepted
- **Authentication Required**: Deep links require authenticated accounts (not guest mode)
- **App Initialization**: Links are rejected until setup is complete

```typescript
// Authentication check
const account = await getActiveAccount();
if (!account || account.account_type === ACCOUNT_TYPE_GUEST || account.is_expired) {
    showToast({
        title: "Authentication Required",
        description: "Please sign in to a valid account to use 'Open in Vesta'.",
        severity: "Error",
    });
    return;
}
```

### Parameter Sanitization

- **URL Parsing**: Uses Rust's `url` crate for safe parsing
- **Path Segments**: Validates and extracts path components
- **Query Parameters**: Sanitizes query parameter values

### Error Handling

- **Invalid URLs**: Clear error messages for malformed links
- **Unknown Actions**: Graceful fallback for unsupported actions
- **Missing Resources**: User-friendly messages for non-existent instances/resources

## Platform-Specific Behavior

### Windows
- **Protocol Registration**: `vesta://` URLs automatically open the launcher
- **Single Instance**: Arguments forwarded to existing instance
- **Focus Management**: Existing window is focused when new instance would open

### macOS
- **Deep Link Plugin**: Uses Tauri's deep link plugin for URL handling
- **Internet Location Files**: Desktop shortcuts use .inetloc format
- **App Focus**: Existing app instance is brought to foreground

### Linux
- **Desktop Integration**: Respects freedesktop.org standards
- **URL Handlers**: Registers as handler for `vesta://` protocol
- **Window Management**: Focuses existing window via window manager

## Future Enhancements

### Planned Features
- **Custom Actions**: Extensible action system for plugins
- **Parameter Validation**: Schema-based validation for link parameters
- **Link Previews**: Rich previews when hovering over vesta:// links
- **Bulk Operations**: Support for multiple resources in single link
- **Authentication Flow**: OAuth integration for external applications

### Technical Improvements
- **Link Shortening**: Short URL support for complex parameter sets
- **Link Analytics**: Usage tracking for integration optimization
- **Fallback Handling**: Graceful degradation when launcher isn't installed
- **Cross-Platform Testing**: Automated testing of deep link functionality