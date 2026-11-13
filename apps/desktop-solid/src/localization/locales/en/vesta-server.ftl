## Vesta Server: setting up a machine, adding its servers and managing it.
## Keep copy short and friendly. Say "Vesta Server". Commands are shown separately with a copy button.

vesta-server-setup-title = Set up a Vesta Server
vesta-server-setup-description = Vesta Server runs on another computer, like a spare PC or a VPS. Pick it below or type its address.
vesta-server-setup-on-network = On your network
vesta-server-setup-looking = Looking for machines
vesta-server-setup-none-found = Nothing found nearby. Type its address instead.
vesta-server-setup-address = Address
vesta-server-setup-address-help = An IP address or domain. Add a port only if it isn't 25500.

vesta-server-step-find = Machine
vesta-server-step-code = Code
vesta-server-step-account = Sign in

vesta-server-found-ready = Ready to set up
vesta-server-found-linked = Linked to this device
vesta-server-found-claimed = Already set up, use a link code

vesta-server-code-setup-title = Enter the setup code
vesta-server-code-setup-help = { $name } showed this code when Vesta Server was installed.
vesta-server-code-setup-label = Setup code
vesta-server-code-setup-new = Need a new code? Run this on the machine:
vesta-server-code-link-title = I have a link code
vesta-server-code-link-help = { $name } is already set up. Get a link code from Link a device on a device that's already linked.
vesta-server-code-link-label = Link code
vesta-server-code-link-new = You can also get one on the machine:

vesta-server-signin-title = Sign in first
vesta-server-signin-help = Vesta Server uses your Microsoft account to know the machine is yours. You'll come right back here.
vesta-server-signin-button = Sign in

vesta-server-code-cell = Character { $count } of { $total }
vesta-server-code-invalid-char = Only letters and numbers from the code
vesta-server-code-checking = Checking the code
vesta-server-code-accepted = Code accepted
vesta-server-code-claiming = Setting up { $name }
vesta-server-code-linking = Asking to link this device
vesta-server-code-owner-as = { $name } will own this Vesta Server
vesta-server-code-link-as = Linking as { $name }

vesta-server-reach-checking = Checking { $name }
vesta-server-reach-online = { $name } is online
vesta-server-reach-offline = { $name } isn't answering

vesta-server-waiting-title = Almost there
vesta-server-waiting-help = Approve this device on a device already linked to { $name }.
vesta-server-waiting-status = Waiting for approval
vesta-server-waiting-on-machine = Or approve it on the machine itself:

vesta-server-done-claimed = { $name } is ready
vesta-server-done-claimed-help = Next, bring in your first server.
vesta-server-done-linked = { $name } is linked
vesta-server-done-linked-help = Its servers are now in your list.
vesta-server-done-first-server = Add a server
vesta-server-done-later = Later
vesta-server-done-show-servers = Show servers

vesta-server-problem-code-wrong = That code doesn't match. Check it and try again.
vesta-server-problem-link-wrong = That link code doesn't match. Check it and try again.
vesta-server-problem-code-expired = That code has expired or was replaced. Get a fresh one on the machine:
vesta-server-problem-link-expired = That link code has expired. Get a new one from Link a device.
vesta-server-problem-link-declined = This device wasn't approved. Try again with a new link code.
vesta-server-problem-account = We couldn't check your Microsoft account right now. Try again in a moment.
vesta-server-problem-account-signin = Your Microsoft sign in needs a refresh. Sign in again to continue.
vesta-server-problem-account-proof = Vesta Server couldn't confirm this Minecraft account. Make sure it owns Minecraft Java Edition.
vesta-server-problem-too-many = Too many tries. Wait a minute and try again.
vesta-server-problem-too-many-seconds = { $count ->
    [one] Too many tries. Try again in a second.
   *[other] Too many tries. Try again in { $count } seconds.
}
vesta-server-problem-too-many-minutes = { $count ->
    [one] Too many tries. Try again in a minute.
   *[other] Too many tries. Try again in { $count } minutes.
}
vesta-server-problem-unreachable = Can't reach that machine. Check that it's on and Vesta Server is running.
vesta-server-problem-unreachable-at = Can't reach { $address }. Is Vesta Server running on that machine?
vesta-server-problem-already-set-up = This machine is already set up by someone else. If they gave you a link code, use that.
vesta-server-problem-claimed-link = I have a link code
vesta-server-problem-no-access = You don't have access to this Vesta Server.

vesta-server-device-windows = Windows PC
vesta-server-device-mac = Mac
vesta-server-device-linux = Linux PC

vesta-server-copy-command = Copy command
vesta-server-missing = This Vesta Server isn't linked to this device

vesta-server-role-primary-owner = Main owner
vesta-server-role-owner = Owner
vesta-server-role-admin = Admin
vesta-server-role-moderator = Moderator
vesta-server-role-member = Member

vesta-server-list-empty-description = Set up a Vesta Server on a spare PC or a VPS, then bring your servers in.
vesta-server-list-other = Other servers
vesta-server-list-settings = { $name } settings
vesta-server-list-machine-settings = Machine settings
vesta-server-list-machine-empty = No servers here yet. Bring in a server that already lives on { $name }.
vesta-server-list-machine-offline = { $name } isn't answering right now. Check that it's on and connected.
vesta-server-list-add-first = Add your first server
vesta-server-list-set-up-another = Set up another Vesta Server
vesta-server-list-online = Online
vesta-server-list-offline = Offline
vesta-server-list-checking = Checking
vesta-server-list-importing = Adding { $name } ({ $percent }%)

vesta-server-connection-runs-on = Runs on

vesta-server-host-about = This Vesta Server
vesta-server-host-name = Name
vesta-server-host-address = Address
vesta-server-host-role = Your role
vesta-server-host-checking = Checking
vesta-server-host-servers = Servers
vesta-server-host-servers-count = { $count ->
    [0] No servers yet
    [one] 1 server
   *[other] { $count } servers
}
vesta-server-host-add-server = Add server
vesta-server-host-devices = Devices
vesta-server-host-this-device = This device
vesta-server-host-unlink = Unlink
vesta-server-host-unlink-title = Unlink { $name }?
vesta-server-host-unlink-help = It loses access right away. You can link it again later with a new code.
vesta-server-host-danger = Remove
vesta-server-host-remove = Remove from this launcher
vesta-server-host-remove-short = Remove
vesta-server-host-remove-title = Remove { $name }?
vesta-server-host-remove-help = Its servers keep running on the machine. To get them back here, link this device again.
vesta-server-host-import-running = { $name } is still being added.
vesta-server-host-import-open = Show

vesta-server-link-action = Link a device
vesta-server-link-title = Link a device
vesta-server-link-help = On the other device, open Set up a Vesta Server, pick { $name } and enter this code.
vesta-server-link-expires = Expires in { $time }
vesta-server-link-expired = This code has expired.
vesta-server-link-new-code = Get a new code
vesta-server-link-approve-question = A device wants to link to { $name }. Approve it?
vesta-server-link-approve = Approve
vesta-server-link-not-now = Not now
vesta-server-link-linked = Device linked.
vesta-server-link-ended = That code can't be used anymore.

vesta-server-import-title = Add a server
vesta-server-import-intro = Bring in a server that already lives on { $name }. Vesta Server copies it and leaves the original untouched.
vesta-server-import-more-soon = Creating a new server from the launcher is coming soon.
vesta-server-import-step-folder = Folder
vesta-server-import-step-review = Review
vesta-server-import-step-copy = Copy

vesta-server-import-remote = Folders here are on { $name }, not this computer.
vesta-server-import-found = Found on { $name }
vesta-server-import-found-none = Nothing found automatically. Paste a path or browse below.
vesta-server-import-looking = Looking for servers on { $name }
vesta-server-import-needs-permission = Needs permission
vesta-server-import-permission = Vesta Server needs permission to read { $path }. Run this on { $name }, then check again.
vesta-server-import-permission-still = Still no access. Run the command, then check again.

vesta-server-import-path-label = Know the path? Paste it here
vesta-server-import-path-example = /srv/minecraft/my-server
vesta-server-import-check = Check
vesta-server-import-checking-path = Checking
vesta-server-import-path-found = Found it. It's open below.
vesta-server-import-path-not-found = There's nothing at that path on { $name }.
vesta-server-import-path-not-folder = That's a file. Paste the path of the folder it's in.
vesta-server-import-path-protected = Vesta Server keeps that folder private. Pick a different one.
vesta-server-import-path-invalid = Paste the full path, starting from the top of the machine.
vesta-server-import-path-unsupported = This Vesta Server can't check paths yet. Browse for the folder below.

vesta-server-import-browse = Browse { $name }
vesta-server-import-shortcuts = Shortcuts
vesta-server-import-trail = Folder path
vesta-server-import-folders = Folders in { $name }
vesta-server-import-opening = Opening
vesta-server-import-no-roots = Vesta Server can't see any folders on { $name } yet. Paste a path above, or update Vesta Server on the machine.
vesta-server-import-up = Up
vesta-server-import-empty-folder = No folders here
vesta-server-import-more = Show more
vesta-server-import-server-badge = Server
vesta-server-import-use-folder = Use this folder
vesta-server-import-folder-checking = Checking this folder
vesta-server-import-folder-ready = This looks like a Minecraft server.
vesta-server-import-why-top = Open the folder your server is in.
vesta-server-import-why-no-server-file = This folder has no server file. Open the folder that contains server.properties.
vesta-server-import-why-no-jar = There's no server jar here. Open the folder that has the server jar in it.
vesta-server-import-why-no-world = There's no world here. Open the folder that has your world in it.
vesta-server-import-unavailable = This Vesta Server can't import servers yet. Update it on the machine and try again.

vesta-server-import-checking-title = Checking { $name }
vesta-server-import-checking = Looking through the folder
vesta-server-import-check-failed = We couldn't check that folder
vesta-server-import-check-again = Check again
vesta-server-import-start-over = Pick another folder

vesta-server-import-review-title = { $name }
vesta-server-import-software = Software
vesta-server-import-minecraft = Minecraft
vesta-server-import-size = Size
vesta-server-import-port = Port
vesta-server-import-unknown = Unknown
vesta-server-import-name = Name
vesta-server-import-memory = Memory
vesta-server-import-memory-gb = Memory (GB)
vesta-server-import-java = Java
vesta-server-import-java-auto = Picked for you
vesta-server-import-java-auto-version = Java { $version }, picked for you
vesta-server-import-customize = Customize
vesta-server-import-customize-help = Check again to use these settings.
vesta-server-import-blocked = Fix these first
vesta-server-import-before-copy = Before copying
vesta-server-import-untouched = Vesta Server copies your server. The original folder stays exactly as it is.
vesta-server-import-stopped = The original server is stopped and won't restart on its own
vesta-server-import-eula = I agree to the Minecraft EULA
vesta-server-import-copy = Copy server
vesta-server-import-copy-starting = Starting copy

vesta-server-blocker-source-running = The original server is still running. Stop it first, then check again.
vesta-server-blocker-source-unknown = We couldn't tell if the original server is running. Make sure it's stopped, then check again.
vesta-server-blocker-permission = Vesta Server needs permission to read this folder. Run this on { $name }, then check again.
vesta-server-blocker-port-in-use = Port { $port } is already in use. Pick another port in Customize, or stop what's using it.
vesta-server-blocker-port-unknown = We couldn't find a free port. Pick one in Customize, then check again.
vesta-server-blocker-disk = Not enough free space on { $name }. This server needs { $size } and { $free } is free.
vesta-server-blocker-software = We couldn't tell which Minecraft version or server software this is.
vesta-server-blocker-launch = We couldn't tell how to start this server. Make sure the server jar is in this folder, then check again.
vesta-server-blocker-java = We couldn't pick a Java version for this server. Check again in a moment.
vesta-server-blocker-not-minecraft = This folder doesn't look like a Minecraft server. Pick the folder that contains server.properties.
vesta-server-blocker-memory = That's more memory than the machine can spare. Pick less in Customize.
vesta-server-blocker-memory-unknown = We couldn't check how much memory the machine has. Check again in a moment.
vesta-server-blocker-changed = Files changed while we were checking. Check again.
vesta-server-blocker-too-large = This server is too big to copy for now.
vesta-server-blocker-unsafe = This folder has links or special files that can't be copied safely.
vesta-server-blocker-other = Something needs fixing before this can be copied. Check again in a moment.

vesta-server-warning-auto-restart = I turned off auto start and auto restart for the original server
vesta-server-warning-rcon = I understand the copy starts with remote console (RCON) turned off
vesta-server-warning-truncated = Some folders weren't searched. Paste a path or browse if your server is missing.
vesta-server-warning-other = I've checked this server and want to continue

vesta-server-import-copying-title = Copying { $name }
vesta-server-import-phase-check = Checking files
vesta-server-import-phase-copy = Copying files
vesta-server-import-phase-finish = Finishing up
vesta-server-import-copied-bytes = { $done } of { $total }, { $count } of { $files } files
vesta-server-import-keeps-going = You can close this. Copying keeps going on { $name }.
vesta-server-import-paused-title = Copying { $name } stopped
vesta-server-import-paused-help = It stopped partway, maybe because { $name } restarted. Pick up where it left off.
vesta-server-import-resume = Resume
vesta-server-import-cancel-copy = Cancel copy
vesta-server-import-close = Close
vesta-server-import-ready-title = { $name } is copied
vesta-server-import-ready-help = Start it when you're ready.
vesta-server-import-start = Start
vesta-server-import-starting-title = Starting { $name }
vesta-server-import-starting = Waiting for the world to load
vesta-server-import-online-title = Server online
vesta-server-import-online-help = { $name } is running. Friends can join now.
vesta-server-import-cancelled-title = Copy cancelled
vesta-server-import-cancelled-help = Your original folder wasn't changed.
vesta-server-import-failed-title = Copy didn't finish
vesta-server-import-failed = Something went wrong on the machine. Try again.
vesta-server-import-start-failed = The server didn't start. Check its console after adding it, or try again.
vesta-server-import-busy = The machine is busy with another import. Try again in a moment.
vesta-server-import-eula-needed = Agree to the Minecraft EULA to continue.
vesta-server-import-gone = The machine no longer has this import. Start again.
vesta-server-import-port-busy = The game port is in use. Stop what's using it, or pick another port and check again.
vesta-server-import-disk-full = The machine is out of free space. Free some up, then try again.
vesta-server-import-confirm-all = Tick each box above to continue.
vesta-server-import-fix-first = Fix the items above, then check again.
vesta-server-import-out-of-date = Something changed since the last check. Check again.
vesta-server-import-full = This Vesta Server can't take more servers right now.
