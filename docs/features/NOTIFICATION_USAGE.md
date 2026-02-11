# Notification System Usage Guide

## Overview
The notification system supports both **persistent** (stored in database) and **ephemeral** (toast-only) notifications with progress tracking.

## Backend API (Rust/Tauri)

### Creating a Persistent Notification
```rust
use crate::notifications::create_notification;
use crate::models::NotificationPayload;

// Error notification that persists in DB
let notif_id = create_notification(
    app.handle(),
    NotificationPayload {
        title: Some("Download Failed".to_string()),
        description: Some("Failed to download Minecraft 1.20.1".to_string()),
        severity: "error".to_string(),
        persist: true,  // Store in database
        progress: None,
        current_step: None,
        total_steps: None,
        client_key: Some("download_mc_1_20_1".to_string()),
        metadata: None,
    },
).await?;
```

### Creating a Progress Notification
```rust
// Start a task with indeterminate progress (pulsing animation)
let notif_id = create_notification(
    app.handle(),
    NotificationPayload {
        title: Some("Installing Mods".to_string()),
        description: Some("Downloading dependencies...".to_string()),
        severity: "info".to_string(),
        persist: false,  // Ephemeral (toast only)
        progress: Some(-1),  // -1 = pulsing animation
        current_step: None,
        total_steps: Some(5),
        client_key: Some("install_mods_pack_123".to_string()),
        metadata: None,
    },
).await?;

// Update progress with percentage
update_notification_progress(
    app.handle(),
    NotificationProgressPayload {
        id: None,
        client_key: Some("install_mods_pack_123".to_string()),
        progress: Some(45),  // 45%
        current_step: Some(2),
        total_steps: Some(5),
    },
).await?;

// Complete the task
update_notification_progress(
    app.handle(),
    NotificationProgressPayload {
        id: None,
        client_key: Some("install_mods_pack_123".to_string()),
        progress: Some(100),  // 100% = completed
        current_step: Some(5),
        total_steps: Some(5),
    },
).await?;
```

### Using Structured Logging
```rust
use crate::utils::logging::{info, warn, error, emit_notification};

// Simple logging
info("Application started");
warn("Low disk space detected");

// Log with automatic notification (for errors/warnings with persist=true)
emit_notification(
    app.handle(),
    log::Level::Error,
    "Database connection failed",
    Some("Unable to connect to database after 3 retries"),
    true,  // persist=true
    None,  // no progress
    None,  // no metadata
    Some("db_connection_error".to_string()),  // client_key for updates
).await;
```

## Frontend API (TypeScript/SolidJS)

### Importing
```typescript
import {
  createNotification,
  updateNotificationProgress,
  listNotifications,
  markNotificationRead,
  deleteNotification,
  cleanupNotifications,
  subscribeToBackendNotifications,
  type BackendNotification,
} from "@utils/notifications";
```

### Creating Notifications from Frontend
```typescript
// Create an error notification
const notifId = await createNotification({
  title: "Upload Failed",
  description: "Could not upload world save to server",
  severity: "error",
  persist: true,  // Store in database
  client_key: "upload_world_save",
});

// Create progress notification
const taskId = await createNotification({
  title: "Downloading Modpack",
  description: "Installing FTB Infinity Evolved",
  severity: "info",
  persist: false,  // Ephemeral toast
  progress: -1,  // Pulsing animation
  total_steps: 100,
  client_key: "download_modpack_ftb",
});

// Update progress
await updateNotificationProgress({
  client_key: "download_modpack_ftb",
  progress: 67,  // 67%
  current_step: 67,
});
```

### Listing and Managing Persistent Notifications
```typescript
// Get all unread notifications
const unreadNotifs = await listNotifications({ read: false });

// Get all error notifications
const errors = await listNotifications({ severity: "error" });

// Mark notification as read
await markNotificationRead(notifId);

// Delete a notification
await deleteNotification(notifId);

// Clean up old notifications (respects retention_days from AppConfig)
const cleanedCount = await cleanupNotifications();
console.log(`Cleaned up ${cleanedCount} expired notifications`);
```

### Event Listeners
Event listeners are automatically subscribed in `app.tsx`:
- `core://notification` - New/updated notifications
- `core://notification-progress` - Progress updates
- `core://notification-updated` - Read/delete events

## Configuration

### Database Settings (AppConfig)
```sql
-- Default: debug_logging = false, notification_retention_days = 30
UPDATE AppConfig SET debug_logging = 1 WHERE id = 1;  -- Enable debug logs
UPDATE AppConfig SET notification_retention_days = 60 WHERE id = 1;  -- 60-day retention
```

### Notification Behavior
- **Persistent notifications** (`persist=true`):
  - Stored in SQLite database
  - Shown in sidebar notifications panel
  - Can be marked as read or deleted
  - Automatically cleaned up after retention period
  - Ideal for: errors, warnings, important info

- **Ephemeral notifications** (`persist=false`):
  - Shown as toasts only (not stored)
  - Auto-dismiss after duration (default 5s)
  - Ideal for: success messages, progress updates, info

### Progress Values
- `progress = null` - No progress indicator
- `progress = -1` - Indeterminate/pulsing animation
- `progress = 0-100` - Percentage progress bar
- When `progress >= 100`, notification is considered complete

### Severity Colors
- `error` - Red (`#e74c3c`)
- `warning` - Yellow/Orange (`#f39c12`)
- `success` - Green (`#27ae60`)
- `info` - Blue (`#3498db`)

## Notification Types and Lifecycle

### Types
- **Immediate**: Toast-only notifications that appear instantly and auto-dismiss. Used for quick feedback like "Saved successfully".
- **Progress**: Active tasks with progress bars. Show pulsing animation (-1) or percentage (0-100). Convert to Patient when complete.
- **Patient**: Completed or passive notifications. Dismissible by user. Former Progress notifications become Patient at 100%.
- **Task**: Similar to Progress but for background operations. May have different UI treatment.

### Lifecycle
1. **Creation**: Notification created with initial state
2. **Updates**: Progress notifications updated via `client_key` until completion
3. **Completion**: Progress >= 100 converts to Patient (dismissible)
4. **Dismissal**: User can dismiss Patient notifications
5. **Cleanup**: Old notifications auto-deleted after retention period

### Type Transitions
- Progress → Patient (when progress >= 100)
- Immediate notifications never persist
- Task notifications may have special handling for background work

## UI Components

### Toast Notifications
Toasts automatically show:
- Severity-based colors
- Progress bars (0-100) or pulsing animation (-1)
- Step counters (e.g., "Step 3 of 5")
- Auto-dismiss for completed tasks

### Sidebar Notifications Panel
Shows persistent notifications with:
- Severity indicators (colored border + badge)
- Unread indicator (red dot)
- Progress bars for active tasks
- Mark as read button (✓)
- Delete button (×)

### Notification Bell Icon
Bell icon shows:
- **Spinner overlay** - Active tasks in progress (progress < 100 or progress = -1)
- **Badge with count** - Number of unread persistent notifications

## Backend Implementation Details

### NotificationManager
The `NotificationManager` handles all notification operations:
- Creates notifications with unique IDs
- Updates progress via `client_key` (prevents duplicates)
- Emits events to frontend (`core://notification`, `core://notification-progress`)
- Manages database persistence and cleanup

### Key Concepts
- **client_key**: Unique identifier for updatable notifications. Use for tasks that report progress.
- **persist**: Whether to store in database (true) or show as toast only (false)
- **progress**: -1 for pulsing, 0-100 for percentage, null for no progress
- **notification_type**: Determines UI behavior and lifecycle

### Event Flow
1. Backend creates/updates notification
2. Event emitted to frontend
3. Frontend updates UI state
4. Toast/sidebar reflects changes
5. Database updated if persistent

## Advanced Usage

```sql
CREATE TABLE Notification (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_key TEXT,
    title TEXT,
    description TEXT,
    severity TEXT NOT NULL,
    persist BOOLEAN NOT NULL,
    progress INTEGER,
    current_step INTEGER,
    total_steps INTEGER,
    read BOOLEAN NOT NULL DEFAULT 0,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT
);

CREATE INDEX idx_notification_client_key ON Notification(client_key);
CREATE INDEX idx_notification_created_at ON Notification(created_at);
CREATE INDEX idx_notification_read ON Notification(read);
```

## Example Workflows

### Long-Running Task with Progress
```rust
// 1. Start task
let client_key = "build_modpack_v2";
create_notification(app, NotificationPayload {
    title: Some("Building Modpack".to_string()),
    severity: "info".to_string(),
    persist: true,  // Keep in sidebar even after completion
    progress: Some(0),
    total_steps: Some(5),
    client_key: Some(client_key.to_string()),
    ..Default::default()
}).await?;

// 2. Update as you progress
for step in 1..=5 {
    // Do work...
    update_notification_progress(app, NotificationProgressPayload {
        client_key: Some(client_key.to_string()),
        progress: Some((step * 100) / 5),
        current_step: Some(step),
        total_steps: Some(5),
        ..Default::default()
    }).await?;
}

// 3. Mark complete (optional - 100% already indicates completion)
update_notification_progress(app, NotificationProgressPayload {
    client_key: Some(client_key.to_string()),
    progress: Some(100),
    ..Default::default()
}).await?;
```

### Error Notification with Retry
```rust
// Show persistent error
let notif_id = create_notification(app, NotificationPayload {
    title: Some("Download Failed".to_string()),
    description: Some("Click to retry".to_string()),
    severity: "error".to_string(),
    persist: true,
    client_key: Some("download_retry_123".to_string()),
    metadata: Some(json!({"retry_count": 1}).to_string()),
    ..Default::default()
}).await?;

// User can see this in sidebar and retry manually
```

## Best Practices

1. **Use `client_key`** for tasks that can be updated (progress, retries)
2. **Persist errors and warnings** (`persist=true`) so users can review them
3. **Use ephemeral toasts** for success/info messages that don't need review
4. **Set `total_steps`** when possible to show "Step X of Y"
5. **Clean up on startup** with `cleanupNotifications()` in app initialization
6. **Use structured logging** via `emit_notification()` for important events
7. **HTML sanitization** is automatic - no need to escape user input
8. **Test retention** - notifications auto-delete after `notification_retention_days`

## Future Enhancements (TODO)
- [ ] Replace basic HTML sanitization with `ammonia` crate
- [ ] Add notification sound/vibration support
- [ ] Add notification actions (buttons) in sidebar
- [ ] Realtime progress updates in sidebar (currently requires refresh)
- [ ] Notification grouping by type/severity
- [ ] Export notifications to file
