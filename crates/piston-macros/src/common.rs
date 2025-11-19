use proc_macro2::{Ident, Span};
use syn::{GenericArgument, Path, PathArguments, Type, TypePath};

/// Returns the name of the first segment of the path
pub(crate) fn get_name_from_path(path: &Path) -> &Ident {
    &path.segments.iter().next().unwrap().ident
}

/// Extracts the type from an enum.
///
/// # Panics
/// When the type is not supported
pub(crate) fn extract_type_from_enum(ty: &Type) -> Type {
    fn path_is_option(path: &Path) -> bool {
        path.leading_colon.is_none() && path.segments.len() == 1
        //&& { path.segments.iter().next().unwrap().ident == name }
    }

    match ty {
        Type::Path(type_path) if type_path.qself.is_none() && path_is_option(&type_path.path) => {
            // Get the first segment of the path (there is only one):
            let type_params = match type_path.path.segments.first() {
                Some(t) => &t.arguments,
                None => panic!("TODO: error handling"),
            };
            // It should have only on angle-bracketed param ("<String>"):
            match type_params {
                PathArguments::AngleBracketed(params) => match params.args.first() {
                    Some(GenericArgument::Type(ty)) => ty.to_owned(),
                    _ => panic!("TODO: error handling"),
                },
                _ => panic!("TODO: error handling"),
            }
        }
        _ => panic!("TODO: error handling"),
    }
}

/// Generates a TypePath for an enum with a generic parameter.
pub(crate) fn generate_enum_with_generic(enum_name: &str, generic_type: &str) -> TypePath {
    let enum_ident = Ident::new(&enum_name, Span::call_site());
    let generic_ident = Ident::new(&generic_type, Span::call_site());

    let mut segments = syn::punctuated::Punctuated::new();
    segments.push_value(syn::PathSegment {
        ident: enum_ident,
        arguments: PathArguments::AngleBracketed(syn::AngleBracketedGenericArguments {
            colon2_token: None,
            lt_token: syn::token::Lt(Span::call_site()),
            args: syn::punctuated::Punctuated::from_iter(vec![syn::GenericArgument::Type(
                Type::Path(TypePath {
                    qself: None,
                    path: Path {
                        leading_colon: None,
                        segments: syn::punctuated::Punctuated::from_iter(vec![syn::PathSegment {
                            ident: generic_ident,
                            arguments: syn::PathArguments::None,
                        }]),
                    },
                }),
            )]),
            gt_token: syn::token::Gt(Span::call_site()),
        }),
    });

    TypePath {
        qself: None,
        path: Path {
            leading_colon: None,
            segments,
        },
    }
}
