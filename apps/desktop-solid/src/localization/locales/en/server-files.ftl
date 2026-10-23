# Server workspace: game-root files, logs and server.properties.

server-files-tab = Files
server-files-location = Server files
server-files-game-root = Server folder
server-files-bad-route = That folder link isn't valid, so the server folder is shown instead.
server-files-name = Name
server-files-size = Size
server-files-modified = Modified
server-files-actions = Actions
server-files-refresh = Refresh
server-files-new = New
server-files-new-file = New file
server-files-new-folder = New folder
server-files-create = Create
server-files-upload = Upload
server-files-download = Download
server-files-downloaded = Saved { $name } ({ $size })
server-files-rename = Rename
server-files-move-to-trash = Move to trash
server-files-moved-to-trash = Moved { $name } to the trash
server-files-open-folder = Open
server-files-edit = Edit
server-files-view = View
server-files-view-log = View log
server-files-open-in-settings = Edit in Settings
server-files-open-in-players = Manage in Players
server-files-protected = Managed elsewhere
server-files-protected-name = This file is managed from the Settings and Players tabs, not as a file.
server-files-load-more = Load more
server-files-loading = Loading…
server-files-empty-title = This folder is empty
server-files-empty-description = Upload files or create a new one here.
server-files-back-to-files = Back to files

server-files-name-empty = Enter a name.
server-files-name-invalid = Use letters, numbers, spaces and symbols other than / \ : * ? " < > |, without a trailing dot or space.
server-files-name-exists = Something with this name is already here.

server-files-delete-title = Move { $name } to the trash?
server-files-delete-description = You can restore it from the trash for seven days. Only you, on this device, can restore it.

server-files-trash = Trash
server-files-trash-description = Files you deleted or overwrote from this device. They're kept on the server for seven days.
server-files-trash-empty = The trash is empty
server-files-restore = Restore
server-files-restored = Restored { $path }
server-files-restore-exists = A file already exists at the original location. Move or rename it, then restore again.
server-files-deleted-ago = Deleted { $time } ago

server-files-upload-title = Upload files
server-files-upload-description = Files go into the open folder. Up to { $limit } in total per upload.
server-files-upload-total = { $size } of { $limit }
server-files-add-files = Add files
server-files-uploaded = { $count ->
    [one] Uploaded 1 file
   *[other] Uploaded { $count } files
  }
server-files-upload-nothing = Choose at least one file.
server-files-upload-bad-name = One of these file names can't be used on the server.
server-files-upload-too-large = These files are larger than the server accepts in one upload. Remove some and try again.
server-files-upload-exists = A file with this name is already in this folder.
server-files-upload-done = Uploaded
server-files-executable-warning = This is code the server will run when it starts. Only add mods, plugins and server JARs you trust.

server-files-editor = Contents of { $name }
server-files-read-only = Read only
server-files-unsaved = Unsaved changes
server-files-discard = Discard
server-files-save = Save
server-files-saved = Saved { $name }
server-files-save-shortcut = Save ({ $value })
server-files-leave-title = Save changes to { $name }?
server-files-leave-description = You edited this file but haven't saved it. Changes you don't save are lost.
server-files-leave-discard = Don't save
server-files-binary = This file isn't text. Download it to open it on this computer.
server-files-preview-only = This file is too large to edit here, so only its beginning is shown. Download it to see everything.
server-files-deleted-on-server = This file was deleted on the server. Saving will create it again.
server-files-conflict-title = The file changed on the server
server-files-conflict-description = Someone saved { $name } after you opened it. Compare the two copies and choose which to keep.
server-files-conflict-lines = { $count ->
    [one] 1 line differs
   *[other] { $count } lines differ
  }
server-files-server-copy = On the server
server-files-my-copy = Your changes
server-files-keep-editing = Keep editing
server-files-discard-mine = Discard mine
server-files-overwrite-mine = Overwrite with mine

server-files-load-earlier = Load earlier lines
server-files-log-empty = This log is empty
server-files-archived-log = Archived
server-files-decompressed = Decompressed
server-files-archived-note = This is an archived log. The server unpacks it for reading; the archive itself is unchanged.

server-settings-tab = Settings
server-settings-group-gameplay = Gameplay
server-settings-group-world = World
server-settings-group-players = Players
server-settings-group-network = Network
server-settings-group-advanced = Advanced
server-settings-group-other = Other entries
server-settings-other-description = These entries are read-only here. Sensitive or unrecognized values are hidden by the server.
server-settings-view-only = You can view these settings, but your role can't change them.
server-settings-stale = server.properties changed on the server while you were editing. It has been reloaded with your changes kept on top; review them and save again.
server-settings-saved = Settings saved. Restart the server to apply them.
server-settings-unsaved = { $count ->
    [one] 1 unsaved change
   *[other] { $count } unsaved changes
  }
server-settings-hidden-value = Not reported by the server
server-settings-read-only-key = { $name } · set when the world is created
server-settings-malformed = { $name } · the current value couldn't be read, so the default is shown
server-settings-secret-description = { $name } · never shown; leave empty to keep it
server-settings-secret-unchanged = Unchanged
server-settings-motd-preview = Server list preview
server-settings-invalid = Enter a valid value.
server-settings-out-of-range = Enter a number from { $min } to { $max }.
server-settings-ascii-only = Use plain ASCII characters only.
server-settings-no-slashes = Slashes and backslashes aren't allowed.
server-settings-too-long = This value is too long.
server-settings-on = On
server-settings-off = Off
server-settings-confirm-title = Confirm less secure settings
server-settings-confirm-description = These changes make the server easier to reach or control. The server asks you to confirm them.
server-settings-confirm = { $count ->
    [0] Confirm
   *[other] Confirm ({ $count }s)
  }
server-settings-confirmation-expired = The confirmation expired. Save again to get a new one.

server-settings-option-peaceful = Peaceful
server-settings-option-easy = Easy
server-settings-option-normal = Normal
server-settings-option-hard = Hard
server-settings-option-survival = Survival
server-settings-option-creative = Creative
server-settings-option-adventure = Adventure
server-settings-option-spectator = Spectator

server-settings-key-difficulty = Difficulty
server-settings-key-gamemode = Game mode
server-settings-key-force-gamemode = Force game mode
server-settings-key-hardcore = Hardcore
server-settings-key-pvp = Player versus player
server-settings-key-allow-flight = Allow flight
server-settings-key-spawn-monsters = Spawn monsters
server-settings-key-spawn-animals = Spawn animals
server-settings-key-spawn-npcs = Spawn villagers
server-settings-key-enable-command-block = Command blocks
server-settings-key-level-type = World type
server-settings-key-allow-nether = Allow the Nether
server-settings-key-view-distance = View distance
server-settings-key-simulation-distance = Simulation distance
server-settings-key-spawn-protection = Spawn protection radius
server-settings-key-max-players = Maximum players
server-settings-key-white-list = Whitelist
server-settings-key-enforce-whitelist = Enforce whitelist
server-settings-key-op-permission-level = Operator permission level
server-settings-key-function-permission-level = Function permission level
server-settings-key-player-idle-timeout = Idle kick (minutes)
server-settings-key-hide-online-players = Hide online players
server-settings-key-motd = Message of the day
server-settings-key-server-port = Server port
server-settings-key-online-mode = Online mode
server-settings-key-enforce-secure-profile = Require secure chat profiles
server-settings-key-prevent-proxy-connections = Block proxy connections
server-settings-key-enable-status = Show in server lists
server-settings-key-log-ips = Log player IP addresses
server-settings-key-enable-rcon = Remote console (RCON)
server-settings-key-rcon-port = RCON port
server-settings-key-rcon-password = RCON password
server-settings-key-enable-query = Query protocol
server-settings-key-query-port = Query port

# Game settings page.
server-settings-group-essentials = Essentials
server-settings-malformed-short = Invalid value in the file
server-settings-motd-title = Server list message (MOTD)
server-settings-motd-help = What players see under the server name while Minecraft is running.
server-settings-motd-plain = Plain text only: server.properties doesn't keep colours reliably. For colours, use a server list message in Sleep and status.
server-settings-motd-preview-aria = Server list preview for { $name }: { $value }
server-settings-search = Search settings
server-settings-no-results = No settings match your search.
server-settings-show-keys = Show property names
server-settings-summary-count = { $count ->
    [one] { $count } setting
   *[other] { $count } settings
  }
server-settings-summary-customized = { $count } changed from default
server-settings-summary-edited = { $count ->
    [one] { $count } unsaved change
   *[other] { $count } unsaved changes
  }
server-settings-unreported = The agent didn't report: { $name }. They keep their current values.
