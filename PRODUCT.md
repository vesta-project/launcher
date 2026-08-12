# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Minecraft players who want to install, configure, and launch their own game instances, including modded instances. Modpack creators also use Vesta to work with and distribute modpack-based instances.

## Product Purpose

Vesta Launcher is a desktop Minecraft launcher that helps people manage instances, install and maintain modded Minecraft, and launch the game. Its purpose is to be the launcher that provides what Minecraft players and modpack creators need in one tool.

## Positioning

Vesta brings multi-instance Minecraft management, modloader support, resource management, modpack workflows, and game launching together in a single launcher rather than requiring users to assemble those needs across separate tools.

## Operating Context

Users work with Minecraft versions, Fabric, Forge, NeoForge, Quilt, local game directories, mods and other downloadable resources, modpacks, and Microsoft/Minecraft accounts. The application is a Tauri desktop app with a SolidJS frontend and Rust backend.

## Capabilities and Constraints

- Supports multiple Minecraft instances and the Fabric, Forge, NeoForge, and Quilt modloaders.
- Includes instance, resource, modpack, account, notification, theming, and launch-related workflows at varying stages of implementation.
- Builds native desktop bundles for Windows and macOS; the product adapts to operating-system capabilities such as window effects and desktop integrations.
- The repository is in active development. Current capability status must be verified in code and current documentation rather than assumed from historical project requirements.
- Desired future commitments, not yet established guarantees: privacy, offline use, support for the relevant desktop platforms, and accessibility.

## Brand Commitments

The product is named Vesta Launcher. Its established promise is practical completeness for Minecraft players and modpack creators: a launcher that has what users need. Specific visual direction is recorded separately in the design system, not here.

## Evidence on Hand

- Product overview and supported modloaders: `README.md`.
- Current implementation and development command: `vesta-launcher/package.json` and `vesta-launcher/src-tauri/tauri.conf.json`.
- Domain vocabulary and module ownership: `CONTEXT.md`.
- Existing logo assets: `vesta-launcher/public/vesta-full.png` and `vesta-launcher/vesta-logo.png`.
- No customer testimonials, quantified outcomes, pricing, or externally validated claims are on hand; future work must not fabricate them.

## Product Principles

- Cover the real tasks of playing and managing modded Minecraft in one coherent tool.
- Treat Minecraft players and modpack creators as first-class users.
- Make multi-instance and modloader workflows understandable and dependable.
- Respect native desktop contexts while keeping product behavior coherent across supported platforms.
- Distinguish current capability from future intent clearly.

## Accessibility & Inclusion

Accessibility is a desired product commitment. The implementation includes focus and reduced-motion support, but a required conformance standard and user-specific accessibility requirements remain undecided.
