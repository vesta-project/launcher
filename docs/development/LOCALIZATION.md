# Localization

Vesta keeps its source strings and translated catalogs in the launcher
repository. Crowdin is the translation workspace and opens reviewed translation
pull requests back to this repository; it is not a second source repository.

This keeps each application revision tied to the exact catalogs it was tested
and released with.

## Runtime design

Vesta uses [Project Fluent](https://projectfluent.org/) (`.ftl`) catalogs shared
by both runtime halves:

- `vesta-launcher/locales/en/` is the source catalog.
- `vesta-launcher/locales/<locale>/` contains Crowdin translations.
- `vesta-launcher/locales/manifest.json` declares locale metadata and controls
  which locales are visible in Settings.
- `vesta-launcher/src/localization/` owns SolidJS translation, locale
  negotiation, direction, and `Intl` formatting.
- `vesta-launcher/src-tauri/src/localization/` embeds the same catalogs for
  native UI such as the system tray.

English is the final fallback. The default preference is `system`, which tries
the operating-system locale and falls back to English. Changing the language in
Settings applies immediately and persists in `app_config.language`.

## Connect the existing Crowdin project

The committed `crowdin.yml` is ready for a file-based Crowdin project. In
Crowdin:

1. Set the project source language to English and add the desired target
   languages.
2. Open **Integrations → GitHub → Set Up Integration**.
3. Select **Source and translation files mode**, authorize the
   `vesta-project/launcher` repository, and select the `main` branch.
4. Keep the default configuration file name, `crowdin.yml`.
5. Leave **Push Sources** disabled. Import existing translations once only;
   after setup, Crowdin should be the source of truth for translated catalogs.
6. Enable the sync schedule. Crowdin will maintain an `l10n_main` service branch
   and open translation pull requests rather than writing directly to `main`.
7. Run **Sync Now** and confirm that `common.ftl`, `settings.ftl`, and
   `shell.ftl` appear as source files.

Do not add Crowdin credentials to `crowdin.yml`. The GitHub integration stores
authorization in Crowdin. The custom Crowdin commit message intentionally omits
`[ci skip]` so the localization workflow validates translation pull requests;
workflow concurrency cancels redundant runs while Crowdin is updating files.

If Crowdin's `%locale%` value is not the BCP 47 directory code Vesta should use,
configure a language mapping in Crowdin before downloading that language.

## Add and release a locale

Before Crowdin exports a new target locale, add it to
`locales/manifest.json`. Keep it disabled until it is reviewed:

```json
{
  "code": "fr",
  "name": "French",
  "nativeName": "Français",
  "direction": "ltr",
  "enabled": false
}
```

The code must be a valid BCP 47 language tag accepted by browser `Intl` APIs and
Rust `unic-langid`. Use `"direction": "rtl"` for right-to-left locales.

When translation quality is sufficient:

1. Review the Crowdin translation pull request.
2. Run `bun run i18n:check` from `vesta-launcher/`.
3. Change the locale's `enabled` flag to `true`.
4. Test system selection, explicit selection, restart persistence, long text,
   and the native tray on at least one desktop platform.

Missing translated messages safely fall back to English, so a locale may launch
before it reaches 100% coverage. Unknown message IDs, malformed Fluent syntax,
duplicate IDs, and changed variables fail validation.

## Add or change source text

Add a stable semantic message ID to the relevant English catalog:

```ftl
instance-launch-failed = Could not launch { $instanceName }
```

Use it in SolidJS:

```ts
t("instance-launch-failed", { instanceName })
```

Use it in Rust:

```rust
let mut args = FluentArgs::new();
args.set("instanceName", instance_name);
localization.format("instance-launch-failed", Some(&args))
```

Keep variables unchanged in translations. Prefer complete messages over
concatenated fragments so translators can reorder words. Add translator context
as an FTL comment immediately above an ambiguous message.

## Verification

From `vesta-launcher/`:

```sh
bun run i18n:check
bun run test --run src/localization/index.test.ts
bun run build
```

From the repository root:

```sh
cargo test -p vesta-launcher localization::tests
```

The first implementation localizes the language settings surface, Settings
navigation/loading states, and native tray. Migrating the remaining UI strings
is incremental: move strings into the nearest domain catalog as each screen is
touched.
