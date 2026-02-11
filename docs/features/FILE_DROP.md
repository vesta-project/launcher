# File Drop System

Vesta Launcher features a sophisticated drag-and-drop system that allows users to drag files and folders from their file system directly into the application. The system provides visual feedback, file type filtering, and seamless integration with the launcher interface.

## Overview

The file drop system consists of three main components:
- **Sniffer Overlay**: Transparent window that captures drag events
- **Drop Zones**: UI components that accept and process dropped files
- **File Processing**: Backend logic for handling different file types

## Architecture

### Sniffer Overlay

The system uses a transparent overlay window that covers the main application window during drag operations:

```html
<!-- file-drop-overlay.html -->
<body style="background: transparent; pointer-events: none;">
<!-- Totally transparent but captures drag events -->
</body>
```

**Key Features:**
- **Transparent Window**: Invisible overlay that doesn't interfere with UI
- **Event Capture**: Intercepts drag events before they reach the main window
- **Cross-Platform**: Works on Windows, macOS, and Linux

### Drop Zone Components

Drop zones are UI components that provide visual feedback and handle file processing:

```tsx
<DropZone 
  onFileDrop={handleFiles} 
  accept="files" 
  allowedExtensions={[".jar", ".zip"]}
>
  <div>Drop files here</div>
</DropZone>
```

**Configuration Options:**
- **`accept`**: `"files" | "folders" | "all"` - Type of items to accept
- **`allowedExtensions`**: `string[]` - File extensions to filter (e.g., `[".jar", ".zip"]`)
- **`onFileDrop`**: `(files: string[]) => void` - Callback for dropped files

## Drag Detection Flow

### 1. Drag Initiation
When a user starts dragging files from their file system:

1. **Overlay Activation**: Transparent overlay window appears over the main window
2. **Event Listening**: Overlay captures `dragenter`, `dragover`, and `drop` events
3. **Path Sniffing**: Backend extracts file paths from drag operation

### 2. Visual Feedback
The system provides real-time visual feedback:

```typescript
// Drop zone highlights when compatible files are dragged over
const handleDragOver = (e: DragEvent) => {
    const paths = manager.getSniffedPaths();
    const filtered = manager.filterPaths(paths, props);
    
    if (filtered.length > 0) {
        e.dataTransfer.dropEffect = "copy";
        element.classList.add("drop-zone--active");
    } else {
        e.dataTransfer.dropEffect = "none";
        element.classList.remove("drop-zone--active");
    }
};
```

### 3. File Processing
When files are dropped:

1. **Path Filtering**: Apply accept criteria and extension filters
2. **Callback Execution**: Pass filtered file paths to handler function
3. **UI Reset**: Clear visual feedback and reset drag state

## File Type Handling

### Supported File Types

The system handles various file types with appropriate processing:

#### Mod Files (`.jar`)
- **Validation**: Check for valid JAR structure
- **Processing**: Extract metadata, check compatibility
- **Integration**: Add to instance's mods directory

#### Resource Packs (`.zip`)
- **Validation**: Verify pack format and contents
- **Processing**: Extract and validate assets
- **Integration**: Copy to resourcepacks directory

#### Data Packs (`.zip`)
- **Validation**: Check for data/structures
- **Processing**: Validate Minecraft version compatibility
- **Integration**: Install to datapacks directory

#### Configuration Files (`.json`, `.toml`, etc.)
- **Validation**: Parse and validate format
- **Processing**: Apply configuration changes
- **Integration**: Update instance settings

#### World Folders
- **Validation**: Check for level.dat and session.lock
- **Processing**: Verify world format and version
- **Integration**: Copy to saves directory

### Extension Filtering

Drop zones can restrict accepted file types:

```typescript
// Only accept JAR files
<DropZone accept="files" allowedExtensions={[".jar"]}>
  Drop mod files here
</DropZone>

// Accept any files
<DropZone accept="files">
  Drop any files here
</DropZone>

// Only accept folders
<DropZone accept="folders">
  Drop world folders here
</DropZone>
```

## Backend Integration

### Tauri Commands

The system provides several backend commands for overlay management:

#### `create_file_drop_overlay()`
Creates the transparent overlay window for drag detection.

#### `position_overlay(x, y, width, height)`
Positions the overlay to cover the main application window.

#### `show_overlay()` / `hide_overlay()`
Shows/hides the overlay window during drag operations.

#### `set_overlay_visual_state(state)`
Controls visual appearance of the overlay (used for debugging).

### Event System

The backend communicates with frontend through Tauri events:

```rust
// Send sniffed file paths to frontend
app_handle.emit("vesta://sniffed-file-drop", sniffed_paths)?;

// Request overlay hide from native side
app_handle.emit("vesta://hide-sniffer-request", ())?;
```

## User Experience

### Visual Feedback

#### Drop Zone States
- **Inactive**: Normal appearance
- **Active**: Highlighted when compatible files are dragged over
- **Rejected**: Different cursor when incompatible files are dragged

#### Cursor Changes
- **Copy Cursor**: Shows when files can be dropped
- **No-Drop Cursor**: Shows when files are incompatible

### Drag Session Management

The system manages drag sessions to prevent flickering and provide smooth UX:

```typescript
class DropZoneManager {
    private hasSniffedThisSession = false;
    private cooldownUntil = 0;
    
    // Prevent re-summoning overlay after successful sniff
    async showSniffer() {
        if (this.hasSniffedThisSession) return;
        if (Date.now() < this.cooldownUntil) return;
        // ... show overlay
    }
}
```

## Error Handling

### Common Issues

#### Permission Errors
- **File Access**: Handle cases where dragged files can't be read
- **Directory Access**: Check write permissions for target directories
- **Network Paths**: Handle UNC paths and network drives

#### File System Errors
- **Missing Files**: Handle cases where files are moved/deleted during drag
- **Locked Files**: Detect and report files that are in use
- **Path Length**: Handle Windows path length limitations

#### Processing Errors
- **Invalid Format**: Gracefully handle malformed files
- **Version Mismatch**: Report incompatible file versions
- **Corruption**: Detect and report corrupted archives

### Recovery Mechanisms

```typescript
const handleDrop = (e: DragEvent) => {
    try {
        const paths = manager.getSniffedPaths();
        const filtered = manager.filterPaths(paths, props);
        
        if (filtered.length > 0) {
            props.onFileDrop(filtered.map(p => p.path));
        }
    } catch (error) {
        console.error("File drop processing failed:", error);
        // Show user-friendly error message
    } finally {
        // Always reset UI state
        manager.clearSniffedPaths();
    }
};
```

## Performance Considerations

### Memory Management
- **Path Caching**: Cache sniffed paths during drag session
- **Lazy Processing**: Process files only when dropped
- **Cleanup**: Clear cached data after drop operation

### Event Optimization
- **Debouncing**: Prevent excessive event firing during drag
- **Batching**: Process multiple files efficiently
- **Async Processing**: Handle large file operations asynchronously

## Security Considerations

### Input Validation
- **Path Sanitization**: Validate and sanitize file paths
- **Extension Checking**: Prevent execution of unauthorized file types
- **Size Limits**: Implement reasonable file size limits

### Access Control
- **Permission Checks**: Verify access to dragged files
- **Sandboxing**: Process files in isolated context
- **Audit Logging**: Log file drop operations for security

## Platform-Specific Behavior

### Windows
- **Shell Integration**: Works with Windows Explorer drag operations
- **Path Formats**: Handles both short and long path formats
- **Permissions**: Respects Windows file permissions and UAC

### macOS
- **Finder Integration**: Compatible with Finder drag operations
- **Sandboxing**: Works within macOS app sandbox restrictions
- **Deep Links**: Can trigger deep link handling for certain file types

### Linux
- **File Manager Integration**: Works with Nautilus, Dolphin, etc.
- **Permissions**: Respects Linux file permissions and ownership
- **Desktop Environments**: Compatible with various DE implementations

## Future Enhancements

### Planned Features
- **Bulk Operations**: Handle large numbers of files efficiently
- **Progress Feedback**: Show progress for large file operations
- **Undo Support**: Allow users to undo file operations
- **Conflict Resolution**: Handle file conflicts during drop
- **Custom Processing**: Allow plugins to extend file type support

### Technical Improvements
- **WebAssembly**: Process files client-side for better performance
- **Streaming**: Handle large files without full memory load
- **Validation**: Enhanced file format validation
- **Metadata**: Extract and display file metadata before drop