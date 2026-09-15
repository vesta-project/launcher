//! Lossless game-option documents and the shared editor catalog.
//!
//! Filesystem ownership, instance validation and launch exclusion belong to the
//! command Adapter. Before calling `OptionsDocument::patched`, every writer MUST
//! call `catalog::validate` for every changed key/value: document validation only
//! prevents structural injection, not edits to protected keys or invalid values.
//! The filesystem Adapter must cap both input and output sizes before publication.
//! UTF-8 is intentional for modern installations; encoding detection is deferred
//! until an actual unsupported installation requires it. Never decode lossily.
pub mod catalog;
pub mod options_file;
