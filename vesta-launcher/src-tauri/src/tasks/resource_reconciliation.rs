use crate::resources::reconciliation::{reconcile_prepared_candidates, PreparedResourceCandidate};
use crate::tasks::manager::{Task, TaskContext};

pub struct ResourceEnrichmentTask {
    instance_id: i32,
    instance_name: String,
    candidates: Vec<PreparedResourceCandidate>,
    reason: String,
}

impl ResourceEnrichmentTask {
    pub(crate) fn new(
        instance_id: i32,
        instance_name: impl Into<String>,
        candidates: Vec<PreparedResourceCandidate>,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            instance_id,
            instance_name: instance_name.into(),
            candidates,
            reason: reason.into(),
        }
    }
}

impl Task for ResourceEnrichmentTask {
    fn name(&self) -> String {
        format!("Enrich resources for {}", self.instance_name)
    }

    fn id(&self) -> Option<String> {
        Some(format!("resource-enrichment-{}", self.instance_id))
    }

    fn show_notification(&self) -> bool {
        false
    }

    fn starting_description(&self) -> String {
        "Filling in resource metadata…".to_string()
    }

    fn completion_description(&self) -> String {
        "Resource metadata enrichment finished".to_string()
    }

    fn run(&self, ctx: TaskContext) -> futures::future::BoxFuture<'static, Result<(), String>> {
        let app_handle = ctx.app_handle.clone();
        let instance_id = self.instance_id;
        let candidates = self.candidates.clone();
        let reason = self.reason.clone();
        Box::pin(async move {
            let total = candidates.len();
            ctx.update_full(
                crate::notifications::models::PROGRESS_INDETERMINATE,
                format!("Matching {total} indexed resources with providers…"),
                Some(0),
                Some(total as i32),
            );
            let summary =
                reconcile_prepared_candidates(&app_handle, instance_id, candidates, &reason)
                    .await
                    .map_err(|error| error.to_string())?;
            crate::resources::watcher::resolve_modpack_override_conflicts(&app_handle, instance_id)
                .await
                .map_err(|error| error.to_string())?;
            ctx.update_full(
                crate::notifications::models::PROGRESS_INDETERMINATE,
                format!(
                    "Matched metadata for {}/{} resources.",
                    summary.identified, summary.attempted
                ),
                Some(summary.attempted as i32),
                Some(summary.attempted as i32),
            );
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::ResourceEnrichmentTask;
    use crate::tasks::manager::Task;

    #[test]
    fn enrichment_is_deduplicated_and_silent() {
        let enrichment =
            ResourceEnrichmentTask::new(22, "Example Pack", Vec::new(), "test-enrichment");

        assert_eq!(enrichment.name(), "Enrich resources for Example Pack");
        assert_eq!(enrichment.id().as_deref(), Some("resource-enrichment-22"));
        assert!(!enrichment.show_notification());
    }
}
