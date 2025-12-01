extern crate proc_macro;
extern crate quote;
extern crate syn;

use proc_macro::TokenStream;
use syn::{parse_macro_input, DeriveInput};

mod common;
mod derive_test;
mod sqlite;

#[proc_macro_derive(
    SqlTable,
    attributes(
        primary_key,
        autoincrement,
        unique,
        not_null,
        table_name,
        numeric,
        migration_version,
        migration_description
    )
)]
pub fn sql_table(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    sqlite::parse_sqlite_table(&input)
}

#[proc_macro_derive(MyDerive, attributes(id))]
pub fn my_derive(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    derive_test::my_derive(&input)
}
