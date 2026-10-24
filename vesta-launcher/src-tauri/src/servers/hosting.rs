use super::*;
impl ServerManager {
    pub async fn sftp_target(
        &self,
        id: &str,
        status: &vesta_server_client::hosting::SftpStatus,
    ) -> Result<(String, vesta_server_client::hosting::SftpTarget)> {
        let record = self.record(id).await?;
        let endpoint = Endpoint::parse(&record.snapshot.connection.endpoint)?;
        vesta_server_client::hosting::sftp_target(&endpoint, status)
    }
    pub(super) fn track_software(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
        job_id: &str,
        action: &str,
    ) {
        let key = format!("{id}:software:{job_id}");
        let Ok(mut trackers) = self.trackers.lock() else {
            return;
        };
        trackers.retain(|_, task| !task.inner().is_finished());
        if trackers.len() >= 32 || trackers.contains_key(&key) {
            return;
        }
        let manager = self.clone();
        let app = app.clone();
        let id = id.to_owned();
        let job_id = job_id.to_owned();
        let action = action.to_owned();
        trackers.insert(
            key,
            tauri::async_runtime::spawn(async move {
                let mut delay = 2;
                for _ in 0..240 {
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                    let Ok(client) = manager.client(&id).await else {
                        break;
                    };
                    match client.software_jobs(false).await {
                        Ok(jobs) => {
                            let Some(job) = jobs.into_iter().find(|job| job.id == job_id) else {
                                break;
                            };
                            super::management::management_activity(
                                &app, &id, &job_id, &action, &job.state, false,
                            );
                            if matches!(
                                job.state.as_str(),
                                "succeeded" | "failed" | "recovery_required"
                            ) {
                                manager.changed(&app);
                                break;
                            }
                        }
                        Err(error)
                            if matches!(
                                error.code,
                                ErrorCode::RateLimited
                                    | ErrorCode::ServerBusy
                                    | ErrorCode::Timeout
                                    | ErrorCode::Unreachable
                            ) => {}
                        Err(_) => break,
                    }
                    delay = (delay * 2).min(10);
                }
            }),
        );
    }
}
