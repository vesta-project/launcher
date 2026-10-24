//! Explicit presentation mappings preserve lifecycle map keys such as `crash_loop`.
use super::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const STATES: [&str; 9] = [
    "online",
    "offline",
    "sleeping",
    "waking",
    "starting",
    "stopping",
    "maintenance",
    "crash_loop",
    "recovery_required",
];
macro_rules! dto {
    ($name:ident { $($field:ident: $ty:ty),* $(,)? }) => {
        #[derive(Clone, Debug, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase")]
        pub struct $name { $(pub $field: $ty),* }
    };
}
dto!(SleepPolicy {
    enabled: bool,
    offline_status: bool,
    wake_on_join: bool,
    idle_seconds: u32,
    warning_seconds: u32,
    start_cooldown_seconds: u32
});
dto!(SleepPolicyView {
    policy: SleepPolicy,
    revision: i64,
    sleep_blocker: Option<SleepBlocker>
});
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "reason", rename_all = "snake_case")]
pub enum SleepBlocker {
    Disabled,
    NotReady,
    PlayersOnline,
    PlayerCountUnknown,
    OperationInProgress,
    Hold,
    AuthorityUnavailable,
    CountingDown {
        #[serde(rename = "remainingSeconds")]
        remaining_seconds: u32,
    },
    WarningSent {
        #[serde(rename = "remainingSeconds")]
        remaining_seconds: u32,
    },
}
dto!(StatePresentation { template: String, version_name: Option<String>, maximum_players: Option<u16>, icon_png: Option<String> });
dto!(MotdDocument { states: BTreeMap<String, StatePresentation>, normal_icon_png: Option<String>, login_message: String });
dto!(MotdPolicyView { document: MotdDocument, revision: Option<String> });
dto!(MotdSegment { text: String, color: Option<String>, bold: bool, italic: bool, underlined: bool, strikethrough: bool, obfuscated: bool, line: u8 });
dto!(MotdPreview { lines: [String; 2], segments: Vec<MotdSegment>, icon_png: Option<String>, placeholders: Vec<String> });

fn invalid() -> Error {
    Error::new(ErrorCode::InvalidInput)
}
fn unsupported() -> Error {
    Error::new(ErrorCode::Unsupported)
}
impl SleepPolicy {
    pub fn wire(&self) -> Result<Value> {
        if !(60..=86400).contains(&self.idle_seconds)
            || !(5..=300).contains(&self.warning_seconds)
            || !(10..=3600).contains(&self.start_cooldown_seconds)
        {
            return Err(invalid());
        }
        Ok(
            json!({"enabled":self.enabled,"offline_status":self.offline_status,"wake_on_join":self.wake_on_join,"idle_seconds":self.idle_seconds,"warning_seconds":self.warning_seconds,"start_cooldown_seconds":self.start_cooldown_seconds}),
        )
    }
}
impl MotdDocument {
    pub fn wire(&self) -> Result<Value> {
        if self.states.len() != STATES.len() || !STATES.iter().all(|s| self.states.contains_key(*s))
        {
            return Err(invalid());
        }
        let states: serde_json::Map<String, Value> = self.states.iter().map(|(state,p)| (state.clone(),json!({"template":p.template,"version_name":p.version_name.as_deref().unwrap_or("Vesta"),"maximum_players":p.maximum_players.unwrap_or(0),"icon_png":p.icon_png}))).collect();
        Ok(
            json!({"states":states,"normal_icon_png":self.normal_icon_png,"login_message":self.login_message}),
        )
    }
    pub fn from_agent(value: Value) -> Result<Self> {
        let states = value["states"]
            .as_object()
            .ok_or_else(unsupported)?
            .iter()
            .map(|(key, p)| Ok((key.clone(), from_wire(p.clone())?)))
            .collect::<Result<BTreeMap<_, _>>>()?;
        if states.len() != STATES.len() || !STATES.iter().all(|s| states.contains_key(*s)) {
            return Err(unsupported());
        }
        Ok(Self {
            states,
            normal_icon_png: serde_json::from_value(value["normal_icon_png"].clone())
                .map_err(|_| unsupported())?,
            login_message: value["login_message"]
                .as_str()
                .ok_or_else(unsupported)?
                .into(),
        })
    }
}
fn revision(value: &Value) -> Result<Option<String>> {
    if value.is_null() {
        return Ok(None);
    }
    value
        .as_i64()
        .filter(|n| *n > 0)
        .map(|n| Some(n.to_string()))
        .ok_or_else(unsupported)
}
fn expected_revision(value: Option<&str>) -> Result<Option<i64>> {
    value
        .map(|s| {
            s.parse::<i64>()
                .ok()
                .filter(|n| *n > 0 && n.to_string() == s)
                .ok_or_else(invalid)
        })
        .transpose()
}
fn color(name: &str) -> Result<String> {
    let (names, hex) = (
        [
            "black",
            "dark_blue",
            "dark_green",
            "dark_aqua",
            "dark_red",
            "dark_purple",
            "gold",
            "gray",
            "dark_gray",
            "blue",
            "green",
            "aqua",
            "red",
            "light_purple",
            "yellow",
            "white",
        ],
        [
            "#000000", "#0000AA", "#00AA00", "#00AAAA", "#AA0000", "#AA00AA", "#FFAA00", "#AAAAAA",
            "#555555", "#5555FF", "#55FF55", "#55FFFF", "#FF5555", "#FF55FF", "#FFFF55", "#FFFFFF",
        ],
    );
    names
        .iter()
        .position(|n| *n == name)
        .map(|i| hex[i].into())
        .ok_or_else(unsupported)
}
impl MotdPreview {
    pub fn from_agent(value: Value) -> Result<Self> {
        let preview = &value["preview"];
        let plain: Vec<String> =
            serde_json::from_value(preview["plain_lines"].clone()).map_err(|_| unsupported())?;
        if plain.is_empty() || plain.len() > 2 {
            return Err(unsupported());
        }
        let mut lines = [String::new(), String::new()];
        for (i, text) in plain.into_iter().enumerate() {
            lines[i] = text;
        }
        // The agent emits {text:"",extra:[{text,color?,style?...}]}, never raw template text.
        let description = &preview["description"];
        if description["text"] != "" {
            return Err(unsupported());
        }
        let spans = description["extra"].as_array().ok_or_else(unsupported)?;
        if spans.len() > 512 {
            return Err(unsupported());
        }
        let mut segments = Vec::new();
        let mut line = 0;
        for span in spans {
            let text = span["text"].as_str().ok_or_else(unsupported)?;
            let color = span
                .get("color")
                .map(|v| color(v.as_str().ok_or_else(unsupported)?))
                .transpose()?;
            let style = |key: &str| -> Result<bool> {
                span.get(key)
                    .map(|v| v.as_bool().ok_or_else(unsupported))
                    .unwrap_or(Ok(false))
            };
            for (i, text) in text.split('\n').enumerate() {
                if i > 0 {
                    line += 1;
                }
                if line > 1 {
                    return Err(unsupported());
                }
                if !text.is_empty() {
                    segments.push(MotdSegment {
                        text: text.into(),
                        color: color.clone(),
                        bold: style("bold")?,
                        italic: style("italic")?,
                        underlined: style("underlined")?,
                        strikethrough: style("strikethrough")?,
                        obfuscated: style("obfuscated")?,
                        line,
                    });
                }
            }
        }
        for (i, plain) in lines.iter().enumerate() {
            let rendered: String = segments
                .iter()
                .filter(|s| s.line as usize == i)
                .map(|s| s.text.as_str())
                .collect();
            if &rendered != plain {
                return Err(unsupported());
            }
        }
        let icon = preview["favicon_data_uri"]
            .as_str()
            .ok_or_else(unsupported)?
            .strip_prefix("data:image/png;base64,")
            .ok_or_else(unsupported)?;
        Ok(Self {
            lines,
            segments,
            icon_png: Some(icon.into()),
            placeholders: serde_json::from_value(value["placeholders"].clone())
                .map_err(|_| unsupported())?,
        })
    }
}
impl Client {
    pub async fn sleep_policy(&self) -> Result<SleepPolicyView> {
        from_wire(self.get("sleep/policy", true, "config.view").await?)
    }
    pub async fn sleep_policy_update(
        &self,
        policy: SleepPolicy,
        expected: i64,
        intent: &str,
    ) -> Result<SleepPolicyView> {
        if expected < 0 {
            return Err(invalid());
        }
        from_wire(
            self.management_mutate(
                Method::PUT,
                "sleep/policy",
                Some(json!({"policy":policy.wire()?,"expected_revision":expected})),
                intent,
                "config.edit",
            )
            .await?,
        )
    }
    pub async fn motd_policy(&self) -> Result<MotdPolicyView> {
        let value = self.get("motd/policy", true, "config.view").await?;
        Ok(MotdPolicyView {
            document: MotdDocument::from_agent(value["document"].clone())?,
            revision: revision(&value["revision"])?,
        })
    }
    pub async fn motd_policy_update(
        &self,
        document: MotdDocument,
        expected: Option<&str>,
        intent: &str,
    ) -> Result<MotdPolicyView> {
        let wire = document.wire()?;
        let value = self
            .management_mutate(
                Method::PUT,
                "motd/policy",
                Some(json!({"document":wire,"expected_revision":expected_revision(expected)?})),
                intent,
                "config.edit",
            )
            .await?;
        let revision = revision(&value["revision"])
            .and_then(|v| v.ok_or_else(unsupported))
            .map_err(|_| Error::new(ErrorCode::OutcomeUnknown))?;
        // PUT returns a revision receipt only. Return the accepted document with concrete agent defaults.
        Ok(MotdPolicyView {
            document: MotdDocument::from_agent(wire)?,
            revision: Some(revision),
        })
    }
    pub async fn motd_preview(&self, state: &str, document: MotdDocument) -> Result<MotdPreview> {
        if !STATES.contains(&state) {
            return Err(invalid());
        }
        let value = self
            .request(
                Method::POST,
                "/api/v3/manage/motd/preview",
                Some(json!({"state":state,"document":document.wire()?})),
                None,
                true,
                "config.view",
            )
            .await?;
        MotdPreview::from_agent(value)
    }
}
