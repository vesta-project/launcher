# ADR-0005: Separate Authentication Rejection From Service Availability

Date: 2026-07-24

Status: Accepted

## Context

Authentication, ownership, and profile requests previously collapsed remote
failures into strings or booleans. A missing profile response could therefore
look like an unauthenticated account, while a Microsoft or Minecraft outage
could prevent a previously authenticated player from launching at all.

Account creation also removed temporary Guest state before every remote
validation step had succeeded. This made a failed account-add attempt capable
of mutating otherwise usable local state.

## Decision

`piston-lib` classifies authentication failures by service, phase, HTTP status,
and retryability. Credential rejection is distinct from network failure and
temporary service unavailability. In particular, a generic `404 Not Found` is
not evidence of an invalid session.

Tauri treats a persisted Microsoft account with a Minecraft UUID and username
as proof of prior successful authentication. When a fresh general connectivity
probe succeeds but Microsoft, Xbox Live, or Minecraft Services is unreachable,
launch preparation may use that account offline. It never uses Guest, Demo,
unknown, incomplete, or newly attempted account data for this fallback.
Credential rejection still blocks online launch.

Account-add persistence and Guest cleanup happen only after token exchange,
ownership verification, and profile retrieval all succeed. Temporary
availability failures are surfaced as structured, user-facing errors.

The authentication-unavailable warning is persisted and deduplicated. It is
created only after setup is complete and at least one previously authenticated
account exists. A service-specific outage does not mark the global network
offline unless a fresh general connectivity probe also fails.

## Consequences

Previously authenticated players can launch offline through temporary
authentication outages without weakening first-time account verification.
Callers must preserve typed failures until the UI or launch-policy boundary
rather than converting every response to an unauthenticated boolean.

The persisted account row is the current proof of prior authentication, so no
database migration is required. If stronger provenance is needed later, it can
replace this predicate behind the Tauri authentication Interface.

## Related

- Domain vocabulary: `CONTEXT.md`
- Protocol classification: `crates/piston-lib/src/auth/mod.rs`
- Minecraft Services Adapter: `crates/piston-lib/src/api/mojang.rs`
- Tauri policy: `vesta-launcher/src-tauri/src/auth/mod.rs`
- Launch Adapter: `vesta-launcher/src-tauri/src/instance/launch_preparation.rs`
