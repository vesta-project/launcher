use rand_chacha::ChaCha20Rng;
use vesta_host_client::rand_core::SeedableRng;
use vesta_host_client::*;
#[test]
fn deterministic_client_vector_and_negative_confirmations() {
    let f: serde_json::Value = serde_json::from_str(include_str!("fixtures/pake-v1.json")).unwrap();
    let code = SetupCode::parse(f["code"].as_str().unwrap()).unwrap();
    for scenario in [
        "ok",
        "wrong_code",
        "exporter_mismatch",
        "forged_confirmation",
        "wrong_host",
        "wrong_fingerprint",
    ] {
        let password = if scenario == "wrong_code" {
            SetupCode::parse("ZZZZ-ZZZZ-ZZZZ").unwrap()
        } else {
            SetupCode::parse(code.canonical()).unwrap()
        };
        let (client, start) = Client::start_with_rng(
            &password,
            Purpose::Claim,
            None,
            "11111111-1111-4111-8111-111111111111".into(),
            [7; 32],
            ChaCha20Rng::from_seed([1; 32]),
        );
        if scenario != "wrong_code" {
            assert_eq!(serde_json::to_value(&start).unwrap(), f["start"]);
        }
        let mut started: Started = serde_json::from_value(f["started"].clone()).unwrap();
        if scenario == "wrong_host" {
            started.host_id = "other".into();
        }
        if scenario == "wrong_fingerprint" {
            started.fingerprint = "other".into();
        }
        let mut exporter = decode::<32>(f["exporter"].as_str().unwrap()).unwrap();
        if scenario == "exporter_mismatch" {
            exporter[0] ^= 1;
        }
        let result = client.finish(
            &started,
            f["started"]["fingerprint"].as_str().unwrap(),
            &exporter,
        );
        if ["wrong_host", "wrong_fingerprint"].contains(&scenario) {
            assert!(result.is_err());
            continue;
        }
        let (client, finish) = result.unwrap();
        if scenario == "ok" {
            assert_eq!(finish.client_confirm, f["clientConfirm"]);
            assert_eq!(
                String::from_utf8(transcript(&start, &started).unwrap()).unwrap(),
                f["transcript"]
            );
        }
        let response = Finished {
            server_confirm: if scenario == "forged_confirmation" {
                encode(&[0; 32])
            } else {
                f["serverConfirm"].as_str().unwrap().into()
            },
            pake_token: encode(&[9; 32]),
            expires_at: "2026-11-13T00:10:00Z".into(),
        };
        assert_eq!(
            client.verify(response).is_ok(),
            scenario == "ok",
            "{scenario}"
        );
    }
}
#[test]
fn strict_password_and_wire_parsing() {
    assert_eq!(
        SetupCode::parse("0123 4567-89ab").unwrap().canonical(),
        "0123456789AB"
    );
    for input in [
        "",
        "OOOO-1111-2222",
        "IIII-1111-2222",
        "0123\t456789AB",
        "0123456789AB??",
    ] {
        assert!(SetupCode::parse(input).is_err());
    }
    assert!(decode::<32>("AA==").is_err());
    let f: serde_json::Value = serde_json::from_str(include_str!("fixtures/pake-v1.json")).unwrap();
    let mut bad = f["start"].clone();
    bad["unknown"] = true.into();
    assert!(serde_json::from_value::<Start>(bad).is_err());
    let json =
        serde_json::to_string(&f["start"])
            .unwrap()
            .replacen('{', "{\"hostId\":\"duplicate\",", 1);
    assert!(serde_json::from_str::<Start>(&json).is_err());
}
