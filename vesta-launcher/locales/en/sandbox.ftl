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
