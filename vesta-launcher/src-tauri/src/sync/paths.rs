//! Re-exports shared path validation from piston-lib.
pub use piston_lib::utils::paths::{
    join_validated, path_is_within, validate_relative_path as validate_staged_relative_path,
};
