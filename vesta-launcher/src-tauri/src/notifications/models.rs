use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NotificationSeverity {
    Info,
    Success,
    Warning,
    Error,
}

impl ToString for NotificationSeverity {
    fn to_string(&self) -> String {
        match self {
            NotificationSeverity::Info => "info".to_string(),
            NotificationSeverity::Success => "success".to_string(),
            NotificationSeverity::Warning => "warning".to_string(),
            NotificationSeverity::Error => "error".to_string(),
        }
    }
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NotificationType {
    Alert,
    Progress,
    Immediate,
    Patient,
}

impl ToString for NotificationType {
    fn to_string(&self) -> String {
        match self {
            NotificationType::Alert => "alert".to_string(),
            NotificationType::Progress => "progress".to_string(),
            NotificationType::Immediate => "immediate".to_string(),
            NotificationType::Patient => "patient".to_string(),
        }
    }
}

impl From<String> for NotificationType {
    fn from(s: String) -> Self {
        match s.to_lowercase().as_str() {
            "alert" => NotificationType::Alert,
            "progress" => NotificationType::Progress,
            "immediate" => NotificationType::Immediate,
            "patient" => NotificationType::Patient,
            _ => NotificationType::Immediate,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationAction {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub action_type: NotificationActionType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NotificationActionType {
    Primary,
    Secondary,
    Destructive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: Option<i32>,
    pub client_key: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub severity: NotificationSeverity,
    pub notification_type: NotificationType,
    pub dismissible: bool,
    pub read: bool,
    pub progress: Option<i32>,
    pub current_step: Option<i32>,
    pub total_steps: Option<i32>,
    pub actions: Vec<NotificationAction>,
    pub metadata: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub actions: Option<Vec<NotificationAction>>,
    pub metadata: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProgressInput {
    pub id_or_key: String,
    pub progress: i32,
    pub current_step: Option<i32>,
    pub total_steps: Option<i32>,
}
