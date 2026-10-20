//! Fail-closed author grammar. Lightning CSS owns syntax and serialization; its
//! underlying tokenizer inspects *all* values, including custom/unparsed values.
use cssparser::{Parser, ParserInput, Token};
use lightningcss::{
    properties::{
        custom::{TokenList, TokenOrValue},
        Property,
    },
    rules::{CssRule, CssRuleList},
    selector::{Component, PseudoClass, PseudoElement, Selector},
    stylesheet::{ParserOptions, PrinterOptions, StyleSheet},
    traits::{Parse, ToCss},
};
use std::collections::HashSet;

pub const MAX_CSS: usize = 128 * 1024;
const MAX_TOKENS: usize = 32768;

// cssparser follows browser EOF recovery for unterminated blocks. Uploads
// require explicit closure instead: a real closing token advances past the
// nested parser's final position, whereas implicit EOF closure does not.
fn block<'i, T>(
    p: &mut Parser<'i, '_>,
    f: impl for<'t> FnOnce(&mut Parser<'i, 't>) -> Result<T, cssparser::ParseError<'i, ()>>,
) -> Result<T, cssparser::ParseError<'i, ()>> {
    let mut end = p.position();
    let value = p.parse_nested_block(|inner| {
        let value = f(inner);
        end = inner.position();
        value
    })?;
    if p.position() == end {
        return Err(p.new_custom_error(()));
    }
    Ok(value)
}

fn tokens<'i>(
    p: &mut Parser<'i, '_>,
    depth: usize,
    count: &mut usize,
    refs: Option<&HashSet<String>>,
) -> Result<(), cssparser::ParseError<'i, ()>> {
    if depth > 32 {
        return Err(p.new_custom_error(()));
    }
    while !p.is_exhausted() {
        *count += 1;
        if *count > MAX_TOKENS {
            return Err(p.new_custom_error(()));
        }
        let t = p.next_including_whitespace_and_comments()?.clone();
        match t {
            Token::BadUrl(_) | Token::BadString(_) | Token::UnquotedUrl(_) => {
                return Err(p.new_custom_error(()))
            }
            Token::Function(name) => {
                let name = name.to_ascii_lowercase();
                if let Some(refs) = refs {
                    if ![
                        "var",
                        "rgb",
                        "rgba",
                        "hsl",
                        "hsla",
                        "hwb",
                        "lab",
                        "lch",
                        "oklab",
                        "oklch",
                        "color",
                        "color-mix",
                        "light-dark",
                        "calc",
                        "min",
                        "max",
                        "clamp",
                        "linear-gradient",
                        "radial-gradient",
                        "conic-gradient",
                        "repeating-linear-gradient",
                        "repeating-radial-gradient",
                        "repeating-conic-gradient",
                        "rotate",
                        "rotatex",
                        "rotatey",
                        "rotatez",
                        "scale",
                        "scalex",
                        "scaley",
                        "translate",
                        "translatex",
                        "translatey",
                        "translate3d",
                        "matrix",
                        "skew",
                        "blur",
                        "brightness",
                        "contrast",
                        "grayscale",
                        "opacity",
                        "saturate",
                        "sepia",
                        "hue-rotate",
                        "drop-shadow",
                        "cubic-bezier",
                        "steps",
                    ]
                    .contains(&name.as_str())
                    {
                        return Err(p.new_custom_error(()));
                    }
                    block(p, |inner| {
                        if name == "var" {
                            let ident = inner.expect_ident()?.to_string();
                            // References may only reach definitions in this upload or
                            // explicitly resource-free engine inputs. No engine grain URL.
                            if ident.starts_with("--vesta-theme-") {
                                return Err(inner.new_custom_error(()));
                            }
                            if !refs.contains(&ident)
                                && !ident.starts_with("--vesta-color-")
                                && !ident.starts_with("--vesta-radius-")
                                && ![
                                    "--switch-height",
                                    "--vesta-border-width",
                                    "--vesta-focus-width",
                                    "--vesta-focus-offset",
                                    "--vesta-font-sans",
                                ]
                                .contains(&ident.as_str())
                            {
                                return Err(inner.new_custom_error(()));
                            }
                        }
                        if name == "color" || name == "color-mix" {
                            if name == "color-mix" {
                                inner.expect_ident_matching("in")?;
                            }
                            let space = inner.expect_ident()?;
                            if ![
                                "srgb",
                                "srgb-linear",
                                "display-p3",
                                "a98-rgb",
                                "prophoto-rgb",
                                "rec2020",
                                "xyz",
                                "xyz-d50",
                                "xyz-d65",
                                "lab",
                                "lch",
                                "oklab",
                                "oklch",
                                "hsl",
                                "hwb",
                            ]
                            .contains(&space.as_ref())
                            {
                                return Err(inner.new_custom_error(()));
                            }
                        }
                        tokens(inner, depth + 1, count, Some(refs))
                    })?;
                } else {
                    block(p, |inner| tokens(inner, depth + 1, count, None))?;
                }
            }
            Token::ParenthesisBlock | Token::SquareBracketBlock | Token::CurlyBracketBlock => {
                if refs.is_some() {
                    return Err(p.new_custom_error(()));
                }
                block(p, |inner| tokens(inner, depth + 1, count, refs))?;
            }
            Token::CloseParenthesis | Token::CloseSquareBracket | Token::CloseCurlyBracket => {
                return Err(p.new_custom_error(()))
            }
            _ => {}
        }
    }
    Ok(())
}

fn styles<'a, 'i>(
    rules: &'a CssRuleList<'i>,
    wrapped: bool,
    out: &mut Vec<&'a lightningcss::rules::style::StyleRule<'i>>,
) -> Result<(), String> {
    for rule in &rules.0 {
        match rule {
            CssRule::Style(s) if s.rules.0.is_empty() => out.push(s),
            CssRule::LayerBlock(l)
                if !wrapped
                    && rules.0.len() == 1
                    && l.name
                        .as_ref()
                        .is_some_and(|n| n.0.len() == 1 && n.0[0].as_ref() == "theme") =>
            {
                styles(&l.rules, true, out)?
            }
            _ => {
                return Err(
                    "Only ordinary rules and an optional exact @layer theme wrapper are supported"
                        .into(),
                )
            }
        }
        if out.len() > 1024 {
            return Err("Too many author rules".into());
        }
    }
    Ok(())
}

// Lightning CSS correctly implements forgiving :is/:where lists, even with
// stylesheet recovery disabled. Compare decoded selector tokens before/after
// serialization so a discarded invalid branch cannot pass the upload gate.
fn selector_tokens<'i>(
    p: &mut Parser<'i, '_>,
    out: &mut Vec<String>,
) -> Result<(), cssparser::ParseError<'i, ()>> {
    while !p.is_exhausted() {
        match p.next_including_whitespace_and_comments()?.clone() {
            Token::WhiteSpace(_) | Token::Comment(_) => {}
            Token::Ident(s) | Token::QuotedString(s) => out.push(format!("word:{s}")),
            Token::Function(s) => {
                out.push(format!("function:{}", s.to_ascii_lowercase()));
                block(p, |p| selector_tokens(p, out))?;
                out.push("end".into());
            }
            Token::SquareBracketBlock => {
                out.push("[".into());
                block(p, |p| selector_tokens(p, out))?;
                out.push("]".into());
            }
            Token::ParenthesisBlock => {
                out.push("(".into());
                block(p, |p| selector_tokens(p, out))?;
                out.push(")".into());
            }
            t => out.push(format!("{t:?}")),
        }
    }
    Ok(())
}
fn original_selectors<'i>(
    p: &mut Parser<'i, '_>,
    out: &mut Vec<String>,
) -> Result<(), cssparser::ParseError<'i, ()>> {
    let mut start = p.position();
    let mut layer = false;
    while !p.is_exhausted() {
        let token_start = p.position();
        match p.next_including_whitespace_and_comments()?.clone() {
            Token::AtKeyword(_) => layer = true, // AST separately admits only exact @layer theme.
            Token::CurlyBracketBlock => {
                if layer {
                    block(p, |p| original_selectors(p, out))?;
                } else {
                    out.push(p.slice(start..token_start).to_owned());
                    block(p, |p| {
                        while p.next_including_whitespace_and_comments().is_ok() {}
                        Ok(())
                    })?;
                }
                start = p.position();
                layer = false;
            }
            Token::Function(_) | Token::SquareBracketBlock | Token::ParenthesisBlock => {
                block(p, |p| {
                    while p.next_including_whitespace_and_comments().is_ok() {}
                    Ok(())
                })?;
            }
            _ => {}
        }
    }
    Ok(())
}
fn selector_fingerprint(css: &str) -> Result<Vec<String>, String> {
    let mut out = vec![];
    selector_tokens(&mut Parser::new(&mut ParserInput::new(css)), &mut out)
        .map_err(|_| "Invalid selector tokens")?;
    // Lightning CSS serializes the four legacy pseudo-elements with one colon.
    let normalized = out
        .iter()
        .enumerate()
        .filter(|(i, token)| {
            !(token.as_str() == "Colon"
                && out.get(i + 1).is_some_and(|s| s == "Colon")
                && out.get(i + 2).is_some_and(|s| {
                    [
                        "word:before",
                        "word:after",
                        "word:first-line",
                        "word:first-letter",
                    ]
                    .contains(&s.as_str())
                }))
        })
        .map(|(_, token)| token.clone())
        .collect();
    Ok(normalized)
}

fn selector_supported(selector: &Selector<'_>, depth: usize) -> bool {
    if depth > 32 {
        return false;
    }
    selector
        .iter_raw_match_order()
        .all(|component| match component {
            Component::Combinator(_)
            | Component::ExplicitUniversalType
            | Component::LocalName(_)
            | Component::ID(_)
            | Component::Class(_)
            | Component::AttributeInNoNamespaceExists { .. }
            | Component::AttributeInNoNamespace { .. }
            | Component::AttributeOther(_)
            | Component::Root
            | Component::Empty
            | Component::Scope
            | Component::Nth(_) => true,
            Component::Negation(list)
            | Component::Where(list)
            | Component::Is(list)
            | Component::Has(list) => list.iter().all(|s| selector_supported(s, depth + 1)),
            Component::NthOf(nth) => nth
                .selectors()
                .iter()
                .all(|s| selector_supported(s, depth + 1)),
            Component::NonTSPseudoClass(pseudo) => matches!(
                pseudo,
                PseudoClass::Lang { .. }
                    | PseudoClass::Dir { .. }
                    | PseudoClass::Hover
                    | PseudoClass::Active
                    | PseudoClass::Focus
                    | PseudoClass::FocusVisible
                    | PseudoClass::FocusWithin
                    | PseudoClass::Enabled
                    | PseudoClass::Disabled
                    | PseudoClass::Checked
                    | PseudoClass::Indeterminate
                    | PseudoClass::Default
                    | PseudoClass::Valid
                    | PseudoClass::Invalid
                    | PseudoClass::Required
                    | PseudoClass::Optional
                    | PseudoClass::UserValid
                    | PseudoClass::UserInvalid
                    | PseudoClass::InRange
                    | PseudoClass::OutOfRange
                    | PseudoClass::ReadOnly(_)
                    | PseudoClass::ReadWrite(_)
                    | PseudoClass::PlaceholderShown(_)
                    | PseudoClass::Autofill(_)
                    | PseudoClass::AnyLink(_)
                    | PseudoClass::Link
                    | PseudoClass::Visited
                    | PseudoClass::Target
                    | PseudoClass::Defined
                    | PseudoClass::Open
                    | PseudoClass::Closed
                    | PseudoClass::Modal
                    | PseudoClass::PopoverOpen
            ),
            Component::PseudoElement(pseudo) => matches!(
                pseudo,
                PseudoElement::Before
                    | PseudoElement::After
                    | PseudoElement::FirstLine
                    | PseudoElement::FirstLetter
                    | PseudoElement::Selection(_)
                    | PseudoElement::Placeholder(_)
                    | PseudoElement::Marker
                    | PseudoElement::Backdrop(_)
                    | PseudoElement::FileSelectorButton(_)
                    | PseudoElement::WebKitScrollbar(_)
            ),
            // Unknown/vendor-opaque pseudo nodes and CSS nesting never pass through.
            _ => false,
        })
}

fn has_variable(tokens: &TokenList<'_>) -> bool {
    tokens.0.iter().any(|t| match t {
        TokenOrValue::Var(_) => true,
        TokenOrValue::Function(f) => has_variable(&f.arguments),
        _ => false,
    })
}

// Existing app font faces must not become a hidden resource route. This v1
// supports common platform faces and generic families, not arbitrary face names.
fn system_font_list(value: &str) -> bool {
    let mut input = ParserInput::new(value);
    let mut p = Parser::new(&mut input);
    let mut family = String::new();
    let allowed = |s: &str| {
        [
            "system-ui",
            "sans-serif",
            "serif",
            "monospace",
            "cursive",
            "fantasy",
            "ui-sans-serif",
            "ui-serif",
            "ui-monospace",
            "ui-rounded",
            "arial",
            "tahoma",
            "verdana",
            "helvetica",
            "times new roman",
            "courier new",
            "ms sans serif",
            "segoe ui",
            "-apple-system",
            "blinkmacsystemfont",
        ]
        .contains(&s.trim().to_ascii_lowercase().as_str())
    };
    while let Ok(t) = p.next() {
        match t {
            Token::Ident(s) | Token::QuotedString(s) => {
                if !family.is_empty() {
                    family.push(' ');
                }
                family.push_str(s);
            }
            Token::Comma => {
                if !allowed(&family) {
                    return false;
                }
                family.clear();
            }
            _ => return false,
        }
    }
    allowed(&family)
}

pub fn canonicalize(css: &str) -> Result<String, String> {
    if css.len() > MAX_CSS {
        return Err("Author CSS exceeds 128 KiB".into());
    }
    tokens(
        &mut Parser::new(&mut ParserInput::new(css)),
        0,
        &mut 0,
        None,
    )
    .map_err(|_| "Invalid CSS tokens or budget exceeded")?;
    let sheet = StyleSheet::parse(
        css,
        ParserOptions {
            error_recovery: false,
            ..Default::default()
        },
    )
    .map_err(|e| format!("Invalid author CSS: {e}"))?;
    let mut rules = vec![];
    styles(&sheet.rules, false, &mut rules)?;
    if rules.is_empty() {
        return Err("Author CSS must contain rules".into());
    }
    let mut preludes = vec![];
    original_selectors(&mut Parser::new(&mut ParserInput::new(css)), &mut preludes)
        .map_err(|_| "Invalid author rule structure")?;
    if preludes.len() != rules.len() {
        return Err("Author selector structure changed during parsing".into());
    }
    for (prelude, rule) in preludes.iter().zip(&rules) {
        let canonical = rule
            .selectors
            .to_css_string(PrinterOptions::default())
            .map_err(|e| e.to_string())?;
        if selector_fingerprint(prelude)? != selector_fingerprint(&canonical)? {
            return Err("Selector normalization discarded or changed unsupported syntax".into());
        }
    }
    let mut definitions = HashSet::new();
    for rule in &rules {
        if !rule.selectors.0.iter().all(|s| selector_supported(s, 0)) {
            return Err("Unsupported or opaque author selector".into());
        }
        for property in &rule.declarations.declarations {
            if let Property::Custom(c) = property {
                let name = c.name.as_ref();
                if !name.starts_with("--")
                    && !["content", "color-scheme", "outline-offset"].contains(&name)
                {
                    return Err(format!("Unsupported property: {name}"));
                }
                if name.starts_with("--") {
                    definitions.insert(name.to_owned());
                }
            }
        }
    }
    let mut output = String::from("@layer theme.author {\n");
    let mut count = 0;
    for rule in rules {
        if !rule.declarations.important_declarations.is_empty() {
            return Err("!important is not supported".into());
        }
        for property in &rule.declarations.declarations {
            // Unknown properties are represented as Custom and rejected above.
            // No resource-bearing function can pass this token walk, including in
            // typed image values, variable fallbacks, escaped names or custom props.
            if let Property::Unparsed(p) = property {
                if !has_variable(&p.value) {
                    return Err("Unparsed property requires an inspectable var() reference".into());
                }
            }
            let value = property
                .value_to_css_string(PrinterOptions::default())
                .map_err(|e| e.to_string())?;
            tokens(
                &mut Parser::new(&mut ParserInput::new(&value)),
                0,
                &mut count,
                Some(&definitions),
            )
            .map_err(|_| "Unsupported author value/function/resource reference")?;
            let property_id = property.property_id();
            let name = property_id.name();
            if let Property::Custom(c) = property {
                if !name.starts_with("--") {
                    let mut input = ParserInput::new(&value);
                    let mut p = Parser::new(&mut input);
                    let valid = match name {
                        "content" => {
                            let mut valid = true;
                            let mut count = 0;
                            while let Ok(t) = p.next() {
                                count += 1;
                                valid &= matches!(t, Token::QuotedString(_))
                                    || matches!(t, Token::Ident(s) if ["none", "normal", "initial", "inherit", "unset", "revert"].contains(&s.as_ref()));
                            }
                            valid && count > 0
                        }
                        "color-scheme" => {
                            let mut valid = true;
                            let mut count = 0;
                            while let Ok(t) = p.next() {
                                count += 1;
                                valid &= matches!(t, Token::Ident(s) if ["light", "dark", "normal", "only"].contains(&s.as_ref()));
                            }
                            valid && count > 0
                        }
                        "outline-offset" => {
                            has_variable(&c.value)
                                || lightningcss::values::length::Length::parse_string(&value)
                                    .is_ok()
                        }
                        _ => false,
                    };
                    if !valid {
                        return Err(format!("Unsupported {name} value"));
                    }
                }
            }
            if ["font", "font-family", "--vesta-font-sans"].contains(&name)
                && !system_font_list(&value)
            {
                return Err("Only explicit supported system font families are allowed; font shorthand and font variables are unsupported".into());
            }
            // Resource contexts may turn bare strings into URLs (e.g. src,
            // image-set). They are unsupported even when this browser ignores them.
            if ["src", "behavior", "-moz-binding"].contains(&name) {
                return Err("Resource property is unsupported".into());
            }
        }
        output.push_str(
            &rule
                .to_css_string(PrinterOptions::default())
                .map_err(|e| e.to_string())?,
        );
        output.push('\n');
    }
    output.push('}');
    if output.len() > MAX_CSS * 2 {
        return Err("Canonical CSS exceeds limit".into());
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn classic_and_public_states_are_inspectable() {
        let css = "@layer theme { :root { --classic: inset 1px 1px #fff; --vesta-color-canvas: #ddd; } [data-vesta=button]:has(:focus-visible),[data-checked] { box-shadow:var(--classic); background:linear-gradient(to right,#000,#fff); content:''; } }";
        let result = canonicalize(css).unwrap();
        assert!(result.starts_with("@layer theme.author"));
        assert!(!result.contains("@layer theme {"));
    }
    #[test]
    fn resource_and_opaque_syntax_fail_closed() {
        for css in [
            "@import 'https://bad';",
            "@\\69mport 'bad';",
            "@font-face {src:url(bad)}",
            "@media all {a{color:red}}",
            "a{& b{color:red}}",
            "@layer other{a{color:red}}",
            "@layer theme,other;",
            "a{color:red!important}",
            "a{--x:u\\72l(bad)}",
            "a{background:image-set('bad' 1x)}",
            "a{background:im\\61ge-set('bad' 1x)}",
            "a{--x:unknown(1)}",
            "a{--x:var(--vesta-grain-image)}",
            ".never{--vesta-theme-grain-image:none}a{background:var(--vesta-theme-grain-image)}",
            "a{--x:color(--remote 0 0 0)}",
            "a{unknown:1}",
            "a:unknown(1){color:red}",
            "a:-vendor-unknown(1){color:red}",
            "a::unknown{color:red}",
            "a:where(:unknown(1)){color:red}",
            "a:is(.valid, ..invalid){color:red}",
            "a:where(.valid, ..invalid){color:red}",
            "a{width:banana}",
            "a{color-scheme:banana}",
            "a{outline-offset:banana}",
            "a{content:banana}",
            "a{color:red",
            "a{--x:red\\}",
            "a{--x:calc(1)",
            "a{font-family:SomeRemoteFace}",
            "a{color:rgb(}",
        ] {
            assert!(canonicalize(css).is_err(), "accepted {css}");
        }
    }
    #[test]
    fn real_classic_fixture() {
        canonicalize(include_str!(
            "../../../../apps/desktop-solid/src/styles/themes/windows-2000.css"
        ))
        .unwrap();
    }
    #[test]
    fn budgets() {
        assert!(canonicalize(&" ".repeat(MAX_CSS + 1)).is_err());
        assert!(canonicalize(&format!(
            "a{{--x:{}1{}}}",
            "calc(".repeat(40),
            ")".repeat(40)
        ))
        .is_err());
        assert!(canonicalize(&"a{color:red}".repeat(1025)).is_err());
    }
}
