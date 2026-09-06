use std::env;
use std::process;

fn main() -> ! {
    #[cfg(target_os = "linux")]
    let code = vesta_sandbox::landlock_exec::run_landlock_exec_cli(env::args());

    #[cfg(target_os = "windows")]
    let code = vesta_sandbox::windows_exec::run_windows_exec_cli(env::args());

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    let code = {
        let _ = env::args();
        eprintln!("vesta-sandbox-exec is only supported on Linux and Windows");
        1
    };

    process::exit(code);
}
