use proc_macro::TokenStream;

use heck::ToSnakeCase;
use proc_macro2::Ident;
use quote::{quote, ToTokens};
use syn::{DeriveInput, TypePath};

use crate::common::{extract_type_from_enum, generate_enum_with_generic, get_name_from_path};

/// TODO: Blobs are not really supported

#[allow(clippy::too_many_lines)]
pub(crate) fn parse_sqlite_table(ast: &DeriveInput) -> TokenStream {
    let name = &ast.ident;
    let mut table_name: Option<String> = None;
    let mut migration_version: Option<String> = None;
    let mut migration_description: Option<String> = None;

    // Check for migration attributes on the struct itself
    for attr in &ast.attrs {
        if let Ok(meta) = attr.parse_args::<syn::LitStr>() {
            if let Some(ident) = attr.path().get_ident() {
                let ident_str = ident.to_string();
                match ident_str.as_str() {
                    "migration_version" => migration_version = Some(meta.value()),
                    "migration_description" => migration_description = Some(meta.value()),
                    _ => {}
                }
            }
        }
    }

    let fields = {
        if let syn::Data::Struct(syn::DataStruct {
            fields: syn::Fields::Named(syn::FieldsNamed { named, .. }),
            ..
        }) = &ast.data
        {
            named
        } else {
            panic!("Only named struct fields are supported");
        }
    };

    // Check attributes
    fields.iter().for_each(|f| {
        let mut is_key = false;
        let mut keys: Vec<String> = Vec::new();
        let mut is_table_name = false;
        for a in &f.attrs {
            let ident = a.path().get_ident();
            if let Some(ident) = ident {
                let ident = ident.to_string();
                if matches!(
                    ident.as_str(),
                    "primary_key" | "autoincrement" | "unique" | "not_null"
                ) {
                    keys.push(ident.clone());
                    is_key = true;
                }
                if "table_name" == &ident {
                    is_table_name = true;
                }
            }
        }
        if is_key && is_table_name {
            panic!(
                "`table_name` attribute cannot be used with attributes {}",
                keys.join(", ")
            );
        } else if is_table_name {
            if table_name.is_some() {
                panic!("Cannot have multiple table_name fields");
            } else {
                table_name = Some(f.ident.as_ref().unwrap().to_string());
            }
        }
    });

    if table_name.is_none() {
        // Convert struct name to snake_case for SQL table naming convention
        table_name = Some(name.to_string().to_snake_case());
    }

    // Parse the fields
    let columns: Vec<_> = fields.iter().map(get_field_columns).collect();

    // The value used in the column function
    let columns_str: Vec<_> = columns
        .iter()
        .filter(|(_, _, attr, _)| !attr.contains(&"TABLE NAME".to_string()))
        .map(|(key, sql_t, attr, _)| {
            quote! { (#key.to_string(), vec![#(#attr.to_string()),*], #sql_t.to_string()) }
        })
        .collect();

    let mut auto_increment: Vec<_> = columns
        .iter()
        .filter(|(_, _, attr, _)| attr.contains(&"AUTOINCREMENT".to_string()))
        .map(|(key, _, _, _)| {
            let k = Ident::new(key, proc_macro2::Span::call_site());
            quote! { Some((#key.to_string(), &self.#k)) }
        })
        .collect::<Vec<_>>();

    if auto_increment.is_empty() {
        auto_increment.push(quote! { None });
    }

    // The values used in the new function
    let struct_new_params: Vec<_> = columns
        .iter()
        .filter(|(_, _, attr, _)| {
            !attr.contains(&"AUTOINCREMENT".to_string())
                && !attr.contains(&"TABLE NAME".to_string())
        })
        .map(|(key, _, _, t)| {
            let key = Ident::new(key, proc_macro2::Span::call_site());
            let t = {
                if t.contains('<') {
                    let t = t.replace('>', "");
                    let mut t = t.split('<');

                    generate_enum_with_generic(t.next().unwrap(), t.last().unwrap())
                    //syn::parse_str::<TypePath>(t.last().unwrap()).unwrap()
                } else {
                    syn::parse_str::<TypePath>(t).unwrap()
                }
            };
            quote! { #key: #t }
        })
        .collect();

    let struct_new_values: Vec<_> = columns
        .iter()
        .map(|(key, _, attrs, _)| {
            let key = Ident::new(key, proc_macro2::Span::call_site());

            if attrs.contains(&"TABLE NAME".to_string()) {
                quote! { #key: stringify!(#key).to_string() }
            } else if attrs.contains(&"AUTOINCREMENT".to_string()) {
                quote! { #key: AUTOINCREMENT::INIT }
            } else {
                quote! { #key }
            }
        })
        .collect();

    //let placeholders = fields.iter().map(|_| "?").collect::<Vec<_>>();
    //let sql_placeholders = quote::quote! { vec![#(#placeholders,)*] };

    // Generate the value collection expression
    let values_column = columns
        .iter()
        .filter(|c| {
            !c.2.contains(&"AUTOINCREMENT".to_string()) && !c.2.contains(&"TABLE NAME".to_string())
        })
        .collect::<Vec<&(String, String, Vec<String>, String)>>();

    let mut pre_values_column: Vec<proc_macro2::TokenStream> = Vec::new();

    let values_expr = fields
        .iter()
        .filter(|f| {
            values_column
                .iter()
                .filter(|c| f.ident.as_ref().unwrap() == &c.0)
                .count()
                != 0
        })
        .map(|field: &syn::Field| field_to_value(field, &values_column, &mut pre_values_column))
        .collect::<Vec<_>>();

    let values_column = values_column
        .iter()
        .map(|c| c.0.clone())
        .collect::<Vec<String>>();
    let values = quote::quote! { (vec![#(Box::new(#values_expr),)*], vec![#(#values_column.to_string(),)*]) };

    // Generate migration-related methods
    let migration_version_impl = if let Some(ver) = migration_version {
        quote::quote! {
            fn migration_version() -> String {
                #ver.to_string()
            }
        }
    } else {
        quote::quote! {}
    };

    let migration_description_impl = if let Some(desc) = migration_description {
        quote::quote! {
            fn migration_description() -> String {
                #desc.to_string()
            }
        }
    } else {
        quote::quote! {}
    };

    let expanded = quote::quote! {
         impl SqlTable for #name {
            fn columns() -> std::collections::HashMap<String, (Vec<String>, String)> {
                let mut hash: std::collections::HashMap<String, (Vec<String>, String)> = std::collections::HashMap::new();
                let columns = vec![#(#columns_str,)*];

                for (key, attr, _type) in columns { hash.insert(key, (attr, _type)); }
                hash
            }

            fn values(&self) -> anyhow::Result<(Vec<Box<dyn rusqlite::ToSql>>, Vec<String>)> {
                #(#pre_values_column)*
                Ok(#values)
            }

            fn name() -> String { #table_name.to_string() }

            fn get_auto_increment(&self) -> Option<(String, &AUTOINCREMENT)> {
                return (#(#auto_increment)*);
            }

            #migration_version_impl
            #migration_description_impl
        }

        impl #name {
            fn new(#(#struct_new_params,)*) -> Self {
                Self { #(#struct_new_values,)* }
            }
        }
    };
    TokenStream::from(expanded)
}

fn get_field_attr(field: &syn::Field) -> Vec<String> {
    field
        .attrs
        .iter()
        .map(|attr| {
            if let Some(name) = attr.path().get_ident() {
                name.to_string().replace('_', " ").to_uppercase()
            } else {
                String::new()
            }
        })
        .collect::<Vec<String>>()
}

fn get_field_columns(field: &syn::Field) -> (String, String, Vec<String>, String) {
    let get_int_type = |attrs: &Vec<String>, normal: &str| -> String {
        if attrs.contains(&"NUMERIC".to_string()) {
            "NUMERIC".to_string()
        } else {
            normal.to_string()
        }
    };

    let ident = field.ident.as_ref().unwrap();
    let attr = get_field_attr(field);

    // Type, Enum Name, is_option
    let sql_t: (String, Option<String>, bool) = match &field.ty {
        syn::Type::Path(syn::TypePath { path, .. }) => {
            // Check if this is an Option type
            let is_option =
                path.segments.len() == 1 && path.segments.first().unwrap().ident == "Option";

            if is_option {
                // Extract the inner type from Option<T>
                match &path.segments.first().unwrap().arguments {
                    syn::PathArguments::AngleBracketed(args) => {
                        if let Some(syn::GenericArgument::Type(inner_ty)) = args.args.first() {
                            match inner_ty {
                                syn::Type::Path(inner_path) => {
                                    let inner_ident = inner_path
                                        .path
                                        .get_ident()
                                        .expect("Failed to get inner type ident");
                                    (inner_ident.to_string(), Some("Option".to_string()), true)
                                }
                                _ => panic!("Unsupported Option inner type"),
                            }
                        } else {
                            panic!("Option must have a type parameter");
                        }
                    }
                    _ => panic!("Option must have angle bracketed arguments"),
                }
            } else {
                match path.get_ident() {
                    None => (
                        match extract_type_from_enum(&field.ty) {
                            syn::Type::Path(syn::TypePath { path, .. }) => path
                                .get_ident()
                                .expect("Failed to get ident from enum")
                                .to_string(),
                            _ => panic!("TODO: Error Handling"),
                        },
                        Some(get_name_from_path(&path).to_string()),
                        false,
                    ),
                    Some(p) => (p.to_string(), None, false),
                }
            }
        }
        t => panic!("Only paths are supported found {}", t.to_token_stream()),
    };

    // AUTOINCREMENT must always be INTEGER in SQLite
    let t = if attr.contains(&"AUTOINCREMENT".to_string()) {
        "INTEGER".to_string()
    } else {
        match sql_t.0.as_str() {
            "String" => "TEXT".to_string(),
            "bool" => "INTEGER".to_string(), // SQLite stores bool as INTEGER
            "i64" => get_int_type(&attr, "INTEGER"),
            "f64" => get_int_type(&attr, "REAL"),
            "i32" => {
                // WARNING: SQL INTEGER has a data type of i64
                get_int_type(&attr, "INTEGER")
            }
            "f32" => {
                // WARNING: SQL READ has a data type of f64
                get_int_type(&attr, "REAL")
            }
            _ => "BLOB".to_string(),
        }
    };

    // Return the full type string including Option if present
    let type_string = if sql_t.2 {
        format!("Option<{}>", sql_t.0)
    } else if let Some(enum_name) = &sql_t.1 {
        format!("{}<{}>", enum_name, sql_t.0)
    } else {
        sql_t.0.clone()
    };

    (ident.to_string(), t, attr, type_string)
}

fn field_to_value(
    field: &syn::Field,
    values_column: &Vec<&(String, String, Vec<String>, String)>,
    columns_pre: &mut Vec<proc_macro2::TokenStream>,
) -> proc_macro2::TokenStream {
    let ident = field.ident.as_ref().unwrap();
    let ty = values_column
        .iter()
        .filter(|c| *ident == c.0)
        .map(|c| &c.1)
        .collect::<Vec<&String>>();

    if "BLOB" == *ty.first().unwrap() {
        columns_pre.push(quote::quote! { let #ident = &self.#ident; });
        return quote::quote! { #ident };
    }

    // Check if the field is an Option type or bool by looking at the type string
    let field_type_str = values_column
        .iter()
        .filter(|c| *ident == c.0)
        .map(|c| &c.3)
        .collect::<Vec<&String>>();

    if let Some(type_str) = field_type_str.first() {
        if type_str.starts_with("Option<") {
            // For Option types, we need to clone the Option itself
            // rusqlite's ToSql is implemented for Option<T> where T: ToSql
            return quote::quote! { self.#ident.clone() };
        } else if *type_str == "bool" {
            // SQLite doesn't have bool, so convert to i32 (0 or 1)
            return quote::quote! { if self.#ident { 1 } else { 0 } };
        }
    }

    // All other types can be cloned
    quote::quote! { self.#ident.clone() }
}
