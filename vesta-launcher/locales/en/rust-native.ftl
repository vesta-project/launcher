## Native Rust dialogs and notifications
rust-native-dialog-test-title = Backend Blocking Test
rust-native-dialog-test-description = This dialog was triggered by the backend! Do you want to continue?
rust-native-dialog-test-stop = No, Stop!
rust-native-dialog-test-proceed = Yes, Proceed
rust-native-select-java-executable = Select Java Executable

rust-native-launcher-updated-title = Vesta has been updated!
rust-native-launcher-updated-description = Welcome to version { $version }. Check out what's new in this release!

rust-native-interrupted-operation-title = Interrupted Operation Detected
rust-native-interrupted-operation-description = The { $operation } for '{ $instanceName }' was interrupted. Would you like to resume?
rust-native-resume-now = Resume Now
rust-native-modpack-update-restored-title = Modpack Update Restored
rust-native-modpack-update-restored-description = The interrupted update for '{ $instanceName }' was rolled back. The previous version is ready to play.
rust-native-modpack-update-completed-title = Modpack Update Completed
rust-native-modpack-update-completed-description = The completed update for '{ $instanceName }' was finalized after the launcher restarted.
rust-native-update-recovery-required-title = Update Recovery Required
rust-native-update-recovery-required-description = The previous version of '{ $instanceName }' could not be fully restored: { $error }

rust-native-update-completed-description = The completed update for '{ $instanceName }' was finalized successfully.
rust-native-previous-version-restored-title = Previous Version Restored
rust-native-failed-update-rolled-back-description = The failed update for '{ $instanceName }' was rolled back. The instance is ready to play.

rust-native-login-required-title = Login Required
rust-native-login-required-launch-description = You must be signed in with a Microsoft account to launch Minecraft. (Current: { $accountType })
rust-native-login-required-install-description = You must be signed in with a Microsoft account to install Minecraft. (Current: { $accountType })
rust-native-login-required-resource-description = You must be signed in with a Microsoft account to install mods or resources.
rust-native-offline-launch-title = Launching { $instanceName } (Offline)
rust-native-offline-launch-description = Started in offline mode. Multiplayer on authenticated servers will not be available.

rust-native-authentication-unavailable-title = Minecraft Authentication Unavailable
rust-native-authentication-unavailable-description = Vesta cannot reach Minecraft authentication services. Previously authenticated accounts can still launch offline.
rust-native-guest-mode-title = Guest Mode Active
rust-native-guest-mode-description = You are in guest mode. Changes will not be saved, and certain features are restricted.

rust-native-repairing-java-title = Repairing Java { $version }
rust-native-repairing-java-description = The managed Java installation was missing or corrupted. Downloading a fresh copy...
rust-native-java-repair-failed-title = Java { $version } repair failed
rust-native-java-reinstall-failed-description = Failed to reinstall managed Java: { $error }

rust-native-mojang-rate-limited-title = Mojang API Rate Limited
rust-native-mojang-rate-limited-description = { $operation } was rate-limited by Mojang. Please wait a moment and retry.
rust-native-window-effect-unavailable-title = Window effect unavailable on this OS
rust-native-window-effect-unavailable-description = The '{ $requestedEffect }' window effect is not supported on { $os }{ $versionSuffix }. Falling back to '{ $activeEffect}'.

rust-native-modpack-versions-restored-title = Modpack versions restored
rust-native-modpack-versions-restored-description = A modpack update supplied active versions for matching custom overrides, so Vesta disabled the custom copies:{ $lineBreak }{ $items }{ $suffix }
rust-native-modpack-versions-restored-suffix = …and { $remaining } more.
rust-native-profile-synced-title = Profile Synced
rust-native-profile-synced-description = Your Minecraft skin/cape was updated to match your Mojang profile.
rust-native-java-verification-failed = Java verification failed: executable not found or invalid at { $path }. Update your Java installation in Settings.

rust-native-new-minecraft-release-title = New Minecraft Release Available
rust-native-new-minecraft-release-description = Minecraft { $version } is now available for download!
rust-native-new-minecraft-snapshot-title = New Minecraft Snapshot Available
rust-native-new-minecraft-snapshot-description = Minecraft snapshot { $version } is now available for testing!
rust-native-new-resource-update-title = New Update: { $version }
rust-native-new-resource-update-description = A new version for { $project } has been released on { $platform }.
