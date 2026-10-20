# Onboarding flow

`index.ts` is the Welcome UI's singleton Interface. `flow.ts` owns the persisted
step mapping, auth guards, guest re-entry and once-only completion. Its transport
is injected so the sequencing can be checked without a WebView. The host remains
the authority for accounts, credentials, guest cleanup and setup persistence.

Host steps retain the original numbers (0, 1, 2, 4, 5, 6); legacy Learn (3)
resumes at Theme. Startup resets legacy early completion and stale guest state.
Completed setup with missing/expired auth enters loginOnly. Guest exploration
enters Library without completion; signing in from there continues unfinished
setup at Theme. Native startup removes stale guest accounts and markers.

The App starts the flow alongside the desktop transport and gates Shell on its
status. Settings reset uses `resetOnboarding()` in the same window. Inline auth
has a separate LoginSession from the AccountLoginDialog and shares its transport.
No credentials or auth state are persisted by this Module.

`first-instance.ts` prefetches six curated projects through Browse's cache, fills
missing results by download rank, and reuses Installation's non-navigating service.
The native TaskManager owns installation after queue submission; App keeps Activity
sync alive while Welcome is mounted. Blank instances use the first builtin icon,
latest release, Vanilla and 2048/4096 MB. Launcher import finishes setup and opens
`/create/import/:kind`. Browser fixtures are session-only; device auth automatically
succeeds after four seconds. In dev, `vestaDev.onboarding()` resets the flow.

See `checks/onboarding.test.js` for startup resolution, auth guards, guest re-entry,
resume, reset and completion sequencing. Native installation/auth still require a
Tauri smoke test. The external architecture atlas is intentionally untouched by
this app-only task.
