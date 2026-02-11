# Pinning System

The Pinning system in Vesta Launcher allows users to pin frequently accessed pages (instances, resources, and settings) to the sidebar for quick access. This feature enhances navigation efficiency by keeping important items always visible.

## Overview

The pinning system provides persistent shortcuts in the sidebar that survive application restarts. Users can pin instances, resources, and settings pages, reorder them via drag-and-drop, and access quick actions like launching instances or creating desktop shortcuts.

## Supported Page Types

### Instance Pins
- **Type**: `"instance"`
- **Target**: Instance slug (e.g., `"vanilla-1-20-1"`)
- **Platform**: `null`
- **Features**: Quick launch/kill buttons, status indicators

### Resource Pins
- **Type**: `"resource"`
- **Target**: Project ID (e.g., `"fabric-api"`)
- **Platform**: `"modrinth"` or `"curseforge"`
- **Features**: Direct navigation to resource details

### Settings Pins
- **Type**: `"settings"`
- **Target**: `"general"` (currently only general settings supported)
- **Platform**: `null`
- **Features**: Quick access to configuration

## Database Schema

Pinned pages are stored in the `pinned_page` table in the Vesta database:

```sql
CREATE TABLE pinned_page (
    id INTEGER PRIMARY KEY,
    page_type TEXT NOT NULL,        -- "instance", "resource", or "settings"
    target_id TEXT NOT NULL,        -- slug, project_id, or settings key
    platform TEXT,                  -- "modrinth", "curseforge", or NULL
    label TEXT NOT NULL,            -- display name
    icon_url TEXT,                  -- icon URL for resources
    order_index INTEGER NOT NULL,   -- sort order (0-based)
    created_at TEXT                 -- ISO timestamp
);
```

### Key Fields
- **`page_type`**: Determines the pin behavior and navigation logic
- **`target_id`**: Unique identifier for the pinned item
- **`platform`**: Required for resource pins to specify the source platform
- **`order_index`**: Controls display order in the sidebar
- **`label`** & **`icon_url`**: UI display metadata

## Backend API

The pinning system provides CRUD operations through Tauri commands:

### Core Commands

#### `get_pinned_pages() -> Vec<PinnedPage>`
Retrieves all pinned pages ordered by `order_index`.

#### `add_pinned_page(new_pin: NewPinnedPage) -> PinnedPage`
Creates a new pinned page and returns the created record.

#### `remove_pinned_page(pin_id: i32) -> ()`
Deletes a pinned page by its ID.

#### `reorder_pinned_pages(pin_ids: Vec<i32>) -> ()`
Updates the `order_index` for multiple pins to reorder them.

### Data Structures

```rust
#[derive(Serialize, Deserialize)]
pub struct PinnedPage {
    pub id: i32,
    pub page_type: String,
    pub target_id: String,
    pub platform: Option<String>,
    pub label: String,
    pub icon_url: Option<String>,
    pub order_index: i32,
    pub created_at: Option<String>,
}

#[derive(Deserialize)]
pub struct NewPinnedPage {
    pub page_type: String,
    pub target_id: String,
    pub platform: Option<String>,
    pub label: String,
    pub icon_url: Option<String>,
    pub order_index: i32,
}
```

## Frontend Integration

### Pinning Store

The frontend uses a SolidJS store for state management:

```typescript
type PinningState = {
    pins: PinnedPage[];
    loading: boolean;
};

export const [pinningState, setPinningState] = createStore<PinningState>({
    pins: [],
    loading: false,
});
```

### Store Functions

#### `initializePinning()`
Loads pinned pages from the backend on application startup.

#### `pinPage(newPin: NewPinnedPage)`
Adds a new pin and updates the local state.

#### `unpinPage(pinId: number)`
Removes a pin and updates the local state.

#### `reorderPins(pinIds: number[])`
Reorders pins and syncs with the backend.

#### `isPinned(type: string, targetId: string)`
Helper function to check if an item is already pinned.

## Sidebar Integration

### Pin Display
Pinned items appear in the sidebar below the main navigation buttons but above the notifications/settings section:

```tsx
<Show when={pinning.pins.length > 0}>
    <div class={styles["sidebar__pins-container"]}>
        <Separator class={styles["pins-separator"]} />
        <div class={styles["sidebar__pins"]}>
            <For each={pinning.pins}>
                {(pin: PinnedPage) => <PinnedItem pin={pin} />}
            </For>
        </div>
    </div>
</Show>
```

### PinnedItem Component

Each pinned item is rendered as a `PinnedItem` component with:

- **Icon**: Resource icon or default instance icon
- **Label**: Display name of the pinned item
- **Status Indicators**: For instances (launching, running, crashed)
- **Quick Actions**: Launch/kill buttons for instances
- **Context Menu**: Additional actions (unpin, create shortcut)

### Instance-Specific Features

For instance pins, the component shows real-time status:

```tsx
const isLaunching = createMemo(() => instancesState.launchingIds[props.pin.target_id]);
const isRunning = createMemo(() => instancesState.runningIds[props.pin.target_id]);
const isCrashed = createMemo(() => instance()?.crashed);
```

## Pinning Actions

### Pinning from Pages

Users can pin items from their respective detail pages:

#### Instance Details
- Pin button in the instance details header
- Toggles between pin/unpin state
- Uses instance slug as target_id

#### Resource Details
- Pin button in resource details (planned feature)
- Stores project ID and platform information

### Context Menu

Right-clicking pinned items shows a context menu with:

- **Unpin**: Remove from sidebar
- **Create Shortcut**: Generate desktop shortcut
  - **Open Page**: Opens the pinned page
  - **Launch Instance**: Directly launches instance (instances only)

## Desktop Shortcuts

The pinning system integrates with desktop shortcut creation:

### Shortcut Types

#### Page Shortcuts
- **Command**: `--open-instance <slug>` or `--open-resource <platform> <id>`
- **Purpose**: Opens the specific page in Vesta Launcher

#### Launch Shortcuts
- **Command**: `--launch-instance <slug>`
- **Purpose**: Directly launches the Minecraft instance

### Implementation

```typescript
const handleCreateShortcut = async (quickLaunch = false) => {
    try {
        let args = "";
        const suffix = quickLaunch ? " (Launch)" : " (Open Page)";
        if (props.pin.page_type === "instance") {
            args = quickLaunch 
                ? `--launch-instance ${props.pin.target_id}` 
                : `--open-instance ${props.pin.target_id}`;
        } else {
            args = `--open-resource ${props.pin.platform} ${props.pin.target_id}`;
        }
        // Create shortcut with args...
    } catch (error) {
        // Handle error...
    }
};
```

## Drag and Drop Reordering

Users can reorder pinned items via drag and drop:

1. **Initiation**: User starts dragging a pinned item
2. **Visual Feedback**: Sidebar shows drop zones and highlights
3. **Reordering**: Items reorder in real-time during drag
4. **Persistence**: Order saved to database on drop

### Implementation Details

```typescript
const handleReorder = async (newOrder: PinnedPage[]) => {
    const pinIds = newOrder.map(pin => pin.id);
    await reorderPins(pinIds);
    // Local state updated automatically by reorderPins
};
```

## Performance Considerations

### Caching Strategy
- Pins loaded once on application startup
- Real-time updates for status changes (instance running/launching)
- No additional API calls for pin state checks

### Memory Management
- Pin data stored in SolidJS store (reactive)
- Automatic cleanup on component unmount
- Minimal memory footprint (typically <10 pins per user)

## Error Handling

### Backend Errors
- Database connection failures gracefully handled
- Invalid pin data logged and skipped
- Transaction rollbacks for reorder operations

### Frontend Errors
- Failed pin operations show user-friendly toasts
- Network errors don't crash the application
- Fallback to local state when backend unavailable

## Future Enhancements

### Planned Features
- **Resource Pinning**: Pin resources from browse/details pages
- **Pin Groups**: Organize pins into collapsible groups
- **Pin Search**: Quick search/filter within pinned items
- **Pin Import/Export**: Backup and restore pin configurations
- **Pin Analytics**: Usage statistics for pin optimization

### Technical Improvements
- **Bulk Operations**: Pin/unpin multiple items simultaneously
- **Pin Templates**: Predefined pin sets for common workflows
- **Pin Sharing**: Share pin configurations between users
- **Pin History**: Recently unpinned items for easy re-pinning