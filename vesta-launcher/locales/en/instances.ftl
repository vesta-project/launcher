# Instance library operation labels.
instances-operation-installing = Installing
instances-operation-updating = Updating
instances-operation-repairing = Repairing
instances-operation-resetting = Resetting
instances-operation-importing = Importing
instances-installation-failed = Installation failed

# Instance settings tab — metadata.
instances-settings-name-placeholder = Instance Name
instances-settings-metadata-description = Choose an icon and a name for this instance. These will be visible in your library.

# Java configuration.
instances-settings-java-title = Java Configuration
instances-settings-java-executable-label = Java Executable
instances-settings-java-executable-description = The Java runtime used to launch this instance.
instances-settings-java-path-placeholder = Path to java executable
instances-settings-java-args-label = Java Arguments
instances-settings-java-args-description = Custom JVM arguments for this instance.

# Memory.
instances-settings-memory-title = Memory Management
instances-settings-memory-allocation-label = Allocation Range
instances-settings-memory-allocation-description = Set the minimum and maximum RAM for the game. (System Total: { $totalRam }GB)
instances-settings-memory-min-label = Min (-Xms):
instances-settings-memory-max-label = Max (-Xmx):
instances-settings-memory-low-system-warning = This leaves little memory for the system and other apps.

# Resolution.
instances-settings-resolution-title = Resolution
instances-settings-resolution-window-label = Game Window
instances-settings-resolution-window-description = Set the initial width and height of the Minecraft window.

# Environment.
instances-settings-env-title = Environment Variables
instances-settings-env-variables-label = Variables
instances-settings-env-variables-description = Custom environment variables for the game process. One per line (e.g. KEY=VALUE).

# Launcher action.
instances-settings-launcher-action-title = Launcher Action On Game Launch
instances-settings-launcher-action-behavior-label = Behavior After Launch
instances-settings-launcher-action-behavior-description = Set how the launcher should behave after this instance starts.

# Lifecycle hooks.
instances-settings-hooks-title = Life-cycle Hooks
instances-settings-pre-launch-label = Pre-launch Hook
instances-settings-pre-launch-description = Command to run before the game starts. (e.g. a script to sync worlds)
instances-settings-wrapper-label = Wrapper Command
instances-settings-wrapper-description = Execute the game through a wrapper (e.g. mangohud, optirun, or a debugger).
instances-settings-post-exit-label = Post-exit Hook
instances-settings-post-exit-description = Command to run after the game closes.

# Maintenance.
instances-settings-maintenance-title = Maintenance
instances-settings-export-label = Export Instance
instances-settings-export-description = Pack this instance into a file for sharing or backup.
instances-settings-export-action = Export…
instances-settings-duplicate-label = Duplicate Instance
instances-settings-duplicate-description = Create an exact clone of this instance.
instances-settings-duplicate-action = Duplicate
instances-settings-repair-modpack-label = Repair Files
instances-settings-repair-instance-label = Repair Instance
instances-settings-repair-description = Verify instance files and re-download anything missing.
instances-settings-repair-action = Repair

# Danger zone.
instances-settings-danger-title = Danger Zone
instances-settings-reset-label = Reset Instance
instances-settings-reset-description = Reinstall from scratch and permanently delete worlds, configs, and screenshots.
instances-settings-reset-action = Reset
instances-settings-delete-label = Delete Instance
instances-settings-delete-description = Remove this instance and all its files. This action is permanent and irreversible.
instances-settings-delete-action = Delete

# Versioning tab.
instances-versioning-linked-modpack-title = Linked Modpack
instances-versioning-linked-modpack-subheader = Update the pack as one source, or unlink to manage everything manually.
instances-versioning-core-config-title = Core Configuration
instances-versioning-core-config-subheader = Define the Minecraft version and modloader for this instance.
instances-versioning-modloader-label = Modloader
instances-versioning-modloader-description = Choose between Vanilla, Forge, Fabric, or others.
instances-versioning-mc-version-label = Minecraft Version
instances-versioning-mc-version-description = The base version of the game to run.
instances-versioning-show-snapshots = Show Snapshots
instances-versioning-mc-version-placeholder = Select version…
instances-versioning-version-picker-aria = Version Picker
instances-versioning-loader-version-label = Loader Version
instances-versioning-loader-version-description = Specific version of the selected modloader.
instances-versioning-loader-version-placeholder = Select loader version…
instances-versioning-experimental-badge = Experimental
instances-versioning-loader-version-aria = Loader Version Selection
instances-versioning-switch-engine = Switch Engine
instances-versioning-connection-title = Connection
instances-versioning-connection-subheader = Control the relationship between this instance and its modpack source.
instances-versioning-unlink-label = Unlink Connection
instances-versioning-unlink-description = Disconnect from the source to manage files manually. This is irreversible.
instances-versioning-unlink-action = Unlink
instances-versioning-delete-unlink-label = Delete Bundled Files & Unlink
instances-versioning-delete-unlink-description = Remove only the bundled modpack files, keep custom resources and overrides, then disconnect the modpack source.
instances-versioning-delete-unlink-action = Delete & Unlink

# Instance details — sidebar navigation.
instances-details-tab-overview = Overview
instances-details-tab-resources = Resources
instances-details-tab-worlds = Worlds
instances-details-tab-console = Console
instances-details-tab-crash = Crash
instances-details-tab-version = Version
instances-details-tab-settings = Settings
instances-details-tab-loading = Loading { $tab }…

# Instance details — page states.
instances-details-load-error = Failed to load instance: { $error }
instances-details-no-data = No instance data available.
instances-details-no-slug = No slug provided.
instances-details-slug-label = (Slug: { $slug })
instances-details-back-home = Back to Home

# Instance details — header.
instances-details-header-played = Played { $time }
instances-details-header-never-played = Never played
instances-details-header-playtime-total = { $hours }h { $minutes }m total
instances-details-header-manage-modpack = Manage linked modpack
instances-details-header-open-folder = Open instance folder
instances-details-header-pin = Pin instance
instances-details-header-unpin = Unpin instance
instances-details-header-update-recovery = Update recovery required
instances-details-header-update-recovery-description = The previous version could not be fully restored
instances-details-header-install-failed-default = The instance could not be installed.
instances-details-header-show-error-details = Show error details
instances-details-header-requested-resource = the requested resource
instances-details-modloader-vanilla = Vanilla

# Instance details — console tab.
instances-details-console-live = LIVE
instances-details-console-search-placeholder = Search logs…
instances-details-console-open-logs-folder = Open logs folder
instances-details-console-follow-live = Follow live
instances-details-console-follow-live-aria = Follow live output
instances-details-console-follow-live-tooltip = Return to the live console output
instances-details-console-log-history = Log History
instances-details-console-select-log-file = Select Log File
instances-details-console-clear-view = Clear console view
instances-details-console-no-matching-logs = No matching logs
instances-details-console-no-matching-logs-description = Try adjusting your search query or filter levels.
instances-details-console-clear-search = Clear Search
instances-details-console-reset-filters = Reset Filters
instances-details-console-waiting = Waiting for game output…
instances-details-console-waiting-description = The console will display logs once the game starts producing output.
instances-details-console-no-logs = No logs to display
instances-details-console-no-logs-description = Launch the instance to see game output here.
instances-details-console-open-logs-folder-action = Open Logs Folder
instances-details-console-jump-top = Jump to Top
instances-details-console-jump-bottom = Jump to Bottom

# Instance details — resources tab.
instances-details-resources-filter-all = All
instances-details-resources-filter-mods = Mods
instances-details-resources-filter-packs = Packs
instances-details-resources-filter-shaders = Shaders
instances-details-resources-search-placeholder = Search resources…
instances-details-resources-check-updates = Check for available updates
instances-details-resources-add = Add resources
instances-details-resources-clear-selection = Clear Selection
instances-details-resources-selected-count = { $count } resources selected
instances-details-resources-update-selected = Update ({ $count })
instances-details-resources-update-selected-tooltip = Update { $count } selected
instances-details-resources-delete-selected = Delete Selected
instances-details-resources-delete-selected-tooltip = Delete selected
instances-details-resources-linked-modpack = Linked modpack
instances-details-resources-update-available = Update available
instances-details-resources-current-version = Current
instances-details-resources-manage-versions = Manage versions
instances-details-resources-unlink = Unlink
instances-details-resources-delete-unlink = Delete & unlink
instances-details-resources-bundled-count = { $count } bundled { $type }
instances-details-resources-type-resources = resources
instances-details-resources-empty = No { $type } found.

# Worlds tab.
instances-worlds-title = Worlds
instances-worlds-section-aria = Worlds
instances-worlds-sort-recency = Recently played
instances-worlds-sort-name = Name
instances-worlds-sort-size = Size
instances-worlds-sort-aria = Sort worlds
instances-worlds-layout-aria = World layout
instances-worlds-view-grid = Grid view
instances-worlds-view-compact = Compact view
instances-worlds-refresh = Refresh worlds
instances-worlds-loading = Finding worlds…
instances-worlds-load-error = Worlds could not be loaded: { $error }
instances-worlds-empty = No Java worlds found. Create and play a world in Minecraft and it will appear here.

instances-worlds-action-open-folder = Open folder
instances-worlds-action-manage-datapacks = Manage datapacks
instances-worlds-action-move = Move to another instance…
instances-worlds-action-copy = Copy to another instance…
instances-worlds-action-delete = Delete world…

instances-worlds-status-unreadable = Unreadable
instances-worlds-view-datapacks-aria = View datapacks in { $name }
instances-worlds-name-with-folder = { $displayName } ({ $folderName })
instances-worlds-last-played = Last played { $date }
instances-worlds-size = World size { $size }
instances-worlds-datapack-count-aria = { $count } datapacks
instances-worlds-actions-aria = Actions for { $name }

instances-worlds-transfer-compat-title-move = Move with compatibility differences?
instances-worlds-transfer-compat-title-copy = Copy with compatibility differences?
instances-worlds-transfer-compat-title-duplicate = Duplicate with compatibility differences?
instances-worlds-transfer-confirm-move = Move world
instances-worlds-transfer-confirm-copy = Copy world
instances-worlds-transfer-confirm-duplicate = Duplicate world
instances-worlds-transfer-started-move = Move started
instances-worlds-transfer-started-copy = Copy started
instances-worlds-transfer-started-duplicate = Duplicate started
instances-worlds-transfer-started-description = Progress is available in notifications.
instances-worlds-transfer-failed = World transfer failed

instances-worlds-delete-title = Delete { $name }?
instances-worlds-delete-description = This permanently deletes the world folder from { $instanceName }. This cannot be undone.
instances-worlds-delete-confirm = Delete world
instances-worlds-deleted-title = World deleted
instances-worlds-deleted-description = { $name } was removed from { $instanceName }.
instances-worlds-delete-failed = Could not delete world

instances-worlds-transfer-dialog-title-move = Move { $name }
instances-worlds-transfer-dialog-title-copy = Copy { $name }
instances-worlds-transfer-dialog-fallback-name = world
instances-worlds-transfer-dialog-description = Choose a destination instance. Existing worlds are never overwritten or merged.
instances-worlds-transfer-dialog-empty = No other instances are available for this transfer.
