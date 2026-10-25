# Software picker follow-up

The running Minecraft view shows the installed software/build or loader and selected
Java. Editing controls mount only while stopped. The stopped editor preserves the
installed selection and offers actual builds/loaders, plus the existing latest
stable choice. Review receives explicit build/loader selections; confirmation and
activation safeguards remain unchanged.

The software mark exceeded its segmented icon wrapper. Letting that wrapper size
to the mark and centering the label fixes the alignment without changing the UI's
layout. Browser geometry checks measured zero horizontal center offset for all
eight software options in dark and light themes.

Validation: 27 focused frontend checks, 17 client unit tests, native Rust check,
TypeScript check, production build and lint passed (existing warnings retained).
Server catalogue tests: 10 matching tests passed; strict query parser test passed;
strict Clippy passed for installer, control and transport libraries.
Browser fixture flows passed in dark/light: running read-only, stopped editing,
no pristine Discard, exact Build 149 review. Screenshots and geometry evidence are
in `V:/tmp/software-picker-20261025`. Collaborative preview snapshots timed out
twice, so these checks used the local browser fallback.

Requires rebuilding both launcher and agent for the new release catalogue route.
No live Minecraft restart or software change was performed.
