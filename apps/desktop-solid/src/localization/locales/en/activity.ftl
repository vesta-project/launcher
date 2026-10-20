# Browser-only activity simulator labels. Host task text is currently host-owned.
activity-fixture-install = Install instance
activity-fixture-background = Refreshing resource index
activity-fixture-step = Mods { $count }/{ $max }
activity-fixture-error = Download interrupted. Check your connection and retry.

activity-java-check = Checking Java runtimes
activity-metadata-refresh = Refreshing version metadata

# Titlebar status pill and activity panel.
activity-panel-title = Activity
activity-clear-finished = Clear finished
activity-empty = Nothing is running.
activity-background = Background
activity-installs = { $count ->
    [one] { $count } install
   *[other] { $count } installs
  }
activity-tasks = { $count ->
    [one] { $count } task
   *[other] { $count } tasks
  }
activity-ready = Ready
activity-queued = Queued
activity-working = Working…
activity-step-count = { $count }/{ $max }
activity-failed = Failed
activity-open = Open
activity-cancel = Cancel { $title }
activity-cancelled-ago = Cancelled · { $time }
activity-quiet-more = { $title } and { $count } more
# Accessible names and polite announcements; progress ticks are not announced.
activity-status-quiet = Working in the background: { $title }
activity-status-running = { $count ->
    [one] { $title } in progress
   *[other] { $count } tasks in progress
  }
activity-status-percent = { $label }, { $value } done
activity-status-success = { $title } is ready
activity-status-failed = { $title } failed
activity-status-ready-more = { $count ->
    [one] { $title } and { $count } other are ready
   *[other] { $title } and { $count } others are ready
  }
# Finished installs wait in the pill and panel until played or dismissed.
activity-ready-to-play = Ready to play
activity-play-ready = Play { $title }
activity-ready-dismiss = Dismiss { $title }

# Launcher self-update control.
activity-update-available = Download Vesta { $version }
activity-update-downloading = Downloading Vesta { $version }
activity-update-restart = Restart
activity-update-restart-label = Restart to update to Vesta { $version }

# Notification inbox.
activity-inbox-title = Notifications
activity-inbox-label = { $count ->
    [one] { $count } unread notification
   *[other] { $count } unread notifications
  }
activity-inbox-empty = You're all caught up.
activity-inbox-clear-all = Clear all
activity-inbox-dismiss = Dismiss

activity-action-unavailable = This action is not available in this version of the launcher.

activity-error-more = More
activity-error-less = Less

# Structured host task contract. Names are labels, never filesystem paths.
activity-kind-instance-install = Installing { $name }
activity-kind-modpack-install = Installing { $name }
activity-kind-modpack-update = Updating { $name }
activity-kind-modpack-export = Exporting { $name }
activity-kind-resource-install = Installing { $name }
activity-kind-java-download = Java { $name }
activity-kind-launcher-import = Importing { $name }
activity-kind-import-resync = Syncing resources for { $name }
activity-kind-resource-enrichment = Matching resources for { $name }
activity-kind-manifest-refresh = Refreshing game versions
activity-kind-profile-sync = Syncing profiles
activity-kind-instance-duplicate = Duplicating { $name }
activity-kind-instance-reset = Resetting { $name }
activity-kind-instance-repair = Repairing { $name }
activity-kind-instance-delete = Deleting { $name }
activity-kind-world-transfer = Copying { $name }
activity-kind-drop-apply = Adding resources to { $name }
activity-stage-preparing = Preparing
activity-stage-installing = Installing
activity-stage-downloading = Downloading
activity-stage-loading-metadata = Loading metadata
activity-stage-downloading-client = Downloading game client
activity-stage-downloading-assets = Downloading assets
activity-stage-downloading-libraries = Downloading libraries
activity-stage-running-processors = Running processors
activity-stage-installing-java = Setting up Java
activity-stage-analyzing = Analyzing archive
activity-stage-extracting = Extracting files
activity-stage-downloading-resources = Downloading resources
activity-stage-finalizing = Finalizing
activity-stage-verifying = Verifying
activity-stage-locating-files = Locating files
activity-stage-copying-files = Copying files
activity-stage-saving-records = Saving records
activity-stage-removing-files = Removing files
activity-stage-stopping-watcher = Stopping watcher
activity-stage-removing-records = Removing records
activity-stage-waiting-for-exit = Waiting for Minecraft to close
activity-stage-reconciling = Syncing resources
activity-stage-matching-resources = Matching resources
activity-stage-syncing-profiles = Syncing profiles
activity-stage-exporting = Exporting files
activity-stage-applying = Adding resources
activity-kind-world-move = Moving { $name }
activity-subject-instance = instance
activity-subject-world = world
activity-subject-resource = resource
activity-subject-java = runtime
activity-transfer-subtitle = { $source } → { $target }
activity-duplicate-subtitle = From { $name }
activity-stage-items = { $stage } · { $done }/{ $total }
activity-stage-items-done = { $stage } · { $done }
activity-stage-bytes = { $stage } · { $done } / { $total }
activity-stage-bytes-done = { $stage } · { $done }
activity-counter = { $done } / { $total }
activity-recent = Recent
activity-done-instance-install = Installed { $name }
activity-done-modpack-install = Installed { $name }
activity-done-modpack-update = Updated { $name }
activity-done-modpack-export = Exported { $name }
activity-done-resource-install = Installed { $name }
activity-done-java-download = Downloaded Java { $name }
activity-done-launcher-import = Imported { $name }
activity-done-import-resync = Synced resources for { $name }
activity-done-resource-enrichment = Matched resources for { $name }
activity-done-manifest-refresh = Refreshed game versions
activity-done-profile-sync = Synced profiles
activity-done-instance-duplicate = Duplicated { $name }
activity-done-instance-reset = Reset { $name }
activity-done-instance-repair = Repaired { $name }
activity-done-instance-delete = Deleted { $name }
activity-done-world-transfer = Copied { $name }
activity-done-world-move = Moved { $name }
activity-done-drop-apply = Added resources to { $name }
