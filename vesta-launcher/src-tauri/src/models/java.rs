use crate::schema::config::global_java_paths;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Queryable, Selectable, Insertable, AsChangeset, Clone)]
#[diesel(table_name = global_java_paths)]
pub struct GlobalJavaPath {
    pub major_version: i32,
    pub path: String,
    pub is_managed: bool,
}
