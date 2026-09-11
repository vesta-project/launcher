//! Lossless game-option documents and the shared editor catalog.
//!
//! Filesystem ownership, instance validation and launch exclusion belong to the
//! command Adapter. This Module only validates and patches document contents.
pub mod catalog;
pub mod options_file;
