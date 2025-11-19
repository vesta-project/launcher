#[cfg(test)]
mod tests {
    use super::super::{Instance, Account};
    use crate::utils::sqlite::SqlTable;

    #[test]
    fn test_instance_schema() {
        println!("\n=== Instance Schema ===");
        println!("{}", Instance::schema_sql());
        println!("\n=== Instance Indices ===");
        for idx in Instance::get_indices() {
            println!("{}", idx);
        }
        assert!(!Instance::schema_sql().is_empty());
    }

    #[test]
    fn test_account_schema() {
        println!("\n=== Account Schema ===");
        println!("{}", Account::schema_sql());
        println!("\n=== Account Indices ===");
        for idx in Account::get_indices() {
            println!("{}", idx);
        }
        assert!(!Account::schema_sql().is_empty());
    }
}
