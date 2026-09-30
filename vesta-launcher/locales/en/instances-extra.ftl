# World datapacks. Provider names and version identifiers are supplied as data.
# Local is the display label for manual/local source types.
instances-extra-local = Local
instances-extra-local-pack = Local pack
instances-extra-world-datapacks-open-folder-failed = Could not open datapacks folder
instances-extra-world-datapacks-enable-failed = Could not enable datapack
instances-extra-world-datapacks-disable-failed = Could not disable datapack
instances-extra-world-datapack-remove-confirm-title = Remove { $name }?
instances-extra-world-datapack-remove-confirm-description = This removes the datapack from { $world }. A linked resource pack is removed only when no other world still references it.
instances-extra-world-datapack-remove-confirm-action = Remove datapack
instances-extra-world-datapack-companion-removed = Its linked resource pack was also removed.
instances-extra-world-datapack-companion-retained = Its linked resource pack was retained because Vesta could not prove it was unused.
instances-extra-world-datapack-removed-title = Datapack removed
instances-extra-world-datapack-removed-description = { $name } was removed from { $world }.
instances-extra-world-datapack-remove-failed = Could not remove datapack
instances-extra-world-datapack-update-started-title = Datapack update started
instances-extra-world-datapack-update-started-description = { $name } will update to { $version }.
instances-extra-world-datapack-update-failed = Could not update datapack
instances-extra-world-datapack-view-details = View details for { $name }
instances-extra-world-datapack-folder-pack = Folder pack
instances-extra-world-datapack-folder-read-only-title = Folder packs are read-only in Vesta
instances-extra-world-datapack-read-only = Read only
instances-extra-world-datapack-disable = Disable { $name }
instances-extra-world-datapack-enable = Enable { $name }
instances-extra-world-datapack-actions = Actions for { $name }
instances-extra-world-datapack-show-in-folder = Show in folder
instances-extra-world-datapack-remove-from-world = Remove from world
instances-extra-world-datapacks-world-label = Datapacks in { $world }
instances-extra-world-datapacks-back = Back to worlds
instances-extra-world-datapacks-folder = World folder
instances-extra-world-datapacks-size = World size
instances-extra-world-datapacks-last-played = Last played
instances-extra-world-datapacks-open-folder = Open datapacks folder
instances-extra-world-datapacks-refresh = Refresh datapacks
instances-extra-world-datapack-add = Add datapack
instances-extra-world-datapacks-loading = Loading datapacks…
instances-extra-world-datapacks-load-failed = Datapacks could not be loaded.
instances-extra-world-datapacks-empty-title = No datapacks yet
instances-extra-world-datapacks-empty-description = Add one from Modrinth, CurseForge, or another source.
instances-extra-world-datapacks-browse = Browse datapacks

# Screenshot gallery. Filenames and timestamps are dynamic data.
instances-extra-screenshot-copied-description = Screenshot copied to clipboard.
instances-extra-screenshot-copy-failed = Failed to copy screenshot.
instances-extra-screenshot-delete-confirm = Are you sure you want to delete { $name }?
instances-extra-screenshot-deleted-title = Deleted
instances-extra-screenshot-deleted-description = Screenshot removed.
instances-extra-screenshot-delete-failed = Failed to delete screenshot.
instances-extra-screenshots-title = Screenshots
instances-extra-screenshots-count = { $count ->
    [one] 1 files
   *[other] { $count } files
}
instances-extra-screenshots-sort-newest = Newest First
instances-extra-screenshots-sort-oldest = Oldest First
instances-extra-screenshots-refresh = Refresh screenshots
instances-extra-screenshots-loading = Loading screenshots…
instances-extra-screenshots-load-failed = Could not load screenshots.
instances-extra-screenshots-empty = No screenshots yet.
instances-extra-screenshots-copy-to-clipboard = Copy to Clipboard
instances-extra-screenshots-open-in-folder = Open in Folder

# Crash screen. Crash report content, resource names, and helper-generated reasons remain dynamic.
instances-extra-crash-status-disabled = Disabled
instances-extra-crash-status-missing = Missing
instances-extra-crash-browse-mods = Browse mods
instances-extra-crash-open-file-failed = Could not open file
instances-extra-crash-clear-failed = Could not clear crash
instances-extra-crash-mclogs-upload-failed = mclo.gs upload failed
instances-extra-crash-link-copied-title = Link copied
instances-extra-crash-link-copied-description = Crash log URL copied to clipboard
instances-extra-crash-copy-link-failed = Could not copy link
instances-extra-crash-share-log = Share log
instances-extra-crash-no-recent-crash = No recent crash
instances-extra-crash-instance-crashed = Instance crashed
instances-extra-crash-uploading = Uploading...
instances-extra-crash-copy-link = Copy link
instances-extra-crash-clear-crash = Clear Crash
instances-extra-crash-suspects = Suspects
instances-extra-crash-missing-dependencies = Missing dependencies
instances-extra-crash-affected-mods = Affected mods
instances-extra-crash-suggested-fixes = Suggested Fixes
instances-extra-crash-still-having-issues = Still having issues?
instances-extra-crash-ask-discord = Ask for help on Discord
instances-extra-crash-detection-notice = Crash detection is still in development and may be incomplete or wrong.
instances-extra-crash-report-problems = Report problems on Discord
instances-extra-crash-log-excerpt = Log excerpt
instances-extra-crash-empty-excerpt = No excerpt was captured for this crash. Use Open file or Logs below to inspect the full log.
instances-extra-crash-open-file = Open file
instances-extra-crash-logs = Logs

# Modpack version selector. Platform names, loader names, and version identifiers are data.
instances-extra-modpack-version-linked = Linked
instances-extra-modpack-version-unknown = unknown
instances-extra-modpack-version-search-placeholder = Search versions...
instances-extra-modpack-version-switch = Switch
instances-extra-overview-no-resources = No resources installed
instances-extra-resource-icon-alt = Resource Icon
instances-extra-resource-enabled = Enabled
instances-extra-crash-suggested-fix-default = Open the latest log and check the first error above the stack trace.
instances-extra-primary-action-starting = Starting…
instances-extra-primary-action-working = { $operation }…
instances-extra-primary-action-working-default = Working…
instances-extra-primary-action-resume-reset = Resume reset
instances-extra-primary-action-resume-repair = Resume repair
instances-extra-primary-action-resume-update = Resume update
instances-extra-primary-action-resume-install = Resume install
instances-extra-primary-action-retry-install = Retry install
instances-extra-primary-action-view-crash = View crash
instances-extra-resource-summary-installed = { $count } installed
instances-extra-resource-summary-ownership = { $bundled } bundled · { $custom } custom
instances-extra-resource-summary-updates = { $count ->
    [one] { $count } update
   *[other] { $count } updates
}

# Instance detail status, confirmation, and runtime option copy.
instances-extra-java-global-default = Global Default (Java { $version })
instances-extra-java-runtime-download = Not installed - Click to download and use
instances-extra-java-custom-path = Custom / Manual Path...
instances-extra-java-select-file = Select a specific file
instances-extra-unsaved-title = Unsaved Changes
instances-extra-unsaved-description = You have unsaved changes to this instance. Are you sure you want to leave without saving?
instances-extra-unsaved-leave = Leave
instances-extra-unsaved-stay = Stay
instances-extra-reset = Reset
instances-extra-saving = Saving...
instances-extra-world-selection-required = World selection required
instances-extra-world-selection-required-description = { $count ->
    [one] { $count } datapack update must be updated individually so you can confirm the target world.
   *[other] { $count } datapack updates must be updated individually so you can confirm the target world.
}
instances-extra-modpack-version-fallback = The previously selected modpack version is unavailable. Switched to the latest available version.
instances-extra-modpack-files-deleted = Modpack Files Deleted
instances-extra-modpack-files-deleted-description = Bundled modpack resources were removed and the instance was unlinked.
instances-extra-modpack-delete-failed-description = Vesta stopped before unlinking. Your custom resources were left intact.
instances-extra-update-check-failed = Update Check Failed
instances-extra-update-check-failed-description = Vesta could not check for updates right now.
instances-extra-resource-identification-failed = Resource Identification Failed
instances-extra-resource-identification-failed-description = Vesta could not identify this resource right now.
instances-extra-update-failed = Update failed
instances-extra-action-failed = Action Failed
instances-extra-delete-resources-title = Delete Resources
instances-extra-delete-selected-resources-confirm = Are you sure you want to delete { $count } selected resources?
instances-extra-delete-resource-title = Delete Resource
instances-extra-delete-resource-confirm = Are you sure you want to delete { $name }? This will remove the file from your instance.
instances-extra-delete-modpack-files-title = Delete Modpack Files?
instances-extra-delete-modpack-files-confirm = This will delete { $count } bundled modpack resources from this instance, keep custom resources and overrides, then unlink the modpack connection.
instances-extra-unlink-modpack-title = Unlink Modpack
instances-extra-unlink-modpack-confirm = Are you sure you want to unlink this instance from the modpack? You will no longer receive updates from the platform, but your files will remain intact.
instances-extra-switch-active-resource-title = Switch Active Resource?
instances-extra-switch-active-resource-confirm = { $name } matches { $peers } from the { $source }. Vesta will disable the other copy so Minecraft only loads one version.
instances-extra-save-changes = Save Changes
instances-extra-delete-modpack-files-action = Delete & Unlink
instances-extra-switch-active-resource-action = Switch
