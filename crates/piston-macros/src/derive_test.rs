use proc_macro::TokenStream;
use quote::quote;
use syn::{Attribute, DeriveInput, Meta, parse_macro_input};


pub fn my_derive(ast: &DeriveInput) -> TokenStream {
    // Check if the input is a struct
    if let syn::Data::Struct(data) = &ast.data {
        // Iterate over the fields of the struct
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

        // Collect fields with the 'id' attribute
        let fields_with_id_attr = fields.iter().filter(|field| {
            field.attrs.iter().any(|attr| {
                if attr.path().is_ident("id") {
                    return true;
                }
                false
            })
        }).map(|field| {
            let field_name = &field.ident.as_ref().unwrap();
            let ty = &field.ty;
            quote! {
            #field_name: #ty,
            #[serde(default = "default_value_for_optional")]
            }
        }).collect::<Vec<_>>();

        // Generate the modified code
        let expanded = quote! {
            #ast
            #(#fields_with_id_attr)*
        };

        // Return the generated impl as a TokenStream
        TokenStream::from(expanded)
    } else {
        panic!("only structs supported");
    }
}