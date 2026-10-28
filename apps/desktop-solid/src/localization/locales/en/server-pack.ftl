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
server-pack-installed = Installed revision:
server-pack-current = Up to date
server-pack-update-available = An optional update is available.
server-pack-update-required = Update this linked pack before playing.
server-pack-unavailable = The server's release could not be verified. Check again when it is available.
server-pack-release = Release / minimum revisions:
server-pack-reload = Check again
server-pack-review-install = Review update

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
server-pack-first-title = Give { $name } a modpack
server-pack-first-description = Players get the modpack from Vesta when they join. Pick where it comes from; you can change it later.
server-pack-first-provider-title = Use a Modrinth or CurseForge modpack
server-pack-first-provider-description = Pick a published modpack. The server only points to it, so players download it from the provider and nothing is hosted.
server-pack-first-provider-action = Browse modpacks
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
server-pack-link-provider = Link the { $provider } pack (not hosted)
server-pack-host-copy = Host my copy
server-pack-use-as-modpack = Use as { $name }'s modpack
server-pack-also-install = Also install on the server
server-pack-also-install-help = Review the server-side files next. Nothing changes until you apply, and files wait for a restart.
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
server-pack-install-title = Install on this server
server-pack-install-description = Put this pack's server-side mods and configs on the server, the way a server pack would.
server-pack-install-point-side = Client-only mods and resource packs are skipped
server-pack-install-point-review = You review conflicts with what's already installed
server-pack-install-point-restart = Changes apply on the next restart
server-pack-install-action = Plan the install

# Install on server
server-pack-install-dialog-title = Install { $name } on the server
server-pack-install-dialog-description = Review what changes on { $title }. Nothing happens until you apply.
server-pack-install-planning = Planning the install
server-pack-install-software = Software
server-pack-install-minecraft = Minecraft
server-pack-install-loader = Loader version
server-pack-install-none = None
server-pack-install-runtime-matches = Server already matches
server-pack-install-switch-badge = Software change needed
server-pack-install-switch-help = This pack needs { $software } on Minecraft { $version }. Change the server software first, then plan again.
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
server-pack-install-content = { $count ->
    [one] 1 mod or datapack
   *[other] { $count } mods and datapacks
}
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
server-pack-install-assign = Also use as { $title }'s modpack
server-pack-install-assign-help = Players get it from Vesta. This runs after the files are staged and can be retried on its own.
server-pack-install-staged-help = Files are staged and applied on the next restart.
server-pack-install-apply = { $count ->
    [one] Stage 1 file
   *[other] Stage { $count } files
}
server-pack-install-uncertain = The server may have received this already. Retrying sends the exact same request.
server-pack-install-staged = { $count ->
    [one] 1 file staged
   *[other] { $count } files staged
}
server-pack-install-staged-running = They apply when the server restarts.
server-pack-install-staged-stopped = They apply the next time the server starts.
server-pack-install-assigned = It's now the server's modpack (revision { $version }).
server-pack-install-assign-pending = The files are staged, but the modpack wasn't assigned. Try again from Overview.
server-pack-install-open-content = Open server content
server-pack-install-restart = Restart now

# Browse pick
server-pack-pick-title = Use { $name } on { $title }
server-pack-pick-description = A { $provider } modpack. Linking it hosts nothing; players download it from { $provider }.
server-pack-pick-version = Version
server-pack-pick-assign = Use as { $title }'s modpack
server-pack-pick-assign-help = Players are offered this exact version when they join.
server-pack-pick-link = Use as modpack
server-pack-pick-review-install = Review install
server-pack-linked = { $name } is now the server's modpack

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
server-pack-no-versions = No versions for Minecraft { $version }.
server-pack-active-version = Active
server-pack-switch-version = Switch to this version
server-pack-switch-confirm = Switch
server-pack-switched = Switched to { $version } (revision { $revision })
