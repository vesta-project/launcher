# Unified servers: design review

Reviewer: GPT-6.1 Sol, 2026-11-02. Verdict: **accept with changes**.
Scope: proposal and research review, with targeted source checks; no game, loader or hosting integration tested. External API claims remain research uncertainties, not verified contracts.

## What the proposal gets right

The user wants connected tasks, not a taxonomy of integrations. One route from a server to its client pack, launch action and permitted administration is right. Reusing LinkedPack and the existing update review is especially good: another sync screen would recreate the original problem. Keeping ordinary Play stable and deferring unsupported hosting APIs are also correct.

But the proposal equates simplicity with one entity, one input and no explicit associations. Those are implementation choices, not evidence of a simpler experience. A remembered, visible choice is often simpler than an inferred one. Unify navigation and actions first; do not require every underlying object to become a server record.

## Changes required before implementation

### 1. Make the instance the launch context; make the server an optional shared identity

The rejected instance Servers tab is a false dichotomy: Minecraft already has a curated per-instance list in `servers.dat`. Showing that list does not introduce another assignment chore. A global registry filtered by inferred compatibility may actually be less predictable.

Use **destinations of this instance** as the primary play model: local worlds, saved addresses and actual recent joins. Worlds & servers is a reasonable label, with separate lists and actions. Keep the existing world management detail routes. A shared server identity enriches a destination with pack and administration links when known. Opening an instance row must always launch that instance; never silently redirect to another server-linked instance.

The global Servers area can still combine saved favourites and managed servers. Its purpose is cross-instance access, not a mandatory master catalogue. Do not create a global record merely because an address appeared in a game log. The proposal already requires opt-in import, contradicting “no second list anywhere”: these are different views with different membership rules. State that honestly.

Capabilities are useful internally; users should see **Play**, **Pack**, **Manage**, with an explanation when unavailable. Do not expose a capability taxonomy or create a detail page just to hold an address and a chooser. Join-only rows can use a small details panel.

### 2. Separate identity, authority and availability

“A server is an address people join” is too narrow. A managed server may have no public address yet, be stopped, or sit behind a proxy shared by several backends. Its pack can exist before it is joinable. Conversely, one server can have several addresses. DNS resolution is not identity: never merge records because hostnames currently resolve to the same IP.

Keep an opaque server identity with optional join endpoints, optional pack authority, and references to management connections. Preserve the original Minecraft hostname for joining, alongside a conservative comparison key. An agent endpoint is a separate HTTPS destination, not a Minecraft address.

Source evidence: [`native.ts`](../../apps/desktop-solid/src/features/servers/native.ts) distinguishes opaque connection ID, endpoint, server ID, TLS fingerprint and `joinAddress`. It also already uses “capabilities” for effective role permissions. A `ManageSource` existing does not grant console/file/start permissions; a Vesta player connection need not manage anything, and an owner need not publish a pack. Keep configured integration, current authorization and current reachability separate. An outage must not remove tabs or bindings.

### 3. Replace inferred compatibility with explicit, stable launch selection

A `servers.dat` entry means “saved here”; a successful join means “worked then”; a protocol match means neither loader nor mod/config compatibility. Label these as evidence, never as guaranteed compatible instances. Mods and proxies can make ping information incomplete or misleading.

The proposed precedence also lets a later join through B override a deliberate remembered choice of A. Use this order for a global Play action:

1. Use the explicitly selected default for this server and Minecraft account, if it still exists and satisfies known pack requirements.
2. If there is exactly one authoritative linked candidate, offer/use it; otherwise ask once, showing linked and previously used instances with reasons.
3. Remember the choice only when requested or clearly communicated. Show “Play with Fabric SMP” and an adjacent Change action. If that instance disappears or becomes invalid, ask again; do not substitute silently.

Instance-context Play bypasses this resolver. Freeze instance, target, account and reviewed pack revision when starting the operation; revalidate before launching. Installation must not later join using whichever instance/account happens to be selected then. Cancellation after installation leaves the installed instance without joining; retry reuses it.

“One-to-one, as today” is unsupported. [`native-pack-sync.ts`](../../apps/desktop-solid/src/features/servers/native-pack-sync.ts) accepts either a fresh installation or an existing instance; [`pack_sync.rs`](../../vesta-launcher/src-tauri/src/servers/pack_sync.rs) stores bindings per instance, with no server-wide uniqueness constraint in that path. Permit multiple client instances for a server, and multiple ordinary destinations for one instance. Keep one active authoritative pack source per instance. A preferred instance is a preference, not ownership.

### 4. Make Modrinth phase 1 an honest pinned association

An address plus a modpack project does not establish what the server runs. The research correctly leaves discovery unverified. A project URL alone lacks a destination; a hosting URL may lack accessible pack metadata. One input can recognize formats, but it cannot eliminate follow-up questions. Show what was recognized, then request missing address, exact pack version or credentials. Preserve the entered address if enrichment fails; do not probe every arbitrary address as an agent.

Initial flow: **address -> choose existing instance or install exact pack version -> remember choice**. Say “Pack version selected by you; server requirements unverified.” The user is the authority for this association; Modrinth verifies the content identity, not its suitability for this server. Offer an explicit version change through existing review. Default `followLatest` to false, and preferably omit it initially: the newest project release can break joining a server still running an older version.

Distinguish that advisory pin from a Vesta signed publication's enforced revision/minimum. If the server changes Minecraft/loader version, preserve the old client and offer a new instance; do not promise an in-place sync the backend cannot do. Reuse install/diff/review machinery, not the Vesta authority protocol. Defer CurseForge expansion until the same small flow works for Modrinth. Also resolve the proposal's phase naming: the table calls this phase 1, while the delivery plan puts it in phase 2.

### 5. Specify migration, account boundaries and removal semantics

Wrap existing connections rather than rewriting their identity. Preserve connection IDs, keychain references, TLS approvals, roles, pin/order metadata and subscriptions. Retain pack bindings' fingerprint, highest revision/minimum and artifact hash. A join-address match can suggest linking, never approve a fingerprint or transfer credentials.

[`pack_sync.rs`](../../vesta-launcher/src-tauri/src/servers/pack_sync.rs), `Link` and `verified_release`, bind connection/server/fingerprint and reject rollback. [`store.rs`](../../vesta-launcher/src-tauri/src/servers/store.rs), `remove_connection`, schedules credential deletion. A registry migration must preserve these invariants, not just add `manage: VestaAgent`. Player-only connections must retain public pack/join behavior without being labelled administrators.

Define three different removals: remove a saved game address, forget a launcher favourite, disconnect management. None should silently delete client content or unlink its pack. If disconnecting leaves signed instances unable to verify, identify them and offer explicit detach/repair. Do not cascade removal across instances' `servers.dat` files.

Minecraft identity used to join, agent credential identity, and Modrinth identity are separate. Key remembered launch defaults by Minecraft account when needed; never infer management rights from that account's ability to join. Existing `authRevision` invalidates account-scoped caches; preserve that isolation. Local world metadata may be shared, but account switching must not carry privileged caches or Realm access across identities.

### 6. Decide offline behavior before adding local-world Quick Play

[`pack_sync_check.rs`](../../vesta-launcher/src-tauri/src/servers/pack_sync_check.rs) initializes `can_launch:false`; failed fresh verification leaves it false. `pack_sync_enforce_launch` gates the instance, without considering a destination. Thus an unreachable pack authority currently prevents opening an installed local world too. A ping timeout and a failed signed-pack check are distinct failures.

For the first slice, retain this enforcement and explain blocked launches; do not accidentally weaken it through a new entry point. Before promising offline local play for linked instances, explicitly design a separate policy for using installed content locally versus joining the authoritative server. Detach/clone can be an escape hatch, not an automatic bypass. Ordinary unlinked worlds should remain usable offline. A failed status ping must not disable a join attempt; multiplayer authentication can fail separately. Show cached status with its age, never “current” merely because a cache exists.

### 7. Respect the game's ownership of files and history

Checking “not running” and then writing is still a race with launch. For later editing, acquire the same instance launch/mutation exclusion, re-read immediately before saving, compare the source file revision/hash, and refuse stale edits. Use atomic replacement, preserve unknown tags, ordering and absent-vs-false flags, and recover safely from malformed files. External game processes can still race; document that boundary, retain a backup, and never replace an unreadable file with an empty list. An address changed inside Minecraft must not be overwritten by registry reconciliation.

Treat `servers.dat` as authoritative for saved addresses in that instance, the registry for favourites/integrations, and explicit defaults for launch selection. Specify what removal means for each; “same link so they can't drift” is not a synchronization design. Read-only projection is sufficient initially.

“Jump back in” must contain observed activity. `servers.dat` has no visit timestamp: saved-but-unplayed entries belong under Saved servers, not recents with invented “2 days ago” copy. World LastPlayed is a valid fallback with known provenance. A Quick Play log is supplementary and its retention/concurrency remain unverified; test its actual output before promising a multi-item history. Persist bounded launcher history only from confirmed joins, not clicks or process starts. Deleted worlds become unavailable entries or disappear; do not launch by stale display name.

## Missing destinations and interaction details

- **LAN:** transient discovery, changing ports and no stable public identity. Allow a session destination or manual direct-connect; do not persist/deduplicate every discovered LAN world as a global server. Discovery can wait.
- **Realms:** an account-scoped Realm ID is not an address. Keep it a distinct launch target; do not invent a fake endpoint or promise inventory discovery because a Quick Play flag exists. Explicitly defer discovery/management and handle revoked access when launch fails.
- **Sleep/start:** Play on a managed sleeping server must explain wake/wait behavior. Administration and joining remain independent; do not silently start a stopped server just because credentials permit it. Existing lifecycle state is richer than a ping badge.
- **UI density:** split-button history, four Overview cards and another combined list duplicate the same action before usage is known. Start with world/server row Play and one small recent list; add shortcuts after seeing whether they help. Preserve ordinary launch and keyboard-accessible target selection.

## Smallest shippable slice and exit checks

Ship explicit world/server launch targets through the existing launch pipeline, a read-only Saved servers section beside existing Worlds, row Play actions, and a small recent list only after log behavior is verified. Reuse [`list_instance_worlds`](../../vesta-launcher/src-tauri/src/commands/worlds.rs) and [`WorldRef`/`WorldSummary`](../../vesta-launcher/src-tauri/src/worlds/mod.rs), which already carry folder identity, recency and validity information; do not build another world inventory. No registry migration, `servers.dat` writes, hosting API or provider expansion is needed for this slice.

Then ship the concrete Modrinth association flow above and a visible default instance on global server rows. Generalize shared identities only where those flows need them. This delivers “my server opens with its pack” before a broad registry redesign.

In [`arguments.rs`](../../crates/piston-lib/src/game/launcher/arguments.rs), `evaluate_rules` currently makes every unknown feature condition fail, even when the required value is false. The proposed correction must mean “unknown feature has value false, then compare with required,” not “unknown condition never matches.” Preserve last-matching-rule ordering. Existing substitution handling already preserves whitespace introduced into separate value tokens; extend it rather than layering shell quoting onto targets.

Manifest absence alone does not prove legacy `--server` support. Establish tested version/loader support and hide unsupported direct-launch actions before launch; a toast after opening the wrong screen is not a successful fallback. Check merged manifests, false-valued feature rules, mutually exclusive targets, flag duplication/custom-argument conflicts, IPv6/ports, world folders with spaces, and target confinement. A missing or malformed destination must fail clearly, not fall back to a different world/server.

Accept once the design replaces automatic compatibility with stable explicit selection, separates pack authority from advisory pins, preserves connection trust during migration, defines offline/removal semantics, and reduces the first release to instance-context play. The unifying principle should be **one understandable route to play**, not one record forced to represent everything.
