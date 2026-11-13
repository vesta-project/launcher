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
vesta-server-step-account = Account

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

vesta-server-account-title = Confirm your account
vesta-server-account-claim-help = This account becomes the owner of { $name }.
vesta-server-account-link-help = This device will be linked to { $name } with this account.
vesta-server-account-microsoft = Microsoft account
vesta-server-account-missing = Sign in with a Microsoft account to continue.
vesta-server-account-add = Sign in
vesta-server-account-claim = Set up
vesta-server-account-link = Link this device
vesta-server-account-working = Connecting

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

vesta-server-problem-setup-code = That code didn't work. It may have expired or already been used. Get a new one on the machine.
vesta-server-problem-link-code = That link code didn't work. It may have expired. Ask for a new one.
vesta-server-problem-link-declined = This device wasn't approved. Try again with a new link code.
vesta-server-problem-account = We couldn't check your Microsoft account right now. Try again in a moment.
vesta-server-problem-too-many = Too many tries. Wait a minute and try again.
vesta-server-problem-unreachable = Can't reach that machine. Check that it's on and Vesta Server is running.
vesta-server-problem-already-set-up = This machine is already set up. Use a link code instead.
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
vesta-server-list-machine-settings = Vesta Server settings
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

vesta-server-import-step-kind = Start
vesta-server-import-step-folder = Folder
vesta-server-import-step-review = Review
vesta-server-import-step-copy = Copy
vesta-server-import-kind-title = Add a server to { $name }
vesta-server-import-kind-import = Import
vesta-server-import-kind-new = New
vesta-server-import-kind-modpack = Modpack
vesta-server-import-kind-restore = Restore
vesta-server-import-soon = Coming soon
vesta-server-import-kind-import-help = Bring in a server that's already on that machine, like one from AMP.

vesta-server-import-folder-title = Pick the server folder
vesta-server-import-folder-remote = These folders are on { $name }, not this computer.
vesta-server-import-found = Found on { $name }
vesta-server-import-found-none = No servers found automatically. Browse for the folder below.
vesta-server-import-looking = Looking
vesta-server-import-browse = Browse { $name }
vesta-server-import-no-roots = Vesta Server can't see any folders yet. Share the folder your server is in by running this on the machine:
vesta-server-import-up = Up
vesta-server-import-empty-folder = No folders here
vesta-server-import-more = Show more
vesta-server-import-use-folder = Use this folder
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
vesta-server-import-from = From
vesta-server-import-unknown = Unknown
vesta-server-import-name = Name
vesta-server-import-memory = Memory
vesta-server-import-memory-gb = Memory (GB)
vesta-server-import-java = Java
vesta-server-import-java-auto = Picked for you
vesta-server-import-java-auto-version = Java { $version }, picked for you
vesta-server-import-customize = Customize
vesta-server-import-customize-help = Check again to use these settings.
vesta-server-import-blocked = A few things to fix first
vesta-server-import-untouched = Your server is copied. The original folder stays exactly as it is.
vesta-server-import-stopped = The original server is stopped and won't restart on its own
vesta-server-import-eula = I agree to the Minecraft EULA
vesta-server-import-copy = Copy server
vesta-server-import-copy-starting = Starting copy

vesta-server-blocker-source-running = This server is still running. Stop this server in AMP first, then check again.
vesta-server-blocker-source-unknown = We couldn't tell if this server is running. Stop it in AMP, then check again.
vesta-server-blocker-permission = Vesta Server needs permission to read this folder. Run this on the machine, then check again:
vesta-server-blocker-port-in-use = Port { $port } is already in use. Pick another port in Customize, or stop what's using it.
vesta-server-blocker-port-unknown = We couldn't find a free port. Pick one in Customize, then check again.
vesta-server-blocker-disk = Not enough free space on the machine. This server needs { $size } and { $free } is free.
vesta-server-blocker-software = We couldn't tell which Minecraft version or server software this is.
vesta-server-blocker-not-minecraft = This folder doesn't look like a Minecraft server. Pick the folder with server.properties in it.
vesta-server-blocker-memory = That's more memory than the machine can spare. Pick less in Customize.
vesta-server-blocker-memory-unknown = We couldn't check how much memory the machine has. Check again in a moment.
vesta-server-blocker-changed = Files changed while we were checking. Check again.
vesta-server-blocker-too-large = This server is too big to copy for now.
vesta-server-blocker-unsafe = This folder has links or special files that can't be copied safely.
vesta-server-blocker-other = Something needs fixing before this can be copied. Check again after a moment.

vesta-server-warning-amp-restart = I turned off auto start and auto restart for this server in AMP
vesta-server-warning-unreadable = Vesta Server can't read { $path }. To include it, run this on the machine:
vesta-server-warning-outside = { $path } is outside the folders Vesta Server can see.
vesta-server-warning-truncated = Some folders weren't checked. Browse for your server if it's missing.
vesta-server-warning-other = I've checked this server and want to continue

vesta-server-import-copying-title = Copying { $name }
vesta-server-import-copying = Copying
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
