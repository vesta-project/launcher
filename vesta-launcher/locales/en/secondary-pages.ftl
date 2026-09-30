# Fatal and invalid route pages.
secondary-fatal-title = Fatal Error
secondary-fatal-unknown = unknown
secondary-invalid-location = The location { $path } is not valid
secondary-not-found-description = This page doesn't exist.

# Changelog interface. Release notes themselves come from remote release data.
secondary-changelog-no-release-notes = No release notes available.
secondary-changelog-versions = Versions
secondary-changelog-whats-new = What's New
secondary-changelog-loading = Fetching latest updates...
secondary-changelog-error = Failed to load release notes. Please check your internet connection.
secondary-changelog-view-on-github = View on GitHub

# File drop test page.
secondary-file-drop-title = File Drop Test
secondary-file-drop-description = Test the file drop functionality by dragging files or folders onto the drop zones below.
secondary-file-drop-single-title = Single File Drop
secondary-file-drop-multiple-title = Multiple Files Drop
secondary-file-drop-folder-title = Folder Drop
secondary-file-drop-single-prompt = Drop a single file here
secondary-file-drop-multiple-prompt = Drop multiple files here
secondary-file-drop-folder-prompt = Drop a folder here
secondary-file-drop-files-only = Files only (no folders)
secondary-file-drop-folders-only = Folders only (no files)
secondary-file-drop-dropped-file = Dropped file:
secondary-file-drop-dropped-files = { $count ->
    [one] Dropped 1 file(s):
   *[other] Dropped { $count } file(s):
}
secondary-file-drop-folder-contents = { $count ->
    [one] Folder contents (1 item(s)):
   *[other] Folder contents ({ $count } item(s)):
}

# Modding guide. The technical help topics supplied by HELP_CONTENT remain in that source file.
secondary-modding-how-it-works = How Modding Works
secondary-modding-intro = Minecraft runs on a software called Java. Since the game wasn't originally designed to be modified, player-made additions (Mods) require a "Modloader" to help the game recognize and run them correctly.
secondary-modding-loader-connection = A Modloader connects player-made content to the game
secondary-modding-java-auto-install = Vesta automatically installs the version of Java the game needs
secondary-modding-mod-a = Mod A
secondary-modding-mod-b = Mod B
secondary-modding-mod-c = Mod C
secondary-modding-modloader = Modloader
secondary-modding-connecting-software = (Connecting Software)
secondary-modding-minecraft-base-game = Minecraft (Base Game)
secondary-modding-available-modloaders = Available Modloaders
secondary-modding-number-of-mods = Number of Mods
secondary-modding-unoptimized = Unoptimized
secondary-modding-vesta-optimized = Vesta Optimized
secondary-modding-workload = Workload
secondary-modding-performance-smoothness = Performance & Smoothness

# Notification test page and its sample notification content.
secondary-notification-test-info-title = Test Info
secondary-notification-test-info-message = This is an ephemeral info toast
secondary-notification-test-success-title = Test Success
secondary-notification-test-success-message = This is an ephemeral success toast
secondary-notification-test-warning-title = Test Warning
secondary-notification-test-warning-message = This is a persistent warning notification.
secondary-notification-test-error-title = Test Error
secondary-notification-test-error-message = This is a persistent error notification.
secondary-notification-test-pulsing-title = Pulsing Task
secondary-notification-test-pulsing-message = This task is doing something...
secondary-notification-test-progress-title = Progress Task
secondary-notification-test-progress-message = Downloading data...
secondary-notification-test-debug-disabled = This debug command is currently disabled in the backend.
secondary-notification-test-debug-title = Debug
secondary-notification-test-backend-result-title = Backend Result
secondary-notification-test-page-title = Notification System Test Page
secondary-notification-test-task-system = Task System
secondary-notification-test-submit-cancellable-task = Submit Cancellable Task (15s)
secondary-notification-test-ephemeral-section = Ephemeral Notifications (Toast Only)
secondary-notification-test-info-toast = Info Toast
secondary-notification-test-success-toast = Success Toast
secondary-notification-test-persistent-section = Persistent Notifications (Sidebar + Toast)
secondary-notification-test-warning-persistent = Warning (Persistent)
secondary-notification-test-error-persistent = Error (Persistent)
secondary-notification-test-progress-section = Progress Notifications
secondary-notification-test-pulsing-progress = Pulsing Progress (-1)
secondary-notification-test-progress-bar = Progress Bar (0-100)
secondary-notification-test-batch-section = Batch Operations
secondary-notification-test-send-multiple-toasts = Send Multiple Toasts
secondary-notification-test-debug-section = Debug
secondary-notification-test-check-tables = Check Tables
secondary-notification-test-rerun-migrations = Rerun Migrations
secondary-notification-test-backend-dialog = Test Backend Blocking Dialog
secondary-notification-test-how-to-test = How to Test:
secondary-notification-test-help-ephemeral-label = Ephemeral:
secondary-notification-test-help-ephemeral-description = Appear as toasts only, disappear after 5s
secondary-notification-test-help-persistent-label = Persistent:
secondary-notification-test-help-persistent-description = Appear in sidebar + toast, stay until dismissed
secondary-notification-test-help-pulsing-label = Pulsing:
secondary-notification-test-help-pulsing-description = Shows animated progress indicator (indeterminate)
secondary-notification-test-help-progress-bar-label = Progress Bar:
secondary-notification-test-help-progress-bar-description = Shows 0-100% with step counter
secondary-notification-test-help-bell-icon-label = Bell Icon:
secondary-notification-test-help-bell-icon-description = Shows spinner when tasks are active, badge when unread exist

# Help content used by the modding guide and related settings topics.
secondary-help-modloader-explained-title = Introduction to Modloaders
secondary-help-modloader-explained-description = A Modloader is a piece of software that allows Minecraft to recognize and run player-made additions (Mods). It acts as a link between the game and the extra files, making sure everything runs correctly together.
secondary-help-modloader-fabric-title = Fabric
secondary-help-modloader-fabric-description = A modern system for adding mods that focuses on being fast and efficient. It uses less of your computer's power compared to older systems and is usually very quick to support the latest game updates.
secondary-help-modloader-forge-title = Forge
secondary-help-modloader-forge-description = A well-established system for adding mods that supports a huge variety of complex changes. It provides creators with many tools to add large-scale features like new worlds, magic systems, and machinery.
secondary-help-modloader-neoforge-title = NeoForge
secondary-help-modloader-neoforge-description = A modernized version of the Forge system. Many creators use it to build stable mods that are better optimized for modern computer hardware while still allowing for very complex additions.
secondary-help-modloader-quilt-title = Quilt
secondary-help-modloader-quilt-description = A community-focused system that is designed to be very easy to use and improve. It works similarly to Fabric and is compatible with many of the same mods while offering extra useful tools.
secondary-help-modloader-vanilla-title = Vanilla (Normal)
secondary-help-modloader-vanilla-description = The official, standard version of Minecraft without any modifications. This is the simplest way to play, exactly as built by the game's developers.
secondary-help-java-managed-title = Java Runtime
secondary-help-java-managed-description = Java is the software that Minecraft runs on. Because different versions of the game need specific versions of Java to work correctly, Vesta automatically downloads and handles these for you. This prevents technical issues that usually occur when the wrong software version is used.
secondary-help-memory-allocation-title = Memory (RAM)
secondary-help-memory-allocation-description = This is the amount of temporary storage your computer sets aside for Minecraft to use while it's running. Using many mods requires more memory to prevent the game from freezing. Most modded games run well with 4GB to 6GB of memory.
secondary-help-modpack-memory-targets-title = Auto Memory
secondary-help-modpack-memory-targets-intro = Vesta chooses the selected max memory with this rule:
secondary-help-modpack-memory-targets-rule = max(default, suggested memory)
secondary-help-modpack-memory-targets-default-label = Default
secondary-help-modpack-memory-targets-default-description = is your starting max from Settings.
secondary-help-modpack-memory-targets-suggested-label = Suggested
secondary-help-modpack-memory-targets-suggested-description = is what the modpack appears to need.
secondary-help-modpack-memory-targets-warning = Vesta warns when the selected memory may leave too little for the rest of the computer.
secondary-help-jvm-args-title = Advanced Tuning
secondary-help-jvm-args-description = Special settings that change how Java handles the game's data. These are usually set automatically, but experts can tune them to improve performance on specialized computer hardware.
secondary-help-gradient-harmony-title = Color Matching
secondary-help-gradient-harmony-description = A system that automatically picks colors that look good together. It ensures your theme stays consistent and readable by following professional design principles.
secondary-help-minecraft-version-title = Game Versions
secondary-help-minecraft-version-description = 'Releases' are finished and stable versions of the game. 'Snapshots' are early versions for testing new features. For the most stable modding experience, you should usually use a Release version.
secondary-help-modpacks-concept-description = A Modpack is a collection of many different mods grouped into one easy package. Creators build and test these collections to ensure they work smoothly together as a single experience, allowing you to install complex mod sets with just one click.
secondary-help-guide-page-title = Knowledge Base
secondary-help-guide-page-description = A clear guide to help you understand modding concepts and your computer's requirements.
