use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Queryable, Insertable, AsChangeset, Clone)]
#[diesel(table_name = crate::schema::vesta::instance_resource_update_check)]
pub struct InstanceResourceUpdateCheck {
    pub instance_id: i32,
    pub checked_at: String,
    pub results_json: String,
    pub instance_fingerprint: String,
}
