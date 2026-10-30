# Sol UI audit, 2026-10-31

Direction: Vesta manages Minecraft instances and connected servers. Character: practical, compact, familiar. World: Minecraft packs and files. Moments: existing pack artwork and resource identities. Signature: the existing Vesta settings rows and installation form. Polish mode; preserve the launcher design and theme tokens.

| Sign | Location | Applied fix |
|---|---|---|
| Separate component language for the same settings | Server Settings panels, Connection and section navigation | Reuse launcher Settings Card, instance settings links and existing SettingRow controls; preserve commands and save behavior |
| Uppercase tracked secondary headings | Server collapsible settings groups | Sentence case with normal tracking; existing themed surfaces |
| A cramped duplicate installation surface | Overview and server menu Create instance | Route to the same InstanceInstallForm used by Browse; prefill signed server review name, Minecraft version and loader, retain consent and linked installation |
| Flat path lists obscure folder ownership | Backup include selection and instance Export | Shared expandable file tree dialog with parent mixed states and explicit Save/Cancel; backup directories remain directory includes |
| Metadata and files compete in one export dialog | Instance Export | Restore the old launcher's metadata then file-selection flow using current Dialog, TextField, Select and Checkbox components |
| Source names answer the wrong question | Server Resources entry subtitles | Show resource type as instances do |
| Text separators glue unrelated facts | Server linking version row and connection sign-in | Separate version fields with layout; use a grammatical list for sign-in |

Export reference: `vesta-launcher/ui/export-dialog/export-dialog.tsx` and its adjacent CSS, retained in this worktree (also present on `origin/main`). It has metadata/files steps, name/version/author/description, expandable folders and mixed checkboxes. No new palette or component system was introduced.

Retention and the Overview modpack content card are owned by other agents and were left unchanged. BackupSetup and BackupProfilesEditor both consume ProfileFields; their include selection therefore shares the picker without changes to backups-tab.tsx.

Unslop guidance: Damir Sokolovsky (@heydamir), CC BY 4.0, `V:/tmp/unslop/skills/unslop/SKILL.md` and `references/signs.md`.

Validation: typecheck and production build pass. All 422 requested server/localization/icon checks pass together (the first run hit the known console HOT_SCOPE_TIME flake). Fixture captures: `V:/tmp/triage2/sol-ui/`, dark/light/Windows 2000, including all nine server settings sections, Resources, server creation, Export metadata/tree/mixed states, backup setup/profile and their pickers. No browser page errors. Windows 2000 uses the existing CSS fixture injection from `checks/theme-surfaces.browser.mjs`.

Setup: root frozen install reported lockfile drift; the app-level frozen install completed successfully. Empty dependencies were copied from `V:/launcher/apps/desktop-solid/node_modules` because those packages were absent at its root. No lockfiles changed.

Final browser smoke: Overview Create navigates to the shared form; Install stays disabled until pack consent, then enables, in all three themes. Link-existing dialog also captured. 57 PNG captures in total.

Open verification issue: a focused export/tree browser run logs STRICT_READ_UNTRACKED from shared Kobalte primitives and library effects; the same primitive warnings appear on the unchanged Welcome screen. No REACTIVE_WRITE diagnostics were captured. Evidence: `V:/tmp/triage2/sol-ui/solid-diagnostics.json`. Native Tauri export-to-disk and installation were not exercised by browser fixtures.
