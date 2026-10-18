# Browse page: search Modrinth, CurseForge and Smithed, then install into an instance.

browse-trail-for = for { $name }
browse-type-label = Resource type
browse-type-mod = Mods
browse-type-modpack = Modpacks
browse-type-resourcepack = Resource packs
browse-type-shader = Shaders
browse-type-datapack = Data packs
browse-type-world = Worlds
browse-source-label = Source
browse-sort-label = Sort by
browse-sort-relevance = Relevance
browse-sort-downloads = Downloads
browse-sort-follows = Followers
browse-sort-newest = Newest
browse-sort-updated = Recently updated
browse-sort-featured = Featured
browse-sort-popularity = Popularity
browse-sort-rating = Rating
browse-sort-name = Name
browse-sort-author = Author
browse-sort-total-downloads = Total downloads
browse-sort-trending = Trending
browse-order-ascending = Ascending
browse-order-descending = Descending
browse-install-to = Install to
browse-layout-label = Card layout
browse-layout-banner = Banners
browse-layout-compact = Compact

browse-search-placeholder = Search { $type }, or type mc:1.21.1 loader:fabric
browse-search-label = Search resources
browse-clear-search = Clear search and filters
browse-filters = Filters
browse-filters-active =
    { $count ->
        [one] Filters, { $count } active
       *[other] Filters, { $count } active
    }
browse-remove-filter = Remove filter { $name }
browse-open-link = Open { $value }
browse-more-filters =
    { $count ->
        [one] { $count } more filter
       *[other] { $count } more filters
    }

browse-section-instance = Instance
browse-section-version = Minecraft version
browse-section-loader = Loader
browse-section-environment = Environment
browse-section-creator = Creator
browse-section-categories = Categories
browse-no-instance = Any instance
browse-instance-modpack-note = Modpacks create a new instance.
browse-any-version = Any version
browse-any-loader = Any loader
browse-show-snapshots = Show snapshots
browse-environment-client = Client
browse-environment-server = Server
browse-clear-creator = Clear
browse-clear-all = Clear all
browse-reset-filters = Reset filters
browse-toggle-group = Toggle { $name } categories

browse-results-label = Search results
browse-results-count =
    { $count ->
        [one] { $count } result
       *[other] { $count } results
    }
browse-per-page = Per page
browse-loading = Loading results
browse-cached-warning = Showing saved results while the source is unavailable.
browse-error-title = Search failed
browse-retry = Try again
browse-empty-title = No resources found
browse-empty-description = Try a different search or remove some filters.
browse-pages-label = Result pages
browse-previous = Previous
browse-next = Next
browse-dismiss = Dismiss

browse-by-author = by { $author }
browse-filter-by-author = Show only projects by { $author }
browse-more-tags = +{ $count }
browse-more-categories =
    { $count ->
        [one] { $count } more category
       *[other] { $count } more categories
    }
browse-followers-title = { $count } followers
browse-downloads-title = { $count } downloads

browse-action-install = Install
browse-install-into = Install into { $title }
browse-action-installed = Installed
browse-action-update = Update
browse-action-installing = Installing…
browse-reason-vanilla = Vanilla instances cannot use this.
browse-reason-loader = Not available for this instance's loader.
browse-reason-no-version = No version matches this instance.
browse-reason-fabric-on-quilt = Fabric build, runs on Quilt.
browse-reason-forge-on-neoforge = Forge build, runs on NeoForge.

browse-install-started = Installing { $name } into { $title }.
browse-no-version = No version of { $name } fits { $title }.
browse-external-download = { $name } can only be downloaded from its website. Opening it.
browse-install-failed = Install failed: { $message }

browse-picker-title = Install into an instance
browse-picker-description = Choose where to install { $name }.
browse-picker-search = Search instances
browse-picker-empty = No instances match.
browse-picker-new-instance = New instance
browse-status-checking = Checking…
browse-status-ready = Compatible
browse-status-installed = Installed
browse-status-update = Update available

browse-pending-resource-world = Create or import a world after setup, then install { $name } into that world from Browse.
browse-pending-resource = After this instance is ready, install { $name } into it.
browse-new-instance-desktop = Creating an instance requires the desktop launcher.
browse-new-instance-pack = Use the modpack create flow for modpacks.
browse-new-instance-metadata = Minecraft metadata is unavailable.
browse-new-instance-loader = Unsupported loader: { $loader }
browse-new-instance-no-version = No downloadable compatible version of { $name } is available.
browse-new-instance-world = { $title } is ready. Create or import a world, then install { $name } from Browse into that world.
browse-new-instance-removed = The new instance was removed; resource installation cancelled.
browse-new-instance-stopped = Instance creation stopped: { $message }
browse-new-instance-timeout = Timed out waiting for the new instance. Resume it from the Library, then install the resource from Browse.
browse-world-title = Choose a world
browse-world-description = { $name } is a data pack, so it goes into one world of { $title }.
browse-world-empty = This instance has no worlds yet. Play once to create one, then install.
browse-world-load-failed = Could not load worlds: { $message }
browse-world-required = Datapack installation requires a world target.
browse-install-task-failed = Resource installation failed. See notifications for details.

# Project page: header, tabs, facts column, versions list and version view.

browse-project-sections = Project sections
browse-project-more = More actions
browse-project-facts = About this project
browse-project-failed = Could not load this project
browse-project-missing = This project link is not valid.
browse-loading-project = Loading project
browse-tab-description = Description
browse-tab-gallery = Gallery
browse-tab-versions = Versions
browse-kind-mod = Mod
browse-kind-modpack = Modpack
browse-kind-resourcepack = Resource pack
browse-kind-shader = Shader
browse-kind-datapack = Data pack
browse-kind-world = World
browse-open-on = Open on { $source }
browse-source-switch = Project source
browse-copy-link = Copy link
browse-link-copied = Link copied.
browse-updated-on = Updated { $date }
browse-no-description = The author has not written a description.
browse-spoiler = Spoiler
browse-gallery-open = Open image { $count }

browse-fit-title = For { $title }
browse-fit-best = Best match
browse-fit-installed = Installed: { $version }
browse-facts-details = Details
browse-facts-minecraft = Minecraft
browse-facts-loaders = Loaders
browse-facts-published = Published
browse-facts-updated = Updated
browse-facts-creators = Creators
browse-facts-links = Links
browse-environment-both = Client and server
browse-creator-organization = Organization
browse-creator-owner = Owner
browse-creator-member = Member

browse-search-versions = Search versions
browse-channel-all = All
browse-fits-target = Fits { $title }
browse-fits-hint = Only versions that can be installed into { $title }
browse-versions-total =
    { $count ->
        [one] { $count } version
       *[other] { $count } versions
    }
browse-versions-shown = { $found } of { $count }
browse-versions-failed = Could not load versions
browse-loading-versions = Loading versions
browse-versions-none = No versions published yet
browse-versions-no-match = No versions match these filters
browse-column-version = Version
browse-column-published = Published
browse-column-downloads = Downloads
browse-install-replaces = Replaces the installed version in { $title }
browse-reason-game-version = Made for other Minecraft versions.
browse-status-replace = Replaces installed version
browse-picker-description-version = Choose where to install { $name } { $version }.

browse-all-versions = All versions
browse-loading-version = Loading version
browse-version-missing = This version could not be found
browse-version-newer = Newer version
browse-version-older = Older version
browse-version-position = { $found } of { $count }
browse-version-facts = About this version
browse-version-changelog = Changelog
browse-changelog-failed = The changelog could not be loaded.
browse-version-compatibility = Compatibility
browse-version-fits = Fits { $title }.
browse-version-misfit = Does not fit { $title }.
browse-show-all = Show all { $count }
browse-show-fewer = Show fewer
browse-version-files = Files
browse-file-primary = Primary
browse-file-role-datapack = Data pack
browse-file-role-resourcepack = Resource pack
browse-file-download = Download file
browse-file-copy-hash = Copy SHA-1 hash
browse-hash-copied = Hash copied.
browse-version-dependencies = Dependencies
browse-dependency-required = Required
browse-dependency-optional = Optional
browse-dependency-embedded = Included
browse-dependency-incompatible = Incompatible
browse-dependency-pinned = Exact version
browse-dependency-unknown = Unknown project
