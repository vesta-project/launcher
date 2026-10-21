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
servers-players-online = Online
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
servers-pending-restart-required = Settings changed. Restart Minecraft to apply them. Nothing restarts automatically.

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
servers-overview-players = Players
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
servers-console-lines = { $count ->
    [one] { $count } line
   *[other] { $count } lines
  }
servers-console-follow = Follow output
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
servers-moderate-delivery-note = "Sent" means the server delivered the command to Minecraft, not that Minecraft applied it.

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
