## Application actions, safety prompts, and notifications

action-external-setup-required-title = Setup Required
action-external-setup-required-description = Please complete the onboarding process before using 'Open in Vesta'.
action-external-auth-required-title = Authentication Required
action-external-auth-required-description = Please sign in to a valid account to use 'Open in Vesta'.
action-instance-not-found-title = Instance Not Found
action-instance-not-found-description = No instance found for "{ $slug }".
action-invalid-link-title = Invalid Link
action-invalid-link-description = The Vesta link you clicked is invalid or unsupported.

action-duplicate-instance-prompt-title = Duplicate Instance
action-duplicate-instance-prompt-description = Enter name for the copy:
action-duplicate-instance-default-name = { $instanceName } (Copy)
action-duplicate-instance-toast-title = Duplicating instance
action-duplicate-instance-toast-description = Creating copy as "{ $newName }"...
action-duplicate-instance-failed-title = Duplicate failed
action-repair-instance-confirm-title = Repair Instance
action-repair-instance-confirm-description = Are you sure you want to repair "{ $instanceName }"? This will re-verify all game files and modloader versions.
action-repair-started-title = Repair started
action-repair-started-description = Verifying game integrity...
action-repair-failed-title = Repair failed
action-hard-reset-confirm-title = Hard Reset
action-hard-reset-confirm-description = This will wipe the ENTIRE instance folder for "{ $instanceName }".

    All worlds, screenshots, and custom mods will be DELETED! This action cannot be undone.

    Are you absolutely sure?
action-hard-reset-confirm-ok = Hard Reset
action-hard-reset-started-title = Hard reset started
action-hard-reset-started-description = Wiping instance data and resetting to default...
action-reset-failed-title = Reset failed
action-uninstall-instance-confirm-title = Uninstall Instance
action-uninstall-instance-confirm-description = Are you sure you want to uninstall "{ $instanceName }"?

    This will permanently delete the instance and its files.
action-uninstall-instance-confirm-ok = Uninstall
action-uninstall-started-title = Uninstalling
action-uninstall-started-description = "{ $instanceName }" is being removed...
action-uninstall-failed-title = Uninstall failed
action-launch-failed-title = Launch failed

action-open-external-link-title = Open External Link
action-open-external-link-description = This link will open in your default web browser:

    { $url }

    Do you want to continue?
action-open-external-link-ok = Open Link
action-open-external-link-cancel = Stay in App

action-datapack-compatibility-confirm-title = Confirm datapack compatibility
action-datapack-versions-not-specified = Not specified by provider
action-datapack-versions-range = { $firstVersion }–{ $lastVersion } ({ $count } versions listed)
action-datapack-data-version = DataVersion { $dataVersion }
action-datapack-unknown-saved-version = Unknown saved version
action-datapack-compatibility-nearby-warning = This release does not explicitly list the target version, although it lists a nearby Minecraft release.
action-datapack-compatibility-unlisted-warning = This release does not explicitly list the target version.
action-datapack-compatibility-warning = Datapacks often work across nearby releases, but Vesta cannot verify this one.
action-datapack-compatibility-description = Project: { $projectName }
    Datapack release: { $releaseVersion }
    Provider-listed Minecraft versions: { $providerVersions }
    Target world: { $worldName }
    Target saved version: { $targetVersion }

    { $reason }
    { $closing }
action-datapack-compatibility-install-anyway = Install anyway
action-datapack-compatibility-choose-another = Choose another version

action-minecraft-version-update-warning = Updating this modpack will change the Minecraft version for "{ $instanceName }" from { $currentVersion } to { $nextVersion }.
action-minecraft-version-change-warning = Changing the Minecraft version for "{ $instanceName }" from { $currentVersion } to { $nextVersion }.
action-minecraft-version-world-warning = Existing worlds may become incompatible or unusable after this change.
action-minecraft-version-continue-question = Are you sure you want to continue?
action-minecraft-version-confirm-title = Change Minecraft Version?
action-minecraft-version-confirm-ok = Change Version
action-minecraft-version-confirm-description = { $action }

    { $worldWarning }

    { $question }

action-app-not-ready-title = App Not Ready
action-app-not-ready-description = Please wait for the app to fully load before navigating.
action-active-processes-title = Active Processes Detected
action-active-processes-description = The launcher is still performing some actions or games are running:

    { $processes }

    Closing now may cause issues.
action-active-processes-exit-anyway = Exit Anyway
action-active-processes-stay-open = Stay Open
action-safe-exit-failed-title = Unable to confirm safe exit
action-safe-exit-failed-description = Vesta couldn't validate running tasks right now, so the launcher will stay open.

action-crash-details = Details
action-load-minecraft-versions-failed = Failed to load Minecraft versions
