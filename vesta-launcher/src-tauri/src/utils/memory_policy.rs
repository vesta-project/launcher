const MEMORY_STEP_MB: i32 = 512;
pub const DEFAULT_MIN_MEMORY_MB: i32 = 2048;
pub const MAX_GENERATED_MEMORY_MB: i32 = 16384;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemoryRange {
    pub min: i32,
    pub max: i32,
}

pub fn round_down_to_memory_step(value_mb: i32) -> i32 {
    ((value_mb.max(MEMORY_STEP_MB)) / MEMORY_STEP_MB) * MEMORY_STEP_MB
}

pub fn dynamic_preferred_max_memory_mb(system_ram_mb: i32) -> i32 {
    if system_ram_mb <= 8192 {
        4096
    } else if system_ram_mb <= 16384 {
        6144
    } else if system_ram_mb <= 32768 {
        8192
    } else {
        10240
    }
}

fn reserved_generated_memory_mb(system_ram_mb: i32) -> i32 {
    if system_ram_mb <= 8192 {
        1024
    } else if system_ram_mb <= 16384 {
        2048
    } else {
        4096
    }
}

pub fn generated_memory_limit_mb(system_ram_mb: i32) -> i32 {
    if system_ram_mb <= 0 {
        return MAX_GENERATED_MEMORY_MB;
    }

    let headroom_cap =
        (system_ram_mb - reserved_generated_memory_mb(system_ram_mb)).max(MEMORY_STEP_MB);

    MAX_GENERATED_MEMORY_MB.min(round_down_to_memory_step(headroom_cap))
}

pub fn manual_memory_limit_mb(system_ram_mb: i32) -> i32 {
    if system_ram_mb <= 0 {
        return MAX_GENERATED_MEMORY_MB;
    }

    round_down_to_memory_step(system_ram_mb)
}

pub fn clamp_manual_memory_range(
    min_memory: i32,
    max_memory: i32,
    system_ram_mb: i32,
) -> MemoryRange {
    let limit = manual_memory_limit_mb(system_ram_mb);
    let next_max = round_down_to_memory_step(max_memory.max(MEMORY_STEP_MB).min(limit));
    let next_min = round_down_to_memory_step(min_memory.max(MEMORY_STEP_MB).min(next_max));

    MemoryRange {
        min: next_min,
        max: next_max,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chooses_dynamic_preferred_max() {
        assert_eq!(dynamic_preferred_max_memory_mb(8192), 4096);
        assert_eq!(dynamic_preferred_max_memory_mb(16384), 6144);
        assert_eq!(dynamic_preferred_max_memory_mb(32768), 8192);
        assert_eq!(dynamic_preferred_max_memory_mb(65536), 10240);
    }

    #[test]
    fn generated_memory_never_exceeds_generated_max() {
        assert_eq!(generated_memory_limit_mb(8192), 7168);
        assert_eq!(generated_memory_limit_mb(16384), 14336);
        assert_eq!(generated_memory_limit_mb(131072), MAX_GENERATED_MEMORY_MB);
    }

    #[test]
    fn clamps_manual_range_to_physical_ram() {
        assert_eq!(
            clamp_manual_memory_range(8192, 12000, 8192),
            MemoryRange {
                min: 8192,
                max: 8192
            }
        );
    }
}
