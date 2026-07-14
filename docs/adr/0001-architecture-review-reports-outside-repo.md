# ADR-0001: Keep Architecture Review Reports Outside The Repo

Date: 2026-07-05

Status: Accepted

## Context

The `improve-codebase-architecture` review process produces visual HTML reports
that collect open architecture findings. Those reports are snapshots for
discussion, not durable project source. The current saved report is outside the
repo in the user's documents area.

The repo still needs durable architecture memory, but that memory should be
limited to domain vocabulary and load-bearing decisions:

- `CONTEXT.md` names domain concepts and likely module seams.
- `docs/adr/` records accepted or rejected decisions.

Open findings stay in external review reports until a decision is accepted or
rejected.

## Decision

Keep architecture review reports outside the repo. Do not add an in-repo
architecture findings ledger for the HTML report output.

When a finding becomes load-bearing:

- Add or update domain vocabulary in `CONTEXT.md`.
- Record the accepted or rejected decision in `docs/adr/`.
- Leave speculative or exploratory findings in the external report.

## Consequences

This preserves locality for durable knowledge without turning the repo into a
scratchpad for every review candidate.

This keeps the report free to be visual, speculative, and iterative, while ADRs
remain the interface for decisions future maintainers and agents must obey.

Future architecture reviews must read both:

- the repo memory (`CONTEXT.md` and `docs/adr/`)
- the external HTML report when continuing a prior review

## Related

- Domain vocabulary: `CONTEXT.md`
- ADR index: `docs/adr/README.md`
