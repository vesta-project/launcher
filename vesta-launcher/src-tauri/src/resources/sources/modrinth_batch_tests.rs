use super::ModrinthSource;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{Arc, Condvar, Mutex},
    time::{Duration, Instant},
};
fn fixture(delay: u64, mode: &str) -> (String, std::thread::JoinHandle<serde_json::Value>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    let mode = mode.to_string();
    let task = std::thread::spawn(move || {
        let began = Instant::now();
        let records = Arc::new(Mutex::new(Vec::new()));
        let gate = Arc::new((Mutex::new(0usize), Condvar::new()));
        let mut jobs = Vec::new();
        let expected = if mode == "project_error" { 1 } else { 3 };
        while jobs.len() < expected {
            assert!(
                began.elapsed() < Duration::from_secs(8),
                "fixture accept deadline"
            );
            match listener.accept() {
                Ok((mut socket, _)) => {
                    let records = records.clone();
                    let gate = gate.clone();
                    let mode = mode.clone();
                    jobs.push(std::thread::spawn(move||{
 socket.set_nonblocking(false).unwrap();socket.set_read_timeout(Some(Duration::from_secs(3))).unwrap();let mut bytes=Vec::new();let mut b=[0;1];while !bytes.ends_with(b"\r\n\r\n"){socket.read_exact(&mut b).unwrap();bytes.push(b[0]);assert!(bytes.len()<65536);}let request=String::from_utf8(bytes).unwrap();assert!(!request.to_ascii_lowercase().contains("authorization:"));let path=request.lines().next().unwrap().split_whitespace().nth(1).unwrap().split('?').next().unwrap().to_string();let started=began.elapsed().as_secs_f64()*1000.;
 let mut overlap=None;if path!="/projects"&&mode=="overlap" {let(lock,cv)=&*gate;let mut n=lock.lock().unwrap();*n+=1;cv.notify_all();let(n,result)=cv.wait_timeout_while(n,Duration::from_millis(1000),|n|*n<2).unwrap();overlap=Some(*n==2&&!result.timed_out());}
 std::thread::sleep(Duration::from_millis(delay));
 let body=match path.as_str(){"/projects"=>json!((0..400).map(|i|json!({"id":format!("p{i}"),"name":format!("Project {i}"),"summary":"fixture","description":"d".repeat(1024),"icon_url":format!("https://cdn.example.invalid/{i}.png"),"downloads":1,"categories":[],"project_types":["mod"],"slug":format!("p{i}"),"published":"2026-01-01","updated":"2026-01-02","followers":0,"team_id":format!("t{}",i%10),"organization":format!("o{}",i%3)})).collect::<Vec<_>>()),"/teams"=>json!((0..10).map(|i|vec![json!({"team_id":format!("t{i}"),"user":{"id":format!("u{i}"),"username":format!("Author{i}")},"role":"Owner","accepted":true,"is_owner":true})]).collect::<Vec<_>>()),"/organizations"=>json!((0..3).map(|i|json!({"id":format!("o{i}"),"slug":format!("org{i}"),"name":format!("Organization{i}")})).collect::<Vec<_>>()),_=>panic!("unexpected fixture path")};
 let error=mode=="project_error"||(mode=="team_error"&&path=="/teams")||(mode=="organization_error"&&path=="/organizations");let data=if error {b"{\"description\":\"fixture unavailable\"}".to_vec()}else{serde_json::to_vec(&body).unwrap()};write!(socket,"HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",if error {"503 Service Unavailable"}else{"200 OK"},data.len()).unwrap();socket.write_all(&data).unwrap();records.lock().unwrap().push(json!({"path":path,"start_ms":started,"bytes":data.len(),"overlap":overlap}));}));
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(1))
                }
                Err(e) => panic!("{e}"),
            }
        }
        for job in jobs {
            job.join().unwrap();
        }
        let data = records.lock().unwrap().clone();
        json!({"requests":data,"connections":expected})
    });
    (format!("http://{address}"), task)
}
#[test]
fn independent_attribution_overlaps_and_preserves_error_fallbacks() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let ids = (0..400).map(|i| format!("p{i}")).collect::<Vec<_>>();
    for (delay, mode, runs) in [
        (0, "normal", 1),
        (0, "team_error", 1),
        (0, "organization_error", 1),
        (0, "project_error", 1),
        (0, "overlap", 1),
    ] {
        for run in 0..runs {
            let (api, task) = fixture(delay, mode);
            let start = Instant::now();
            let source = ModrinthSource {
                client: reqwest::Client::builder()
                    .timeout(Duration::from_secs(5))
                    .build()
                    .unwrap(),
            };
            let result = runtime.block_on(source.get_projects_at(&ids, &api));
            let wall = start.elapsed().as_secs_f64() * 1000.;
            let wire = task.join().unwrap();
            let mut digest = None;
            if mode == "project_error" {
                assert!(result.is_err());
            } else {
                let rows = result.unwrap();
                assert_eq!(rows.len(), 400);
                for (i, row) in rows.iter().enumerate() {
                    assert_eq!(row.id, format!("p{i}"));
                    assert_eq!(row.name, format!("Project {i}"));
                    assert_eq!(row.description.as_ref().unwrap().len(), 1024);
                    assert_eq!(
                        row.author,
                        if mode == "team_error" {
                            "Unknown".into()
                        } else {
                            format!("Author{}", i % 10)
                        }
                    );
                    assert_eq!(row.organization.is_none(), mode == "organization_error");
                }
                digest = Some(hex::encode(Sha256::digest(
                    serde_json::to_vec(&rows).unwrap(),
                )));
            }
            let overlap = wire["requests"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|r| r["overlap"].as_bool())
                .all(|x| x);
            println!(
                "PROVIDER_PERF {}",
                json!({"delay_ms":delay,"mode":mode,"run":run,"wall_ms":wall,"wire":wire,"semantic_digest":digest,"all_enrichment_overlapped":overlap})
            );
            if mode == "overlap" {
                assert!(overlap, "independent enrichment requests must overlap");
            }
        }
    }
}
