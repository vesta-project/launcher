# Shell material and titlebar review

Verdict: **accept with changes**. Keep the frame/content hierarchy and the avatar above the rail. Correct the compositing model, narrow the first PR, and treat the split-colour junction and native behaviour as unproven until tested. Do not implement A in full as PR 1.

## Evidence and strengths

- Read the proposal and `V:/tmp/round8/shell/mock.html`; inspected all seven supplied PNGs. These are static concept evidence, not native Tauri verification. No implementation or runtime interaction was performed.
- Checked the shared Rust commands/startup/capabilities, rewrite shell/titlebar/rail/board CSS, theme resolver/tokens, and old home/titlebar code. `apps/desktop-solid/src-tauri/Cargo.toml` depends on the old native crate, so native changes affect both applications.
- The diagnosis of stacked alpha is right: `theme-model.ts:236–238` gives 52/72/87 at glass/60. `shell.css` paints canvas beneath chrome and boards; effective chrome coverage is 86.56%, panel 93.76%, before theme background spots, grain and borders. Those additional layers also affect appearance.
- `commands/app.rs:1046–1048` confirms fixed legacy tint and forced-dark Mica; acrylic extends the frame to -1. Scheme-aware native application is necessary. Capability/build distinctions in the proposal broadly match `utils/window_effects.rs`.
- The old `home.module.css` really uses a 64px rail, 32px row and 20% instance-wrapper fill. Its titlebar fades horizontally from transparent. Recovering that continuity and a more open library answers the user's actual request.
- In `dark-mica-settings.png`, the quiet sheet and visible frame create a useful hierarchy. `light-mica-library.png` gives the cards a shared backdrop without compromising card labels. A persistent sheet could also avoid double-painting translucent page backgrounds during transitions.

## Changes required before implementation

### 1. Fix the mock and the layering specification

The mock does **not** implement its stated coverage or the proposal table:

- `.shell` paints a full rail-coloured base, then a rail-column gradient over it, then a titlebar band over both. At dark default 48%, top-left coverage is `1 - .52^3 = 85.94%`; the rest of the titlebar is 72.96%. One CSS background declaration can still contain three overlapping painted layers.
- The sheet uses 93% directly over a 48% frame: 96.36% effective. Showcase uses 62% over 48%: 80.24%, not the proposed 67%. Light showcase is 87.4%, not 72%. The comment says derivation was done by hand, but the actual values do not do it.
- The toolbar adds yet another sheet fill over showcase. Split titlebar's 85% colour stacks too. The inactive screenshot dims the breadcrumb, contrary to A4, and substitutes a mock opaque backdrop; it does not test OS deactivation.

Consequently `dark-mica-library.png` versus `dark-none-library.png` still differs fairly little in the card field. Fix the mock before accepting exact opacity numbers. Render frame regions without overlap, or paint independent frame and content regions directly against the native backdrop. The latter is simpler than deriving every layer against a full-window undercoat.

There is a mathematical conflict in A4: default dark frame 53% becomes 78% inactive, exceeding showcase's unchanged 67% target. No nonnegative sheet alpha can recover 67% over 78%. Recomputing the derived alpha is insufficient. At frame=100% the equation also divides by zero. Prefer independent region fills; otherwise cap inactive frame below content coverage and explicitly handle opaque/invalid targets. Clamp frosted adjustments and test all slider endpoints.

Coverage describes alpha, not final colour or contrast. Different tint colours, theme gradients and grain must be included in the colour calculation. Overlay alpha cannot simply reuse a target derived over frame: menus can cover opaque cards, sheets and other overlays.

### 2. Keep the L-frame, reconsider the 48px fade

In `dark-mica-library-split.png`, blue fades down behind the first navigation tile; in `light-mica-settings-split.png`, the blue bar and grey rail still read as distinct surfaces. The sheet edge separates content successfully, but does not resolve every possible titlebar/rail colour pair. Its top-left corner is convex, not a concave fillet hiding a 48px transition. The fade is another gradient treatment, despite the claim to avoid the old gradient hack.

Use one frame colour by default. For strongly split author themes, prefer a deliberate full-height rail spine with the avatar at its top and the titlebar starting beside it. Shared alignment, material and control spacing can connect two distinct colours without blending them. Concept 2 does not inherently cause stacked alpha or restrict the effect to one side: its header can paint directly against the native backdrop and retain right/bottom frame gutters. Give this simpler variant a fair comparison before mandating a gradient.

If retaining the fade, make its length a theme detail and keep it away from the first selected tile; review navy/grey and saturated opposite-colour cases. Do not promise automatic legibility or a seamless junction for arbitrary author colours.

### 3. Correct native assumptions and application state

- WebView2 needs an alpha-zero webview background as well as transparent HTML/body and a native backdrop; `transparent(true)` alone is not a complete proof. The existing `clear_window_startup_background` command separately clears the window and sets webview RGBA to zero, noting that `None` can become white. The old frontend calls it; the rewrite readiness path in `platform/desktop.ts` calls `present_window_when_ready` instead. Trace the full lifecycle before changing startup colours. [WebView2 supports alpha 0 or 255, not intermediate host-background alpha](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2controller2).
- The non-Windows opaque builder background is real, but macOS subsequently enables decorations and overlay titlebar. Fixing transparency should be a platform-tested follow-up, not evidence that vibrancy currently cannot work. Keep a safe pre-show fallback and verify first paint, none/effect switching and fullscreen.
- [The 0.7.1 source](https://docs.rs/crate/window-vibrancy/0.7.1/source/src/windows.rs) confirms modern acrylic selects TRANSIENTWINDOW without consuming the tint, and Mica sets immersive dark mode. Its DWM calls also discard HRESULTs: a successful wrapper return does not prove visible material. Log/check native failures where possible. On apply failure, restore a coherent solid fallback rather than leaving a prior effect under a root hook saying none.
- Add scheme to the frontend drain's desired/applied key; merely rerunning its effect with the same effect name will be deduplicated today. Serialize scheme/effect updates and publish the normalized applied result. Rust callers must be updated for a new argument even if its type is `Option<bool>`; preserve omitted IPC arguments for the old frontend.
- [DWM MAINWINDOW is standard Mica, TRANSIENTWINDOW is Desktop Acrylic, and TABBEDWINDOW is Mica Alt; this enum starts at build 22621](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type). [Mica Alt is particularly intended for tabbed titlebars](https://learn.microsoft.com/en-us/windows/apps/design/style/mica), not every custom titlebar. Mica samples wallpaper rather than live windows; the mock's CSS blur is an illustration, not a simulation of its native pixels.
- Mica deactivation/fallback is documented, but do not assume every legacy acrylic/blur path follows identical focus rules. Initialize focus/maximized state, then subscribe with race-safe cleanup. Increasing frame opacity changes every content pixel if frame lies beneath it; A4's promise that content never shifts is false in that arrangement. Prefer no extra inactive fill animation initially; dim captions gently, keeping navigation readable.
- OS fallback can happen without losing focus. Chromium exposes reduced-transparency, but test actual OS-to-WebView2 mapping; battery saver is not represented by focus or that media query. Forced-colours needs system colours and visible focus/selection, not only alpha=100. Never infer actual DWM pixels solely from the selected effect.

### 4. Simplify contrast and performance promises

The proposed luminance envelopes are hypotheses, not bounds. Neither those estimates nor adding ten opacity points establishes a contrast guarantee. Compute final rendered sRGB colours, then linearize channels for WCAG relative luminance; interpolating OKLCH lightness or compositing scalar Y values as if they were CSS pixels is insufficient. Include active selection colours, disabled/subtle text, theme overrides, toolbar overlays and inactive states. Opaque does not itself mean accessible.

Use a full black-to-white backdrop range for an initial conservative check, with opaque local fills behind labels that fail. Native samples can justify later tuning but cannot certify all wallpaper/OS/hardware combinations. Author token alpha is not a reliable detector of whether the effect is hidden: ancestor fills, images and selector overrides also matter. Defer that runtime explanatory feature.

Keep native backdrop work out of CSS: `backdrop-filter` cannot recreate the OS backdrop behind the HWND. Avoid whole-shell or per-card CSS blur; reserve small, temporary overlay filters and measure with them open. The mock's 70px blur says nothing about native performance. [Legacy acrylic's drag/resize lag is documented](https://docs.rs/window-vibrancy/0.7.1/window_vibrancy/fn.apply_acrylic.html); measure native movement and renderer/compositor timing, not just application logs or a blanket 60fps assertion.

### 5. Treat caption geometry as behaviour

40px is a reasonable Windows row: a 28px avatar gets 6px breathing room. It is a Vesta choice, not a universal native metric. The mock omits update/guest/compact-add crowding and long breadcrumbs. At 520px minimum width, collapse running status first, ellipsize location, reserve caption width and preserve an intentional draggable gap. Retain `Board` fixed/inner-scroll behaviour; making every board a scroller risks nested scrolling in instance tabs.

Deep drag is already in the rewrite; keep real buttons/links for exclusions and test the entire avatar/menu/tooltip subtree. A plain non-drag child or `pointer-events:none` strip may still fall through to a deep-drag ancestor: prove explicit exclusion with the installed Tauri implementation. Four CSS pixels are a workaround, not DPI-aware native resize metrics; cover corners and side edges as well. Do not give the rail drag behaviour.

Maximized layout cannot be specified as “same layout” before checking client bounds, invisible resize-frame insets, mixed-DPI monitor moves and auto-hide taskbars. Keep caption controls flush to actual visible top/right bounds, with no restored resize strip while maximized. Internal sheet gutters are independent of native frame padding. DWM corner clipping and Alt+Space/system-menu availability must be verified for this undecorated window; do not assume them from CSS.

46px square-edged caption targets are sensible; use stable vector glyphs rather than relying on private-use font fallback, and make pressed feedback stronger than hover. [Snap hover requires native caption support or HTMAXBUTTON hit-testing](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-snap-layout-menu). A DOM maximize click alone is insufficient. Prototype hit-testing before polishing replacement captions; verify hover, click, restore and leave states together. Keep Win+Z as a fallback, not a claim of equivalent discoverability. Native-owned captions deserve evaluation before a JS-rectangle/native-subclass bridge.

macOS should keep its own layout. Verify traffic-light API coordinates/units rather than interpreting (16,20) as a centre, and avoid remounting account state when entering fullscreen. None of this should block the Windows material correction.

## Answers to the ten open questions

1. **40px on Windows**, retain platform-specific macOS sizing until checked. Do not shrink a busy header simply to preserve 32px.
2. **Left-align location with the content column**, after Back. Preserve text truncation and a drag gap; do not require Back's bounding box to equal the sheet edge if it has intentional padding.
3. **Keep standard Mica initially.** Compare Mica Alt after removing excess paint; if chosen later, explain its variant in Appearance rather than silently changing saved preferences. No extra user control is needed merely for experimentation.
4. **Showcase for the library grid; instance hero only after separate review.** Overview text/statistics need local solid backing. Instance tabs, logs and settings stay sheet/solid. The old library's “instance wrapper” is not the entire instance detail page.
5. **Keep 8px right/bottom gutters maximized** initially. They preserve the normal-page effect reveal and cost little; native maximized insets are a separate concern.
6. **Prefer blur for new Win10 defaults after a movement check**, retain explicitly saved acrylic. Do not remove Linux transparent solely because compositor detection is hard; retain it where actually validated, otherwise mark capability conservatively. No Linux policy change in PR 1.
7. **Neither estimated envelopes nor +10 gives a guarantee.** Use conservative full-range contrast checks/local backing first, then native measurements to tune appearance.
8. **Schedule a small Snap/native-caption spike alongside the geometry design**, after the material fix and before caption replacement. It need not block PR 1.
9. **No rail drag region.** An empty gap can later become a pin or control; stable input behaviour is more valuable than extra draggable area.
10. **Resolve missing settings from native capabilities**, preserving explicit none and existing preferences. Startup currently applies none deliberately (`startup/shell.rs:36`), so the native capability default is not the actual initial rendered effect. Coordinate readiness and effect application to avoid a visible switch.

## Smallest first PR: reveal the selected effect in today's geometry

1. For Windows Mica, synchronize native dark/light scheme with serialized effect application; keep standard Mica and existing option names. Confirm transparent webview/root backgrounds through startup. Preserve a solid none/flat/error/reduced-transparency fallback.
2. Reuse existing tokens: make shell canvas the single frame tint (start around 53% dark / 60% light at glass/60), remove titlebar/rail's additional fill only for this applied effect, and reduce only the library board tint. At dark frame 53%, a local library fill of about 30% yields 67% effective coverage; existing 87% normal-board fill yields about 94%. Back library toolbar/empty-state text locally. Keep theme background artwork from obscuring the intended reveal.
3. Keep current rail placement, 32px header, board insets, captions and author-theme overrides. No token renaming, all-platform coverage table, inactive animation, persistent sheet migration, Mica Alt substitution or Linux capability rewrite in this PR.
4. Acceptance: real Win11 Tauri captures on contrasting wallpapers show an obvious material change across the library card field and shell, while settings stays calm. Test light/dark, active/inactive, none/effect switching, OS transparency off and a split/opaque author theme; verify frame/content contrast. Mica must be assessed with wallpaper changes, acrylic with moving windows behind it. Include small compositing and scheme-update regression checks; static mock screenshots are insufficient.

Then land avatar/header/rail integration as PR 2, using the corrected mock to choose unified frame versus deliberate split spine. This separates a measurable fix for A from the still-open visual decision in B without exposing more settings or disconnected features to the user.
