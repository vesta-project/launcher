# Architecture Decision Records

This directory stores load-bearing architecture decisions for Vesta Launcher.
Use it when a decision should stop future architecture reviews from relitigating
the same question.

## When To Add An ADR

Add an ADR when a decision:

- Chooses a seam for a module.
- Rejects a plausible deepening opportunity.
- Establishes a persistent adapter strategy.
- Changes where an interface should live.
- Explains a tradeoff that future maintainers or agents are likely to miss.

Do not add an ADR for temporary scheduling, preference, or work that is merely
not worth doing today.

## Index

- [ADR-0001: Keep Architecture Review Reports Outside The Repo](0001-architecture-review-reports-outside-repo.md)
- [ADR-0002: Split Instance Lifecycle From Runtime Launch](0002-instance-lifecycle-tauri-runtime-launch-piston.md)
- [ADR-0003: Put Runtime Preparation In piston-lib And Launch Adaptation In Tauri](0003-runtime-preparation-piston-launch-adaptation-tauri.md)

Use `0000-template.md` for the first decision and number accepted records as
`0001-short-title.md`, `0002-short-title.md`, and so on.
