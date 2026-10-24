//! File-specific snapshot effects; kept separate from lifecycle/access modules.
mod dropped;
pub(crate) use dropped::{DroppedFiles, DroppedUploadCandidate};

use super::*;
use std::collections::BTreeMap;
use vesta_server_client::files::PropertiesUpdateResult;

impl ServerManager {
    pub(crate) async fn files_properties_update(
        &self,
        app: &AppHandle,
        id: &str,
        changes: BTreeMap<String, Value>,
        expected: &str,
        confirmation: Option<&str>,
        intent: &str,
    ) -> Result<PropertiesUpdateResult> {
        let result = self
            .client(id)
            .await?
            .properties_update(changes, expected, confirmation, intent)
            .await;
        match &result {
            Ok(PropertiesUpdateResult::Applied {
                restart_needed: true,
                ..
            }) => {
                self.edit_store(|store| {
                    let record = store
                        .connections
                        .iter_mut()
                        .find(|v| v.snapshot.connection.id == id)
                        .ok_or_else(|| Error::new(ErrorCode::NotFound))?;
                    record.snapshot.restart_required = true;
                    Ok(())
                })
                .await?;
                let snapshot = self.record(id).await?.snapshot;
                self.deliver(
                    id,
                    ServerTopic::Status,
                    ServerEvent::Snapshot {
                        snapshot: Box::new(snapshot),
                    },
                );
                self.changed(app);
            }
            Err(error) => self.synchronize_failure(app, id, error).await,
            _ => {}
        }
        result
    }
}
