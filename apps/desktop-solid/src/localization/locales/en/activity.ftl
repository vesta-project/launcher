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
activity-installed-ago = Installed · { $time }
activity-finished-ago = Finished · { $time }
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
activity-inbox-dismiss = Dismiss { $title }
