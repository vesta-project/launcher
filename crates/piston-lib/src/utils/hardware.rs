use sysinfo::System;
use once_cell::sync::Lazy;
use std::sync::Mutex;

static SYSTEM: Lazy<Mutex<System>> = Lazy::new(|| {
    let mut sys = System::new();
    sys.refresh_memory();
    Mutex::new(sys)
});

/// Returns the total physical memory in Megabytes
pub fn get_total_memory_mb() -> u64 {
    let mut sys = SYSTEM.lock().unwrap();
    sys.refresh_memory();
    sys.total_memory() / 1024 / 1024
}

/// Returns the available physical memory in Megabytes
pub fn get_available_memory_mb() -> u64 {
    let mut sys = SYSTEM.lock().unwrap();
    sys.refresh_memory();
    sys.available_memory() / 1024 / 1024
}
