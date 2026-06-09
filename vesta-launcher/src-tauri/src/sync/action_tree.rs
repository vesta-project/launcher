/// An action the sync engine must execute against the game directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncAction {
    /// Add a new file from the pack (was not present in old manifest).
    Add {
        /// Relative path within game_dir
        path: String,
        /// Where the file content comes from
        source: FileSource,
        /// Expected sha1 content hash after placement
        expected_hash: Option<String>,
    },
    /// Update an existing file to the pack's new version.
    Update {
        /// Relative path within game_dir
        path: String,
        /// Where the file content comes from
        source: FileSource,
        /// Content hash of the old version (for audit)
        old_hash: Option<String>,
        /// Expected content hash after placement
        new_hash: Option<String>,
    },
    /// Remove a file that was in the old manifest but not in the new one.
    Remove {
        /// Relative path within game_dir
        path: String,
        /// Why this file is being removed
        reason: RemoveReason,
        /// Last known content hash (for safe delete)
        last_hash: Option<String>,
    },
    /// Merge a text config file — the content has already been resolved.
    Merge {
        /// Relative path within game_dir
        path: String,
        /// Resolved content to write
        merged_content: String,
        /// Original content hash from old manifest
        old_hash: Option<String>,
        /// Expected content hash of merged output (if computable)
        new_hash: Option<String>,
    },
    /// Rotate a world save — move user's world aside so the pack's clean copy
    /// can be placed in the original slot.
    RotateWorld {
        /// Original world folder path (e.g. "saves/MyWorld")
        original_path: String,
        /// Quarantine target (e.g. "saves/MyWorld_user_20260520_1337")
        quarantine_path: String,
        /// Content hash of the old level.dat for audit
        old_level_dat_hash: Option<String>,
    },
    /// Skip this file entirely — no action needed.
    Skip {
        /// Relative path within game_dir
        path: String,
        /// Why this file is being skipped
        reason: SkipReason,
    },
}

/// Where the content for an Add or Update action comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileSource {
    /// Download from a Modrinth version URL
    Modrinth {
        url: String,
        sha1: Option<String>,
        filename: String,
    },
    /// Download from a CurseForge file URL
    CurseForge {
        url: String,
        project_id: Option<u32>,
        file_id: u32,
        filename: String,
        subfolder: String,
        sha1: Option<String>,
    },
    /// Extract from the new modpack ZIP (overrides)
    ZipOverride {
        /// Game-relative path (passed to `read_zip_override_entry`)
        relative_path: String,
    },
    /// Content generated in-memory (merged configs)
    Generated,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoveReason {
    /// Author removed this file from the modpack
    AuthorRemoved,
    /// File is no longer needed (dead dependency)
    DeadDependency,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkipReason {
    /// User modified this file — protect their changes
    UserModified,
    /// File is untracked (not in either manifest) — leave alone
    Untracked,
    /// File matches the new manifest already — no update needed
    AlreadyCurrent,
    /// Binary file the user has modified
    UserModifiedBinary,
    /// Config key was resolved via merge — no file-level action needed
    ResolvedViaMerge,
    /// Config/override dropped from the new modpack manifest — keep the local file
    NotInNewVersion,
    /// Config/override expected from the new ZIP but missing — keep the local file
    NotInNewVersionZip,
}

/// A collection of actions to execute against the game directory.
#[derive(Debug, Clone, Default)]
pub struct ActionTree {
    pub actions: Vec<SyncAction>,
    /// Number of files that were classified as "user modified" and protected
    pub protected_count: usize,
    /// Any world collisions that require rotation
    pub world_collisions: Vec<(String, String)>,
    /// Corrupted config files that need user attention
    pub corrupted_configs: Vec<String>,
}

impl ActionTree {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_action(&mut self, action: SyncAction) {
        self.actions.push(action);
    }

    pub fn add_world_collision(&mut self, original: String, quarantine: String) {
        self.world_collisions.push((original, quarantine));
    }

    pub fn add_corrupted_config(&mut self, path: String) {
        self.corrupted_configs.push(path);
    }

    /// Total number of actions (excluding Skips for progress calculation)
    pub fn actionable_count(&self) -> usize {
        self.actions
            .iter()
            .filter(|a| !matches!(a, SyncAction::Skip { .. }))
            .count()
    }

    pub fn is_empty(&self) -> bool {
        self.actions.is_empty()
            && self.world_collisions.is_empty()
            && self.corrupted_configs.is_empty()
    }
}
