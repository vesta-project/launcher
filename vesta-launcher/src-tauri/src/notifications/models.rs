use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum NotificationType {
    Immediate,
    Progress,
    Patient,
}

impl ToString for NotificationType {
    fn to_string(&self) -> String {
        match self {
            NotificationType::Immediate => "immediate".to_string(),
            NotificationType::Progress => "progress".to_string(),
            NotificationType::Patient => "patient".to_string(),
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

pub const PROGRESS_INDETERMINATE: i32 = -1;
pub const NOT_PERSISTED_ID: i32 = -1;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", content = "data")]
#[serde(rename_all = "camelCase")]
pub enum ProgressUpdate {
    /// Update the overall progress percentage and/or description
    Progress {
        percent: i32,
        description: Option<String>,
        severity: Option<NotificationSeverity>,
    },
    /// Start a new step with an optional count of sub-steps
    Step {
        name: String,
        total: Option<u32>,
    },
    /// Update the current step count against a total
    StepCount {
        current: u32,
        total: Option<u32>,
    },
    /// Mark the task as finished
    Finished {
        success: bool,
        message: Option<String>,
    },
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
    pub persist: Option<bool>,
    pub silent: Option<bool>,
}

impl Default for CreateNotificationInput {
    fn default() -> Self {
        Self {
            client_key: None,
            title: None,
            description: None,
            severity: Some("info".to_string()),
            notification_type: Some(NotificationType::Immediate),
            dismissible: Some(true),
            progress: None,
            current_step: None,
            total_steps: None,
            actions: None,
            metadata: None,
            show_on_completion: None,
            persist: Some(true),
            silent: Some(false),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Notification {
    pub id: Option<i32>,
    pub client_key: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub severity: NotificationSeverity,
    pub notification_type: NotificationType,
    pub dismissible: bool,
    pub persist: bool,
    pub silent: bool,
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
    #[serde(rename = "id")]
    pub action_id: String,
    #[serde(rename = "type")]
    pub action_type: String,
    pub payload: Option<serde_json::Value>,
}
