# Error inventory, 2026-10-31

Scope: fixed Rust enum-to-code arms and literal HTTP error emissions in agent control/transport, plus closed native and explicit UI reason mappings. Dynamic error families and job detail strings still need a separate audit. This is an inventory of current behavior, not a claim that row 7 is complete.

Path: agent wire code plus optional fixed domain reason -> native `Error::wire` (closed code + retained reason) -> TS `ServerCommandError` -> `serverErrorPresentation`. Pack safety refusals additionally carry `issue: {code, rule, item}`; provider failures retain their bounded provider details.

The former `message` row was an object property, not a wire code, and has been removed. Eight software plan warning identifiers are checked against `warningMessage`, separately from error presentations.

BUG marks known causes that still reach generic copy or lose their code before reaching the UI. Cause labels below come from Rust variant names and fixed transport codes; they are not exception text.

| Code | Cause | Current user message / next step | Intended or bug |
|---|---|---|---|
| `actor_mismatch` | Actor Mismatch | Your account cannot make this change; ask the server owner for access. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `admin_reserved` | Admin Reserved | Only the server owner can make this change; ask them to review it. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `admission_data_malformed` | Malformed | The server access list is invalid; ask the owner to repair it. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `admission_data_too_large` | Too Large | The server access list exceeds its configured limit; ask the owner to review the limit. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `admission_data_unavailable` | Unavailable | The server access list could not be read; ask the owner to check it and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `archive_corrupt` | archive corrupt | This archive is damaged or incomplete; download a fresh copy and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `audit_unavailable` | Audit Unavailable | The server cannot record this change safely; ask the owner to check its audit storage. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `automation_conflict` | automation conflict | The server changed since this view opened; refresh and review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `automation_idempotency_conflict` | Idempotency Conflict | This was already submitted; refresh to see the result. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `automation_receipts_saturated` | Saturated | The server has too many pending requests; wait a moment and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_busy` | Busy | Another task is using this service; wait for it to finish and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_confirmation_invalid` | Confirmation Invalid | This confirmation is no longer valid; review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_disk_space_low` | Disk Space Low | The server is low on disk space; free some space and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_forbidden` | Forbidden | Your account cannot make this change; ask the server owner for access. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_idempotency_conflict` | Idempotency Conflict | This was already submitted; refresh to see the result. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_invalid_request` | Invalid | The request contains invalid values; check the form and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_job_unknown` | Unknown Job | This backup is no longer available; refresh and choose an available backup. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_object_missing` | Not Found | This backup is no longer available; refresh and choose an available backup. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_object_too_large` | Too Large | This file exceeds the configured size limit; choose a smaller file or ask the owner to raise the limit. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_policy_revision_conflict` | Policy Conflict | The server changed since this view opened; refresh and review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_profile_unknown` | Unknown Profile | This backup is no longer available; refresh and choose an available backup. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_repository_corrupt` | Corrupt | The backup repository is damaged; ask the owner to check it before restoring. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_repository_invalid` | Invalid | The backup repository settings are invalid; ask the owner to repair them. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_repository_unavailable` | Failed | The backup service is unavailable; ask the owner to check its storage and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_restore_path_not_in_snapshot` | Not In Snapshot | This path is absent from the backup; choose a path included in the snapshot. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_restore_target_unsafe` | Target Unsafe | This restore destination is unsafe; choose a different destination. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_snapshot_unknown` | Missing | This backup is no longer available; refresh and choose an available backup. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_source_incomplete` | Incomplete | The backup source is incomplete; check the source files before trying again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_state_unavailable` | State | The backup service is unavailable; ask the owner to check its storage and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_storage_limit_reached` | Limit Reached | Storage has reached its limit; remove unused files or ask the owner to raise the limit. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_storage_unavailable` | Unavailable | The backup service is unavailable; ask the owner to check its storage and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_too_large` | Too Large | This request exceeds the configured limit; send less data or ask the owner to raise the limit. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `backup_unavailable` | Unavailable | The backup service is unavailable; ask the owner to check its storage and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `backups_not_configured` | Disabled | Backups are not configured; ask the owner to set up backup storage. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `binding_mismatch` | Binding Mismatch | Your account cannot make this change; ask the server owner for access. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `bootstrap_closed` | Bootstrap Closed | Server setup has already finished; refresh and sign in with an existing account. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `browser_origin_forbidden` | browser origin forbidden | This browser address is not allowed; connect through the configured server address. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `cancellation_requested` | Cancellation Requested | This task was cancelled; refresh to check its result. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `code_invalid` | Code Invalid | This connection code is invalid; ask for a new code. (next: new_code) | Intended / fixed: explicit mapping; wire reason preserved |
| `confirmation_invalid` | Confirmation Invalid | This confirmation is no longer valid; review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `confirmation_rejected` | Confirmation Rejected | This confirmation is no longer valid; review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `confirmation_required` | Confirmation Required | This confirmation is no longer valid; review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `content_datapack_toggle_requires_world` | content datapack toggle requires world | This content needs a world destination; select a world and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `content_mods_unsupported` | content mods unsupported | This server software cannot use this content; choose compatible content or change the server software. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `content_pack_download_failed` | Download Failed | A pack file couldn't be downloaded. Check the server's connection and retry. | Intended mapping; inspect shared-message specificity |
| `content_pack_download_unavailable` | Download Unavailable | CurseForge refused this file's download or no longer hosts it. Try another pack version or install its server files manually. | Intended mapping; inspect shared-message specificity |
| `content_pack_hash_mismatch` | Hash Mismatch | A downloaded pack file didn't match the provider's checksum. Nothing was installed. Retry to download it again. | Intended mapping; inspect shared-message specificity |
| `content_pack_metadata_invalid` | Invalid Metadata | The provider returned invalid file details while preparing this pack. Retry or choose another version. | Intended mapping; inspect shared-message specificity |
| `content_pack_source_unsafe` | Unsafe Source | The provider returned a file name or download address Vesta can't use safely. Try another pack version. | Intended mapping; inspect shared-message specificity |
| `content_plugins_unsupported` | content plugins unsupported | This server software cannot use this content; choose compatible content or change the server software. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `content_provider_not_configured` | Provider Not Configured | CurseForge isn't configured on this server. Its API key must be set on the agent before linking this pack. | Intended mapping; inspect shared-message specificity |
| `content_provider_unavailable` | Provider Unavailable | Couldn't download or verify the pack from its provider. Try again later. | Intended mapping; inspect shared-message specificity |
| `credential_conflict` | Credential Conflict | The server changed since this view opened; refresh and review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `credential_revision_exhausted` | Credential Revision Exhausted | The server cannot update these credentials; ask the owner to replace them. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `cursor_gap` | cursor gap | Some server updates were missed; refresh to load the current state. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `datapack_requires_running_game` | datapack requires running game | The game must be running for this request; start it and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `device_session_required` | device session required | Your connection is no longer authorized; pair with the server again. (next: pair_again) | Intended / fixed: explicit mapping; wire reason preserved |
| `download_busy` | download busy | Another task is using this service; wait for it to finish and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `download_host_not_allowed` | download host not allowed | The download URL must use HTTPS and contain no credentials. Choose another pack version. | Intended mapping; inspect shared-message specificity |
| `endpoint_not_found` | endpoint not found | This server does not offer the requested feature; refresh or update the server. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `experimental_build` | experimental build | This is an experimental build. | Intended mapping; inspect shared-message specificity |
| `explicit_deny` | Explicit Deny | Your account cannot make this change; ask the server owner for access. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_conflict` | Conflict | The server changed since this view opened; refresh and review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_corrupt` | Corrupt | This archive is damaged or incomplete; download a fresh copy and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_insufficient_space` | Insufficient Space | The server is low on disk space; free some space and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_intents_full` | Intents Full | The server has too many pending requests; wait a moment and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_limit_invalid` | Invalid Limit | The server file settings are invalid; ask the owner to repair them. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_not_compressed` | Not Compressed | This file is not a supported archive; choose a ZIP, TAR, or GZIP file. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_not_directory` | Not Directory | This path is not a folder; choose a folder and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_not_found` | Not Found | This file is no longer available; refresh and choose an existing file. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_not_regular` | Not Regular | This path is not a regular file; choose a regular file and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_path_invalid` | Invalid Path | This file path is invalid; choose a safe relative path inside the server folder. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_path_linked` | Linked Path | This path points through a file link; choose a path inside the server folder without links. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_path_protected` | Protected Path | This file controls the server and cannot be changed here; choose another file. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_recovery_required` | Recovery Required | An earlier change needs recovery; ask the server owner to repair it before continuing. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_root_invalid` | Invalid Root | The server file settings are invalid; ask the owner to repair them. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_too_large` | Too Large | This file exceeds the configured size limit; choose a smaller file or ask the owner to raise the limit. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_trash_full` | Trash Full | Storage has reached its limit; remove unused files or ask the owner to raise the limit. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_unavailable` | Unavailable | The server files could not be read; ask the owner to check access and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `file_upload_full` | Upload Full | The server has too many pending requests; wait a moment and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `filename_not_portable` | filename not portable | This file name cannot be stored safely. Choose another version or rename the file before importing. | Intended mapping; inspect shared-message specificity |
| `first_run_effects` | first run effects | The first start after switching may update the world and config files. | Intended mapping; inspect shared-message specificity |
| `forbidden` | forbidden | Your account cannot make this change; ask the server owner for access. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_config_document_linked` | Linked Document | The server configuration file cannot be read safely; ask the owner to check the file and its permissions. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_config_document_not_regular` | Invalid Document File | The server configuration file cannot be read safely; ask the owner to check the file and its permissions. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_config_document_unavailable` | Document Unavailable | The server configuration file cannot be read safely; ask the owner to check the file and its permissions. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_config_host_paths_invalid` | Invalid Host Paths | The server configuration is invalid; ask the owner to repair it on the server computer. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_config_invalid` | Invalid Document | The server configuration is invalid; ask the owner to repair it on the server computer. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_config_listener_invalid` | Invalid Listener | The server configuration is invalid; ask the owner to repair it on the server computer. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_config_missing` | Missing Document | The server configuration file cannot be read safely; ask the owner to check the file and its permissions. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_config_pack_invalid` | Invalid Pack Metadata | The server configuration is invalid; ask the owner to repair it on the server computer. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_config_path_budget_exceeded` | Path Budget Exceeded | The server configuration is invalid; ask the owner to repair it on the server computer. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_config_path_invalid` | Invalid Path | The server configuration is invalid; ask the owner to repair it on the server computer. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_config_revision_invalid` | Invalid Revision | The server configuration is invalid; ask the owner to repair it on the server computer. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_config_scan_root_duplicate` | Duplicate Scan Root | The server configuration is invalid; ask the owner to repair it on the server computer. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_config_schema_unsupported` | Unsupported Schema | The server configuration is invalid; ask the owner to repair it on the server computer. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_config_state_overlap` | State Overlap | The server configuration is invalid; ask the owner to repair it on the server computer. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_config_too_large` | Document Too Large | This request exceeds the configured limit; send less data or ask the owner to raise the limit. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_launch_definition_unavailable` | Launch Document | The game launch settings are unavailable or invalid; ask the owner to repair them. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `host_launch_directory_invalid` | Launch Directory | The game launch settings are unavailable or invalid; ask the owner to repair them. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `idempotency_conflict` | Idempotency Conflict | This was already submitted; refresh to see the result. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `idempotency_key_required` | idempotency key required | This request is missing its tracking key; refresh and submit it again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `input_unavailable` | Input Unavailable | The server files could not be read; ask the owner to check access and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `invalid_password` | Invalid Password | This password is incorrect; check it and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `invalid_password_gate_config` | Invalid Config | The server password settings are invalid; ask the owner to repair them. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `invalid_password_policy` | Invalid Policy | The server password settings are invalid; ask the owner to repair them. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `invalid_request` | Invalid Request | The request contains invalid values; check the form and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `invalid_resource` | Invalid Resource | The request contains invalid values; check the form and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `invalid_transition` | Invalid Transition | The server cannot make this change in its current state; refresh and try an available action. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `legacy_checksum` | legacy checksum | I understand this version's download can only be checked with an older method | Intended mapping; inspect shared-message specificity |
| `legacy_endpoint_removed` | legacy endpoint removed | This server does not offer the requested feature; refresh or update the server. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `lifecycle_state_conflict` | lifecycle state conflict | The game must be fully stopped; stop it and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `lightning_unsupported_version` | lightning unsupported version | This game version cannot use lightning effects; choose another moderation action. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `listener_bind_failed` | Bind | The server cannot use its configured address and port; ask the owner to check for another service using them. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `local_authority_required` | Local Authority Required | This change needs local access; run it on the server computer. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `local_grant_only` | Local Grant Only | Only the server owner can make this change; ask them to review it. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `local_only` | Local Only | This change needs local access; run it on the server computer. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `maintenance_active` | Maintenance Active | The server is under maintenance; try again when maintenance ends. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `malformed_password_verifier` | Malformed Verifier | The server password settings are invalid; ask the owner to repair them. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `management_forbidden` | Forbidden | Your account cannot make this change; ask the server owner for access. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `management_pair_invalid` | Pair Invalid | This connection code is invalid; ask for a new code. (next: new_code) | Intended / fixed: explicit mapping; wire reason preserved |
| `management_saturated` | Saturated | The server has too many pending requests; wait a moment and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `management_session_invalid` | Session Invalid | Your connection is no longer authorized; pair with the server again. (next: pair_again) | Intended / fixed: explicit mapping; wire reason preserved |
| `management_unavailable` | Unavailable | Server management is unavailable; ask the owner to check the service and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `manual_download_required` | manual download required | This file requires a manual download from the provider. | Intended mapping; inspect shared-message specificity |
| `method_not_allowed` | method not allowed | This server does not offer the requested feature; refresh or update the server. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `metrics_policy_conflict` | metrics policy conflict | The server changed since this view opened; refresh and review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `minecraft_busy` | Busy | Another task is using this service; wait for it to finish and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `minecraft_invalid_request` | Invalid Request | The request contains invalid values; check the form and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `minecraft_rate_limited` | Rate Limited | Too many requests reached the server; wait a moment and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `minecraft_unavailable` | Unavailable | The Minecraft service is unavailable; try again later. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `motd_policy_conflict` | motd policy conflict | The server changed since this view opened; refresh and review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `no_identity` | No Identity | Your connection is no longer authorized; pair with the server again. (next: pair_again) | Intended / fixed: explicit mapping; wire reason preserved |
| `not_compressed` | not compressed | This file is not a supported archive; choose a ZIP, TAR, or GZIP file. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `not_delegable` | Not Delegable | Only the server owner can make this change; ask them to review it. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `not_found` | Not Found | This item is no longer available; refresh and choose an available item. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `not_granted` | Not Granted | Your account cannot make this change; ask the server owner for access. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `not_implemented` | not implemented | This server does not offer the requested feature; refresh or update the server. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `not_owner` | Not Owner | Only the server owner can make this change; ask them to review it. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `operation_conflict` | operation conflict | The server changed since this view opened; refresh and review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `owner_reserved` | Owner Reserved | Only the server owner can make this change; ask them to review it. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `owner_stopping` | Owner Stopping | The server is stopping; wait for it to stop before trying again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `pack_access_denied` | pack access denied | Your account cannot make this change; ask the server owner for access. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `pack_access_unavailable` | pack access unavailable | Pack access could not be checked; try again later. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `pack_archive_invalid` | Invalid Archive | This pack's archive or manifest isn't supported. Choose another version or a Minecraft modpack export. | Intended mapping; inspect shared-message specificity |
| `pack_artifact_conflict` | Conflict | The stored pack changed. Refresh and review again. | Intended mapping; inspect shared-message specificity |
| `pack_artifact_not_published` | Not Published | This pack has not been published. Ask the owner to publish it. | Intended mapping; inspect shared-message specificity |
| `pack_catalogue_invalid` | Catalogue | This pack's archive or manifest isn't supported. Choose another version or a Minecraft modpack export. | Intended mapping; inspect shared-message specificity |
| `pack_custom_content_disabled` | pack custom content disabled | This server does not allow custom content. Ask its owner to enable it. | Intended mapping; inspect shared-message specificity |
| `pack_limit_invalid` | Invalid Limit | The pack limits are invalid. Ask the server owner to correct them. | Intended mapping; inspect shared-message specificity |
| `pack_not_published` | pack not published | No client pack is published; ask the owner to publish one and refresh. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `pack_path_invalid` | Invalid Path | This pack contains a file path Vesta can't install safely. Try another version. | Intended mapping; inspect shared-message specificity |
| `pack_path_linked` | Linked Path | The pack path crosses a linked directory. Use a directory without links. | Intended mapping; inspect shared-message specificity |
| `pack_path_protected` | Protected Path | The pack includes a protected server file. Remove it and review again. | Intended mapping; inspect shared-message specificity |
| `pack_prune_recovery_required` | Recovery Required | Pack cleanup needs recovery. Ask the server owner to repair pack storage. | Intended mapping; inspect shared-message specificity |
| `pack_release_conflict` | Conflict | The server changed since this view opened; refresh and review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `pack_release_revision_exhausted` | Revision Exhausted | The pack revision counter is exhausted. Contact the server owner. | Intended mapping; inspect shared-message specificity |
| `pack_release_revision_mismatch` | Revision Mismatch | The pack revision differs from the review. Refresh and review again. | Intended mapping; inspect shared-message specificity |
| `pack_release_version_invalid` | Invalid Version | The pack version is invalid. Enter a numeric version such as 1.2.3. | Intended mapping; inspect shared-message specificity |
| `pack_release_version_not_increasing` | Version Not Increasing | This version is older than the published pack. Acknowledge the downgrade in the publication review. | Intended mapping; inspect shared-message specificity |
| `pack_rollback_rejected` | pack rollback rejected | This pack cannot be restored to that version; refresh and choose an available version. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `pack_session_invalid` | Invalid | Your connection is no longer authorized; pair with the server again. (next: pair_again) | Intended / fixed: explicit mapping; wire reason preserved |
| `pack_session_limits_invalid` | Invalid Limits | The pack transfer settings are invalid; ask the owner to repair them. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `pack_session_saturated` | Saturated | The server has too many pending requests; wait a moment and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `pack_session_unavailable` | Unavailable | The pack transfer service is unavailable; try again later. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `pack_signature_unavailable` | pack signature unavailable | The server cannot sign this pack; ask the owner to check its signing key. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `pack_storage_low` | Insufficient Space | Not enough free disk space on the server computer. | Intended mapping; inspect shared-message specificity |
| `pack_too_large` | Too Large | This pack exceeds the server's import limits. Use a smaller pack or install its server files manually. | Intended mapping; inspect shared-message specificity |
| `pack_unavailable` | Unavailable | The pack storage cannot be read. Check server storage and retry. | Intended mapping; inspect shared-message specificity |
| `pack_unresolved_file` | Unresolved File | This pack contains a file without a verified download. Add a provider version for that file before installing. | Intended mapping; inspect shared-message specificity |
| `password_busy` | password busy | Another task is using this service; wait for it to finish and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `password_cost_out_of_bounds` | Cost Out Of Bounds | The server password settings are invalid; ask the owner to repair them. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `password_gate_closed` | Closed | Password sign-in is closed; ask the owner for another way to connect. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `password_gate_unavailable` | Unavailable | Password sign-in is temporarily unavailable; try again later. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `password_kdf_busy` | Busy | Another task is using this service; wait for it to finish and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `password_kdf_unavailable` | Kdf Unavailable | Password sign-in is temporarily unavailable; try again later. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `password_random_unavailable` | Random Unavailable | Password sign-in is temporarily unavailable; try again later. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `password_rate_limited` | Rate Limited | Too many requests reached the server; wait a moment and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `peer_capacity_unavailable` | peer capacity unavailable | The server has too many pending requests; wait a moment and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `players_file_malformed` | players file malformed | The server access list is invalid; ask the owner to repair it. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `players_query_busy` | Busy | Another task is using this service; wait for it to finish and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `players_query_console_gap` | Console Gap | Some server updates were missed; refresh to load the current state. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `players_query_console_incomplete` | Console Incomplete | Some server updates were missed; refresh to load the current state. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `players_query_invalid` | Invalid Request | The request contains invalid values; check the form and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `players_query_not_running` | Not Running | The game must be running for this request; start it and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `players_query_rollback_failed` | Rollback | An earlier change needs recovery; ask the server owner to repair it before continuing. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `players_query_scan_limit` | Scan Limit | The result exceeds the configured limit; narrow the request and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `players_query_stale_generation` | Stale Generation | Some server updates were missed; refresh to load the current state. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `players_query_stopping` | Shutting Down | The server is stopping; wait for it to stop before trying again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `players_query_timeout` | Timed Out | The player query did not finish in time; try again after the game responds. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `players_query_unavailable` | Unavailable | The player list could not be read; check that the game is responding and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `precondition_failed` | precondition failed | The server changed since this view opened; refresh and review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `provider_not_implemented` | provider not implemented | This software can't be set up from here. | Intended mapping; inspect shared-message specificity |
| `proxy_resolution` | proxy resolution | Check that your proxy supports this version. | Intended mapping; inspect shared-message specificity |
| `range_not_satisfiable` | range not satisfiable | This download position is no longer valid; restart the download. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `range_required` | range required | This download position is no longer valid; restart the download. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `rate_limited` | Rate Limited | Too many requests reached the server; wait a moment and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `realtime_busy` | realtime busy | Another task is using this service; wait for it to finish and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `recovery_export_forbidden` | Forbidden | This change needs local access; run it on the server computer. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `recovery_export_passphrase_invalid` | Invalid | This recovery passphrase is invalid; enter an accepted passphrase and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `recovery_export_too_large_use_local_command` | Too Large | This recovery export is too large for remote download; run the export command on the server computer. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `recovery_export_unavailable` | Unavailable | The recovery export could not be created; ask the owner to check the server storage and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `redirect_limit_exceeded` | redirect limit exceeded | The download redirected too many times. Try again. | Intended mapping; inspect shared-message specificity |
| `region_threading` | region threading | Folia runs regions in parallel. Many plugins don't work with it. | Intended mapping; inspect shared-message specificity |
| `request_timeout` | request timeout | The request did not finish in time; check the connection and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `request_too_large` | request too large | This request exceeds the configured limit; send less data or ask the owner to raise the limit. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_not_found` | resource not found | This item is no longer available; refresh and choose an available item. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_archive_invalid` | Invalid Archive | This archive is damaged or incomplete; download a fresh copy and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_build_busy` | Busy | Another task is using this service; wait for it to finish and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_build_timed_out` | Timed Out | The request did not finish in time; check the connection and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_busy` | Busy | Another task is using this service; wait for it to finish and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_confirmation_invalid` | Confirmation | This confirmation is no longer valid; review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_forbidden` | Forbidden | Your account cannot make this change; ask the server owner for access. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_format_incompatible` | Incompatible Format | This server software cannot use this content; choose compatible content or change the server software. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_idempotency_conflict` | Idempotency Conflict | This was already submitted; refresh to see the result. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_input_changed` | Changed Input | The server changed since this view opened; refresh and review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_input_invalid` | Invalid Input | The request contains invalid values; check the form and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_limit_exceeded` | Too Large | This request exceeds the configured limit; send less data or ask the owner to raise the limit. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_metadata_invalid` | Invalid Metadata | The request contains invalid values; check the form and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_metadata_unsupported` | Unsupported Metadata | This server software cannot use this content; choose compatible content or change the server software. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_not_found` | Not Found | This item is no longer available; refresh and choose an available item. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_recovery_required` | Recovery Required | An earlier change needs recovery; ask the server owner to repair it before continuing. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_request_invalid` | Invalid | The request contains invalid values; check the form and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_requires_stopped_game` | Stopped Required | The game must be fully stopped; stop it and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_revision_conflict` | Conflict | The server changed since this view opened; refresh and review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_storage_limit` | Limit | Storage has reached its limit; remove unused files or ask the owner to raise the limit. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_storage_unavailable` | Unavailable | The resource pack could not be prepared; ask the owner to check its files and storage and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_target_changed` | Target Changed | The server changed since this view opened; refresh and review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `resource_pack_unavailable` | Unavailable | The resource pack could not be prepared; ask the owner to check its files and storage and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `result_too_large` | Result Too Large | The result exceeds the configured limit; narrow the request and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `role_invalid` | Role Invalid | The request contains invalid values; check the form and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `rollback_failed` | Rollback | An earlier change needs recovery; ask the server owner to repair it before continuing. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `server_install.approval_mismatch` | server install approval mismatch | The review expired. Review the change again. | Intended mapping; inspect shared-message specificity |
| `server_install.artifact_changed` | server install artifact changed | The download didn't match its published checksum, so it wasn't used. | Intended mapping; inspect shared-message specificity |
| `server_install.build_memory_low` | server install build memory low | Not enough free RAM to build this version. Free some memory, or build it on another computer and import the JAR. | Intended mapping; inspect shared-message specificity |
| `server_install.build_output_mismatch` | server install build output mismatch | The built server doesn't match this release's published checksum. Your current software is unchanged. | Intended mapping; inspect shared-message specificity |
| `server_install.build_tools_missing` | server install build tools missing | Install Git and a JDK on the server computer before building CraftBukkit or Spigot. Windows also needs Git Bash. | Intended mapping; inspect shared-message specificity |
| `server_install.busy` | server install busy | Another change is in progress. Try again when it finishes. | Intended mapping; inspect shared-message specificity |
| `server_install.deadline` | server install deadline | The download didn't complete. Check the server's internet connection and try again. | Intended mapping; inspect shared-message specificity |
| `server_install.expired` | server install expired | The review expired. Review the change again. | Intended mapping; inspect shared-message specificity |
| `server_install.integrity_conflict` | server install integrity conflict | The download didn't match its published checksum, so it wasn't used. | Intended mapping; inspect shared-message specificity |
| `server_install.invalid_metadata` | server install invalid metadata | The download source returned something unexpected. Try again later. | Intended mapping; inspect shared-message specificity |
| `server_install.limit_exceeded` | server install limit exceeded | The download is larger than the server allows. | Intended mapping; inspect shared-message specificity |
| `server_install.runtime_failed` | server install runtime failed | The server computer doesn't have the Java version this needs. | Intended mapping; inspect shared-message specificity |
| `server_install.runtime_incompatible` | server install runtime incompatible | The installed Java can't run this version. | Intended mapping; inspect shared-message specificity |
| `server_install.runtime_unknown` | server install runtime unknown | The server computer doesn't have the Java version this needs. | Intended mapping; inspect shared-message specificity |
| `server_install.source_refused` | server install source refused | The download source returned something unexpected. Try again later. | Intended mapping; inspect shared-message specificity |
| `server_install.storage_low` | server install storage low | Not enough free disk space on the server computer. | Intended mapping; inspect shared-message specificity |
| `server_install.storage_unknown` | server install storage unknown | Vesta couldn't verify the installation disk's available space or filesystem support. | Intended mapping; inspect shared-message specificity |
| `server_install.transport_failed` | server install transport failed | The download didn't complete. Check the server's internet connection and try again. | Intended mapping; inspect shared-message specificity |
| `server_install.unavailable` | server install unavailable | That version isn't available. | Intended mapping; inspect shared-message specificity |
| `sftp_bind_failed` | sftp bind failed | SFTP couldn't use that address and port. It's still off. | Intended mapping; inspect shared-message specificity |
| `sftp_idempotency_conflict` | Repeated submission | This was already submitted; refresh to see the result. (next: refresh) | Intended / fixed: shared repeated-submission mapping |
| `sftp_key_duplicate` | sftp key duplicate | That key is already added. | Intended mapping; inspect shared-message specificity |
| `sftp_key_invalid` | sftp key invalid | That isn't a public SSH key the server accepts. | Intended mapping; inspect shared-message specificity |
| `sftp_key_limit` | sftp key limit | The server has reached its key limit. Revoke an old key first. | Intended mapping; inspect shared-message specificity |
| `sftp_outcome_unknown` | sftp outcome unknown | The result could not be confirmed; refresh before trying the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `sftp_unavailable` | sftp unavailable | File transfer is unavailable; ask the owner to check the transfer service and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `sleep_listener_not_configured` | sleep listener not configured | The sleep listener is not configured; ask the owner to set it up. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `sleep_policy_conflict` | sleep policy conflict | The server changed since this view opened; refresh and review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `software_busy` | Busy | Another change is in progress. Try again when it finishes. | Intended mapping; inspect shared-message specificity |
| `software_confirmation_invalid` | Confirmation Invalid | The review expired. Review the change again. | Intended mapping; inspect shared-message specificity |
| `software_disabled` | Disabled | Software changes aren't available on this server. | Intended mapping; inspect shared-message specificity |
| `software_forbidden` | Forbidden | Only the server owner can do this. | Intended mapping; inspect shared-message specificity |
| `software_idempotency_conflict` | Idempotency Conflict | This was already submitted; refresh to see the result. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `software_invalid_request` | Invalid Request | The request contains invalid values; check the form and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `software_plan_expired` | Plan Expired | The review expired. Review the change again. | Intended mapping; inspect shared-message specificity |
| `software_previous_unavailable` | Previous Unavailable | There's no previous software to restore. | Intended mapping; inspect shared-message specificity |
| `software_recovery_required` | Recovery Required | Restore the previous software first. | Intended mapping; inspect shared-message specificity |
| `software_revision_conflict` | Revision Conflict | The server changed since you opened this. Review again. | Intended mapping; inspect shared-message specificity |
| `software_runtime_unavailable` | Runtime Unavailable | Software changes aren't available on this server. | Intended mapping; inspect shared-message specificity |
| `software_state_unavailable` | State Unavailable | The server must be fully stopped. | Intended mapping; inspect shared-message specificity |
| `source_build` | source build | Builds from source. Upstream lists one current build per Minecraft version; historical builds are unavailable. | Intended mapping; inspect shared-message specificity |
| `source_build_reference_mismatch` | source build reference mismatch | Installed from the reviewed sources. The built JAR differs from the published reference checksum; its local checksum is saved for future integrity checks. | Intended mapping; inspect shared-message specificity |
| `source_revision_unavailable` | Source Revision Unavailable | These source files are no longer available; refresh and choose another version. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `temporarily_unavailable` | temporarily unavailable | The server is temporarily unavailable; wait a moment and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `tls_material_unavailable` | Tls Material | The server certificate could not be loaded; ask the owner to repair its connection settings. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `transport_busy` | transport busy | Another task is using this service; wait for it to finish and try again. (next: wait) | Intended / fixed: explicit mapping; wire reason preserved |
| `transport_shutdown_failed` | Shutdown | The result could not be confirmed; refresh before trying the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |
| `transport_unavailable` | Runtime | The server is temporarily unavailable; wait a moment and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `unknown_type` | Unknown Type | The request contains invalid values; check the form and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `unsupported_password_verifier` | Unsupported Verifier | The server password settings are invalid; ask the owner to repair them. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `unsupported_upstream` | unsupported upstream | This version is no longer supported by its developers. | Intended mapping; inspect shared-message specificity |
| `vesta_build_limit_invalid` | Invalid Limit | The pack build limits are invalid; ask the owner to repair them. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `vesta_build_metadata_mismatch` | Metadata Mismatch | The pack build inputs are invalid or inconsistent; check the pack files and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `vesta_build_reference_invalid` | Invalid Reference | The pack build inputs are invalid or inconsistent; check the pack files and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `vesta_build_snapshot_invalid` | Invalid Snapshot | The pack build inputs are invalid or inconsistent; check the pack files and try again. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `vesta_build_too_large` | Too Large | This request exceeds the configured limit; send less data or ask the owner to raise the limit. (next: fix_input) | Intended / fixed: explicit mapping; wire reason preserved |
| `vesta_build_unavailable` | Unavailable | The pack build could not finish; ask the owner to check its files and storage and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `whitelist_malformed` | Malformed | The server access list is invalid; ask the owner to repair it. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `whitelist_too_large` | Too Large | The server access list exceeds its configured limit; ask the owner to review the limit. (next: none) | Intended / fixed: explicit mapping; wire reason preserved |
| `whitelist_unavailable` | Unavailable | The server access list could not be read; ask the owner to check it and try again. (next: retry) | Intended / fixed: explicit mapping; wire reason preserved |
| `world_metadata_invalid` | world metadata invalid | The server couldn't read this world's saved metadata. Check the world files and try again. | Intended mapping; inspect shared-message specificity |
| `world_not_stopped` | world not stopped | The server must be fully stopped. | Intended mapping; inspect shared-message specificity |
| `world_requires_stopped` | world requires stopped | The server must be fully stopped. | Intended mapping; inspect shared-message specificity |
| `world_state_conflict` | world state conflict | The server changed since this view opened; refresh and review the change again. (next: refresh) | Intended / fixed: explicit mapping; wire reason preserved |

Legacy archive count, member size, aggregate size and metadata thresholds now produce structured archive_limit_warning plan issues; apply requires acknowledgement. Imported workspace storage and spooled apply no longer reimpose those legacy thresholds. Overflow, disk failures, malformed archives, checksums, unsafe paths and links remain hard failures. Download URL refusals carry a named rule and sanitized URL with credentials, query and fragment removed. Duplicate/case collisions, encrypted archives and unknown members remain separate policy work. No theme screenshots were captured in this pass.


## Pack refusal classification

These classify policy refusals. Disk failure, invalid JSON/ZIP, missing provider bytes, bad checksums, unsupported schemas and stale authorization/revisions are operational or integrity failures: acknowledgement cannot manufacture valid bytes or authority. They must report their specific cause, rather than pretending that retry or acknowledgement repairs it.

| Refusal rule / location | Classification | Current implementation |
|---|---|---|
| Traversal, absolute/drive paths, linked files/directories | hard | Never acknowledged; structured issue added for archive/install lexical path and symlink refusals |
| Download URL has credentials or is not HTTPS | hard | Intended / fixed: hard refusal with sanitized URL and named rule at download validation |
| Executable outside mods/plugins/scripts/kubejs | hard | Named executable_directory issue |
| Protected server control file | hard | Named protected_server_control_file issue |
| Portable display name rejected despite safe private storage | warning | Provider names use stable hash aliases accepted by OS and catalogue; actual display name stays in metadata |
| Unusual game content directory, PDFs and licenses | warning | Accepted as data; imported install plans warn per destination; provider installs omit this warning |
| Aggregate selected pack >64 MiB | warning | Structured plan warning; apply requires acknowledgement |
| Unknown server side, missing dependency, inferred runtime, retained unidentified content, client delivery unavailable | warning | Structured plan warning; apply requires acknowledgement |
| Legacy in-memory archive >68 MiB, pinned member >16 MiB, combined blobs >64 MiB | warning | Intended / fixed: legacy import accepts; structured plan issues and acknowledgement; large client delivery may remain unavailable |
| ZIP >65,537 members, manifest >65,536 files | warning | Intended / fixed: import, workspace and spooled apply accept; structured count warnings at plan time |
| Metadata JSON/text budget >32 MiB; file >8 GiB; aggregate >128 GiB | warning | Intended / fixed for imported server plans: structured metadata/file/aggregate warnings; namespace integrity remains hard; publication catalogue limits remain separate |
| Metadata response >1 MiB; provider cache >4 MiB | warning | Response cap still refuses; cache budget evicts/declines caching rather than rejecting |
| Interactive pending intents >65,536 / staged bytes >128 MiB | warning | Intended / fixed: acknowledged spooled pack plans bypass interactive count/byte caps; interactive edits retain their own limits |
| Archive extra member outside declared override roots | warning | BUG: import parser still rejects rather than preserving for review |
| Case aliases / duplicate destinations | warning | BUG: cannot choose one candidate at plan time; current duplicate rejection is not acknowledgeable |
| Redirect count >5 / URL length >8,192 | warning | BUG: still refuses before planning; bounded redirect handling needs an explicit policy override |

This table records the remaining policy items explicitly; response/cache budgets, unknown members, collisions, redirects and URL length policy are outside the legacy archive threshold change. Redirect and URL length failures now retain sanitized provenance.

## Implementation validation

The 220 former BUG code rows have explicit localized presentation mappings grouped by recovery step. All bounded machine codes survive native IPC as `reason`; unknown or malformed reasons cannot select arbitrary copy. `servers-error-coverage.test.js` checks every inventoried error against an explicit presentation, and native `error_inventory.rs` checks reason retention and serialization. Software plan warning identifiers are checked separately from error codes.
