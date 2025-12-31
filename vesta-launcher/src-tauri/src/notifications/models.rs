use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum NotificationType {
    Immediate,
    Progress,
    Patient,
    Task,
}

impl ToString for NotificationType {
    fn to_string(&self) -> String {
        match self {
            NotificationType::Immediate => "immediate".to_string(),
            NotificationType::Progress => "progress".to_string(),
            NotificationType::Patient => "patient".to_string(),
            NotificationType::Task => "task".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NotificationSeverity {
    Info,
    Success,
    Warning,
    Error,
}

impl From<String> for NotificationSeverity {
    fn from(s: String) -> Self {
        match s.to_lowercase().as_str() {
            "success" => NotificationSeverity::Success,
            "warning" => NotificationSeverity::Warning,
            "error" => NotificationSeverity::Error,
            _ => NotificationSeverity::Info,
        }
    }
}

impl ToString for NotificationSeverity {
    fn to_string(&self) -> String {
        match self {
            NotificationSeverity::Success => "success".to_string(),
            NotificationSeverity::Warning => "warning".to_string(),
            NotificationSeverity::Error => "error".to_string(),
            NotificationSeverity::Info => "info".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CreateNotificationInput {
    pub client_key: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub severity: Option<String>,
    pub notification_type: Option<NotificationType>,
    pub dismissible: Option<bool>,
    pub progress: Option<i32>,
    pub current_step: Option<i32>,
    pub total_steps: Option<i32>,
    pub actions: Option<String>,  // JSON string
    pub metadata: Option<String>, // JSON string
    pub show_on_completion: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: Option<i32>,
    pub client_key: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub severity: NotificationSeverity,
    pub notification_type: NotificationType,
    pub dismissible: bool,
    pub progress: Option<i32>,
    pub current_step: Option<i32>,
    pub total_steps: Option<i32>,
    pub read: bool,
    pub actions: Vec<crate::notifications::models::NotificationAction>, // Need Action struct?
    pub metadata: Option<String>,
    pub show_on_completion: Option<bool>,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: Option<String>,
}

// I need NotificationAction too!
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NotificationAction {
    pub label: String,
    pub action_id: String,
    pub primary: bool,
}
