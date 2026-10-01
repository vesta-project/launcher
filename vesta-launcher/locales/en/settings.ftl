# Settings navigation.
settings-tab-general = General
settings-tab-account = Account
settings-tab-appearance = Appearance
settings-tab-java = Java
settings-tab-notifications = Notifications
settings-tab-keyboard = Keyboard
settings-tab-sync = Sync
settings-tab-defaults = Defaults
settings-tab-developer = Developer
settings-tab-help = Help

settings-loading = Loading settings…
settings-general-loading = Loading General Settings…
settings-general-error = General settings could not be displayed.
settings-appearance-loading = Loading Appearance…
settings-java-loading = Loading Java Settings…
settings-keyboard-loading = Loading Keyboard Settings…
settings-developer-loading = Loading Developer Settings…
settings-generic-loading = Loading…
settings-tab-error = { $tab } settings could not be displayed.

# Language preference.
settings-language-change-failed = Language change failed
settings-language-change-failed-description = Vesta could not save the selected language. Your previous language is still active.
settings-language-card-title = Language & Region
settings-language-label = Launcher language
settings-language-description = Choose the language used by Vesta. System default follows your operating system when a matching translation is available.

# Instance defaults (Settings → Defaults).
settings-defaults-resolution-title = Resolution Defaults
settings-defaults-resolution-subheader = Default window size for new instances.
settings-defaults-game-window-label = Game Window
settings-defaults-game-window-description = Initial width and height for the game window.

settings-defaults-memory-title = Memory Defaults
settings-defaults-memory-subheader = Defaults used when creating new instances.
settings-defaults-memory-preferred-label = Preferred max memory
settings-defaults-memory-preferred-description = Used as the starting max memory when Vesta creates a new instance. Larger modpacks may get more automatically. (System Total: { $totalRam }GB)
settings-defaults-memory-warning = Warning: Allowing Minecraft to use this much memory may leave too little for the rest of the computer. Vesta recommends staying below { $recommended }.

settings-defaults-launcher-action-title = Launcher Behavior After Launch
settings-defaults-launcher-action-subheader = Choose what the launcher does once a game starts.

settings-defaults-java-args-title = Launch Arguments
settings-defaults-java-args-subheader = Global Java arguments applied to linked instances.

settings-defaults-env-title = Environment Variables
settings-defaults-env-subheader = Global environment variables for the game process. One per line (e.g. KEY=VALUE).

settings-defaults-hooks-title = Lifecycle Hooks
settings-defaults-hooks-subheader = Commands to run at different stages of the instance lifecycle.
settings-defaults-pre-launch-label = Pre-launch Command
settings-defaults-pre-launch-description = Runs before the game starts.
settings-defaults-wrapper-label = Wrapper Command
settings-defaults-wrapper-description = Wraps the Java process (e.g. mangohud, optirun).
settings-defaults-post-exit-label = Post-exit Command
settings-defaults-post-exit-description = Runs after the game process terminates.

settings-using-global-java-args = Currently using the Java arguments defined in global settings.
settings-using-global-resolution = Currently using the resolution defined in global settings.
settings-using-global-env = Currently using the environment variables defined in global settings.
settings-using-global-launcher-action = Currently using the launcher action defined in global settings.
settings-using-global-hooks = Currently using the lifecycle hooks defined in global settings.

settings-lifecycle-hooks-global-label = Use Global Life-cycle Hooks
settings-lifecycle-hooks-global-description = Link all hooks to the settings defined in your global profile.
settings-using-global-hooks-active = Currently using the pre-launch, wrapper, and post-exit hooks defined in global settings.
# Shared settings sync.
sync-bundle-title = Shared options
sync-edit = Edit { $category }
sync-enable-to-edit = Enable this category to edit shared values.
sync-instance-label = Sync with { $name }
sync-instances = Instances
sync-instances-hint = Instances that follow receive the shared values. Unsync to leave them as they are.
sync-linked = Instances linked: { $count }
sync-loading = Loading sync preferences…
sync-no-instances = No matching instances.
sync-no-options = No matching options.
sync-option-label = Sync { $option }
sync-scope-all = All settings
sync-search = Search instances
sync-servers-shared = Synced servers
sync-server-add-title = Add synced server
sync-server-remove = Remove { $server }
sync-server-empty = No synced servers.
sync-shared-entry-hint = Choose individual options and their shared values.
sync-shared-hint = Synced options are applied to every following instance. Other options stay local.
sync-shared-page-title = Shared game options
sync-source-hint = Used once to seed the shared starting values. After that, it is just another instance.
sync-source-title = Which instance is the owner?
sync-link-all-instances = Link all
sync-unlink-all-instances = Unlink all
sync-value-label = { $option } value
sync-value-missing = Not in the starting configuration
sync-keybinds-help = Keybinding controls
sync-keybinds-page-title = Shared keybindings
sync-keybinds-recording-help = Click a binding, then press a key or mouse button.


# Game option enum values are shared by the editor and synced-option controls.
game-options-key-change = Change binding for { $key }
game-options-key-empty = No game keybindings found.
game-options-key-help = Select a binding, then press a key or mouse button. Escape cancels; changes save automatically.
game-options-key-legacy = This older binding format is preserved. Change it in-game.
game-options-key-recording = Press a key…
game-options-key-unbound = Unbound
game-options-key-unsupported = This key is not supported. Try another key or press Escape to cancel.
game-options-key-cancelled = Recording cancelled.
game-options-key-cleared = Keybinding cleared.
game-options-description = Edit this instance’s game settings. Close the game before saving.
game-options-discard = Discard edits
game-options-save = Save game options
game-options-saving = Saving…
game-options-saved = Game options saved.
game-options-category = Category
game-options-count = { $count } edited
game-options-loading = Loading game options…
game-options-missing = No game options file yet. Saving creates it with only your edits.
game-options-unset = Not in file
game-options-empty-value = Enter a value before saving.
game-options-no-results = No matching game options.
game-options-fov = Field of view (degrees)
game-options-fullscreen = Fullscreen
game-options-view-bobbing = View bobbing
game-options-invert-mouse = Invert mouse
game-options-mouse-sensitivity = Mouse sensitivity
game-options-master-volume = Master volume
game-options-music-volume = Music volume
