## Add a server to a Vesta Server: New, Restore and Import share the settings, review and progress.

server-add-intro = It runs on { $name }, ready for your friends whenever they are.
server-add-on-machine = On { $name }
server-add-continue = Continue
server-add-start-over = Start over

server-add-mode-label = How to add it
server-add-mode-new = New server
server-add-mode-restore = Restore
server-add-mode-import = Import
server-add-mode-new-hint = A fresh world on any Minecraft version.
server-add-mode-restore-hint = Bring a server back from a backup on { $name }.
server-add-mode-import-hint = Copy a server that already lives on { $name }. The original stays untouched.

server-add-step-server = Server
server-add-step-backup = Backup
server-add-step-create = Create
server-add-step-restore = Restore

server-add-software-title = Minecraft and software
server-add-software-label = Software
server-add-software-loader = Loader version
server-add-software-build = Build
server-add-software-pick-build = Pick one
server-add-software-recommended-build = { $version } (recommended)
server-add-software-experimental-build = { $version } (experimental)
server-add-software-no-recommended = Every build here is experimental, so pick one yourself.
server-add-software-experimental-note = Experimental versions can be unstable. Back up your world often.
server-add-software-reason-version = Not for { $version }
server-add-software-reason-offline = Download site offline right now
server-add-software-reason-machine = Not for this machine
server-add-software-reason-soon = Coming soon
server-add-software-reason-other = Not available

server-add-settings-title = Settings
server-add-settings-port-range = Pick a port from 1024 to 65535.
server-add-settings-port-busy = Something on { $name } already uses this port.

server-add-continue-folder = Choose a server folder first.
server-add-continue-backup = Choose a backup first.
server-add-continue-version = Choose a Minecraft version.
server-add-continue-software = Choose the software.
server-add-continue-build = Choose a { $name } build.
server-add-continue-name = Give it a name.

server-add-restore-title = Backups on { $name }
server-add-restore-action = Restore server

server-add-import-checking = Checking { $name }
server-add-import-not-server = { $name } isn't a Minecraft server.
server-add-import-unreadable = Vesta Server needs permission to read this folder.
server-add-import-granted = Vesta Server can read this folder now.
server-add-import-chosen = Folder to copy
server-add-import-change = Choose another

server-add-new-action = Create server
server-add-review-checking = Checking with { $name }
server-add-review-subtitle = { $software } on { $name }
server-add-review-minecraft = Minecraft { $version }
server-add-review-software-build = { $software } build { $version }
server-add-review-space = Space
server-add-review-free = { $free } free
server-add-review-backup = Backup
server-add-review-pack = Modpack
server-add-review-from = Copied from
server-add-review-where = Lives in
server-add-review-fix-first = Fix these first
server-add-review-notices = From the modpack
server-add-review-before = Before you go
server-add-review-need-eula = Agree to the Minecraft EULA to continue.
server-add-review-need-ticks = Tick each box above to continue.
server-add-review-sending = Starting

server-add-fix-name = Change name
server-add-fix-port = Change port
server-add-fix-memory = Change memory
server-add-fix-version = Change version
server-add-fix-backup = Choose another backup
server-add-fix-folder = Choose another folder

server-add-blocker-permission = Vesta Server needs permission to read this folder. Run this on { $name }, then check again.
server-add-blocker-port-in-use = Port { $port } is already in use on { $name }.
server-add-blocker-port-none = Vesta Server couldn't find a free port. Pick one yourself.
server-add-blocker-port-state = Vesta Server couldn't check this port. Check again, or pick another.
server-add-blocker-memory = That's more memory than { $name } can spare.
server-add-blocker-memory-small = Give it at least 512 MB of memory.
server-add-blocker-name = A server on { $name } already has this name.
server-add-blocker-software = Vesta Server couldn't find that version of the software. Choose another.
server-add-blocker-disk = { $name } needs more free space for this server.
server-add-blocker-provider = Vesta Server couldn't reach the download site. Check again in a moment.
server-add-blocker-pack-invalid = This modpack doesn't include a Minecraft server.
server-add-blocker-pack-client = This modpack only works in the game, not on a server.
server-add-blocker-pack-blocked = The modpack has problems that stop it running as a server.
server-add-blocker-restore-gone = This backup isn't on { $name } anymore.
server-add-blocker-archive = This file has paths or files that can't be unpacked safely.
server-add-blocker-archive-large = This file is too big for Vesta Server.

server-add-warning-experimental = I understand this version is experimental and may be unstable
server-add-warning-checksum = I understand Minecraft checks this download with an older method
server-add-warning-pack = I read the modpack notes above
server-add-warning-restore-version = I understand Vesta Server couldn't tell which Minecraft version this backup uses
server-add-warning-upstream = I understand its developers no longer support this version

server-add-phase-prepare = Getting ready
server-add-phase-java = Downloading Java
server-add-phase-software = Downloading the server
server-add-phase-software-restore = Downloading the server software
server-add-phase-install = Setting up the server
server-add-phase-install-restore = Restoring the world
server-add-phase-start = Starting it up

server-add-progress-line = Being made on { $name }
server-add-progress-copy-line = Being copied to its new home on { $name }
server-add-progress-online-line = Running on { $name }
server-add-progress-bytes = { $done } of { $total }
server-add-progress-files = { $count } of { $total } files
server-add-progress-keeps-going = You can close this. { $name } keeps going.
server-add-progress-paused = It stopped partway, maybe because { $name } restarted. Pick up where it left off.
server-add-progress-cancelled-title = Cancelled
server-add-progress-cancelled-help = Nothing was added to { $name }.
server-add-progress-failed-help = Nothing was added to { $name }. Try again, or change the settings.
server-add-progress-try-again = Try again
server-add-progress-change = Change settings
server-add-progress-view = View server

server-add-error-gone = Vesta Server no longer has this job. Start again.
server-add-error-unavailable = This Vesta Server can't create servers yet. Update it on the machine and try again.
server-add-error-busy = Vesta Server is busy with another server. Try again in a moment.
server-add-error-not-yet = This Vesta Server can't do that yet.
server-add-error-too-large = That's too big to send to Vesta Server.
server-add-error-download = A download didn't finish. Check again in a moment.
server-add-error-integrity = A download didn't match what was expected, so it wasn't used. Try again.
server-add-error-install = Setting up the server didn't finish. Try again.
server-add-error-invalid = Vesta Server didn't accept that. Check the settings and try again.
server-add-error-cancelled = Cancelled.
server-add-error-interrupted = It stopped partway. Pick up where it left off.
server-add-error-step = Vesta Server couldn't finish this step. Try again.

server-add-progress-browse-packs = Browse modpacks
server-add-defaults-failed = { $name } couldn't suggest settings this time, so these are starting values.
server-add-memory-free = { $value } not used by other servers on { $name }
server-add-memory-unknown = How much { $name } gives this server while it runs
server-add-memory-chosen = This server
server-add-memory-most = Up to { $amount }
server-add-memory-most-label = Most it can have
server-add-memory-suggested-preset = Suggested { $amount }
server-add-memory-over-free = More than { $name } has free right now. That's fine while not every server runs at once.
