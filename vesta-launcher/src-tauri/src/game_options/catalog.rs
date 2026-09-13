//! Metadata for the Java Edition `options.txt` settings we can safely share.
//!
//! The catalog describes file keys and editor constraints. It does not provide
//! defaults: an absent key stays absent until the game creates it. Unknown
//! non-keybind keys are still valid sync candidates, which lets modded
//! installations keep useful settings without pretending that Vesta knows
//! their type.

/// The small type used by the original local editor. Keep it while callers
/// migrate to [`SettingEditor`]; sync code should use the richer metadata.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ValueKind {
    Boolean,
    Number { min: f64, max: f64 },
    Text,
}

/// The control shown for a catalogued setting.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SettingEditor {
    Boolean,
    UnboundedInteger,
    Integer { min: i64, max: i64, step: i64 },
    UnboundedDecimal,
    Decimal {
        min: f64,
        max: f64,
        step: f64,
        unit: Option<&'static str>,
    },
    Enum(&'static [&'static str]),
    Language,
}

/// How the editor value is represented in `options.txt`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ValueEncoding {
    Bool,
    Integer,
    Decimal,
    Enum(&'static [&'static str]),
    QuotedEnum(&'static [&'static str]),
    Text,
    /// FOV is stored as a normalized value in options.txt while the game UI
    /// presents degrees: `degrees = 70 + 40 * raw`.
    Fov,
    /// GUI scale uses 0 for Auto and positive integer values. The upper bound
    /// depends on the window, so validation intentionally has no fixed cap.
    GuiScale,
    /// These codecs accept the documented historical spellings without
    /// converting an observed value while seeding.
    Graphics,
    AmbientOcclusion,
    Clouds,
}

/// A stable setting identity plus the physical key names used by different
/// Minecraft releases. `keys[0]` is the preferred key when a file has more
/// than one alias; writers should only patch an alias that is present.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SupportedSetting {
    pub id: &'static str,
    pub keys: &'static [&'static str],
    pub since: Option<&'static str>,
    pub until: Option<&'static str>,
    pub category: &'static str,
    pub editor: SettingEditor,
    pub encoding: ValueEncoding,

    // Compatibility fields for the pre-catalog command response. They can be
    // removed after the command returns the rich editor metadata directly.
    pub key: &'static str,
    pub label_id: &'static str,
    pub kind: ValueKind,
    pub default: Option<&'static str>,
    pub version_hint: Option<&'static str>,
}

/// Legacy name retained for downstream callers during the command migration.
pub type OptionDefinition = SupportedSetting;

const fn legacy_kind(editor: SettingEditor) -> ValueKind {
    match editor {
        SettingEditor::Boolean => ValueKind::Boolean,
        SettingEditor::Integer { min, max, .. } => ValueKind::Number {
            min: min as f64,
            max: max as f64,
        },
        SettingEditor::UnboundedInteger => ValueKind::Number {
            min: f64::MIN,
            max: f64::MAX,
        },
        SettingEditor::Decimal { min, max, .. } => ValueKind::Number { min, max },
        SettingEditor::UnboundedDecimal => ValueKind::Number {
            min: f64::MIN,
            max: f64::MAX,
        },
        SettingEditor::Enum(_) | SettingEditor::Language => ValueKind::Text,
    }
}

const fn setting(
    id: &'static str,
    keys: &'static [&'static str],
    since: Option<&'static str>,
    until: Option<&'static str>,
    category: &'static str,
    editor: SettingEditor,
    encoding: ValueEncoding,
) -> SupportedSetting {
    SupportedSetting {
        id,
        keys,
        since,
        until,
        category,
        editor,
        encoding,
        key: keys[0],
        label_id: id,
        kind: legacy_kind(editor),
        default: None,
        version_hint: None,
    }
}

macro_rules! boolean {
    ($id:literal, [$($key:literal),+ $(,)?], $since:expr, $until:expr, $category:literal) => {
        setting(
            $id,
            &[$($key),+],
            $since,
            $until,
            $category,
            SettingEditor::Boolean,
            ValueEncoding::Bool,
        )
    };
}

macro_rules! integer {
    ($id:literal, [$($key:literal),+ $(,)?], $since:expr, $until:expr, $category:literal, $min:expr, $max:expr, $step:expr) => {
        setting(
            $id,
            &[$($key),+],
            $since,
            $until,
            $category,
            SettingEditor::Integer { min: $min, max: $max, step: $step },
            ValueEncoding::Integer,
        )
    };
}

macro_rules! decimal {
    ($id:literal, [$($key:literal),+ $(,)?], $since:expr, $until:expr, $category:literal, $min:expr, $max:expr, $step:expr, $unit:expr) => {
        setting(
            $id,
            &[$($key),+],
            $since,
            $until,
            $category,
            SettingEditor::Decimal { min: $min, max: $max, step: $step, unit: $unit },
            ValueEncoding::Decimal,
        )
    };
}

macro_rules! enumeration {
    ($id:literal, [$($key:literal),+ $(,)?], $since:expr, $until:expr, $category:literal, $values:expr, $encoding:expr) => {
        setting(
            $id,
            &[$($key),+],
            $since,
            $until,
            $category,
            SettingEditor::Enum($values),
            $encoding,
        )
    };
}

macro_rules! unbounded_integer {
    ($id:literal, [$($key:literal),+ $(,)?], $since:expr, $until:expr, $category:literal) => {
        setting(
            $id,
            &[$($key),+],
            $since,
            $until,
            $category,
            SettingEditor::UnboundedInteger,
            ValueEncoding::Integer,
        )
    };
}

const GRAPHICS: &[&str] = &["fast", "fancy", "fabulous", "custom"];
const GRAPHICS_BACKEND: &[&str] = &["default", "opengl", "vulkan"];
const PARTICLES: &[&str] = &["0", "1", "2"];
const CLOUDS: &[&str] = &["false", "fast", "true"];
const AMBIENT_OCCLUSION: &[&str] = &["false", "true", "0", "1", "2", "3"];
const ATTACK_INDICATOR: &[&str] = &["0", "1", "2"];
const CHAT_VISIBILITY: &[&str] = &["0", "1", "2"];
const NARRATOR: &[&str] = &["0", "1", "2", "3"];
const DIFFICULTY: &[&str] = &["0", "1", "2", "3"];
const MAIN_HAND: &[&str] = &["left", "right"];
const SHARE_PRESENCE: &[&str] = &["all", "limited", "none"];
const MUSIC_TOAST: &[&str] = &["never", "pause", "pause_and_toast"];
const MUSIC_FREQUENCY: &[&str] = &["DEFAULT", "FREQUENT", "CONSTANT"];
const INACTIVITY_FPS_LIMIT: &[&str] = &["afk", "minimized"];
const PRIORITIZE_CHUNK_UPDATES: &[&str] = &["0", "1", "2"];
const TEXTURE_FILTERING: &[&str] = &["0", "1", "2"];

/// The settings Vesta must never copy between instances. These values describe
/// machine state, session state, pack ownership, or startup bookkeeping.
pub const NEVER_SYNC_KEYS: &[&str] = &[
    "version",
    "resourcePacks",
    "incompatibleResourcePacks",
    "lastServer",
    "startedCleanly",
    "tutorialStep",
    "joinedFirstServer",
    "onboardAccessibility",
    "soundDevice",
    "fullscreenResolution",
    "overrideWidth",
    "overrideHeight",
    "fboEnable",
    "saturation",
    "streamBytesPerPixel",
    "streamMicVolume",
    "streamGameVolume",
    "streamKbps",
    "streamFps",
    "streamCompression",
    "streamSendMetadata",
    "streamPreferredServer",
    "streamChatEnabled",
    "streamChatUserFilter",
    "streamMicToggleBehavior",
    "streamSystemVolume",
    "skin",
    "showInventoryAchievementHint",
    "enableWeakAttacks",
    "skipRealms32bitWarning",
    "showFrameRate",
    "limitFramerate",
    "chunksPerFrame",
    "uploadsPerFrame",
    "onlyShowSignedChat",
    "skipFriendsListPromo",
    "postProcessEnable",
    // These are old sound controls whose ownership is unclear and whose names
    // do not match the stable sound-category keys above.
    "soundCategory_animals",
    "soundCategory_mobs",
    "soundCategory_records",
    "shieldAnimation",
];

/// Supported vanilla settings. Values and release bounds are grounded in the
/// options.txt reference and the documented catalog shape; no defaults are
/// synthesized from this table.
pub const CATALOG: &[SupportedSetting] = &[
    // Video.
    setting(
        "fov",
        &["fov"],
        None,
        None,
        "video",
        SettingEditor::Integer {
            min: 30,
            max: 110,
            step: 1,
        },
        ValueEncoding::Fov,
    ),
    enumeration!(
        "graphics",
        ["graphicsPreset", "graphicsMode", "fancyGraphics"],
        Some("1.0"),
        None,
        "video",
        GRAPHICS,
        ValueEncoding::Graphics
    ),
    enumeration!(
        "ambient_occlusion",
        ["ao"],
        Some("1.0"),
        None,
        "video",
        AMBIENT_OCCLUSION,
        ValueEncoding::AmbientOcclusion
    ),
    decimal!(
        "brightness",
        ["gamma"],
        None,
        None,
        "video",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    integer!(
        "render_distance",
        ["renderDistance"],
        Some("1.7.2"),
        None,
        "video",
        2,
        64,
        1
    ),
    integer!(
        "simulation_distance",
        ["simulationDistance"],
        Some("1.18"),
        None,
        "video",
        2,
        64,
        1
    ),
    decimal!(
        "entity_distance",
        ["entityDistanceScaling"],
        Some("1.16"),
        None,
        "video",
        0.5,
        5.0,
        0.25,
        Some("multiplier")
    ),
    setting(
        "gui_scale",
        &["guiScale"],
        None,
        None,
        "video",
        SettingEditor::UnboundedInteger,
        ValueEncoding::GuiScale,
    ),
    unbounded_integer!(
        "debug_gui_scale",
        ["debugGuiScale"],
        Some("26.3"),
        None,
        "video"
    ),
    enumeration!(
        "graphics_backend",
        ["preferredGraphicsBackend"],
        Some("26.2"),
        None,
        "video",
        GRAPHICS_BACKEND,
        ValueEncoding::QuotedEnum(GRAPHICS_BACKEND)
    ),
    enumeration!(
        "particles",
        ["particles"],
        None,
        None,
        "video",
        PARTICLES,
        ValueEncoding::Enum(PARTICLES)
    ),
    enumeration!(
        "clouds",
        ["renderClouds", "clouds"],
        Some("1.8"),
        None,
        "video",
        CLOUDS,
        ValueEncoding::Clouds
    ),
    integer!(
        "cloud_range",
        ["cloudRange"],
        Some("1.21.6"),
        None,
        "video",
        2,
        128,
        1
    ),
    boolean!(
        "entity_shadows",
        ["entityShadows"],
        Some("1.8.1"),
        None,
        "video"
    ),
    boolean!("view_bobbing", ["bobView"], None, None, "video"),
    boolean!(
        "vsync",
        ["enableVsync"],
        Some("1.3.1"),
        None,
        "video"
    ),
    boolean!(
        "fullscreen",
        ["fullscreen"],
        Some("1.3.1"),
        None,
        "video"
    ),
    boolean!(
        "exclusive_fullscreen",
        ["exclusiveFullscreen"],
        Some("26.1"),
        None,
        "video"
    ),
    boolean!(
        "mac_fullscreen_menu",
        ["macFullscreenMenuVisibility"],
        Some("26.3"),
        None,
        "video"
    ),
    integer!(
        "max_framerate",
        ["maxFps"],
        Some("1.7.2"),
        None,
        "video",
        10,
        260,
        10
    ),
    enumeration!(
        "inactivity_framerate_limit",
        ["inactivityFpsLimit"],
        Some("1.21.2"),
        None,
        "video",
        INACTIVITY_FPS_LIMIT,
        ValueEncoding::QuotedEnum(INACTIVITY_FPS_LIMIT)
    ),
    integer!(
        "mipmap_levels",
        ["mipmapLevels"],
        Some("1.7.2"),
        None,
        "video",
        0,
        4,
        1
    ),
    integer!(
        "biome_blend_radius",
        ["biomeBlendRadius"],
        Some("1.13"),
        None,
        "video",
        0,
        7,
        1
    ),
    enumeration!(
        "prioritize_chunk_updates",
        ["prioritizeChunkUpdates"],
        Some("1.18"),
        None,
        "video",
        PRIORITIZE_CHUNK_UPDATES,
        ValueEncoding::Enum(PRIORITIZE_CHUNK_UPDATES)
    ),
    enumeration!(
        "attack_indicator",
        ["attackIndicator"],
        Some("1.9"),
        None,
        "video",
        ATTACK_INDICATOR,
        ValueEncoding::Enum(ATTACK_INDICATOR)
    ),
    boolean!(
        "reduced_debug_info",
        ["reducedDebugInfo"],
        Some("1.8"),
        None,
        "video"
    ),
    decimal!(
        "chunk_fade_time",
        ["chunkSectionFadeInTime"],
        Some("1.21.11"),
        None,
        "video",
        0.0,
        2.0,
        0.01,
        Some("seconds")
    ),
    boolean!(
        "cutout_leaves",
        ["cutoutLeaves"],
        Some("1.21.11"),
        None,
        "video"
    ),
    boolean!(
        "improved_transparency",
        ["improvedTransparency"],
        Some("1.21.11"),
        None,
        "video"
    ),
    enumeration!(
        "texture_filtering",
        ["textureFiltering"],
        Some("1.21.11"),
        None,
        "video",
        TEXTURE_FILTERING,
        ValueEncoding::Enum(TEXTURE_FILTERING)
    ),
    integer!(
        "anisotropy",
        ["maxAnisotropyBit"],
        Some("1.21.11"),
        None,
        "video",
        1,
        3,
        1
    ),
    boolean!("vignette", ["vignette"], Some("1.21.11"), None, "video"),
    integer!(
        "weather_radius",
        ["weatherRadius"],
        Some("1.21.11"),
        None,
        "video",
        3,
        10,
        1
    ),
    boolean!(
        "advanced_opengl",
        ["advancedOpengl"],
        Some("1.0"),
        Some("1.7.10"),
        "video"
    ),
    boolean!(
        "anaglyph_3d",
        ["anaglyph3d"],
        Some("1.0"),
        Some("1.12.2"),
        "video"
    ),
    unbounded_integer!(
        "anisotropic_filtering",
        ["anisotropicFiltering"],
        Some("1.7.2"),
        Some("1.7.10"),
        "video"
    ),
    boolean!(
        "alternate_blocks",
        ["allowBlockAlternatives"],
        Some("1.8"),
        Some("1.8.9"),
        "video"
    ),
    boolean!(
        "held_item_tooltips",
        ["heldItemTooltips"],
        Some("1.4.6"),
        Some("1.19.3"),
        "video"
    ),
    boolean!(
        "use_vbo",
        ["useVbo"],
        Some("1.8"),
        Some("1.13.2"),
        "video"
    ),

    // Sound.
    boolean!(
        "directional_audio",
        ["directionalAudio"],
        Some("1.19"),
        None,
        "sound"
    ),
    enumeration!(
        "music_toast",
        ["musicToast"],
        Some("1.21.11"),
        None,
        "sound",
        MUSIC_TOAST,
        ValueEncoding::QuotedEnum(MUSIC_TOAST)
    ),
    enumeration!(
        "music_frequency",
        ["musicFrequency"],
        Some("1.21.6"),
        None,
        "sound",
        MUSIC_FREQUENCY,
        ValueEncoding::QuotedEnum(MUSIC_FREQUENCY)
    ),
    decimal!(
        "master_volume",
        ["soundCategory_master", "sound"],
        Some("1.0"),
        None,
        "sound",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "music_volume",
        ["soundCategory_music", "music"],
        Some("1.0"),
        None,
        "sound",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "record_volume",
        ["soundCategory_record"],
        Some("1.7.2"),
        None,
        "sound",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "weather_volume",
        ["soundCategory_weather"],
        Some("1.7.2"),
        None,
        "sound",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "blocks_volume",
        ["soundCategory_block"],
        Some("1.7.2"),
        None,
        "sound",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "hostile_volume",
        ["soundCategory_hostile"],
        Some("1.7.2"),
        None,
        "sound",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "neutral_volume",
        ["soundCategory_neutral"],
        Some("1.7.2"),
        None,
        "sound",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "players_volume",
        ["soundCategory_player"],
        Some("1.7.2"),
        None,
        "sound",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "ambient_volume",
        ["soundCategory_ambient"],
        Some("1.7.2"),
        None,
        "sound",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "voice_volume",
        ["soundCategory_voice"],
        Some("1.9"),
        None,
        "sound",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "ui_volume",
        ["soundCategory_ui"],
        Some("1.21.6"),
        None,
        "sound",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),

    // Controls.
    decimal!(
        "sensitivity",
        ["mouseSensitivity"],
        None,
        None,
        "controls",
        0.0,
        1.0,
        0.005,
        Some("percent")
    ),
    boolean!("invert_mouse", ["invertYMouse"], None, None, "controls"),
    boolean!(
        "invert_horizontal_mouse",
        ["invertXMouse"],
        Some("1.21.9"),
        None,
        "controls"
    ),
    boolean!(
        "auto_jump",
        ["autoJump"],
        Some("1.10"),
        None,
        "controls"
    ),
    boolean!(
        "toggle_crouch",
        ["toggleCrouch"],
        Some("1.15"),
        None,
        "controls"
    ),
    boolean!(
        "toggle_sprint",
        ["toggleSprint"],
        Some("1.15"),
        None,
        "controls"
    ),
    boolean!(
        "toggle_attack",
        ["toggleAttack"],
        Some("1.21.9"),
        None,
        "controls"
    ),
    boolean!(
        "toggle_use",
        ["toggleUse"],
        Some("1.21.9"),
        None,
        "controls"
    ),
    boolean!(
        "discrete_mouse_scroll",
        ["discrete_mouse_scroll"],
        Some("1.14"),
        None,
        "controls"
    ),
    decimal!(
        "mouse_wheel_sensitivity",
        ["mouseWheelSensitivity"],
        Some("1.13"),
        None,
        "controls",
        1.0,
        10.0,
        0.01,
        None
    ),
    boolean!(
        "raw_mouse_input",
        ["rawMouseInput"],
        Some("1.14.4"),
        Some("26.2"),
        "controls"
    ),
    boolean!(
        "touchscreen",
        ["touchscreen"],
        Some("1.4.4"),
        Some("26.1.2"),
        "controls"
    ),
    boolean!(
        "allow_cursor_changes",
        ["allowCursorChanges"],
        Some("1.21.9"),
        None,
        "controls"
    ),
    integer!(
        "sprint_window",
        ["sprintWindow"],
        Some("1.21.9"),
        None,
        "controls",
        0,
        10,
        1
    ),
    boolean!(
        "operator_items_tab",
        ["operatorItemsTab"],
        Some("1.19.3"),
        None,
        "controls"
    ),
    boolean!(
        "ctrl_click_emulates_right_click",
        ["ctrlClickEmulatesRightClick"],
        Some("26.3"),
        None,
        "controls"
    ),
    boolean!(
        "quit_shortcuts",
        ["quitShortcuts"],
        Some("26.3"),
        None,
        "controls"
    ),
    boolean!(
        "advanced_item_tooltips",
        ["advancedItemTooltips"],
        Some("1.4.2"),
        None,
        "controls"
    ),
    boolean!(
        "pause_on_lost_focus",
        ["pauseOnLostFocus"],
        Some("1.4.2"),
        None,
        "controls"
    ),
    boolean!(
        "use_native_transport",
        ["useNativeTransport"],
        Some("1.8.1"),
        None,
        "controls"
    ),

    // Chat.
    enumeration!(
        "chat_visibility",
        ["chatVisibility"],
        Some("1.3.1"),
        None,
        "chat",
        CHAT_VISIBILITY,
        ValueEncoding::Enum(CHAT_VISIBILITY)
    ),
    boolean!("chat_colors", ["chatColors"], Some("1.3.1"), None, "chat"),
    boolean!("chat_links", ["chatLinks"], Some("1.3.1"), None, "chat"),
    boolean!(
        "chat_links_prompt",
        ["chatLinksPrompt"],
        Some("1.3.1"),
        None,
        "chat"
    ),
    decimal!(
        "chat_opacity",
        ["chatOpacity"],
        Some("1.3.1"),
        None,
        "chat",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "chat_scale",
        ["chatScale"],
        Some("1.5.1"),
        None,
        "chat",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "chat_width",
        ["chatWidth"],
        Some("1.5.1"),
        None,
        "chat",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "focused_chat_height",
        ["chatHeightFocused"],
        Some("1.5.1"),
        None,
        "chat",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "unfocused_chat_height",
        ["chatHeightUnfocused"],
        Some("1.5.1"),
        None,
        "chat",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "chat_line_spacing",
        ["chatLineSpacing"],
        Some("1.16"),
        None,
        "chat",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "chat_delay",
        ["chatDelay"],
        Some("1.16"),
        None,
        "chat",
        0.0,
        6.0,
        0.01,
        Some("seconds")
    ),
    decimal!(
        "text_background_opacity",
        ["textBackgroundOpacity"],
        Some("1.14"),
        None,
        "chat",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    boolean!(
        "chat_background_only",
        ["backgroundForChatOnly"],
        Some("1.14"),
        None,
        "chat"
    ),
    boolean!(
        "auto_suggestions",
        ["autoSuggestions"],
        Some("1.13"),
        None,
        "chat"
    ),
    boolean!(
        "secure_chat_only",
        ["onlyShowSecureChat"],
        Some("1.19"),
        None,
        "chat"
    ),
    boolean!(
        "save_chat_drafts",
        ["saveChatDrafts"],
        Some("1.21.9"),
        None,
        "chat"
    ),
    boolean!(
        "hide_matched_names",
        ["hideMatchedNames"],
        Some("1.16.4"),
        None,
        "chat"
    ),
    integer!(
        "notification_time",
        ["notificationDisplayTime"],
        Some("1.19.4"),
        None,
        "chat",
        0,
        10,
        1
    ),
    boolean!(
        "skip_multiplayer_warning",
        ["skipMultiplayerWarning"],
        Some("1.15.2"),
        None,
        "chat"
    ),

    // Accessibility.
    enumeration!(
        "narrator",
        ["narrator"],
        Some("1.12"),
        None,
        "accessibility",
        NARRATOR,
        ValueEncoding::Enum(NARRATOR)
    ),
    boolean!(
        "subtitles",
        ["showSubtitles"],
        Some("1.9"),
        None,
        "accessibility"
    ),
    boolean!(
        "high_contrast",
        ["highContrast"],
        Some("1.19.4"),
        None,
        "accessibility"
    ),
    boolean!(
        "dark_splash",
        ["darkMojangStudiosBackground"],
        Some("1.17"),
        None,
        "accessibility"
    ),
    decimal!(
        "fov_effects",
        ["fovEffectScale"],
        Some("1.16.2"),
        None,
        "accessibility",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "screen_effects",
        ["screenEffectScale"],
        Some("1.16.2"),
        None,
        "accessibility",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "darkness_pulsing",
        ["darknessEffectScale"],
        Some("1.19"),
        None,
        "accessibility",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "damage_tilt",
        ["damageTiltStrength"],
        Some("1.19.4"),
        None,
        "accessibility",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "glint_speed",
        ["glintSpeed"],
        Some("1.19.4"),
        None,
        "accessibility",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    decimal!(
        "glint_strength",
        ["glintStrength"],
        Some("1.19.4"),
        None,
        "accessibility",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    boolean!(
        "hide_lightning_flashes",
        ["hideLightningFlashes"],
        Some("1.18"),
        None,
        "accessibility"
    ),
    boolean!(
        "hide_splash_texts",
        ["hideSplashTexts"],
        Some("1.20.3"),
        None,
        "accessibility"
    ),
    boolean!(
        "high_contrast_outline",
        ["highContrastBlockOutline"],
        Some("1.21.2"),
        None,
        "accessibility"
    ),
    boolean!(
        "narrator_hotkey",
        ["narratorHotkey"],
        Some("1.20.2"),
        None,
        "accessibility"
    ),
    boolean!(
        "autosave_indicator",
        ["showAutosaveIndicator"],
        Some("1.18"),
        None,
        "accessibility"
    ),
    decimal!(
        "panorama_speed",
        ["panoramaScrollSpeed"],
        Some("1.19.3"),
        None,
        "accessibility",
        0.0,
        1.0,
        0.01,
        Some("percent")
    ),
    integer!(
        "menu_background_blur",
        ["menuBackgroundBlurriness"],
        Some("1.20.5"),
        None,
        "accessibility",
        0,
        10,
        1
    ),
    boolean!(
        "rotate_with_minecart",
        ["rotateWithMinecart"],
        Some("1.21.2"),
        None,
        "accessibility"
    ),

    // Language and account-facing settings.
    setting(
        "language",
        &["lang"],
        Some("1.1"),
        None,
        "language",
        SettingEditor::Language,
        ValueEncoding::Text,
    ),
    boolean!(
        "force_unicode_font",
        ["forceUnicodeFont"],
        Some("1.7.2"),
        None,
        "language"
    ),
    boolean!(
        "japanese_glyph_variants",
        ["japaneseGlyphVariants"],
        Some("1.20.5"),
        None,
        "language"
    ),
    enumeration!(
        "main_hand",
        ["mainHand"],
        Some("1.9"),
        None,
        "skin",
        MAIN_HAND,
        ValueEncoding::Enum(MAIN_HAND)
    ),
    boolean!(
        "cape",
        ["modelPart_cape", "showCape"],
        Some("1.8"),
        None,
        "skin"
    ),
    boolean!("hat", ["modelPart_hat"], Some("1.8"), None, "skin"),
    boolean!(
        "jacket",
        ["modelPart_jacket"],
        Some("1.8"),
        None,
        "skin"
    ),
    boolean!(
        "left_sleeve",
        ["modelPart_left_sleeve"],
        Some("1.8"),
        None,
        "skin"
    ),
    boolean!(
        "right_sleeve",
        ["modelPart_right_sleeve"],
        Some("1.8"),
        None,
        "skin"
    ),
    boolean!(
        "left_pants_leg",
        ["modelPart_left_pants_leg"],
        Some("1.8"),
        None,
        "skin"
    ),
    boolean!(
        "right_pants_leg",
        ["modelPart_right_pants_leg"],
        Some("1.8"),
        None,
        "skin"
    ),
    enumeration!(
        "difficulty",
        ["difficulty"],
        Some("1.0"),
        Some("1.7.2"),
        "online",
        DIFFICULTY,
        ValueEncoding::Enum(DIFFICULTY)
    ),
    boolean!(
        "allow_server_listing",
        ["allowServerListing"],
        Some("1.18"),
        None,
        "online"
    ),
    boolean!(
        "realms_notifications",
        ["realmsNotifications"],
        Some("1.8.9"),
        None,
        "online"
    ),
    boolean!(
        "hide_server_address",
        ["hideServerAddress"],
        Some("1.3.2"),
        None,
        "online"
    ),
    boolean!(
        "extra_telemetry",
        ["telemetryOptInExtra"],
        Some("1.19.3"),
        None,
        "online"
    ),
    boolean!(
        "in_game_notification",
        ["inGameNotification"],
        Some("26.2"),
        None,
        "online"
    ),
    enumeration!(
        "share_presence",
        ["sharePresence"],
        Some("26.2"),
        None,
        "online",
        SHARE_PRESENCE,
        ValueEncoding::QuotedEnum(SHARE_PRESENCE)
    ),
];

/// Lookup by stable catalog identity.
pub fn setting_by_id(id: &str) -> Option<&'static SupportedSetting> {
    CATALOG.iter().find(|setting| setting.id == id)
}

/// Lookup by a physical options.txt key, including documented aliases.
pub fn setting_by_file_key(key: &str) -> Option<&'static SupportedSetting> {
    CATALOG
        .iter()
        .find(|setting| setting.keys.contains(&key))
}

/// Compatibility name used by the local game-options editor.
pub fn definition(key: &str) -> Option<&'static SupportedSetting> {
    setting_by_file_key(key)
}

pub fn all_supported_settings() -> impl Iterator<Item = &'static SupportedSetting> {
    CATALOG.iter()
}

pub fn category(key: &str) -> &'static str {
    if key.starts_with("key_") {
        "keybindings"
    } else {
        definition(key).map_or("custom", |setting| setting.category)
    }
}

fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && !key.starts_with('#')
        && !key.starts_with("//")
        && !key.starts_with('\u{feff}')
        && !key
            .chars()
            .any(|character| character.is_control() || character.is_whitespace() || character == ':')
}

pub fn is_never_sync(key: &str) -> bool {
    NEVER_SYNC_KEYS.contains(&key)
}

/// A game-option key may be catalogued or unknown, but it cannot be a keybind
/// or one of the machine/session/pack-owned values above.
pub fn is_syncable_key(key: &str) -> bool {
    valid_key(key) && !key.starts_with("key_") && !is_never_sync(key)
}

/// Keybinds use a separate bundle. Keep the key namespace broad because mods
/// and game releases add bindings; the value validator accepts modern named
/// bindings and legacy numeric values without trying to reinterpret them.
pub fn is_syncable_keybind(key: &str) -> bool {
    valid_key(key) && key.starts_with("key_") && !is_never_sync(key)
}

fn single_line(value: &str) -> Result<(), &'static str> {
    if value.is_empty() || value.contains(['\r', '\n', '\0']) {
        Err("Option values must be a non-empty single line")
    } else {
        Ok(())
    }
}

fn unquoted(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(value)
}

fn valid_number(value: &str, min: Option<f64>, max: Option<f64>) -> bool {
    value.parse::<f64>().is_ok_and(|number| {
        number.is_finite()
            && min.is_none_or(|min| number >= min)
            && max.is_none_or(|max| number <= max)
    })
}

fn valid_integer(value: &str, min: Option<i64>, max: Option<i64>) -> bool {
    value.parse::<i64>().is_ok_and(|number| {
        min.is_none_or(|min| number >= min) && max.is_none_or(|max| number <= max)
    })
}

fn enum_contains(values: &[&str], value: &str) -> bool {
    values.contains(&unquoted(value))
}

fn validate_setting(setting: &SupportedSetting, value: &str) -> Result<(), &'static str> {
    let valid = match setting.encoding {
        ValueEncoding::Bool => matches!(value, "true" | "false"),
        ValueEncoding::Integer => match setting.editor {
            SettingEditor::Integer { min, max, .. } => {
                valid_integer(value, Some(min), Some(max))
            }
            _ => valid_integer(value, None, None),
        },
        ValueEncoding::Decimal => match setting.editor {
            SettingEditor::Decimal { min, max, .. } => {
                valid_number(value, Some(min), Some(max))
            }
            _ => valid_number(value, None, None),
        },
        ValueEncoding::Enum(values) | ValueEncoding::QuotedEnum(values) => {
            enum_contains(values, value)
        }
        ValueEncoding::Text => true,
        ValueEncoding::Fov => valid_number(value, Some(-1.0), Some(1.0)),
        ValueEncoding::GuiScale => valid_integer(value, Some(0), None),
        ValueEncoding::Graphics => {
            enum_contains(GRAPHICS, value)
                || matches!(unquoted(value), "0" | "1" | "2" | "3" | "true" | "false")
        }
        ValueEncoding::AmbientOcclusion => enum_contains(AMBIENT_OCCLUSION, value),
        ValueEncoding::Clouds => enum_contains(CLOUDS, value),
    };
    if valid {
        Ok(())
    } else {
        Err("Value is outside the supported format or range")
    }
}

/// Validate a value that will be written as a game option. Unknown extra keys
/// receive structural validation only; catalogued keys receive their editor
/// validation. This intentionally rejects keybinds so the two bundles cannot
/// cross-write one another.
pub fn validate(key: &str, value: &str) -> Result<(), &'static str> {
    if !is_syncable_key(key) {
        return Err("This option belongs to another sync category or is protected");
    }
    single_line(value)?;
    if let Some(setting) = definition(key) {
        validate_setting(setting, value)?;
    }
    Ok(())
}

/// Validate a key/value observed while reading an instance. It does not apply
/// catalog ranges, so a value produced by a mod or an older release remains
/// readable and can be kept local during seed/apply.
pub fn validate_observed(key: &str, value: &str) -> Result<(), &'static str> {
    if !is_syncable_key(key) {
        return Err("This option belongs to another sync category or is protected");
    }
    single_line(value)
}

pub fn validate_keybind(key: &str, value: &str) -> Result<(), &'static str> {
    if !is_syncable_keybind(key) {
        return Err("This keybinding is protected or is not a keybinding option");
    }
    single_line(value)
}

/// The editor-facing representation of a raw value. Only FOV changes units;
/// other settings retain their file representation (including quoted enums).
pub fn decode_for_editor(key: &str, raw: &str) -> Result<String, &'static str> {
    let setting = definition(key).ok_or("Unknown catalogued option")?;
    match setting.encoding {
        ValueEncoding::Fov => {
            let raw = raw.parse::<f64>().map_err(|_| "FOV must be numeric")?;
            if !raw.is_finite() || !(-1.0..=1.0).contains(&raw) {
                return Err("FOV is outside the stored range");
            }
            Ok(format_number(70.0 + raw * 40.0))
        }
        _ => Ok(raw.to_owned()),
    }
}

/// Encode an editor-facing value for the file. FOV expects degrees. Quoted
/// enum values are normalized to the representation used by modern files.
pub fn encode_from_editor(key: &str, editor_value: &str) -> Result<String, &'static str> {
    let setting = definition(key).ok_or("Unknown catalogued option")?;
    match setting.encoding {
        ValueEncoding::Fov => {
            let degrees = editor_value
                .parse::<f64>()
                .map_err(|_| "FOV must be numeric")?;
            if !degrees.is_finite() || !(30.0..=110.0).contains(&degrees) {
                return Err("FOV is outside the supported range");
            }
            Ok(format_number((degrees - 70.0) / 40.0))
        }
        ValueEncoding::QuotedEnum(_) => {
            let value = unquoted(editor_value);
            validate_setting(setting, value)?;
            Ok(format!("\"{value}\""))
        }
        _ => {
            validate(key, editor_value)?;
            Ok(editor_value.to_owned())
        }
    }
}

fn format_number(value: f64) -> String {
    let mut formatted = format!("{value:.6}");
    while formatted.ends_with('0') {
        formatted.pop();
    }
    if formatted.ends_with('.') {
        formatted.pop();
    }
    formatted
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct GameVersion([u32; 3]);

fn parse_game_version(version: &str) -> Option<GameVersion> {
    let version = version.trim().trim_start_matches('v');
    let version = version.split(['-', '+', ' ', '_']).next()?;
    let mut parts = version.split('.');
    let first = parts.next()?.parse::<u32>().ok()?;
    let second = parts.next().map_or(Some(0), |part| part.parse().ok())?;
    let third = parts.next().map_or(Some(0), |part| part.parse().ok())?;
    if parts.next().is_some() {
        return None;
    }
    Some(GameVersion([first, second, third]))
}

/// Return whether a catalogued setting is valid for an instance's game
/// version. Unknown/malformed versions fail closed for bounded metadata; this
/// prevents a new release from receiving a stale compatibility assumption.
pub fn setting_available_for_version(setting: &SupportedSetting, version: &str) -> bool {
    let Some(version) = parse_game_version(version) else {
        return false;
    };
    if let Some(since) = setting.since {
        let Some(since) = parse_game_version(since) else {
            return false;
        };
        if version < since {
            return false;
        }
    }
    if let Some(until) = setting.until {
        let Some(until) = parse_game_version(until) else {
            return false;
        };
        if version > until {
            return false;
        }
    }
    true
}

pub fn setting_available_for_key(key: &str, version: &str) -> bool {
    definition(key).is_some_and(|setting| setting_available_for_version(setting, version))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_broad_unique_metadata_without_keybinds() {
        let mut ids = std::collections::HashSet::new();
        let mut keys = std::collections::HashSet::new();
        for setting in CATALOG {
            assert!(ids.insert(setting.id), "duplicate id {}", setting.id);
            assert!(!setting.keys.is_empty());
            for key in setting.keys {
                assert!(keys.insert(*key), "duplicate physical key {key}");
                assert!(is_syncable_key(key));
                assert!(!key.starts_with("key_"));
            }
        }
        for key in [
            "renderDistance",
            "maxFps",
            "guiScale",
            "gamma",
            "particles",
            "ao",
            "graphicsPreset",
            "difficulty",
        ] {
            assert!(definition(key).is_some(), "missing {key}");
        }
        assert!(CATALOG.len() > 70);
    }

    #[test]
    fn sync_boundaries_keep_categories_separate_and_allow_extra_options() {
        assert!(is_syncable_key("mod.someOption"));
        assert!(validate("mod.someOption", "a value").is_ok());
        assert!(!is_syncable_key("key_key.forward"));
        assert!(validate("key_key.forward", "key.keyboard.w").is_err());
        assert!(is_syncable_keybind("key_key.forward"));
        assert!(validate_keybind("key_key.forward", "32").is_ok());
        assert!(validate_keybind("key_key.forward", "key.keyboard.w").is_ok());
        for key in NEVER_SYNC_KEYS {
            assert!(!is_syncable_key(key), "protected key {key}");
        }
        assert!(definition("difficulty").is_some());
        assert!(!is_never_sync("difficulty"));
        assert!(validate("difficulty", "2").is_ok());
    }

    #[test]
    fn validates_catalogued_ranges_but_keeps_observed_outliers_readable() {
        assert!(validate("fov", "0.75").is_ok());
        assert!(validate("fov", "110").is_err());
        assert!(validate("renderDistance", "64").is_ok());
        assert!(validate("renderDistance", "81").is_err());
        assert!(validate_observed("renderDistance", "81").is_ok());
        assert!(validate("guiScale", "0").is_ok());
        assert!(validate("guiScale", "42").is_ok());
        assert!(validate("guiScale", "-1").is_err());
        assert!(validate("preferredGraphicsBackend", "\"opengl\"").is_ok());
        assert!(validate("preferredGraphicsBackend", "opengl").is_ok());
        assert!(validate("particles", "4").is_err());
        assert!(validate("ao", "true").is_ok());
        assert!(validate("ao", "3").is_ok());
    }

    #[test]
    fn fov_codec_uses_degrees_without_losing_raw_precision() {
        assert_eq!(decode_for_editor("fov", "0.75").unwrap(), "100");
        assert_eq!(encode_from_editor("fov", "100").unwrap(), "0.75");
        assert_eq!(encode_from_editor("fov", "70").unwrap(), "0");
        assert!(encode_from_editor("fov", "29").is_err());
    }

    #[test]
    fn version_ranges_fail_closed_for_unknown_versions() {
        let render_distance = definition("renderDistance").unwrap();
        let difficulty = definition("difficulty").unwrap();
        assert!(setting_available_for_version(render_distance, "1.20.1"));
        assert!(!setting_available_for_version(render_distance, "1.6.4"));
        assert!(setting_available_for_version(difficulty, "1.7.2"));
        assert!(!setting_available_for_version(difficulty, "1.8"));
        assert!(!setting_available_for_version(render_distance, "not-a-version"));
        assert!(!setting_available_for_version(render_distance, "25w44a"));
        assert!(setting_available_for_key("renderDistance", "1.20.1"));
    }

    #[test]
    fn aliases_resolve_to_one_stable_setting() {
        assert_eq!(definition("sound").unwrap().id, "master_volume");
        assert_eq!(definition("soundCategory_master").unwrap().id, "master_volume");
        assert_eq!(definition("clouds").unwrap().id, "clouds");
        assert_eq!(category("key_key.forward"), "keybindings");
        assert_eq!(category("mod.someOption"), "custom");
    }
}
