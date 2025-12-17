use crate::notifications::models::{
    CreateNotificationInput, NotificationAction, NotificationActionType, NotificationType,
};
use slug::slugify;

/// Map a generator-provided NotificationHint (from piston-lib) into a CreateNotificationInput
pub fn notification_hint_to_create_input(
    hint: &piston_lib::game::NotificationHint,
) -> CreateNotificationInput {
    // Convert actions, if any
    let mut actions: Vec<NotificationAction> = Vec::new();
    if let Some(ref acts) = hint.actions {
        for a in acts.iter() {
            if let Some(obj) = a.as_object() {
                let label = obj
                    .get("label")
                    .and_then(|v| v.as_str())
                    .unwrap_or("action")
                    .to_string();
                let id = obj
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| slugify(&label));
                let action_type = obj
                    .get("action_type")
                    .or_else(|| obj.get("type"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("primary");
                let action_type_enum = match action_type.to_lowercase().as_str() {
                    "destructive" => NotificationActionType::Destructive,
                    "secondary" => NotificationActionType::Secondary,
                    _ => NotificationActionType::Primary,
                };
                let payload = obj.get("payload").cloned();
                actions.push(NotificationAction {
                    id,
                    label,
                    action_type: action_type_enum,
                    payload,
                });
            }
        }
    }

    // Build metadata JSON string from the hint. We preserve the hint fully to store in DB/allow the UI to pick it up
    let meta_json = serde_json::to_string(&hint).ok();

    // Build client_key fallback from title if missing
    let client_key = hint
        .client_key
        .clone()
        .or_else(|| hint.title.clone().map(|t| slugify(&t)));

    let notification_type = hint.notification_type.clone().map(NotificationType::from);

    CreateNotificationInput {
        client_key,
        title: hint.title.clone(),
        description: hint.description.clone(),
        severity: hint.severity.clone(),
        notification_type,
        dismissible: hint.dismissible,
        progress: hint.progress,
        current_step: hint.current_step.map(|s| s as i32),
        total_steps: hint.total_steps.map(|s| s as i32),
        actions: if actions.is_empty() {
            None
        } else {
            Some(actions)
        },
        metadata: meta_json,
        show_on_completion: hint.show_on_completion,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use piston_lib::game::NotificationHint;

    #[test]
    fn test_mapping_basic() {
        let hint = NotificationHint {
            client_key: Some("ck-1".to_string()),
            title: Some("My title".to_string()),
            description: Some("desc".to_string()),
            notification_type: Some("Immediate".to_string()),
            severity: Some("Info".to_string()),
            dismissible: Some(true),
            progress: None,
            current_step: None,
            total_steps: None,
            show_on_completion: None,
            actions: None,
            extra: None,
        };
        let input = notification_hint_to_create_input(&hint);
        assert_eq!(input.client_key.unwrap(), "ck-1");
        assert_eq!(input.title.unwrap(), "My title");
        assert_eq!(input.notification_type.unwrap().to_string(), "immediate");
    }
}
