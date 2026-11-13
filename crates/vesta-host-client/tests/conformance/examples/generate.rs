use rand_chacha::ChaCha20Rng;
use spake2::{Ed25519Group, Password, Spake2};
use vesta_host_client::rand_core::SeedableRng;
use vesta_host_client::*;
fn main() {
    let code = SetupCode::parse("0123-4567-89AB").unwrap();
    let (_, start) = Client::start_with_rng(
        &code,
        Purpose::Claim,
        None,
        "11111111-1111-4111-8111-111111111111".into(),
        [7; 32],
        ChaCha20Rng::from_seed([1; 32]),
    );
    let (a, b) = identities(&start);
    let (server, msg) = Spake2::<Ed25519Group>::start_b_with_rng(
        &Password::new(code.canonical().as_bytes()),
        &a,
        &b,
        ChaCha20Rng::from_seed([2; 32]),
    );
    let started = Started {
        exchange_id: "22222222-2222-4222-8222-222222222222".into(),
        link_id: None,
        host_id: start.host_id.clone(),
        fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
        server_nonce: encode(&[4; 32]),
        message_b: encode(&msg),
        expires_at: "2026-11-13T00:02:00Z".into(),
    };
    let shared = server
        .finish(&decode::<33>(&start.message_a).unwrap())
        .unwrap();
    let t = transcript(&start, &started).unwrap();
    let c = Confirmation::new(&shared, &[3; 32], &t);
    let out = serde_json::json!({"suite":"spake2-0.4.0-Ed25519Group","code":code.display(),"rng":"ChaCha20Rng 0.3.1; client seed [1;32], server seed [2;32]","exporter":encode(&[3;32]),"start":start,"started":started,"transcript":String::from_utf8(t).unwrap(),"clientConfirm":c.client(),"serverConfirm":c.server(),"negativeCases":["wrong_code","exporter_mismatch","replay","expired_code","reconnect"]});
    std::fs::write(
        "protocol/host-v1/fixtures/pake-v1.json",
        serde_json::to_string_pretty(&out).unwrap() + "\n",
    )
    .unwrap();
}
