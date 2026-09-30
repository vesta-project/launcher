# Instance and modpack installation flow.
install-page-analyzing-modpack = Analyzing modpack details...
install-page-unknown-modpack = Unknown Modpack
install-page-new-resource-instance-label = New instance with { $resourceType }
install-page-create-resource-instance = Create a new instance with { $resourceName } installed.
install-page-create-clean-slate = Create a clean slate and customize it.
install-page-loading-installing-modpack = Installing modpack...
install-page-loading-creating-instance = Creating instance...
install-page-loading-reading-manifest = Reading modpack manifest...
install-page-loading-reading-root-manifest = Reading the root modpack manifest...
install-page-loading-matching-source = Matching online source...
install-page-loading-could-not-read = Could not read modpack
install-page-loading-fetching-details = Fetching modpack details...
install-page-loading-preparing-instance = Preparing instance...
install-page-loading-installing-resource = Installing { $resourceName } after the instance is created.
install-page-loading-applying-configuration = Creating files and applying the selected configuration.
install-page-resource-fallback = the selected resource
install-page-back-to-browser = Back to Browser
install-page-change-import = Change import

install-import-page-description = Select a launcher path, rescan detected instances, then import one.
install-import-launcher-path-placeholder = Detected launcher instances path
install-import-open-game-directory-title = Open game directory in file manager
install-import-no-instances = No instances found for the selected launcher and path.
install-import-methods-title = Import instance
install-import-methods-description = Choose how you want to bring in a modpack or existing instance.
install-import-local-file = Local file
install-import-archive-types = Upload a .zip or .mrpack
install-import-browse-modpacks = Browse modpacks
install-import-search-platforms = Search Modrinth & CurseForge
install-import-from-launcher = Import from launcher
install-import-launcher-examples = Prism, CurseForge, GDLauncher, and more
install-import-enter-url = Enter a modpack URL.
install-import-url-scheme-error = URL must start with http:// or https://
install-import-url-placeholder = https://…
install-import-back-aria = Back to import methods
install-import-from-url = From URL
install-import-paste-url-description = Paste a Modrinth, CurseForge, or direct link
install-import-choose-launcher-description = Choose which launcher you want to import from.

# Install form fields and status copy.
install-form-counting = Counting...
install-form-local-upload = Local upload
install-form-modpack-fallback = Modpack
install-form-pack-version = Pack Version
install-form-project-id = Project ID
install-form-version-id = Version ID
install-form-manual-memory-reason = Manually set for this instance.
install-form-memory-high-modpack-below = Set below the modpack suggestion to leave memory for the system. This pack may struggle.
install-form-memory-high-modpack = Using the modpack's recommendation. This is high for this device.
install-form-memory-high-suggested-below = Set below the suggested memory to leave room for the system. This pack may struggle.
install-form-memory-high-raised = Raised for this modpack. This is high for this device.
install-form-memory-high-default = Using your default max. This is high for this device.
install-form-memory-modpack = Using the modpack's recommended memory.
install-form-memory-raised-count = Raised for this modpack based on { $count } { $count ->
    [one] resource.
   *[other] resources.
}
install-form-memory-raised = Raised for this modpack.
install-form-memory-default = Using your default max for new instances.
install-form-latest = Latest
install-form-loader-version-picker-aria = Loader Version Picker
install-form-memory-title = Memory
install-form-hide-controls = Hide controls
install-form-selected-max = Selected max
install-form-memory-warning-description = Allowing Minecraft to use this much memory may leave too little for the rest of the computer.
install-form-instance-identity = Instance Identity
install-form-instance-name-placeholder = My Instance
install-form-fetching-versions = Fetching available versions...
install-form-no-other-versions = No other versions available for this platform.
install-form-modpack-configuration = Modpack Configuration
install-form-release-version = Release Version
install-form-loading-version = Loading version...
install-form-select-version = Select version...
install-form-modpack-version-selection-aria = Modpack Version Selection
install-form-minecraft = Minecraft
install-form-loading = Loading...
install-form-game-options = Game Options
install-form-pick-version = Pick a version...
install-form-include-snapshots = Include Snapshots
install-form-compatibility-adjusted = Compatibility Adjusted
install-form-memory-min = min
install-form-memory-max = max

# Launcher import details panel.
# Short display label for screenshots in the imported instance summary.
install-import-shots = Shots
install-import-last-played = Last Played
install-import-source = Source
install-importing = Importing...
install-import-selected = Import Selected
install-import-no-metadata-modpack = Could not read this modpack.
install-import-fetching-project-details = Fetching project and version details...
install-import-cached-project-details-message = Using cached project details while online metadata is unavailable.
install-import-cached-project-details-toast = Using the project details already loaded from Browse.
install-import-details-limited-title = Modpack Details Limited
install-import-metadata-sync-failed-title = Metadata Sync Failed
install-import-metadata-sync-failed-description = Could not read modpack metadata from the provided source. Check your selection.
install-import-resource-pack = Resource Pack
install-import-resource-data-pack = Data Pack
install-page-resource-shader = Shader
install-page-resource-world = World

install-submit-version-loading-title = Modpack Version Still Loading
install-submit-version-loading-description = Wait for a version to finish loading, then try installing again.
install-submit-resource-started-title = Resource Installation Started
install-submit-resource-started-description = { $projectName } will be installed into { $instanceName }.
install-submit-world-first-title = Create and play a world first
install-submit-world-first-description = { $instanceName } is ready. Launch Minecraft and play a world, then add { $projectName } from that world's datapack view.
install-submit-instance-fallback = the new instance
install-submit-new-instance-fallback = Your new instance

install-import-detection-failed-title = Instance Detection Failed
install-import-roots-title = Select { $launcherName } data root
install-import-multiple-roots = Multiple data roots were detected. Choose the one you want to use:
install-import-queued-title = Import Queued
install-import-queued-description = The import task is queued and will start when a worker is available.
install-import-failed-title = Import Failed

install-versions-sync-failed-title = Version Sync Failed
install-versions-sync-failed-description = Could not load modpack versions right now. You can still continue and retry shortly.
install-versions-updated-title = Version Updated
install-versions-updated-description = The selected modpack version is no longer available. Switched to the latest available version.

install-dialog-started-description = Installing { $instanceName }... Check notifications for progress.
install-dialog-failed-title = Installation Failed
install-dialog-configure-description = Configure your new instance for this modpack.
install-dialog-analyzing = Analyzing modpack...
