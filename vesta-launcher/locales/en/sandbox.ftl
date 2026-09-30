# Sandbox policy presets and capability chips (Settings → Defaults / Instance settings).
# Wire these in sandbox-policy-ui.tsx and sandbox-host.ts on the sandboxing branch.

sandbox-preset-trusted = Trusted
sandbox-preset-modded = Modded
sandbox-preset-paranoid = Paranoid

sandbox-capability-none = No sandbox enforcement
sandbox-capability-enforced = Sandbox enforced
sandbox-capability-files-restricted = Files restricted
sandbox-capability-network-allowed = Network allowed
sandbox-capability-network-blocked = Network blocked
sandbox-capability-mic-allowed = Microphone allowed
sandbox-capability-mic-blocked = Microphone blocked
sandbox-capability-strict = Strict sandbox

sandbox-host-notice-fallback = Modded and Paranoid sandbox presets cannot be enforced on this system.
sandbox-host-notice-linux-paranoid-audio = On Linux, Paranoid blocks microphone access by also disabling game audio playback.
sandbox-unavailable-title = Sandbox unavailable
sandbox-unavailable-fallback = Sandbox enforcement is unavailable on this system.

# Instance / defaults settings cards (when sandbox UI is merged).
sandbox-settings-defaults-title = Sandbox Defaults
sandbox-settings-defaults-subheader = Default sandbox preset and extra paths for new instances.
sandbox-settings-instance-title = Sandbox Policy
sandbox-settings-instance-subheader = OS sandbox preset for this instance when launched.
sandbox-settings-preset-label = Sandbox preset
sandbox-settings-wrapper-nesting-label = Wrapper nesting
sandbox-settings-extra-paths-label = Extra filesystem paths
sandbox-settings-extra-paths-description = Additional read-write paths granted inside the sandbox (one per line).

sandbox-wrapper-sandbox-outside = Sandbox outside wrapper
sandbox-wrapper-wrapper-outside = Wrapper outside sandbox

# Sandbox controls in instance and default settings.
sandbox-settings-card-title = Sandbox
sandbox-settings-defaults-card-subheader = Default OS sandbox policy for new instances.
sandbox-settings-preset-option-label = Preset
sandbox-settings-preset-option-description = Capability profile applied at launch.
sandbox-settings-wrapper-inclusion-label = Include wrapper in the sandbox
sandbox-settings-wrapper-inclusion-description = When enabled, the wrapper runs inside the game sandbox. When disabled, the wrapper runs outside the sandbox with your normal user access.
sandbox-settings-extra-folders-label = Extra read-write folders
sandbox-settings-extra-folders-description = The game may read from and write to these folders in addition to its instance folder.
sandbox-settings-add-default-folder = Add read-write folder…
sandbox-settings-no-extra-default-folders = No extra read-write folders.
sandbox-settings-use-global-preset = Use Global Preset
sandbox-settings-global-preset-description = Link preset and wrapper inclusion only. Extra read-write folders stay instance-editable.
sandbox-settings-add-instance-folder = Add instance-only folder…
sandbox-settings-no-instance-folders = No instance-only folders.
