//! Pending onboarding; confirmation secrets stay native.
use super::*;
use serde::{Deserialize, Serialize};
#[derive(Default)]
pub(super) struct State {
    approvals: Mutex<HashMap<String, zeroize::Zeroizing<String>>>,
}
macro_rules! dto {($name:ident { $($field:ident:$ty:ty),* $(,)? })=>{
    #[derive(Clone,Debug,Serialize,Deserialize)] #[serde(rename_all="camelCase",deny_unknown_fields)]
    pub struct $name { $(pub $field:$ty),* }
};}
dto!(SetupReadiness {
    api_version: String,
    installation_id: String,
    server_id: String,
    status: String,
    management_available: bool,
    provisioning_available: bool
});
dto!(SetupStatus {
    installation_id: String,
    server_id: String,
    claimed: bool
});
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SetupPlanRequest {
    Install {
        name: String,
        software: String,
        version: String,
        build: Option<u32>,
        loader_version: Option<String>,
        experimental: bool,
    },
    AdoptCopy {
        name: String,
        minecraft_version: String,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SetupJobState {
    Planning,
    Review,
    Applying,
    Ready,
    Complete,
    Failed,
    Interrupted,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetupReview {
    pub name: String,
    pub minecraft_version: String,
    pub software: Option<String>,
    pub loader_version: Option<String>,
    pub files: u64,
    #[serde(deserialize_with = "decimal_bytes")]
    pub bytes: String,
    pub warnings: Vec<String>,
}
fn decimal_bytes<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<String, D::Error> {
    let value = Value::deserialize(d)?;
    match value {
        Value::Number(n) if n.as_u64().is_some() => Ok(n.to_string()),
        Value::String(s) if s.parse::<u64>().is_ok() => Ok(s),
        _ => Err(serde::de::Error::custom("invalid byte count")),
    }
}
dto!(SetupJob { id:String, state:SetupJobState, phase:String, error:Option<String>, review:Option<SetupReview> });
impl Client {
    /// Public readiness requires the discovery pin, never a session credential.
    pub async fn setup_readiness(
        transport: &Arc<Transport>,
        server_id: &str,
    ) -> Result<SetupReadiness> {
        if transport.expected.is_none() {
            return Err(Error::new(ErrorCode::TlsFailed));
        }
        let ready: SetupReadiness = from_wire(
            transport
                .request(Method::GET, "/api/v3/setup", None, None, None, true)
                .await?,
        )?;
        auth::check_identity(server_id, &ready.server_id)?;
        if ready.api_version != "3"
            || ready.status != "awaiting_app_onboarding"
            || ready.management_available
        {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        Ok(ready)
    }
    async fn setup_status_request(&self, method: Method, path: &str) -> Result<SetupStatus> {
        let status: SetupStatus =
            from_wire(self.request(method, path, None, None, true, "").await?)?;
        auth::check_identity(&self.server_id, &status.server_id)?;
        Ok(status)
    }
    pub async fn setup_claim(&self) -> Result<SetupStatus> {
        self.setup_status_request(Method::POST, "/api/v3/setup/claim")
            .await
    }
    pub async fn setup_status(&self) -> Result<SetupStatus> {
        self.setup_status_request(Method::GET, "/api/v3/setup/status")
            .await
    }
    async fn setup_decode_job(&self, mut value: Value) -> Result<SetupJob> {
        let token = value
            .as_object_mut()
            .ok_or_else(|| Error::new(ErrorCode::Unsupported))?
            .remove("confirmation");
        let job: SetupJob = from_wire(value)?;
        if uuid::Uuid::parse_str(&job.id).is_err() {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        if job.state == SetupJobState::Review {
            let token = token
                .and_then(|t| t.as_str().map(str::to_owned))
                .filter(|s| !s.is_empty() && s.len() <= 4096)
                .ok_or_else(|| Error::new(ErrorCode::Unsupported))?;
            let mut approvals = self.setup.approvals.lock().await;
            if approvals.len() >= 256 && !approvals.contains_key(&job.id) {
                return Err(Error::new(ErrorCode::ServerBusy));
            }
            approvals.insert(job.id.clone(), zeroize::Zeroizing::new(token));
        }
        Ok(job)
    }
    pub async fn setup_plan(&self, request: SetupPlanRequest) -> Result<SetupJob> {
        let body = hosting::wire(
            serde_json::to_value(request).map_err(|_| Error::new(ErrorCode::InvalidInput))?,
        );
        self.setup_decode_job(
            self.request(
                Method::POST,
                "/api/v3/setup/plan",
                Some(body),
                None,
                true,
                "",
            )
            .await?,
        )
        .await
    }
    pub async fn setup_job(&self, id: &str) -> Result<SetupJob> {
        if uuid::Uuid::parse_str(id).is_err() {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        self.transport.invalidate_reads();
        let job = self
            .setup_decode_job(
                self.request(
                    Method::GET,
                    &format!("/api/v3/setup/jobs/{id}"),
                    None,
                    None,
                    true,
                    "",
                )
                .await?,
            )
            .await?;
        if job.id != id {
            return Err(Error::new(ErrorCode::Unsupported));
        }
        Ok(job)
    }
    pub async fn setup_apply(
        &self,
        id: &str,
        warnings: bool,
        legacy: bool,
        intent: &str,
    ) -> Result<SetupJob> {
        let key = self.intent_key(intent)?;
        if uuid::Uuid::parse_str(id).is_err() {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        if !self.setup.approvals.lock().await.contains_key(id) {
            self.setup_job(id).await?;
        }
        let token = self
            .setup
            .approvals
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| Error::new(ErrorCode::ConfirmationExpired))?;
        let body = json!({"job_id":id,"confirmation":token.as_str(),"idempotency_key":key,"acknowledge_warnings":warnings,"acknowledge_legacy_checksum":legacy});
        self.setup_decode_job(
            self.request(
                Method::POST,
                "/api/v3/setup/apply",
                Some(body),
                Some(&key),
                true,
                "",
            )
            .await?,
        )
        .await
    }
    /// Retired routes and dropped sockets never prove activation. Verify public
    /// managed status, then renew signed authentication on the SAME pinned transport.
    pub async fn setup_handoff(&self) -> Result<()> {
        if self.transport.expected.is_none() {
            return Err(Error::new(ErrorCode::TlsFailed));
        }
        self.transport.invalidate_reads();
        self.public_lifecycle().await?;
        {
            let mut session = self.session.lock().await;
            session.session = None;
            session.failure = None;
        }
        self.token(None).await?;
        self.info().await?;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dto_roundtrips_and_refuses_unknown_fields() {
        let value = json!({"kind":"adopt_copy","name":"Copy","minecraftVersion":"1.21.1"});
        let request: SetupPlanRequest = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(request).unwrap(), value);
        let mut bad = value;
        bad["source"] = json!("C:/private");
        assert!(serde_json::from_value::<SetupPlanRequest>(bad).is_err());
        let ready = json!({"api_version":"3","installation_id":"abc","server_id":"server","status":"awaiting_app_onboarding","management_available":false,"provisioning_available":true});
        let dto: SetupReadiness = from_wire(ready.clone()).unwrap();
        assert_eq!(hosting::wire(serde_json::to_value(dto).unwrap()), ready);
        let mut bad = ready;
        bad["secret"] = json!(true);
        assert!(from_wire::<SetupReadiness>(bad).is_err());
    }
    #[test]
    fn job_states_and_subphases() {
        for state in [
            "planning",
            "review",
            "applying",
            "ready",
            "complete",
            "failed",
            "interrupted",
        ] {
            let value =
                json!({"id":"id","state":state,"phase":"metadata","error":null,"review":null});
            let job: SetupJob = from_wire(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(job).unwrap(), value);
        }
        assert!(serde_json::from_value::<SetupJobState>(json!("online")).is_err());
    }
}
