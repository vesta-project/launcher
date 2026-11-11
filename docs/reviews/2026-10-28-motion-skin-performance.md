# Reduced motion and skin preview performance

Implemented against launcher baseline `52db3ead9ed8e1e872db361cd326344f11736b75`. The existing visual design and drag rotation remain; changes concern motion policy, loading and resource use.

## Motion

- The effective preference is the app setting OR the operating-system preference. OS changes while the launcher is open update both CSS and JavaScript consumers.
- Reduced-motion overrides live in the existing `preferences` cascade layer, after normal theme declarations. Fixed-duration onboarding, theme checkmark and status effects now receive the same override as shared controls. Completion events remain available for presence/unmount behavior.
- Welcome pointer tracking detaches its listener, cancels the queued frame and centers the light when reduced motion is enabled. Normal pointer updates remain coalesced to one frame.
- Speck durations use a CSS custom property rather than an inline animation-duration declaration, keeping them under the motion policy.
- The instance-settings section navigation uses instant scrolling when motion is reduced.

Sources: [preference](../../apps/desktop-solid/src/features/settings/reduced-motion.ts), [CSS policy](../../apps/desktop-solid/src/styles/reduced-motion.css), [welcome light](../../apps/desktop-solid/src/pages/welcome/welcome-light.ts).

## Skin loading and rendering

- The 3D engine is dynamically imported only for an onscreen preview with a skin. Engine loading and texture decoding begin together. The imported module is reused for later previews.
- Thumbnails and the 3D preview share decoded images. Arm-model changes update geometry without decoding or uploading the same texture again.
- The image cache retains at most 32 entries and an estimated 8 MiB of decoded RGBA pixels. There are at most four active loads and 32 queued loads. Queue overflow rejects the oldest queued request; active shared requests finish normally. Oversized images are not retained in the cache. Failed loads can be retried, and network/decode waits have a 30-second deadline.
- Late texture or module completions cannot overwrite a newer selection or create/update a disposed viewer. Removed capes cannot reappear after a slow load.
- Offscreen or document-hidden previews pause the engine's rendering loop. Reduced-motion previews render on demand after control changes, texture loading, resize or context recovery. Normal visible idle animation stays enabled.
- Pixel ratio is capped at 2x. This bounds rendering resolution on higher-DPI displays; those displays may show slightly softer preview edges than an unrestricted native-DPI render. Repeated identical resize notifications do not resize the renderer again.
- Completed skin mutations no longer refresh an account panel that has been closed or replaced. The mutation itself still finishes for its original account.

Sources: [component](../../apps/desktop-solid/src/components/skin-viewer.tsx), [viewer owner](../../apps/desktop-solid/src/components/skin-viewer-controller.ts), [shared images](../../apps/desktop-solid/src/features/accounts/skin-textures.ts), [account state](../../apps/desktop-solid/src/features/accounts/skins.ts).

## Idle variation and drag recovery

The follow-up adds three restrained presets: breathing, looking around and shifting weight. They sit over the library's existing arm/cape idle motion. Gestures are selected randomly without immediate repeats, last 4-6 seconds and have 4-8 second quiet gaps. Their envelopes and pose interpolation keep transitions gradual.

Dragging interrupts the current gesture and fades its offsets back to neutral. After release, the view holds its inspected angle for 1.2 seconds and eases back to its initial resting angle over another 1.2 seconds. It follows the shortest orbit around the character, preserving distance instead of cutting through the mesh. Re-grabbing cancels the return immediately. Offscreen hiding also cancels it. Reduced motion disables both presets and automatic camera return, preserving manual rotation and the inspected angle.

This uses the existing visible render loop and adds no timers or extra frame loop. Gesture selection is not performed per frame, and the pose object is reused. Normal skin/model/cape updates do not reassign the same animation, because the installed library resets progress on every assignment. The controller also cancels an obsolete static repaint when continuous rendering takes over.

Source: [motion policy and orbit interpolation](../../apps/desktop-solid/src/components/skin-viewer-motion.ts).

## Build evidence

Production Vite output, decimal kB as reported by the bundler:

| Artifact | Baseline | Updated |
| --- | ---: | ---: |
| Main client JS, minified | 2,664.55 | 2,154.09 |
| Main client JS, gzip | 753.02 | 625.84 |
| Deferred skinview3d chunk, minified | Part of main JS | 524.97 |
| Deferred skinview3d chunk, gzip | Part of main JS | 130.80 |

The manifest marks skinview3d as a dynamic entry with no static imports. This demonstrates deferred engine delivery, not a measured startup-time or frame-rate improvement. Cold first-use still needs to load that chunk. Total code has not disappeared; it has moved off the initial path. The existing large-chunk advisory remains.

## Verification

- `bun test checks/reduced-motion.test.js checks/skin-viewer.test.js checks/skin-viewer-motion.test.js checks/review-regressions.test.js checks/settings-model.test.js checks/account-login.test.js`: **39 passed, 0 failed, 165 assertions**.
- The motion tests run the actual Solid effects under `captureArtifact` with deterministic media, pointer and frame adapters. Both captured scenarios pass `expectNoDiagnostics`.
- Viewer/cache tests cover deferred initialization, parallel loading, visibility pause/resume, static repaint coalescing, resize/DPI bounds, model-only changes, out-of-order skins, cape removal, disposal, failed imports, actual image-decode readiness, cache reuse, LRU/pixel limits, concurrency/queue bounds and failed-load retries.
- Motion tests cover all three pose bounds, distinct/non-repeating gestures, quiet gaps, smooth neutral settling during drag, invalid/suspended frame times, orbit distance, shortest-path wrapping, return interruption, reduced-motion cancellation and preservation of animation progress. Controller integration uses the installed library's real `IdleAnimation` and `PlayerObject`; the WebGL renderer is faked. These tests do not benchmark GPU cost or establish perceived visual quality.
- The existing regression harness now uses `fileURLToPath`, accepts Windows separators, provides inert visibility APIs, and awaits the current staged-edit `flush()` contract. It verifies account isolation and disposal. Its separately bundled Solid runtimes emit the existing multiple-instance warning; that is a harness warning, not evidence of duplicate runtimes in the product build.
- `bun run typecheck`: passed.
- Scoped oxlint over changed TypeScript/TSX and test files: passed, no output.
- `bun run build`: passed for client and SSR shell.
- `git diff --check`: passed.

No native app or browser visual test was run for these changes. Native WebView input, first-use appearance, GPU memory, frame pacing and actual low-end loading time still need practical verification. The tests establish lifecycle, resource bounds and reactivity behavior, not a smoothness rating.

No dependencies were installed, server processes restarted, user data removed, or changes committed/pushed. Earlier audit artifacts and unrelated untracked roadmap files were preserved. The Import dialog's separate exit-animation issue was outside this request and remains unchanged.
