# Modpack permissions and controls

The agent already includes effective role ids in `/manage/session`. The native
client discarded them, leaving the frontend to use the role captured at pairing.
That role is null after Minecraft sign-in, including for an effective owner.

The native capability projection now preserves session role ids. The workspace,
Browse modpack target menu and install handoff share the owner/administrator plus
content.install and pack.edit check. Reported roles override stale pairing roles;
an empty role list does not resurrect a previous owner label. The agent continues
to authorize every operation. No agent protocol or server deployment change is needed.

Client pack identity uses compact loader icon/version selects. Switching loaders
does not reuse the previous loader's version. Metadata arriving later supplies a
default reactively; saved versions absent from the current catalogue remain visible.
There is no transient free-text fallback. Failed metadata reads can be retried.
Modpack navigation hover/focus warms the shared metadata and workspace caches;
initial workspace load consumes that cache, while explicit reload stays fresh.

Published history now uses the existing version-list rows and badges. Unknown
publisher/count fields are omitted instead of displayed as dash placeholders.

Validation: 471 frontend checks and all 24 HTTPS native-client tests passed,
including effective role propagation without a pairing role and denial after
role removal. Typecheck, scoped oxlint and diff whitespace checks passed.
The edited screens have not been visually checked in the running native app.
Rebuild/restart the launcher to load the native role projection change.

Follow-up: the shared native launcher also constructs an initial CapabilityView
in servers/mod.rs. Its new optional roles field must be initialized there. The
client-only test run did not compile this consumer; corrected to roles: None.
The user's captured runtime predated the native role change even while frontend
hot reload had already picked up the new gate. Replaying its saved snapshot
reproduced false without roles and true with the effective owner role.
Full desktop native check subsequently passed using the desktop manifest and
existing .tauri-target directory (only unrelated unused/dead-code warnings).
The user's rebuild produced and launched a new native binary at 21:50 local time.
