server-pack-title = Modpack
server-pack-sections = Modpack sections
server-pack-tab-overview = Overview
server-pack-tab-content = Content
server-pack-tab-files = Files
server-pack-tab-versions = Versions
server-pack-loading = Loading the modpack…
server-pack-no-access = You can't view or download this server's modpack.
server-pack-read-only = Read-only
server-pack-customize-first = Customize first
server-pack-untitled = Untitled modpack
server-pack-back = Back
server-pack-done = Done
server-pack-retry = Retry with the same request
server-pack-review-again = Review again

# Linked instance status (instance page)
server-pack-update-available = An optional update is available.
server-pack-update-required = Update this linked pack before playing.
server-pack-unavailable = The server's release could not be verified. Check again when it is available.

# Header
server-pack-source-custom = Custom
server-pack-customizing = Customizing
server-pack-minecraft = Minecraft { $version }
server-pack-minecraft-locked = Follows the server's Minecraft version
server-pack-display-version = Version { $version }
server-pack-revision-facts = Revision { $published } · minimum { $minimum }
server-pack-never-published = Not published yet
server-pack-unpublished = Unpublished changes
server-pack-unpublished-count = { $count ->
    [one] 1 unpublished change
   *[other] { $count } unpublished changes
}
server-pack-review-publish = Review & publish

# First run
server-pack-first-title = Build a custom client pack
server-pack-first-description = A pack Vesta hosts for players, separate from the server software. Start from a file or from scratch; nothing reaches players until you publish.
server-pack-first-upload-title = Upload a modpack file
server-pack-first-upload-description = Use a .mrpack, a CurseForge export or a zip with mods and configs. Vesta checks it before anything changes.
server-pack-first-upload-hint = Or drop the file here.
server-pack-first-upload-action = Choose a file
server-pack-first-scratch-title = Start from scratch
server-pack-first-scratch-description = Build a custom pack, starting with the client mods this server's own content needs.
server-pack-first-scratch-action = Start a custom pack
server-pack-upload-bad-file = Choose a .mrpack or .zip modpack file.
server-pack-uploading = Uploading { $name }…
server-pack-inspecting = Checking the archive
server-pack-archive-detected = Found in { $name }
server-pack-archive-format = Format
server-pack-archive-minecraft = Minecraft
server-pack-archive-loader = Loader
server-pack-archive-entries = Entries
server-pack-archive-overrides = Override files
server-pack-format-mrpack = Modrinth pack
server-pack-format-curseforge = CurseForge pack
server-pack-format-zip = Plain zip
server-pack-format-vesta = Vesta pack
server-pack-archive-minecraft-differs = The archive targets another Minecraft version. The modpack always follows the server ({ $version }).
server-pack-archive-runtime-inferred = The loader can't be read from a plain zip, so the pack starts without one. Set the client loader in Overview.
server-pack-archive-unresolved = { $count ->
    [one] 1 file couldn't be matched to a provider
   *[other] { $count } files couldn't be matched to a provider
}
server-pack-archive-unresolved-help = These stay visible in Content and block publishing until each is replaced with a provider pin or an uploaded file.
server-pack-archive-provider-found = This is { $name } on { $provider }. Linking it means players download it from { $provider } and Vesta hosts nothing.
server-pack-archive-host-help = Vesta keeps a copy of this pack and serves it to players once you publish.
server-pack-scratch-title = Client mods the server needs
server-pack-scratch-description = These mods run on the server and players need them too. Choose which to start the pack with.
server-pack-scratch-loading = Checking the server's content
server-pack-scratch-none = The server's content doesn't need any client mods. You can add content after creating the pack.
server-pack-scratch-create = Create the modpack
server-pack-scratch-create-count = { $count ->
    [one] Create with 1 mod
   *[other] Create with { $count } mods
}

# Overview
server-pack-identity = Identity
server-pack-name = Name
server-pack-summary = Summary
server-pack-version = Display version
server-pack-version-help = Numbers and dots, e.g. 1.4.0
server-pack-loader = Client loader
server-pack-loader-none = None (vanilla)
server-pack-loader-version = Loader version
server-pack-minecraft-help = Minecraft { $version } comes from the server and can't be changed here.
server-pack-drift = The server now runs Minecraft { $version }. Update the pack to match before publishing.
server-pack-repair = Use the server's version
server-pack-icon-change = Change icon
server-pack-icon-invalid = Choose a PNG or JPEG up to 256 KB.
server-pack-save = Save
server-pack-saved = Modpack saved
server-pack-discard = Discard
server-pack-source = Source
server-pack-provider-help = Players download this pack from the provider. Vesta only stores which version to use.
server-pack-provider-newer = { $count ->
    [one] 1 newer version
   *[other] { $count } newer versions
}
server-pack-change-version = Change version
server-pack-customize = Customize
server-pack-customize-title = Customize this modpack?
server-pack-customize-description = Customizing turns the provider pack into a custom pack you can edit.
server-pack-customize-point-copy = Its mods, resources and override files are copied into a draft.
server-pack-customize-point-active = Players keep getting the provider version until you publish the custom pack.
server-pack-customize-point-host = Once published, Vesta hosts the custom pack instead of pointing to the provider.
server-pack-customize-confirm = Customize
server-pack-customized = The modpack is ready to customize
server-pack-customizing-help = Players still get the provider version. Publish this custom draft in Versions to switch them over.
server-pack-get-title = Get the modpack
server-pack-get-description = Install it as a new instance, or link an instance you already have. Vesta verifies the server's release first.
server-pack-get-unpublished = Publish the modpack before players can get it.
server-pack-get-target = Install into
server-pack-get-new = A new instance
server-pack-get-review-new = Review installation
server-pack-get-review-link = Review linking
server-pack-get-changes = { $added } to add · { $updated } to update · { $removed } to remove
server-pack-get-show-changes = Show every change
server-pack-get-consent = I approve the executable changes in revision { $version }
server-pack-get-consent-help = Mods and scripts run code on your computer.
server-pack-get-install = Install
server-pack-get-update = Install changes
server-pack-get-link-only = Link matching files only
server-pack-get-uncertain = The result is unclear. Check your library before trying again.

# Install on server
server-pack-install-planning = Downloading and verifying files
server-pack-install-software = Software
server-pack-install-minecraft = Minecraft
server-pack-install-loader = Loader version
server-pack-install-none = None
server-pack-install-runtime-matches = Server already matches
server-pack-install-switch-badge = Software change needed
server-pack-install-switch-help = This pack uses { $software } on Minecraft { $version } with the loader version shown above. Match that setup to continue.
server-pack-install-switch-first = Change the server software first
server-pack-install-review-software = Review software change
server-pack-install-replan = Plan again
server-pack-install-invalid = This pack can't be installed yet. Choose server software with a mod loader, then plan again.
server-pack-install-expired = This plan expired. Plan again to review the current state.
server-pack-install-expires = { $count ->
    [one] Plan valid for 1 more minute
   *[other] Plan valid for { $count } more minutes
}
server-pack-install-backup = Take a backup first. Replaced files go to the trash, but a backup restores everything at once.
server-pack-install-open-backups = Open backups
server-pack-install-conflicts = { $count ->
    [one] 1 file already on the server
   *[other] { $count } files already on the server
}
server-pack-install-conflict-choice = What to do with { $path }
server-pack-conflict-project-version = Another version of this project
server-pack-conflict-same-filename = A file with the same name
server-pack-conflict-unidentified = An unidentified jar
server-pack-install-replace = Replace
server-pack-install-keep = Keep mine
server-pack-install-overrides = { $count ->
    [one] 1 config or override file
   *[other] { $count } config and override files
}
server-pack-install-skipped = { $count ->
    [one] 1 client-only file skipped
   *[other] { $count } client-only files skipped
}
server-pack-warning-unknown-side = { $path } doesn't say which side it runs on, so it's included.
server-pack-warning-retained = { $path } isn't identified and stays as it is.
server-pack-warning-loader-inferred = The loader comes from the server's current software.
server-pack-install-staged-help = Files are staged and applied on the next restart.
server-pack-install-uncertain = The server may have received this already. Retrying sends the exact same request.
server-pack-install-staged = { $count ->
    [one] 1 file staged
   *[other] { $count } files staged
}
server-pack-install-staged-running = They apply when the server restarts.
server-pack-install-staged-stopped = They apply the next time the server starts.
server-pack-install-restart = Restart now

# Browse pick
server-pack-pick-title = Link { $title } to { $name }
server-pack-pick-description = A { $provider } modpack. Pick the version; the review shows what changes on the server.
server-pack-pick-version = Version

# Content
server-pack-search = Search the modpack
server-pack-filter-label = Kind
server-pack-filter-all = All
server-pack-kind-mod = Mod
server-pack-kind-resource-pack = Resource pack
server-pack-kind-shader = Shader
server-pack-kind-datapack = Datapack
server-pack-kind-config = Config
server-pack-kind-column = Kind
server-pack-required-column = Required
server-pack-required-entry = { $name } is required
server-pack-select-entry = Select { $name }
server-pack-select-all = Select all
server-pack-selected = { $count } selected
server-pack-clear-selection = Clear selection
server-pack-make-required = Make required
server-pack-make-optional = Make optional
server-pack-remove = Remove
server-pack-remove-selected = Remove
server-pack-remove-title = { $count ->
    [one] Remove 1 entry from the modpack?
   *[other] Remove { $count } entries from the modpack?
}
server-pack-remove-description = This changes the draft only. Players keep the published pack until you publish.
server-pack-removed = Removed from the draft
server-pack-updated = Updated in the draft
server-pack-update-entry = Update { $name }
server-pack-entry-actions = Actions for { $name }
server-pack-add-content = Add content
server-pack-customize-to-edit = Customize to edit
server-pack-content-read-only = This is a provider pack, so its content can't be edited. Customize it in Overview to make changes.
server-pack-content-empty = Nothing in the modpack yet
server-pack-content-empty-hint = Add mods, resource packs and shaders players should have.
server-pack-no-matches = No matches
server-pack-source-upload = Uploaded
server-pack-source-manual = Needs a file
server-pack-needs-file = Needs a file
server-pack-suggestions = Suggestions
server-pack-suggestions-count = { $count ->
    [one] 1 suggestion
   *[other] { $count } suggestions
}
server-pack-suggest-missing = The server runs { $name }; players need it too.
server-pack-suggest-newer = A newer version of { $name } is available.
server-pack-suggest-removed = { $name } was removed from the server.
server-pack-suggest-drift = The server moved to Minecraft { $version }.
server-pack-suggest-add = Add
server-pack-suggest-update = Update
server-pack-suggest-remove = Remove
server-pack-dismiss = Dismiss

# Files
server-pack-root-label = Which players get these files
server-pack-root-all = All
server-pack-root-client = Client only
server-pack-root-server = Server only
server-pack-root-all-hint = Files here go to players and to the server.
server-pack-root-client-hint = Files here only go to players. They win over the same file in All.
server-pack-root-server-hint = Files here only go to the server when the pack is installed there. Players never get them.
server-pack-root-folder = { $name }
server-pack-files-location = Modpack files
server-pack-files-empty = No files here
server-pack-files-empty-hint = Add configs, scripts and options players should start with, or drop files here.
server-pack-files-locked-title = Provider packs keep their own files
server-pack-files-locked-description = Customize the modpack to change its configs and other files.
server-pack-drop-hint = Drop to add to { $name }
server-pack-file-uploaded = Added { $name } to the draft
server-pack-file-trash-description = The file leaves the draft. Players keep it until you publish.
server-pack-upload-too-large = Files can be up to 16 MB.
server-pack-upload-path-refused = Modpack files go in mods, config, resourcepacks, shaderpacks, datapacks, defaultconfigs, kubejs, scripts or resources, or are options.txt or servers.dat.

# Versions
server-pack-published-revision = Published revision
server-pack-minimum-revision = Minimum revision
server-pack-draft-revision = Draft revision
server-pack-minimum-help = Players below the minimum must update before joining.
server-pack-draft-title = Draft
server-pack-up-to-date = Published
server-pack-draft-pending-help = Review what changed since the last release, then publish it.
server-pack-draft-clean-help = The draft matches the published release.
server-pack-reviewing = Building the review…
server-pack-diff-added = { $count } added
server-pack-diff-updated = { $count } updated
server-pack-diff-removed = { $count } removed
server-pack-diff-files = { $count ->
    [one] 1 custom file
   *[other] { $count } custom files
}
server-pack-diff-metadata = Name, icon, loader or other details changed.
server-pack-diff-resolved = { $count ->
    [one] 1 required dependency will be added automatically.
   *[other] { $count } required dependencies will be added automatically.
}
server-pack-issue-error = Fix before publishing: { $code } { $name }
server-pack-issue-warning = Check: { $code } { $name }
server-pack-snapshot = A backup before publishing is recommended.
server-pack-publish-mode = Update type
server-pack-publish-optional = Optional
server-pack-publish-required = Required
server-pack-publish-optional-help = Players can keep playing on the previous release.
server-pack-publish-required-help = Players must update before joining. This raises the minimum revision.
server-pack-ack = I know this release has a lower display version.
server-pack-ack-older = I know this is an older version.
server-pack-publish = Publish
server-pack-publishing = Publishing…
server-pack-published = Published revision { $version }
server-pack-published-optional = Revision { $version } is out as an optional update.
server-pack-published-required = Revision { $version } is out and required.
server-pack-provider-versions = { $provider } versions
server-pack-show-all-versions = Show all versions
server-pack-loading-versions = Loading versions…
server-pack-versions-failed = Couldn't load versions.
server-pack-versions-empty = No versions are available.
server-pack-saving = Saving changes…
server-pack-no-versions = No versions for Minecraft { $version }.
server-pack-active-version = Active
server-pack-switch-version = Switch to this version
server-pack-switch-confirm = Switch
server-pack-switched = Switched to { $version } (revision { $revision })

server-pack-history-title = Published history
server-pack-history-empty = No published revisions yet.
server-pack-history-loading = Loading published versions…
server-pack-history-counts = { $entries } entries, { $overrides } overrides
server-pack-history-entries = { $count } entries
server-pack-history-overrides = { $count } overrides
server-pack-no-loader-versions = No compatible versions found
server-pack-provider-not-configured = CurseForge isn't configured on this server. Its API key must be set on the agent before linking this pack.
server-pack-download-unavailable = CurseForge refused this file's download or no longer hosts it. Try another pack version or install its server files manually.
server-pack-metadata-invalid = The provider returned invalid file details while preparing this pack. Retry or choose another version.
server-pack-download-failed = A pack file couldn't be downloaded. Check the server's connection and retry.
server-pack-hash-mismatch = A downloaded pack file didn't match the provider's checksum. Nothing was installed. Retry to download it again.
server-pack-source-unsafe = The provider returned a file name or download address Vesta can't use safely. Try another pack version.
server-pack-path-invalid = This pack contains a file path Vesta can't install safely. Try another version.
server-pack-archive-invalid = This pack's archive or manifest isn't supported. Choose another version or a Minecraft modpack export.
server-pack-too-large = This pack exceeds the server's import limits. Use a smaller pack or install its server files manually.
server-pack-unresolved-file = This pack contains a file without a verified download. Add a provider version for that file before installing.
server-pack-error-details = Error details
server-pack-error-copy-failed = Could not copy. Select and copy the details below.
server-pack-provider-unavailable = Couldn't download or verify the pack from its provider. Try again later.

# Sections: the server's own modpack link and the client pack are independent
server-pack-section-server = Server modpack
server-pack-section-client = Client pack
server-pack-client-sections = Client pack sections
server-pack-linked-badge = Linked
server-pack-restart-badge = Restart
server-pack-optional = Optional
server-pack-coming-soon = Coming soon

# Server modpack: not linked
server-pack-link-none-title = This server doesn't use a modpack
server-pack-link-none-description = That's fine: a server runs without one. Link a modpack to install its server-side content and keep it up to date, like an instance linked to a modpack. Your own content stays separate.
server-pack-link-no-permission = Only an owner or administrator who can install content can link a modpack.
server-pack-link-browse-title = Browse modpacks
server-pack-link-browse-description = Pick a Modrinth or CurseForge modpack. The server tracks its versions, so updates show up here.
server-pack-link-browse-action = Browse modpacks
server-pack-link-upload-title = Upload a modpack file
server-pack-link-upload-description = Use a .mrpack, a CurseForge export or a zip. Vesta checks it and shows exactly what changes before anything is installed.
server-pack-archive-link-file-help = This file isn't a published modpack Vesta can identify, so the server is linked to the file itself and won't find updates on its own.
server-pack-link-review = Review link
server-pack-link-wait-restart = A reviewed change is waiting for a restart. Restart the server first, then try again.
server-pack-link-source-upload = Uploaded modpack
server-pack-link-source-vesta = Vesta pack

# Server modpack: linked
server-pack-link-installed = Installed { $version }
server-pack-link-not-confirmed = Not installed yet
server-pack-link-pending-badge = { $version } after restart
server-pack-link-current = Up to date
server-pack-link-checking = Checking for updates
server-pack-link-update-to = Update to { $version }
server-pack-link-actions = Modpack actions
server-pack-link-check = Check for updates
server-pack-link-open-resources = Open Resources
server-pack-link-pending-install = { $version } is staged and installs when the server restarts.
server-pack-link-pending-update = The update to { $version } is staged and applies when the server restarts.
server-pack-link-pending-help = { $count ->
    [one] 1 change waits in Resources. Until then you can't start another update or unlink.
   *[other] { $count } changes wait in Resources. Until then you can't start another update or unlink.
}
server-pack-owned-title = Content from this modpack
server-pack-owned-description = { $count ->
    [0] The modpack doesn't own any server files yet.
    [one] 1 server file comes from this modpack. Resources marks it, and it changes through updates rather than one by one.
   *[other] { $count } server files come from this modpack. Resources marks them, and they change through updates rather than one by one.
}
server-pack-owned-more = { $count ->
    [one] and 1 more
   *[other] and { $count } more
}
server-pack-owned-user-kept = Content you add yourself is never touched by updates or unlinking.
server-pack-offering-none = Players aren't offered a pack. Linking the server doesn't change that.
server-pack-offering-server = Players are offered this modpack.
server-pack-offering-custom = Players get your custom client pack, separate from this modpack.
server-pack-offering-open = Open client pack
server-pack-unlink = Unlink
server-pack-unlink-title = Unlink { $name }
server-pack-unlink-description = The server stops tracking this modpack. Choose what happens to the files it installed.
server-pack-unlink-keep = Keep its files
server-pack-unlink-keep-help = { $count ->
    [one] The 1 file stays as ordinary server content.
   *[other] The { $count } files stay as ordinary server content.
}
server-pack-unlink-remove = Remove its files
server-pack-unlink-remove-help = { $count ->
    [one] The 1 file it installed is removed on the next restart. Files you changed are kept.
   *[other] The { $count } files it installed are removed on the next restart. Files you changed are kept.
}
server-pack-unlink-offering = Players are offered this modpack. After unlinking they get no pack until you choose another.
server-pack-unlinked = { $name } is no longer linked
server-pack-unlinked-removing = { $count ->
    [one] 1 file is removed on the next restart.
   *[other] { $count } files are removed on the next restart.
}

# Link / update review
server-pack-link-dialog-title = Link { $name }
server-pack-update-dialog-title = Update { $name }
server-pack-link-dialog-description = Install on { $title }. Client-only files are skipped. Changes that need a decision are shown before installation.
server-pack-link-apply = { $count ->
    [one] Link and stage 1 change
   *[other] Link and stage { $count } changes
}
server-pack-update-apply = { $count ->
    [one] Stage 1 change
   *[other] Stage { $count } changes
}
server-pack-review-added = { $count ->
    [one] 1 entry added
   *[other] { $count } entries added
}
server-pack-review-updated = { $count ->
    [one] 1 entry updated
   *[other] { $count } entries updated
}
server-pack-review-removed = { $count ->
    [one] 1 entry removed
   *[other] { $count } entries removed
}
server-pack-review-removed-help = Only files this modpack installed earlier are removed. A file you changed stops the restart from removing it.
server-pack-review-unchanged = { $count ->
    [one] 1 file already matches.
   *[other] { $count } files already match.
}
server-pack-link-players-unchanged = What players get doesn't change. That's a separate choice under Client pack.
server-pack-offer-title = Also offer it to players
server-pack-offer-description = Players get this same modpack when they join, downloaded from its provider.
server-pack-offer-action = Offer to players
server-pack-pick-review-link = Review link
server-pack-pick-review-update = Review update
server-pack-pick-point-server = Its server-side content is installed on the server; client-only mods are skipped.
server-pack-pick-point-players = What players get stays a separate choice.
server-pack-pick-replaces = The server is linked to another modpack. Linking this one replaces that link; files only the old one installed are listed for removal.

# Client pack: what players get
server-pack-client-title = What players get
server-pack-client-description = Optional, and separate from the server's own modpack. Players can always join with any compatible client.
server-pack-mode-none = Nothing
server-pack-mode-none-description = Players aren't offered a pack.
server-pack-mode-none-short = None
server-pack-mode-server = Same as the server's modpack
server-pack-mode-server-description = Players get the modpack the server is linked to.
server-pack-mode-server-linked = Players get { $name }, the modpack the server is linked to.
server-pack-mode-server-short = Server modpack
server-pack-mode-custom = Custom pack
server-pack-mode-custom-description = A pack you build here, separate from the server software. Vesta hosts it.
server-pack-mode-custom-short = Custom
server-pack-mode-current = Current
server-pack-mode-coming-soon = Offering the server's modpack to players isn't available yet.
server-pack-mode-needs-link = Link the server to a modpack first.
server-pack-mode-no-permission = You can't change what players get.
server-pack-mode-server-not-live = This server is set to offer its modpack, but delivery isn't available yet, so players can't download a pack right now.
server-pack-mode-require-update = Require players to update
server-pack-mode-require-update-help = Players must take a new version of the modpack before they can join.
server-pack-mode-change-none = Players won't be offered a pack.
server-pack-mode-change-none-kept = Players won't be offered a pack. Your custom pack and its history are kept; switch back any time.
server-pack-mode-change-custom = Players get your published custom pack again.
server-pack-mode-change-custom-new = Players get the custom pack once you publish it.
server-pack-mode-change-server = Players get { $name } when they join.
server-pack-mode-save = Save
server-pack-mode-saved = Saved what players get
server-pack-use-as-client-pack = Use as the client pack
server-pack-check-content = Check for updates
server-pack-checking-content = Checking for updates…
server-pack-check-content-failed = Some updates couldn't be checked. Try again.

server-pack-install-action = Install
server-pack-install-preparing = Preparing installation?
server-pack-install-notes = { $count } notes
server-pack-install-current-runtime = Installed: { $software } { $version }, loader { $loader }

server-pack-warning-missing-dependency = A required dependency is missing from this pack: { $path }

# Install review
server-pack-review-version = Version
server-pack-review-installed = Installed { $version }
server-pack-review-badge-update = Update
server-pack-review-badge-installed = Installed
server-pack-review-badge-older = Older version
server-pack-review-switch = Switches the server to { $target }
server-pack-review-switch-current = now { $source }
server-pack-review-switch-ack = This changes the server's software and may break existing worlds or plugins
server-pack-review-switch-needs-ack = Confirm the software change to continue
server-pack-review-switch-started = The server is switching to { $target }.
server-pack-review-changes = Changes
server-pack-review-count-added = { $count } added
server-pack-review-count-updated = { $count } updated
server-pack-review-count-removed = { $count } removed
server-pack-review-count-overrides = { $count ->
    [one] 1 config file
   *[other] { $count } config files
}
server-pack-review-count-skipped = { $count } client-only skipped
server-pack-review-conflicts = { $count ->
    [one] 1 file already on the server
   *[other] { $count } files already on the server
}
server-pack-review-nothing = Already installed. Nothing to change.
server-pack-review-backup-first = Back up first
server-pack-review-backup-failed = The backup didn't finish. Try again, or untick Back up first.
server-pack-review-backing-up = Backing up…
server-pack-review-installing = Installing…
server-pack-review-install = Install
server-pack-review-update = Update
server-pack-review-note-restart = Applies on the next restart.
server-pack-review-note-start = Applies when the server starts.
server-pack-review-note-players = Players get it too.
server-pack-review-stage-archive = Reading the pack
server-pack-review-stage-metadata = Resolving files
server-pack-review-stage-review = Checking the server
server-pack-play-title = Play on this server
server-pack-play-version = Pack version { $version }
server-pack-play-create = Create instance
server-pack-play-link = Link existing instance
server-pack-play-create-title = Create an instance for { $title }
server-pack-play-link-title = Link an instance to { $title }
server-pack-play-instance = Instance
server-pack-play-instance-pick = Choose an instance
server-pack-play-instance-none = No instances to link
server-pack-play-checking = Checking the server's pack
server-pack-play-consent = I trust the mods and scripts in this pack
server-pack-play-none = This server doesn't offer a modpack.
server-pack-review-note-replaces = Replaces the current modpack link.
server-pack-provider-filename = This file name cannot be stored safely. Choose another version or rename the file before importing.
server-pack-provider-host = The download URL must use HTTPS and contain no credentials. Choose another pack version.
server-pack-provider-redirect = The download redirected too many times. Try again.
server-pack-provider-manual = This file requires a manual download from the provider.
server-pack-review-note-stop = Stop Minecraft to switch the software.

server-pack-error-pack-limit-invalid = The pack limits are invalid. Ask the server owner to correct them.
server-pack-error-pack-path-protected = The pack includes a protected server file. Remove it and review again.
server-pack-error-pack-path-linked = The pack path crosses a linked directory. Use a directory without links.
server-pack-error-pack-unavailable = The pack storage cannot be read. Check server storage and retry.
server-pack-error-pack-artifact-conflict = The stored pack changed. Refresh and review again.
server-pack-error-pack-artifact-not-published = This pack has not been published. Ask the owner to publish it.
server-pack-error-pack-release-revision-exhausted = The pack revision counter is exhausted. Contact the server owner.
server-pack-error-pack-release-revision-mismatch = The pack revision differs from the review. Refresh and review again.
server-pack-error-pack-release-version-not-increasing = This version is older than the published pack. Acknowledge the downgrade in the publication review.
server-pack-error-pack-release-version-invalid = The pack version is invalid. Enter a numeric version such as 1.2.3.
server-pack-error-pack-prune-recovery-required = Pack cleanup needs recovery. Ask the server owner to repair pack storage.
server-pack-error-pack-custom-content-disabled = This server does not allow custom content. Ask its owner to enable it.
