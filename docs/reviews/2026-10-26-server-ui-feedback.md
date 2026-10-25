# Server UI feedback, 26 October 2026

The existing layouts and navigation are retained.

## Changes

- Switch track clicks suppress an enclosing label's second activation. Property-name and workflow switches now use the component's own label.
- Segmented controls center within toolbar rows. Labels use cap-height to baseline trimming so capital letters center vertically.
- Minecraft versions use the launcher's existing numeric game-version comparator, newest first. Software build and loader numbers also sort descending. Both menus reveal additional batches on scroll instead of ending at 80 entries.
- Previous software has a compact bordered row. Known installations keep their software/version/build details. The first locally configured launch has no historical version metadata, so it is labeled honestly rather than guessed.
- Sleep diagnostics are hidden for stopped, disconnected, stopping and recovery states. The starting message is limited to the starting lifecycle. The diagnostic aligns with its settings fields and no longer looks like a warning box.
- Activity has cursor-based Newer/Older navigation. Only requested pages load; live outcomes update matching rows and newly accepted tasks stay visible on the first page.
- Native lifecycle, moderation and console activities identify the action and server in the titlebar. Failure notifications identify the action and reported outcome. Console command contents are deliberately omitted from titlebar titles.
- Backup retention labels identify days, weeks and months; the description explains combined rules and zero values.
- Automation always uses a backup-profile selector. An empty or unavailable profile list gives setup guidance instead of requiring a typed name.
- English localization catalogs contain no em dashes. Unknown uptime and empty property values also use words instead of an em dash.

## Exact copy changes

Server-management descriptions were reviewed for clarity, repetition and claims about behavior. Unchanged descriptions remain where they explain a useful constraint. The table lists every changed or added English entry. An old em dash is written as [em dash] in this report.

| Entry | Before | After |
| --- | --- | --- |
| `console-copy-failed` | Copy failed [em dash] select and copy the text below. | Copy failed. Select and copy the text below. |
| `server-automation-no-backup-profiles` | (new) | Set up a backup profile in Backups first. |
| `server-hosting-original-setup` | Original setup | Installation details unavailable |
| `server-hosting-change-pick-description` | Choose the software and versions, then review the change. Nothing happens until you apply it. | Choose the software and versions, then review the change. |
| `server-hosting-original-description` | The launch command set up on the server computer | The agent has no version details for this installation. |
| `server-world-datapacks-saved-help` | As of the world's last save. Changes made while the server runs show here after Minecraft saves. | Updated when Minecraft saves the world. |
| `server-world-no-datapacks-help` | Put datapack folders or .zip files in the world's datapacks folder, then turn them on here. | Add datapack folders or ZIP files to this world's datapacks folder. |
| `server-world-pack-needs-running` | Start the server to switch datapacks. Minecraft applies them while it runs. | Datapack changes from this page are available while Minecraft is running. |
| `servers-activity-pages` | (new) | Activity pages |
| `servers-activity-newer` | (new) | Newer |
| `servers-activity-older` | (new) | Older |
| `servers-backup-setup-intro` | Backups save restore points of your server, so you can roll back after a bad update, griefing or a broken world. Each backup only stores what changed, so they stay small. | Save restore points of your server to recover from unwanted changes. |
| `servers-backup-setup-suggested` | Here's a sensible starting point. Adjust anything you like [em dash] you can change it later. | Adjust these defaults to suit your server. |
| `servers-backup-setup-name-help` | Lowercase letters, numbers and dashes. Automation refers to the profile by this name. | Use lowercase letters, numbers and dashes. |
| `servers-backup-setup-mode-online-help` | Backs up while people play. Vesta pauses world saving for a moment so the copy is consistent. Needs the server supervisor and a running game. | Backs up while Minecraft runs. World saving is paused briefly while files are copied. |
| `servers-backup-setup-mode-stopped-help` | Only backs up while Minecraft is stopped. The safest copy, but the server has to be off. | Backs up only while Minecraft is stopped. |
| `servers-backup-setup-retention` | How many to keep | Backup retention |
| `servers-backup-setup-retention-help` | After each backup, older restore points are cleaned up. Each rule keeps the newest backup of that period, so 7 per day means one for each of the last 7 days. | Keep the newest backups plus one backup for each day, week or month below. The rules combine. Set a rule to 0 to skip it. |
| `servers-backup-setup-keep-last` | Latest backups | Newest backups |
| `servers-backup-setup-keep-daily` | One per day | Days to keep |
| `servers-backup-setup-keep-weekly` | One per week | Weeks to keep |
| `servers-backup-setup-keep-monthly` | One per month | Months to keep |
| `servers-backup-setup-uncertain` | We couldn't confirm whether the server saved this. Trying again is safe [em dash] it won't be applied twice. | We couldn't confirm the save. You can safely try again. |
| `servers-backup-setup-stale` | Backup settings changed on the server. The latest version is loaded with your edits kept on top [em dash] review them and save again. | Backup settings changed on the server. Review your edits against the latest settings and save again. |
| `servers-presence-sleep-help` | Stop Minecraft when nobody is playing, and start it again when someone joins. The Vesta agent stays online the whole time. | Put Minecraft to sleep when the server is empty. Enable wake on join to let players start it again. |
| `servers-presence-sleep-enabled-help` | Stops Minecraft after nobody has been online for a while. Never during backups, updates or restores. | Sleeps after the server has been empty for the time below. Waits for backups, updates and restores to finish. |
| `servers-sleep-blocker-not-ready` | Waiting for Minecraft to finish starting | Minecraft is starting |

## Validation and limits

- Production build and TypeScript check pass.
- Focused server, backup, sleep, activity, version-ordering and localization tests pass.
- Native launcher library check passes with existing unused-code warnings.
- Lint passes with existing warnings.
- The existing combobox selection harness now works on Windows and its selection assertions pass. It still emits warnings from the installed Kobalte implementation (STRICT_READ_UNTRACKED and EFFECT_RELAY_TEAR); this change does not modify that implementation or suppress those warnings.
- No live server, Minecraft process or external SFTP application was restarted. Visual positioning still needs confirmation in the running launcher.
- Offline datapack editing is not implemented by this UI correction. The text describes this page's current controls, rather than claiming Minecraft requires a running server to configure datapacks.
- Historical software/version details cannot be recovered reliably from the old baseline record. New managed installations already retain those details.
