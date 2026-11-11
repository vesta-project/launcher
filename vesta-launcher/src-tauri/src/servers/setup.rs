use super::*;
use vesta_server_client::setup::SetupReadiness;
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupDiscovery {
    pub discovery: Discovery,
    pub readiness: SetupReadiness,
}
impl ServerManager {
    pub async fn setup_readiness(&self, address: &str) -> Result<SetupDiscovery> {
        let discovery = self.discover(address).await?;
        let transport = self
            .contacts
            .lock()
            .await
            .get(&discovery.discovery_id)
            .ok_or_else(|| Error::new(ErrorCode::NotFound))?
            .transport
            .clone();
        let readiness = Client::setup_readiness(&transport, &discovery.server_id).await?;
        Ok(SetupDiscovery {
            discovery,
            readiness,
        })
    }
    pub async fn setup_handoff(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
    ) -> Result<ServerSnapshot> {
        self.management_read(
            app,
            id,
            |client| async move { client.setup_handoff().await },
        )
        .await?;
        let slot = self.slot(id)?;
        slot.info_loaded
            .store(false, std::sync::atomic::Ordering::Relaxed);
        slot.capabilities_loaded
            .store(false, std::sync::atomic::Ordering::Relaxed);
        self.snapshot(app, id, true).await
    }
}
