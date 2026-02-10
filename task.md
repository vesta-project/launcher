## Plan: Cross-Platform Page Pinning & Desktop Shortcuts

This plan implements a dynamic pinning system for the sidebar and a cross-platform desktop shortcut feature. It includes a robust CLI/Deep-Link handling system to support "Quick Launch" and "Open Page" functionality from outside the launcher.

### Phase 1: Database & Backend Models
1.  **Migration**: Create a new migration for the `vesta` database to add a `pinned_page` table.
    - `id` (Integer, PK)
    - `page_type` (Text: "instance" or "resource")
    - `target_id` (Text: instance slug or resource projectId)
    - `platform` (Nullable Text: e.g., "modrinth" for resources)
    - `label` (Text: Display name for the sidebar)
    - `icon_url` (Nullable Text)
    - `order_index` (Integer)
2.  **Rust Models**: Implement `PinnedPage` and `NewPinnedPage` in src-tauri/src/models/pinning.rs.
3.  **Commands**: Implement CRUD commands in src-tauri/src/commands/pinning.rs:
    - `get_pinned_pages`, `add_pin`, `remove_pin`, `reorder_pins`.

### Phase 2: Cross-Platform Shortcuts & CLI
1.  **Shortcut Command**: Implement `create_desktop_shortcut` in src-tauri/src/commands/shortcuts.rs.
    - **Windows**: Use `mslink` to create `.lnk` files with CLI arguments (e.g., `--launch-instance my-slug`).
    - **Linux**: Write `.desktop` files with `Exec=/path/to/exe --launch-instance my-slug`.
    - **macOS**: Use AppleScript (`osascript`) to create an alias using the custom protocol (e.g., `vesta://launch/my-slug`).
2.  **CLI/Protocol Handling**: 
    - In src-tauri/src/main.rs, update the `single-instance` plugin callback to capture CLI arguments and emit `core://handle-cli` to the frontend.
    - Update setup.rs to handle CLI arguments on initial cold boot.
3.  **Command arguments**:
    - `--launch-instance <slug>`
    - `--open-instance <slug>`
    - `--open-resource <platform> <id>`

### Phase 3: Frontend State & Navigation
1.  **Pinning Store**: Create src/stores/pinning.ts to manage the list of pinned items.
2.  **Instance Store Update**: Enhance src/stores/instances.ts to track a `launching_ids` set. Add `core://instance-launch-request` listener to mark an instance as "launching".
3.  **CLI Listener**: In src/app.tsx, listen for `core://handle-cli` and `core://handle-deep-link` to navigate to the correct page or trigger a launch.

### Phase 4: UI Implementation
1.  **Sidebar Pins**: Update src/components/pages/home/sidebar/sidebar.tsx to render pins.
    - **Status Indicator**: Use a pulsing green dot for `launching` state and a solid green dot for `launched` (running) state.
    - **Interaction**: On hover, show a "slide-out" play button for instances.
2.  **Titlebar Options**:
    - Create `PageOptionsMenu` in src/components/page-root/titlebar/titlebar.tsx.
    - Features: Toggle Pin, Add to Desktop (with sub-options for instances: "Open Page" vs "Quick Launch").
3.  **Context Menu**: Implement a right-click menu for sidebar pins to Unpin, Create Shortcut, or Launch.

### Phase 5: Icons & Assets
1.  Request SVG icons: `pin.svg`, `unpin.svg`, `desktop-shortcut.svg`, `ellipsis-h.svg` (for titlebar menu).

**Verification**
- **Windows**: Create a "Quick Launch" shortcut and verify it starts the game without manual navigation.
- **macOS/Linux**: Verify shortcuts/aliases correctly open the app to the specific instance page.
- **UI**: Ensure the status dot transitions correctly: None -> Pulsing (launching) -> Solid (running) -> None (exited).

**Decisions**
- Chose a separate table `pinned_page` to support pinning various page types (Instances vs. Remote Resources) without cluttering their respective tables.
- Chose a hybrid CLI/Deep-Link approach to ensure macOS support (via Deep Links) while respecting user's CLI preference for Windows/Linux.
- Chose to track `launching` state in the frontend store to bridge the gap between "Button Click" and "Process Started".