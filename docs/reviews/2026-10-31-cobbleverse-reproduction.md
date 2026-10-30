# COBBLEVERSE live reproduction

Authenticated against real CurseForge metadata on 2026-10-31 using the agent's existing configured application key. No key values or full provider responses were logged. The agent embeds CURSEFORGE_API_KEY from its repository .env at build time; runtime VESTA_CURSEFORGE_API_KEY / CURSEFORGE_API_KEY also work. The launcher embeds the same application-key setting in its build script. No additional credential was needed.

The reported 1173260 / 6060565 identifies the resource pack "Cobblemon 3D Poké Rods 1.0.zip", 167,546 bytes. COBBLEVERSE itself is project 1210677, file 8488030, display name "COBBLEVERSE 1.7.42 [CF]", archive size 225,761,641 bytes. Its manifest name/version is COBBLEVERSE / 1.7.42-CF and includes the exact reported resource-pack reference as required.

Before the fix, a whole-pack plan against 1210677 / 8488030 refused after parsing with:

    pack_path_invalid
    safe_relative_path
    mods/provider-Cobblemon%203D%20Pok%C3%A9%20Rods%201.0.zip

The percent-escaped storage alias passed the server file-path admission but failed the separate catalogue path admission. The alias is now a stable SHA-256 filename with the original extension, and is checked against both validators. Provider display names remain in metadata. Regression coverage includes the real Unicode filename using a Rust Unicode escape, as well as a question-mark filename.

After the fix, the same real whole-pack plan passed in 141.10 seconds: valid=true, 418 server files, 590,583,000 selected bytes. The plan returned structured warnings for total size and a FancyMenu dependency (curseforge/410295). The test uses a disposable stopped-server fixture; it never applies the plan or starts Minecraft. This verifies planning, not installation of this live pack.

Reproduce from V:/server-connections-mvp:

    cargo test -p vesta-control --lib cobbleverse_1_7_42_review -- --ignored --nocapture

The ignored test performs real provider traffic. Provider file metadata returned a null downloadUrl for the whole pack; the existing verified CDN fallback resolves it. A raw script that fetches downloadUrl directly will fail on that null and does not reproduce launcher behavior.

Remaining work is listed in 2026-10-31-error-inventory.md. Rows 6/7 are not complete: legacy count/size/import refusals and broad cause-specific UI mappings still need work. Custom content enforcement now covers manual resource inspection/application and all provider resource types. The remaining generic server DeleteDialog consumers use deferred Undo; the separate instance deletion dialog remains outside the stated intent rule. Dark/light/Windows 2000 screenshots were not captured.

Validation: desktop-solid typecheck and production build passed; 68 selected pack/Undo checks passed; 38 native client tests passed; launcher cargo check passed. Agent workspace tests passed (36 selected tests after policy updates, five live tests ignored; the two heavy capacity tests had passed in the earlier 37-test workspace run). Two transport provider error tests passed. Final agent content tests passed: 41 passed, one live test ignored.

Agent implementation: triage2-agent-2, commit 0ccc7734ae25d55ea15dd66d1747bc35652a3095. No merge was performed.
