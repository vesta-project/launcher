# Remote Vesta server management.
nav-servers = Servers
prefs-general-servers-in-rail = Show Servers in the sidebar
prefs-general-servers-in-rail-description = Adds a sidebar shortcut to the servers you manage. When hidden, open Servers from the Library button's right-click menu; pinned servers stay in the sidebar.

servers-title = Servers
servers-subtitle = Manage Minecraft servers that run Vesta, on this computer or elsewhere.
servers-add = Add server
servers-open = Open server
servers-pin = Pin to sidebar
servers-remove = Remove server
servers-hide-from-sidebar = Hide from sidebar
servers-sections = Server sections
servers-not-found = This server is no longer saved
servers-empty-title = No servers yet
servers-empty-description = Connect to a server running Vesta using its address and a pairing code from the server, or your Minecraft account.
servers-preview-note = Preview mode: these are sample servers, not real connections.
servers-unknown = Unknown
servers-server-id = Server ID
servers-fingerprint = Certificate fingerprint
servers-continue = Continue
servers-got-it = Got it
servers-seen = seen { $time } ago
servers-updated = Updated { $time } ago
servers-ago = { $time } ago
servers-retry-after = Try again in { $count ->
    [one] { $count } second
   *[other] { $count } seconds
  }.

servers-age-seconds = { $count ->
    [one] { $count } second
   *[other] { $count } seconds
  }
servers-age-minutes = { $count ->
    [one] { $count } minute
   *[other] { $count } minutes
  }
servers-age-hours = { $count ->
    [one] { $count } hour
   *[other] { $count } hours
  }
servers-age-days = { $count ->
    [one] { $count } day
   *[other] { $count } days
  }

servers-tab-overview = Overview
servers-tab-console = Console
servers-tab-players = Players
servers-tab-activity = Activity
servers-tab-connection = Connection

# Connect flow
servers-add-title = Add a server
servers-add-description = Enter the server's address, or paste the pairing link printed by the server.
servers-add-steps = Steps
servers-step-address = Address
servers-step-verify = Verify
servers-step-sign-in = Sign in
servers-address-label = Server address
servers-address-help = For example play.example.net, 192.168.1.20:8443 or [2001:db8::1]:8443. The default port is 8443. Local network addresses work while offline.
servers-address-checking = Contacting server…
servers-address-problem-empty = Enter an address.
servers-address-problem-scheme = Only https:// addresses are supported.
servers-address-problem-credentials = Remove the user name or password from the address.
servers-address-problem-path = Enter only the host and port, without a path.
servers-address-problem-host = This isn't a valid host name or IP address.
servers-address-problem-port = The port must be a number from 1 to 65535.
servers-address-problem-link = This pairing link is incomplete or damaged. Copy it again from the server.
servers-verify-title = Check that this is your server
servers-verify-compare = Compare this fingerprint with the one shown on the server, for example in the output of vesta-agent pair or vesta-agent owner link. If any group differs, stop: you may be talking to a different machine.
servers-verify-confirm = The fingerprint matches what the server shows
servers-verify-link-matches = Matches the fingerprint in your pairing link.
servers-verify-link-mismatch = This doesn't match the fingerprint in your pairing link. Don't continue; the connection may be intercepted.
servers-verify-already-saved = This server is already saved. Signing in again adds another device for it.
servers-verify-trust = Trust and continue
servers-sign-in-title = Sign in to the server
servers-sign-in-method = Sign-in method
servers-sign-in-code = Pairing code
servers-sign-in-minecraft = Minecraft account
servers-sign-in-code-help = Paste the one-time code from vesta-agent pair on the server, or from an invitation. Codes expire after a few minutes and can be used once.
servers-sign-in-code-label = Pairing code
servers-sign-in-code-format = Pairing codes are 43 letters, digits, dashes or underscores.
servers-sign-in-minecraft-help = Your account proves who you are. The server decides what you can do. Your Microsoft sign-in is never sent to the server.
servers-sign-in-account = Account
servers-sign-in-no-account = Add a Microsoft account in Settings to sign in with Minecraft.
servers-sign-in-submit = Sign in
servers-sign-in-working = Signing in…
servers-done-title = Connected to { $name }
servers-done-paired-as = This device is paired as { $name }.
servers-done-no-management = Signed in. This account has no management access on this server; ask its owner for an invitation.
servers-done-all-servers = All servers

# State facts
servers-connection-online = Connected
servers-connection-connecting = Connecting…
servers-connection-retrying = Retrying in { $count } s
servers-connection-unreachable = Can't reach server
servers-connection-disconnected = Not connected
servers-connection-rate-limited = Server is limiting requests · resuming in { $count } s
servers-access-paired-as = Paired as { $name }
servers-access-signed-in = Signed in
servers-access-fingerprint-changed = Needs verification
servers-access-rejected = Sign-in rejected
servers-access-vault-unavailable = Credentials unavailable
servers-access-no-management = No management access
servers-minecraft-unknown = Minecraft state unknown
servers-minecraft-stopped = Minecraft stopped
servers-minecraft-starting = Minecraft starting
servers-minecraft-ready = Minecraft ready
servers-minecraft-degraded = Minecraft degraded
servers-minecraft-stopping = Minecraft stopping
servers-minecraft-sleeping = Sleeping
servers-minecraft-waking = Waking up
servers-minecraft-crash-loop = Crash loop: stopped
servers-minecraft-recovery-required = Recovery required
servers-readiness-startup-timeout = Minecraft didn't report ready in time.
servers-readiness-probe-failed = The game port isn't answering status checks.
servers-readiness-fatal-output = Minecraft printed a fatal error.
servers-readiness-console-gap = Some console output was missed, so readiness is uncertain.
servers-supervisor-orphan = A Minecraft process is running without its supervisor. Control is limited until an approved restart.
servers-supervisor-launch-unresolved = The last launch didn't finish cleanly.
servers-supervisor-observation-failed = Vesta can't currently observe the Minecraft process.
servers-supervisor-restart-unsaved = Crash-restart state couldn't be saved.
servers-players-count = { $count ->
    [one] { $count } player online
   *[other] { $count } players online
  }
servers-players-unknown = Player count unknown
servers-players-none-running = Not running
servers-players-nobody = Nobody is online.
servers-players-whitelist = Whitelist
servers-players-operators = Operators
servers-players-bans = Bans
servers-players-whitelist-empty = The whitelist is empty.
servers-players-ops-empty = No operators.
servers-players-bans-empty = No banned players.
servers-players-name = Player
servers-players-detail = Details
servers-players-level = Level { $count }
servers-players-name-format = Use the Java Edition name: up to 16 letters, digits or underscores.
servers-players-add-whitelist = Add to whitelist
servers-players-ban-player = Ban player
servers-players-make-operator = Make operator

# Lifecycle
servers-lifecycle-start = Start
servers-lifecycle-stop = Stop
servers-lifecycle-restart = Restart
servers-lifecycle-kill = Force kill…
servers-lifecycle-sending = Sending…
servers-lifecycle-offline = Not connected
servers-lifecycle-no-access = No management access
servers-lifecycle-unknown-state = Waiting for server status
servers-lifecycle-needs-attention = Needs attention on the server
servers-lifecycle-not-allowed = Your role can't control this server
servers-lifecycle-stopping = Stopping…
servers-kill-title = Force kill Minecraft?
servers-kill-description = The server is still stopping. Force kill ends the Minecraft process immediately.
servers-kill-target = Target run
servers-kill-warning = Unsaved world changes can be lost. Players are disconnected without warning.
servers-kill-prepare = Prepare force kill
servers-kill-prepare-again = Prepare again
servers-kill-confirm = Force kill now ({ $count } s)
servers-kill-no-longer-needed = Minecraft has already stopped. No force kill is needed.

# Operations
servers-intent-start = Start
servers-intent-stop = Stop
servers-intent-restart = Restart
servers-intent-kill = Force kill
servers-intent-command = Console command
servers-intent-moderate = Player action
servers-intent-other = Server task
servers-operation-accepted = Accepted by server
servers-operation-accepted-toast = { $name }: accepted by server
servers-operation-awaiting-confirmation = Waiting for confirmation
servers-operation-running = In progress
servers-operation-cancelling = Cancelling
servers-operation-succeeded = Completed
servers-operation-failed = Failed. Check the console for details.
servers-operation-cancelled = Cancelled
servers-operation-recovery-required = Recovery required on the server
servers-operation-checking = Checking whether the server received this…
servers-activity-description = Tasks the server has accepted. Closing the launcher doesn't cancel them.
servers-activity-empty = No recent tasks.

# Overview
servers-overview-minecraft = Minecraft
servers-overview-version = Version
servers-overview-uptime = Uptime
servers-overview-performance = Performance
servers-overview-cpu = CPU
servers-overview-memory = Memory
servers-overview-waiting-metrics = Waiting for the first sample…
servers-overview-no-metrics = No live metrics while Minecraft is stopped.
servers-overview-pack = Modpack
servers-overview-pack-revision = Published revision
servers-overview-pack-minimum = Minimum required
servers-overview-pack-unpublished = No pack published.
servers-overview-recent = Recent tasks
servers-overview-agent = Vesta version

# Console
servers-console-notice = Console output can include sensitive information. Commands you send are kept by the server as task input.
servers-console-waiting = Waiting for output…
servers-console-stopped = Minecraft isn't running
servers-console-placeholder = Type a command, e.g. say Hello
servers-console-command = Console command
servers-console-send = Send
servers-console-empty = Enter a command.
servers-console-too-long = Commands can be at most 1,024 bytes.
servers-console-control-characters = Commands can't contain line breaks or control characters.
servers-console-gap = Lines skipped while the server was busy
servers-console-gap-latest-log = Older lines are in logs/latest.log

# Moderation
servers-moderate-kick = Kick
servers-moderate-ban = Ban
servers-moderate-pardon = Pardon
servers-moderate-deop = Remove operator
servers-moderate-whitelist-remove = Remove from whitelist
servers-moderate-kill = Kill player
servers-moderate-lightning = Strike with lightning
servers-moderate-reason = Reason (optional)
servers-moderate-apply = Apply
servers-moderate-confirm = Confirm ({ $count } s)
servers-moderate-op-warning = Operators can run powerful in-game commands. The server asks you to confirm.
servers-moderate-delivery-note = "Completed" means the server delivered the command to Minecraft, not that Minecraft applied it.

# Trust and access
servers-trust-changed-title = This server's certificate changed
servers-trust-changed-description = Management is paused until you verify this change. If you didn't expect it, don't approve it.
servers-trust-approved = Approved fingerprint
servers-trust-presented = Fingerprint the server presents now
servers-trust-check = Check current fingerprint
servers-trust-approve = I compared it, approve
servers-rejected-title = Sign-in rejected
servers-rejected-pair-again = Pair again

# Connection tab
servers-connection-name = Name
servers-connection-name-description = Shown in the launcher only.
servers-connection-pin-description = Keep a shortcut to this server in the sidebar.
servers-connection-status = Status
servers-connection-sign-in = Signed in with
servers-connection-storage = Device key
servers-connection-memory-only = This session only
servers-connection-secure-storage = Saved in the system credential store
servers-connection-fingerprint-help = The launcher only talks to this server while it presents this fingerprint.
servers-connection-remove-title = Remove { $name }?
servers-connection-remove-description = Forgets this server and deletes this device's key. The server and its files are not changed.

# Errors
servers-error-invalid-address = Check the server address.
servers-error-unreachable = Can't reach the server. Check the address, that the server is running, and your network.
servers-error-timeout = The server took too long to answer.
servers-error-tls-failed = A secure connection couldn't be set up.
servers-error-fingerprint-mismatch = The server's certificate doesn't match the one you approved.
servers-error-pair-code-invalid = That code is wrong, expired or already used. Ask for a new code.
servers-error-pair-outcome-unknown = We couldn't confirm pairing. The code may already be used. Ask for a new code.
servers-error-credentials-rejected = This device's access was removed or is no longer recognized.
servers-error-credentials-unavailable = The system credential store isn't available.
servers-error-no-management-access = This account has no management access on this server.
servers-error-forbidden = Your role doesn't allow this.
servers-error-not-found = That no longer exists on the server.
servers-error-stale-target = The server changed state. Review and try again.
servers-error-confirmation-expired = The confirmation expired. Prepare it again.
servers-error-conflict = Something else changed this first. Refresh and try again.
servers-error-rate-limited = The server is limiting requests.
servers-error-server-busy = The server is busy.
servers-error-unsupported = This server's Vesta version doesn't support that yet.
servers-error-backups-not-configured = Backups aren't set up for this server. Set up backup storage on the server computer, then refresh.
servers-error-client-rate-limited = Vesta is pacing requests to this server. Wait a moment, then retry.
servers-error-client-busy = Vesta is waiting for other requests to finish. Wait a moment, then retry.
servers-error-outcome-unknown = We couldn't confirm whether the server received this. Checking…
servers-error-invalid-input = Check the values you entered.
servers-error-internal = Something went wrong in the launcher.
servers-console-delivered = Delivered to Minecraft.
servers-console-load-recent = Load recent history
servers-console-send-again = Send again
servers-operation-uncertain-retry = We couldn't confirm the server received this. Trying again is safe: the server won't run it twice.
servers-players-names-withheld = { $count ->
    [one] { $count } player online. Their name can't be shown.
   *[other] { $count } players online. Their names can't be shown.
  }
servers-moderate-accepted = Accepted by server
servers-moderate-confirm-target = Confirm making { $name } an operator. To choose someone else, close this and start again.
servers-sign-in-storage-unavailable = This computer's secure credential store isn't available, so the launcher can't save this device's key.
servers-sign-in-memory-only = Use for this session only (you'll need to pair again after restarting the launcher)
prefs-general-servers-privacy = Server privacy mode
prefs-general-servers-privacy-description = Blur server addresses, server IDs and certificate fingerprints, for streaming or screen sharing. Click a blurred value to reveal it briefly.
servers-actions = Server actions
servers-activity-actor-unknown = Someone
servers-activity-actor-you = You
servers-activity-actor-person = { $name }
servers-activity-actor-workflow = { $name }
servers-activity-actor-system = { $name }
servers-activity-all = All
servers-activity-filter = Show tasks
servers-activity-in-progress = In progress
servers-activity-mine = Mine
servers-card-attention = Attention
servers-card-online = Online
servers-card-starting = Starting
servers-card-unreachable = Offline
servers-connection-address-description = Where this launcher reaches the server.
servers-connection-danger = Danger zone
servers-connection-general = General
servers-connection-identity = Identity and trust
servers-connection-network = Network
servers-copied = Copied
servers-copy-address = Copy address
servers-notice-crash-loop = Minecraft crashed repeatedly and was left stopped. Fix the cause on the server, then start it again.
servers-notice-last-known = Showing the last known state.
servers-notice-limited-control = Limited control
servers-notice-recovery = The server needs local recovery before it can start again.
servers-notice-no-state = Vesta hasn't seen this server's state yet.
servers-notice-pressure = Vesta will try again shortly and keeps showing what it already has.
servers-notice-restart-title = Restart to apply settings
servers-notice-restart = Some changes take effect the next time Minecraft starts.
servers-notice-restart-now = Restart now
servers-settings-title = Server settings
servers-settings-sections = Server settings sections
servers-settings-general = General
servers-settings-game = Game
servers-settings-group-server = Server
servers-settings-group-people = People
servers-settings-group-device = This device
servers-join-address = Join address
servers-copy-join-address = Copy join address
servers-offline-title = Can't reach { $name } right now
servers-offline-connecting-title = Connecting to { $name }…
servers-offline-retrying = Vesta will try again in { $count } s. Overview shows the last known state.
servers-offline-waiting = Vesta keeps trying in the background. Overview shows the last known state.
servers-offline-retry = Try now
servers-overview-online-players = Online players
servers-players-unknown-offline = Unknown while Vesta can't reach the server.
servers-players-not-running = Minecraft isn't running.
servers-outcome-delivered = Delivered to Minecraft
servers-outcome-exited = Minecraft exited
servers-outcome-recovery = Needs recovery
servers-outcome-stale = The server had already changed
servers-outcome-timeout = Timed out
servers-outcome-write-failed = Couldn't reach Minecraft's input
servers-privacy-hidden = { $name } hidden
servers-privacy-reveal = Privacy mode is on. Click to reveal briefly.
servers-refresh = Refresh
servers-task-backup = ran a { $value } backup ({ $name })
servers-task-ban = banned { $name }
servers-task-ban-for = banned { $name } for { $time }
servers-task-command = ran a console command
servers-task-command-hidden = ran a console command (hidden: needs console access)
servers-task-deop = removed { $name } as an operator
servers-task-file = { $value } { $path }
servers-task-force-kill = force killed Minecraft
servers-task-kick = kicked { $name }
servers-task-kill-player = killed { $name }
servers-task-lightning = struck { $name } with lightning
servers-task-moderate = used { $value } on { $name }
servers-task-op = made { $name } an operator
servers-task-pardon = pardoned { $name }
servers-task-restart = restarted Minecraft
servers-task-start = started Minecraft
servers-task-stop = stopped Minecraft
servers-task-whitelist-add = added { $name } to the whitelist
servers-task-whitelist-remove = removed { $name } from the whitelist
servers-tab-backups = Backups
servers-tab-access = Access
servers-loading = Loading…
servers-save = Save
servers-done = Done
servers-copy = Copy
servers-backups-storage = Storage
servers-backups-used = Used by backups
servers-backups-restore-points = Restore points
servers-backups-free = Free on the server
servers-backups-of-limit = of { $value } limit
servers-backups-profiles = Backup profiles
servers-backups-recent = Recent backup jobs
servers-backups-no-profiles = No backup profiles are configured on this server.
servers-backups-not-loaded = Backup profiles couldn't be loaded.
servers-backups-no-jobs = No backup jobs yet.
servers-backups-no-points = No restore points yet.
servers-backups-mode-online = While running
servers-backups-mode-stopped = Server stopped
servers-backups-keep-all = Keeps every backup
servers-backups-keep-last = { $count ->
    [one] Keeps the latest
   *[other] Keeps { $count } latest
  }
servers-backups-keep-daily = { $count ->
    [one] { $count } daily
   *[other] { $count } daily
  }
servers-backups-keep-weekly = { $count ->
    [one] { $count } weekly
   *[other] { $count } weekly
  }
servers-backups-keep-monthly = { $count ->
    [one] { $count } monthly
   *[other] { $count } monthly
  }
servers-backups-show-points = Restore points
servers-backups-hide-points = Hide restore points
servers-backups-run = Back up now
servers-backups-verify = Verify
servers-backups-started = Backup "{ $name }" started
servers-backups-verify-started = Verifying "{ $name }"
servers-backups-kind-backup = backed up "{ $name }"
servers-backups-kind-verify = verified "{ $name }"
servers-backups-kind-restore-copy = restored a copy from "{ $name }"
servers-backups-kind-restore = restored the server from "{ $name }"
servers-backups-failed = Failed
servers-backups-error-stopped = This profile only backs up while Minecraft is stopped.
servers-backups-error-disk = Backups paused: the server is low on disk space.
servers-backups-error-storage = Backups paused: the backup storage limit is reached.
servers-backups-error-count = Backups paused: the restore point limit is reached.
servers-backups-added = { $value } added
servers-backups-files-changed = { $count ->
    [one] { $count } file changed
   *[other] { $count } files changed
  }
servers-backups-verified = Integrity verified
servers-backups-safety = Safety snapshot
servers-backups-restore-copy = Restore a copy
servers-backups-restore = Restore server…
servers-backups-copy-started = Restoring a copy into the server's restore folder. Live files aren't touched.
servers-backups-restore-title = Restore the server from this backup?
servers-backups-restore-description = The server's files will be replaced with the backup from { $time }. Changes made since then are lost.
servers-backups-stop-first = Stop Minecraft first. Restoring never stops or starts the server for you.
servers-backups-safety-first = Take a safety snapshot of the current files first (recommended)
servers-backups-no-safety-warning = Without a safety snapshot there is no way back to the current files.
servers-backups-prepare = Prepare restore
servers-backups-confirm-restore = Restore now
servers-backups-restore-started = Restore started
servers-backups-recovery = A restore was interrupted, so Minecraft can't start until you decide. Keep the files as they are now, or run a full restore again.
servers-backups-resolve = Keep current files

servers-activity-pages = Activity pages
servers-activity-newer = Newer
servers-activity-older = Older

servers-backup-setup-title = Set up backups
servers-backup-setup-intro = Save restore points of your server to recover from unwanted changes.
servers-backup-setup-suggested = Adjust these defaults to suit your server.
servers-backup-setup-name = Profile name
servers-backup-setup-name-help = Use lowercase letters, numbers and dashes.
servers-backup-setup-name-problem = Use up to 32 lowercase letters, numbers or dashes, starting with a letter or number.
servers-backup-setup-name-taken = Another profile already uses this name.
servers-backup-setup-mode = When it can back up
servers-backup-setup-mode-online-help = Backs up while Minecraft runs. World saving is paused briefly while files are copied.
servers-backup-setup-mode-stopped-help = Backs up only while Minecraft is stopped.
servers-backup-setup-retention = Backup retention
servers-backup-setup-retention-help = For example, 7 days keeps one backup from each of 7 days.
servers-backup-setup-keep-last = Newest backups
servers-backup-setup-keep-daily = Days to keep
servers-backup-setup-keep-weekly = Weeks to keep
servers-backup-setup-keep-monthly = Months to keep
servers-backup-setup-keep-range = Use a whole number from 0 to 1000.
servers-backup-setup-keeps-everything = With every count at 0 nothing is cleaned up, so backup storage keeps growing.
servers-backup-setup-scope = What to back up
servers-backup-setup-scope-all = Everything
servers-backup-setup-scope-some = Only some files
servers-backup-setup-scope-all-help = Every world (including custom world names), configs, mods and plugins in the game folder.
servers-backup-setup-scope-some-help = Only the files and folders you list below.
servers-backup-setup-include = Files and folders to include
servers-backup-setup-include-help = One path per line, relative to the game folder.
servers-backup-setup-include-problem = Use relative paths without "..", wildcards or backslashes.
servers-backup-setup-exclude = Skip these
servers-backup-setup-exclude-help = Optional. One pattern per line, like a .gitignore file.
servers-backup-setup-exclude-problem = Patterns can't contain ".." or start with "!" or "#".
servers-backup-setup-storage = Stored at
servers-backup-setup-storage-help = On the server, inside the instance folder. Only the server's host can move it.
servers-backup-setup-storage-new = A new backup store will be created here, inside the instance folder on the server.
servers-backup-setup-storage-unknown = Chosen by the server
servers-backup-setup-no-auto-run = Turning backups on doesn't take a backup or start a schedule by itself.
servers-backup-setup-turn-on = Turn on backups
servers-backup-setup-turning-on = Turning on…
servers-backup-setup-retry = Try again
servers-backup-setup-uncertain = We couldn't confirm the save. You can safely try again.
servers-backup-setup-stale = Backup settings changed on the server. Review your edits against the latest settings and save again.
servers-backup-setup-enabled-title = Backups are on
servers-backup-setup-enabled-body = The "{ $name }" profile is ready. Back up now, or schedule it to run every night in Automation.
servers-backup-setup-schedule = Schedule it
servers-backup-setup-dismiss = Not now
servers-backup-setup-view-only = Only the owner or an administrator can change backup profiles.
servers-backup-setup-profiles-help = Each profile is a set of rules for what to back up and how long to keep it.
servers-backup-setup-add-profile = Add profile
servers-backup-setup-edit = Edit
servers-backup-setup-done = Done
servers-backup-setup-remove = Remove profile
servers-backup-setup-remove-help = Removing a profile keeps its restore points. Re-adding the same name shows them again.
servers-backup-setup-rename-note = Automation workflows that use "{ $name }" keep the old name. Update them after saving.
servers-backup-setup-badge-new = New
servers-backup-setup-badge-edited = Edited
servers-backup-setup-disable-warning = With no profiles, backups are turned off. Existing restore points are kept.
servers-backup-setup-saved = Backup profiles saved
servers-backup-setup-unsaved = { $count ->
    [one] 1 unsaved change
   *[other] { $count } unsaved changes
}
servers-access-people = People
servers-access-invitations = Invitations
servers-access-devices = Devices
servers-access-devices-help = Every launcher signed in to this server. Revoking one signs it out for good.
servers-access-rules = Join rules
servers-access-devices-count = { $count ->
    [one] { $count } device
   *[other] { $count } devices
  }
servers-access-change-role = Change role
servers-access-role = Role
servers-access-role-title = Change { $name }'s role
servers-access-role-help = You can only give roles below your own. Owner and Administrator are granted on the server machine.
servers-access-local-only = Owner and Administrator roles can only be granted from the server machine (vesta-agent owner link).
servers-access-invite = Invite someone
servers-access-invite-help = An invitation is a one-time code for a role you choose. It expires after up to an hour.
servers-access-create-invite = Create invitation
servers-access-expiry = Expires
servers-access-expires-in = { $count ->
    [one] Expires in { $count } minute
   *[other] Expires in { $count } minutes
  }
servers-access-invite-role-help = They get this role when they redeem the code. You can only invite to roles below your own.
servers-access-invite-once = Send this to the person you're inviting. It's shown only once and works once.
servers-access-pairing-link = Pairing link
servers-access-invitation-for = Invitation for { $name }
servers-access-created-by = by { $name }
servers-access-no-invitations = No pending invitations.
servers-access-invitations-unsupported = This server's Vesta version can't list invitations yet. You can still create them.
servers-access-revoke = Revoke
servers-access-revoked = Revoked
servers-access-this-device = This device
servers-access-revoke-title = Revoke { $name }?
servers-access-revoke-description = That device can no longer manage this server. Its person keeps their role and other devices.
servers-access-rules-help = Roles people get automatically, without an invitation. They can only download the pack and see public status.
servers-access-rule-whitelist-sync = Use the server whitelist
servers-access-rule-whitelist-sync-help = Whitelisted Minecraft players get the whitelist role after signing in with their account.
servers-access-rule-anonymous = Anyone
servers-access-rule-anonymous-help = Visitors who haven't signed in.
servers-access-rule-new-user = New accounts
servers-access-rule-new-user-help = People the first time they sign in.
servers-access-rule-whitelist = Whitelisted players
servers-access-rule-whitelist-help = Players on the Minecraft whitelist who aren't banned.
servers-access-rule-password = Pack password
servers-access-rule-password-help = Devices that entered the pack password.
servers-pack-publish = Publish pack
servers-pack-published = Pack published
servers-pack-require = Require this version
servers-pack-require-title = Require pack revision { $version }?
servers-pack-require-description = Players on older pack revisions will be told to update before joining. This can't be lowered again.
servers-pack-required = Players now need the latest pack
servers-tab-presence = Sleep & status
servers-presence-sleep = Sleep
servers-presence-sleep-help = Put Minecraft to sleep when the server is empty. Enable wake on join to let players start it again.
servers-presence-sleep-enabled = Sleep when empty
servers-presence-sleep-enabled-help = Sleeps after the server has been empty for the time below. Waits for backups, updates and restores to finish.
servers-presence-idle = Minutes with nobody online
servers-presence-idle-help = How long the server must be empty before the warning.
servers-presence-warning = Warning countdown (seconds)
servers-presence-warning-help = An in-game countdown before stopping. Anyone joining cancels it.
servers-presence-offline-status = Answer the server list while asleep
servers-presence-offline-status-help = Players see your offline message instead of "Can't connect". Pinging never wakes the server.
servers-presence-wake = Wake when someone joins
servers-presence-wake-help = A real login attempt starts Minecraft. The player reconnects once it's ready.
servers-presence-cooldown = Wake cooldown (seconds)
servers-presence-cooldown-help = Minimum time between wake-ups, so repeated logins can't start it over and over.
servers-presence-unsaved = Unsaved changes
servers-presence-discard = Discard
servers-presence-saved = Saved
servers-presence-status = Server list message
servers-presence-status-help = What players see in their multiplayer list while Minecraft is asleep, starting or stopped. The live message while it's running is the MOTD in Settings.
servers-presence-when = Show while
servers-presence-state-online = Online (app only)
servers-presence-state-offline = Offline
servers-presence-state-sleeping = Sleeping
servers-presence-state-waking = Waking up
servers-presence-state-starting = Starting
servers-presence-state-stopping = Stopping
servers-presence-state-maintenance = Maintenance
servers-presence-state-crash-loop = Crash loop
servers-presence-state-recovery = Recovery required
servers-presence-colors = Colours and styles
servers-presence-reset = Reset
servers-presence-placeholder = Insert value
servers-presence-template = Message
servers-presence-problem-lines = Use at most two lines.
servers-presence-problem-length = The message is too long (1,024 bytes max).
servers-presence-problem-placeholder = Unknown value in braces. Use Insert value to add one.
servers-presence-problem-unclosed = A placeholder is missing its closing brace.
servers-presence-version-label = Version label
servers-presence-version-placeholder = Shown instead of the version, e.g. Sleeping
servers-presence-max-players = Maximum players shown
servers-presence-login-message = Message to the player who wakes it
servers-presence-login-message-help = They're disconnected with this text while Minecraft starts.
servers-presence-check = Preview with server
servers-presence-checked = This is exactly how the server will show it.
servers-presence-live-motd-note = Previews use sample values. Preview with server for its current values.
servers-presence-sample-reason = Updating mods

servers-profile-title = Server profile
servers-profile-icon = Server icon
servers-profile-icon-description = Shown to everyone who connects from Vesta. Any image works; it is cropped square and resized.
servers-profile-icon-upload = Choose image
servers-profile-icon-remove = Remove
servers-profile-icon-unreadable = That image could not be read
servers-profile-name = Display name
servers-profile-name-description = The name players see for this server.
servers-profile-name-required = Enter a name
servers-profile-too-long = Use at most { $max } characters
servers-profile-description = Description
servers-profile-description-help = A short note shown with the server in Vesta.
servers-profile-saved = Server profile saved
servers-profile-stale = Someone else changed the profile. The latest version has been loaded.

# Players (People) section.
servers-moderate-duration = Duration
servers-people-add = Add player
servers-people-add-as = Add as
servers-people-add-title = Add a player
servers-people-add-whitelist-choice = Whitelist
servers-people-add-operator-choice = Operator
servers-people-add-ban-choice = Ban
servers-people-ban = Ban
servers-people-unban = Unban
servers-people-kick = Kick from server
servers-people-ban-section = Ban
servers-people-ban-by = by { $name }
servers-people-ban-since = since { $time }
servers-people-ban-ends = ends { $time }
servers-people-ban-permanent = Permanent
servers-people-banned = Banned
servers-people-banned-until = Banned until { $time }
servers-people-not-banned = Not banned
servers-people-no-reason = No reason given
servers-people-whitelist-section = Whitelist
servers-people-on-whitelist = Can join while the whitelist is on.
servers-people-not-on-whitelist = Not on the whitelist.
servers-people-whitelisted = Whitelisted
servers-people-operator = Operator { $count }
servers-people-operator-section = Operator
servers-people-not-operator = Not an operator.
servers-people-operator-level = Permission level { $count }
servers-people-operator-level-help = Level 4 can use every command, including stopping the server.
servers-people-bypass = Can join when the server is full.
servers-people-online = Online
servers-people-uuid = UUID
servers-people-no-uuid = Not known yet. Minecraft records it the first time the player joins.
servers-people-copy-uuid = Copy UUID
servers-people-search = Search players
servers-people-filter-all = All
servers-people-filter-online = Online
servers-people-filter-whitelisted = Whitelisted
servers-people-filter-operators = Operators
servers-people-filter-banned = Banned
servers-people-filter-empty = Nobody here yet.
servers-people-no-match = No players match your search.
servers-people-empty-title = No players yet
servers-people-empty-description = Players appear here when they join, or when you add them to the whitelist, make them an operator or ban them.
servers-people-whitelist-on = The whitelist is on: only listed players can join.
servers-people-whitelist-off = The whitelist is off: anyone can join.
servers-people-whitelist-change = Change in Game settings

# MOTD editor.
servers-motd-colour = Colour
servers-motd-clear = Clear formatting
servers-motd-hint = Formatting applies to selected text, or to what you type next.
servers-motd-bold = Bold
servers-motd-italic = Italic
servers-motd-underline = Underline
servers-motd-strikethrough = Strikethrough
servers-motd-color-black = Black
servers-motd-color-dark-blue = Dark blue
servers-motd-color-dark-green = Dark green
servers-motd-color-dark-aqua = Dark aqua
servers-motd-color-dark-red = Dark red
servers-motd-color-dark-purple = Dark purple
servers-motd-color-gold = Gold
servers-motd-color-gray = Grey
servers-motd-color-dark-gray = Dark grey
servers-motd-color-blue = Blue
servers-motd-color-green = Green
servers-motd-color-aqua = Aqua
servers-motd-color-red = Red
servers-motd-color-light-purple = Light purple
servers-motd-color-yellow = Yellow
servers-motd-color-white = White

# Presence and profile help.
servers-presence-when-state = { $name } message
servers-presence-wake-needs = Turn on "Answer the server list while asleep" first. Vesta has to answer on the game port to notice a join.
servers-presence-version-help = Shown instead of the Minecraft version in the server list.
servers-presence-max-players-help = The maximum shown in the server list. It doesn't limit who can join.
servers-presence-running-note = While Minecraft is running, the server list shows its own MOTD instead.
servers-presence-edit-motd = Edit the live MOTD
servers-profile-help = How this server appears in the launcher for everyone you share it with.

servers-lifecycle-sleep = Sleep
servers-lifecycle-wake = Wake
servers-lifecycle-waking = Waking up…
servers-lifecycle-starting = Starting…
servers-minecraft-sleeping-wakes = Sleeping · joins wake it
servers-card-sleeping = Sleeping

servers-sleep-blocker-asleep = Asleep now
servers-sleep-blocker-not-ready = Minecraft is starting
servers-sleep-blocker-players-online = Players online · sleeps once everyone leaves
servers-sleep-blocker-player-count-unknown = Waiting: player count unknown
servers-sleep-blocker-operation = Waiting: a task is running
servers-sleep-blocker-hold = Paused while a backup, update or restore runs
servers-sleep-blocker-authority = Paused: the person who turned on sleep can no longer stop this server. Save these settings to take it over.
servers-sleep-blocker-counting-seconds = Nobody online · sleeping in { $count } s
servers-sleep-blocker-counting-minutes = Nobody online · sleeping in { $count } min
servers-sleep-blocker-warned-seconds = Countdown sent to players · sleeping in { $count } s
servers-sleep-blocker-warned-minutes = Countdown sent to players · sleeping in { $count } min
servers-presence-sleep-now = Right now
servers-presence-agent-start = When the agent starts
servers-presence-agent-start-help = What Minecraft does when the Vesta agent starts, for example after the computer restarts.
servers-presence-agent-start-stay-stopped = Stay stopped
servers-presence-agent-start-sleep = Sleep
servers-presence-agent-start-start = Start Minecraft
servers-presence-agent-start-sleep-needs = Sleep at startup needs "Answer the server list while asleep".

servers-graphs-range = Time range
servers-graphs-range-15m = 15 min
servers-graphs-range-1h = 1 hour
servers-graphs-range-24h = 24 hours
servers-graphs-tps = TPS
servers-graphs-players = Players
servers-graphs-of-max = of { $max }
servers-graphs-empty = No performance history for this time range yet.
servers-graphs-summary = { $name } over the last { $time }: latest { $value }, low { $min }, high { $max }.
servers-graphs-summary-empty = { $name }: no samples in this time range.
servers-graphs-allocated = Allocated

servers-access-people-help = People who can manage this server, and the devices they use. Only the server computer can grant Owner or Administrator.
servers-access-no-people = No one else manages this server yet. Invite someone to add them.
servers-access-you = You
servers-access-unknown-person = Unknown person
servers-access-devices-of = Devices of { $name }
servers-access-pack-users = Pack users ({ $count })
servers-access-pack-users-summary = { $count } active devices
servers-access-pack-users-help = People who download this server's pack through Vesta. Plain Minecraft players aren't listed.
servers-access-rename-device = Rename { $name }
servers-access-rename-title = Rename device
servers-access-device-name = Device name
servers-access-device-name-long = Use 64 characters or fewer.
servers-access-device-name-invalid = Device names can't contain control characters.
