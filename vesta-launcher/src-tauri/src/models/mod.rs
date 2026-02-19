pub mod account;
pub mod api;
pub mod domain;
pub mod installed_resource;
pub mod instance;
pub mod java;
pub mod notification;
pub mod notification_seen_item;
pub mod notification_subscription;
pub mod pinning;
pub mod resource;
pub mod task_state;
pub mod user_version_tracking;

pub use account::Account;
pub use installed_resource::InstalledResource;
pub use instance::Instance;
pub use java::GlobalJavaPath;
pub use notification::Notification;
pub use notification_seen_item::{NewNotificationSeenItem, NotificationSeenItem};
pub use notification_subscription::{NewNotificationSubscription, NotificationSubscription};
pub use resource::{ResourceProject, ResourceType, ResourceVersion, SourcePlatform};
pub use task_state::TaskState;
pub use user_version_tracking::UserVersionTracking;

// Re-export AppConfig from utils::config for convenience
pub use crate::utils::config::AppConfig;

#[cfg(test)]
mod tests;
