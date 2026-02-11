# Self-Updater System

## Overview

Vesta Launcher features an integrated self-updater system powered by Tauri's updater plugin, enabling automatic detection, download, and installation of application updates.

## Configuration Options

### Update Settings

Stored in the application configuration:

- **`auto_update_enabled`**: Controls automatic download of available updates (default: `true`)
- **`startup_check_updates`**: Enables update checks on application startup (default: `true`)

### Configuration Schema

```sql
CREATE TABLE config (
    auto_update_enabled BOOLEAN NOT NULL,
    startup_check_updates BOOLEAN NOT NULL,
    -- ... other settings
);
```

## Update Workflow

### 1. Update Detection

- **Automatic**: Triggered 5 seconds after startup if `startup_check_updates` is enabled
- **Manual**: Via `checkForAppUpdates()` function call
- **API**: Uses Tauri's `check()` function to query the update server

### 2. Update Notification

- **Auto-Update Mode** (`auto_update_enabled: true`):
  - Shows toast notification
  - Automatically begins download

- **Manual Mode** (`auto_update_enabled: false`):
  - Shows patient notification with "Download" action button
  - User initiates download manually

### 3. Download Process

- Creates progress notification with download percentage
- Uses Tauri's `download()` API with event callbacks:
  - `"Started"`: Initializes content length tracking
  - `"Progress"`: Updates progress bar
  - `"Finished"`: Converts to installation-ready notification

### 4. Installation

- Displays "Install & Restart" button in patient notification
- Calls `update.install()` to apply changes and restart the application
- Shows installation toast during the process

## Frontend Implementation

### Core Functions

- **`initUpdateListener()`**: Sets up event listeners for update actions
- **`checkForAppUpdates(silent)`**: Performs update check with optional silent mode
- **`downloadUpdate()`**: Downloads the pending update with progress tracking

### Event Handling

Listens for backend-emitted events:
- `core://check-for-updates`: Initiates update check on startup
- `core://update-available`: Handles available update notifications
- `core://download-app-update`: Triggers download process
- `core://install-app-update`: Starts installation and restart

## User Interface

### Notifications

- **Toast Messages**: Brief status updates (available, downloading, errors)
- **Progress Notifications**: Download progress with percentage or indeterminate bar
- **Patient Notifications**: Completed downloads with action buttons

### Error Handling

- Network failures during check/download
- Installation errors
- User-friendly error messages via toast notifications

## Technical Architecture

### Dependencies

- `@tauri-apps/plugin-updater`: Cross-platform update functionality
- Tauri plugin initialized in `main.rs`

### State Management

```typescript
let pendingUpdate: Update | null = null;
let isDownloading: boolean = false;
let isChecking: boolean = false;
let isDownloaded: boolean = false;
```

### Progress Tracking

- Content length and downloaded bytes calculation
- Percentage progress updates
- Indeterminate progress for unknown sizes

## Platform Support

The updater works across all supported platforms (Windows, macOS, Linux) using Tauri's unified update mechanism.

## Security Considerations

- Updates are verified by Tauri's plugin before installation
- Only official update sources are queried
- User confirmation required for non-automatic updates

This system ensures Vesta Launcher stays current with the latest features, bug fixes, and security improvements.