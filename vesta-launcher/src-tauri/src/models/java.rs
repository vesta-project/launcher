use crate::schema::config::global_java_paths;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Queryable, Selectable, Clone)]
#[diesel(table_name = global_java_paths)]
pub struct GlobalJavaPath {
    pub id: i32,
    pub major_version: i32,
    pub path: String,
    pub is_managed: bool,
    pub is_active: bool,
}
