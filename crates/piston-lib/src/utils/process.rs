#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Extension trait for Piston-related command execution, providing unified
/// support for console suppression and process detachment.
pub trait PistonCommandExt {
    /// Hides the console window on Windows. No-op on other platforms.
    fn suppress_console(&mut self) -> &mut Self;

    /// Detaches the process from its parent, allowing it to survive app closure.
    /// On Windows, this uses CREATE_NEW_PROCESS_GROUP.
    /// On Unix, this uses a new session via setsid.
    fn detach(&mut self) -> &mut Self;
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;

impl PistonCommandExt for std::process::Command {
    fn suppress_console(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            // Note: On Windows, creation_flags replaces existing flags.
            // We'll combine with existing flags if possible, but standard Command doesn't expose them.
            // We use 0.8 as a baseline for "no window".
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }

    fn detach(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            // Combine with CREATE_NO_WINDOW often as detached processes shouldn't have one
            self.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            unsafe {
                self.pre_exec(|| {
                    libc::setsid();
                    Ok(())
                });
            }
        }
        self
    }
}

impl PistonCommandExt for tokio::process::Command {
    fn suppress_console(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }

    fn detach(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            self.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
        }
        #[cfg(unix)]
        {
            unsafe {
                self.pre_exec(|| {
                    libc::setsid();
                    Ok(())
                });
            }
        }
        self
    }
}
