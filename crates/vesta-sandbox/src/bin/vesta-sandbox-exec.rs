use std::env;
use std::process;

fn main() -> ! {
    let code = vesta_sandbox::landlock_exec::run_landlock_exec_cli(env::args());
    process::exit(code);
}
