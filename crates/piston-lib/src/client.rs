use reqwest::Client;
use std::sync::OnceLock;
use std::time::Duration;

fn build_shared_client() -> Client {
    Client::builder()
        .pool_max_idle_per_host(8)
        .tcp_keepalive(Some(Duration::from_secs(30)))
        .timeout(Duration::from_secs(120))
        .user_agent("VestaLauncher/1.0")
        .build()
        .expect("Failed to build shared HTTP client")
}

pub fn shared_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(build_shared_client)
}
