# Error inventory, 2026-10-31

Scope: fixed Rust enum-to-code arms and literal HTTP error emissions in agent control/transport, plus closed native and explicit UI reason mappings. Dynamic error families and job detail strings still need a separate audit. This is an inventory of current behavior, not a claim that row 7 is complete.

Path: agent wire code -> native `Error::wire` (closed code + retained reason) -> TS `ServerCommandError` -> `serverErrorPresentation`. Pack safety refusals additionally carry `issue: {code, rule, item}`; provider failures retain their bounded provider details.

BUG marks known causes that still reach generic copy or lose their code before reaching the UI. Cause labels below come from Rust variant names and fixed transport codes; they are not exception text.

| Code | Cause | Current user message / next step | Intended or bug |
|---|---|---|---|
| `actor_mismatch` | Actor Mismatch | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `admin_reserved` | Admin Reserved | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `admission_data_malformed` | Malformed | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `admission_data_too_large` | Too Large | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `admission_data_unavailable` | Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `archive_corrupt` | archive corrupt | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `audit_unavailable` | Audit Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `automation_conflict` | automation conflict | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `automation_idempotency_conflict` | Idempotency Conflict | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `automation_receipts_saturated` | Saturated | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_busy` | Busy | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_confirmation_invalid` | Confirmation Invalid | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_disk_space_low` | Disk Space Low | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_forbidden` | Forbidden | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_idempotency_conflict` | Idempotency Conflict | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_invalid_request` | Invalid | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_job_unknown` | Unknown Job | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_object_missing` | Not Found | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_object_too_large` | Too Large | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_policy_revision_conflict` | Policy Conflict | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_profile_unknown` | Unknown Profile | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_repository_corrupt` | Corrupt | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_repository_invalid` | Invalid | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_repository_unavailable` | Failed | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_restore_path_not_in_snapshot` | Not In Snapshot | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_restore_target_unsafe` | Target Unsafe | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_snapshot_unknown` | Missing | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_source_incomplete` | Incomplete | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_state_unavailable` | State | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_storage_limit_reached` | Limit Reached | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_storage_unavailable` | Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_too_large` | Too Large | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backup_unavailable` | Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `backups_not_configured` | Disabled | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `binding_mismatch` | Binding Mismatch | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `bootstrap_closed` | Bootstrap Closed | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `browser_origin_forbidden` | browser origin forbidden | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `cancellation_requested` | Cancellation Requested | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `code_invalid` | Code Invalid | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `confirmation_invalid` | Confirmation Invalid | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `confirmation_rejected` | Confirmation Rejected | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `confirmation_required` | Confirmation Required | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `content_datapack_toggle_requires_world` | content datapack toggle requires world | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `content_mods_unsupported` | content mods unsupported | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `content_pack_download_failed` | Download Failed | A pack file couldn't be downloaded. Check the server's connection and retry. | Intended mapping; inspect shared-message specificity |
| `content_pack_download_unavailable` | Download Unavailable | CurseForge refused this file's download or no longer hosts it. Try another pack version or install its server files manually. | Intended mapping; inspect shared-message specificity |
| `content_pack_hash_mismatch` | Hash Mismatch | A downloaded pack file didn't match the provider's checksum. Nothing was installed. Retry to download it again. | Intended mapping; inspect shared-message specificity |
| `content_pack_metadata_invalid` | Invalid Metadata | The provider returned invalid file details while preparing this pack. Retry or choose another version. | Intended mapping; inspect shared-message specificity |
| `content_pack_source_unsafe` | Unsafe Source | The provider returned a file name or download address Vesta can't use safely. Try another pack version. | Intended mapping; inspect shared-message specificity |
| `content_plugins_unsupported` | content plugins unsupported | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `content_provider_not_configured` | Provider Not Configured | CurseForge isn't configured on this server. Its API key must be set on the agent before linking this pack. | Intended mapping; inspect shared-message specificity |
| `content_provider_unavailable` | Provider Unavailable | Couldn't download or verify the pack from its provider. Try again later. | Intended mapping; inspect shared-message specificity |
| `credential_conflict` | Credential Conflict | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `credential_revision_exhausted` | Credential Revision Exhausted | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `cursor_gap` | cursor gap | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `datapack_requires_running_game` | datapack requires running game | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `device_session_required` | device session required | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `download_busy` | download busy | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `download_host_not_allowed` | download host not allowed | The download URL must use HTTPS and contain no credentials. Choose another pack version. | Intended mapping; inspect shared-message specificity |
| `endpoint_not_found` | endpoint not found | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `experimental_build` | experimental build | This is an experimental build. | Intended mapping; inspect shared-message specificity |
| `explicit_deny` | Explicit Deny | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_conflict` | Conflict | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_corrupt` | Corrupt | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_insufficient_space` | Insufficient Space | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_intents_full` | Intents Full | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_limit_invalid` | Invalid Limit | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_not_compressed` | Not Compressed | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_not_directory` | Not Directory | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_not_found` | Not Found | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_not_regular` | Not Regular | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_path_invalid` | Invalid Path | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_path_linked` | Linked Path | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_path_protected` | Protected Path | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_recovery_required` | Recovery Required | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_root_invalid` | Invalid Root | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_too_large` | Too Large | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_trash_full` | Trash Full | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_unavailable` | Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `file_upload_full` | Upload Full | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `filename_not_portable` | filename not portable | This file name cannot be stored safely. Choose another version or rename the file before importing. | Intended mapping; inspect shared-message specificity |
| `first_run_effects` | first run effects | The first start after switching may update the world and config files. | Intended mapping; inspect shared-message specificity |
| `forbidden` | forbidden | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_config_document_linked` | Linked Document | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_config_document_not_regular` | Invalid Document File | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_config_document_unavailable` | Document Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_config_host_paths_invalid` | Invalid Host Paths | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_config_invalid` | Invalid Document | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_config_listener_invalid` | Invalid Listener | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_config_missing` | Missing Document | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_config_pack_invalid` | Invalid Pack Metadata | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_config_path_budget_exceeded` | Path Budget Exceeded | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_config_path_invalid` | Invalid Path | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_config_revision_invalid` | Invalid Revision | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_config_scan_root_duplicate` | Duplicate Scan Root | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_config_schema_unsupported` | Unsupported Schema | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_config_state_overlap` | State Overlap | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_config_too_large` | Document Too Large | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_launch_definition_unavailable` | Launch Document | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `host_launch_directory_invalid` | Launch Directory | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `idempotency_conflict` | Idempotency Conflict | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `idempotency_key_required` | idempotency key required | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `input_unavailable` | Input Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `invalid_password` | Invalid Password | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `invalid_password_gate_config` | Invalid Config | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `invalid_password_policy` | Invalid Policy | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `invalid_request` | Invalid Request | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `invalid_resource` | Invalid Resource | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `invalid_transition` | Invalid Transition | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `legacy_checksum` | legacy checksum | I understand this version's download can only be checked with an older method | Intended mapping; inspect shared-message specificity |
| `legacy_endpoint_removed` | legacy endpoint removed | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `lifecycle_state_conflict` | lifecycle state conflict | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `lightning_unsupported_version` | lightning unsupported version | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `listener_bind_failed` | Bind | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `local_authority_required` | Local Authority Required | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `local_grant_only` | Local Grant Only | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `local_only` | Local Only | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `maintenance_active` | Maintenance Active | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `malformed_password_verifier` | Malformed Verifier | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `management_forbidden` | Forbidden | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `management_pair_invalid` | Pair Invalid | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `management_saturated` | Saturated | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `management_session_invalid` | Session Invalid | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `management_unavailable` | Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `manual_download_required` | manual download required | This file requires a manual download from the provider. | Intended mapping; inspect shared-message specificity |
| `message` | message | Couldn't download or verify the pack from its provider. Try again later. | Intended mapping; inspect shared-message specificity |
| `method_not_allowed` | method not allowed | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `metrics_policy_conflict` | metrics policy conflict | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `minecraft_busy` | Busy | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `minecraft_invalid_request` | Invalid Request | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `minecraft_rate_limited` | Rate Limited | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `minecraft_unavailable` | Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `motd_policy_conflict` | motd policy conflict | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `no_identity` | No Identity | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `not_compressed` | not compressed | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `not_delegable` | Not Delegable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `not_found` | Not Found | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `not_granted` | Not Granted | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `not_implemented` | not implemented | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `not_owner` | Not Owner | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `operation_conflict` | operation conflict | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `owner_reserved` | Owner Reserved | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `owner_stopping` | Owner Stopping | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `pack_access_denied` | pack access denied | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `pack_access_unavailable` | pack access unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `pack_archive_invalid` | Invalid Archive | This pack's archive or manifest isn't supported. Choose another version or a Minecraft modpack export. | Intended mapping; inspect shared-message specificity |
| `pack_artifact_conflict` | Conflict | The stored pack changed. Refresh and review again. | Intended mapping; inspect shared-message specificity |
| `pack_artifact_not_published` | Not Published | This pack has not been published. Ask the owner to publish it. | Intended mapping; inspect shared-message specificity |
| `pack_catalogue_invalid` | Catalogue | This pack's archive or manifest isn't supported. Choose another version or a Minecraft modpack export. | Intended mapping; inspect shared-message specificity |
| `pack_custom_content_disabled` | pack custom content disabled | This server does not allow custom content. Ask its owner to enable it. | Intended mapping; inspect shared-message specificity |
| `pack_limit_invalid` | Invalid Limit | The pack limits are invalid. Ask the server owner to correct them. | Intended mapping; inspect shared-message specificity |
| `pack_not_published` | pack not published | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `pack_path_invalid` | Invalid Path | This pack contains a file path Vesta can't install safely. Try another version. | Intended mapping; inspect shared-message specificity |
| `pack_path_linked` | Linked Path | The pack path crosses a linked directory. Use a directory without links. | Intended mapping; inspect shared-message specificity |
| `pack_path_protected` | Protected Path | The pack includes a protected server file. Remove it and review again. | Intended mapping; inspect shared-message specificity |
| `pack_prune_recovery_required` | Recovery Required | Pack cleanup needs recovery. Ask the server owner to repair pack storage. | Intended mapping; inspect shared-message specificity |
| `pack_release_conflict` | Conflict | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `pack_release_revision_exhausted` | Revision Exhausted | The pack revision counter is exhausted. Contact the server owner. | Intended mapping; inspect shared-message specificity |
| `pack_release_revision_mismatch` | Revision Mismatch | The pack revision differs from the review. Refresh and review again. | Intended mapping; inspect shared-message specificity |
| `pack_release_version_invalid` | Invalid Version | The pack version is invalid. Enter a numeric version such as 1.2.3. | Intended mapping; inspect shared-message specificity |
| `pack_release_version_not_increasing` | Version Not Increasing | This version is older than the published pack. Acknowledge the downgrade in the publication review. | Intended mapping; inspect shared-message specificity |
| `pack_rollback_rejected` | pack rollback rejected | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `pack_session_invalid` | Invalid | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `pack_session_limits_invalid` | Invalid Limits | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `pack_session_saturated` | Saturated | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `pack_session_unavailable` | Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `pack_signature_unavailable` | pack signature unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `pack_storage_low` | Insufficient Space | Not enough free disk space on the server computer. | Intended mapping; inspect shared-message specificity |
| `pack_too_large` | Too Large | This pack exceeds the server's import limits. Use a smaller pack or install its server files manually. | Intended mapping; inspect shared-message specificity |
| `pack_unavailable` | Unavailable | The pack storage cannot be read. Check server storage and retry. | Intended mapping; inspect shared-message specificity |
| `pack_unresolved_file` | Unresolved File | This pack contains a file without a verified download. Add a provider version for that file before installing. | Intended mapping; inspect shared-message specificity |
| `password_busy` | password busy | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `password_cost_out_of_bounds` | Cost Out Of Bounds | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `password_gate_closed` | Closed | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `password_gate_unavailable` | Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `password_kdf_busy` | Busy | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `password_kdf_unavailable` | Kdf Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `password_random_unavailable` | Random Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `password_rate_limited` | Rate Limited | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `peer_capacity_unavailable` | peer capacity unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `players_file_malformed` | players file malformed | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `players_query_busy` | Busy | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `players_query_console_gap` | Console Gap | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `players_query_console_incomplete` | Console Incomplete | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `players_query_invalid` | Invalid Request | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `players_query_not_running` | Not Running | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `players_query_rollback_failed` | Rollback | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `players_query_scan_limit` | Scan Limit | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `players_query_stale_generation` | Stale Generation | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `players_query_stopping` | Shutting Down | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `players_query_timeout` | Timed Out | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `players_query_unavailable` | Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `precondition_failed` | precondition failed | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `provider_not_implemented` | provider not implemented | This software can't be set up from here. | Intended mapping; inspect shared-message specificity |
| `proxy_resolution` | proxy resolution | Check that your proxy supports this version. | Intended mapping; inspect shared-message specificity |
| `range_not_satisfiable` | range not satisfiable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `range_required` | range required | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `rate_limited` | Rate Limited | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `realtime_busy` | realtime busy | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `recovery_export_forbidden` | Forbidden | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `recovery_export_passphrase_invalid` | Invalid | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `recovery_export_too_large_use_local_command` | Too Large | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `recovery_export_unavailable` | Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `redirect_limit_exceeded` | redirect limit exceeded | The download redirected too many times. Try again. | Intended mapping; inspect shared-message specificity |
| `region_threading` | region threading | Folia runs regions in parallel. Many plugins don't work with it. | Intended mapping; inspect shared-message specificity |
| `request_timeout` | request timeout | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `request_too_large` | request too large | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_not_found` | resource not found | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_archive_invalid` | Invalid Archive | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_build_busy` | Busy | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_build_timed_out` | Timed Out | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_busy` | Busy | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_confirmation_invalid` | Confirmation | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_forbidden` | Forbidden | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_format_incompatible` | Incompatible Format | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_idempotency_conflict` | Idempotency Conflict | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_input_changed` | Changed Input | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_input_invalid` | Invalid Input | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_limit_exceeded` | Too Large | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_metadata_invalid` | Invalid Metadata | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_metadata_unsupported` | Unsupported Metadata | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_not_found` | Not Found | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_recovery_required` | Recovery Required | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_request_invalid` | Invalid | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_requires_stopped_game` | Stopped Required | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_revision_conflict` | Conflict | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_storage_limit` | Limit | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_storage_unavailable` | Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_target_changed` | Target Changed | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `resource_pack_unavailable` | Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `result_too_large` | Result Too Large | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `role_invalid` | Role Invalid | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `rollback_failed` | Rollback | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
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
| `sftp_key_duplicate` | sftp key duplicate | That key is already added. | Intended mapping; inspect shared-message specificity |
| `sftp_key_invalid` | sftp key invalid | That isn't a public SSH key the server accepts. | Intended mapping; inspect shared-message specificity |
| `sftp_key_limit` | sftp key limit | The server has reached its key limit. Revoke an old key first. | Intended mapping; inspect shared-message specificity |
| `sftp_outcome_unknown` | sftp outcome unknown | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `sftp_unavailable` | sftp unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `sleep_listener_not_configured` | sleep listener not configured | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `sleep_policy_conflict` | sleep policy conflict | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `software_busy` | Busy | Another change is in progress. Try again when it finishes. | Intended mapping; inspect shared-message specificity |
| `software_confirmation_invalid` | Confirmation Invalid | The review expired. Review the change again. | Intended mapping; inspect shared-message specificity |
| `software_disabled` | Disabled | Software changes aren't available on this server. | Intended mapping; inspect shared-message specificity |
| `software_forbidden` | Forbidden | Only the server owner can do this. | Intended mapping; inspect shared-message specificity |
| `software_idempotency_conflict` | Idempotency Conflict | The server changed since you opened this. Review again. | Intended mapping; inspect shared-message specificity |
| `software_invalid_request` | Invalid Request | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `software_plan_expired` | Plan Expired | The review expired. Review the change again. | Intended mapping; inspect shared-message specificity |
| `software_previous_unavailable` | Previous Unavailable | There's no previous software to restore. | Intended mapping; inspect shared-message specificity |
| `software_recovery_required` | Recovery Required | Restore the previous software first. | Intended mapping; inspect shared-message specificity |
| `software_revision_conflict` | Revision Conflict | The server changed since you opened this. Review again. | Intended mapping; inspect shared-message specificity |
| `software_runtime_unavailable` | Runtime Unavailable | Software changes aren't available on this server. | Intended mapping; inspect shared-message specificity |
| `software_state_unavailable` | State Unavailable | The server must be fully stopped. | Intended mapping; inspect shared-message specificity |
| `source_build` | source build | Builds from source. Upstream lists one current build per Minecraft version; historical builds are unavailable. | Intended mapping; inspect shared-message specificity |
| `source_build_reference_mismatch` | source build reference mismatch | Installed from the reviewed sources. The built JAR differs from the published reference checksum; its local checksum is saved for future integrity checks. | Intended mapping; inspect shared-message specificity |
| `source_revision_unavailable` | Source Revision Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `temporarily_unavailable` | temporarily unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `tls_material_unavailable` | Tls Material | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `transport_busy` | transport busy | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `transport_shutdown_failed` | Shutdown | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `transport_unavailable` | Runtime | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `unknown_type` | Unknown Type | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `unsupported_password_verifier` | Unsupported Verifier | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `unsupported_upstream` | unsupported upstream | This version is no longer supported by its developers. | Intended mapping; inspect shared-message specificity |
| `vesta_build_limit_invalid` | Invalid Limit | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `vesta_build_metadata_mismatch` | Metadata Mismatch | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `vesta_build_reference_invalid` | Invalid Reference | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `vesta_build_snapshot_invalid` | Invalid Snapshot | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `vesta_build_too_large` | Too Large | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `vesta_build_unavailable` | Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `whitelist_malformed` | Malformed | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `whitelist_too_large` | Too Large | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `whitelist_unavailable` | Unavailable | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |
| `world_metadata_invalid` | world metadata invalid | The server couldn't read this world's saved metadata. Check the world files and try again. | Intended mapping; inspect shared-message specificity |
| `world_not_stopped` | world not stopped | The server must be fully stopped. | Intended mapping; inspect shared-message specificity |
| `world_requires_stopped` | world requires stopped | The server must be fully stopped. | Intended mapping; inspect shared-message specificity |
| `world_state_conflict` | world state conflict | HTTP/closed-code fallback; no cause-specific recovery copy | BUG: known cause lacks explicit UI mapping or transport preservation |

Remaining policy work: archive entry/count/metadata and in-memory legacy byte limits still refuse before planning; duplicate/case collision, encrypted archive and unknown member handling still need a reviewable decision model. These are not completed by structured warnings. Provider URL failures still require sanitized URL/rule provenance at their origin. No theme screenshots were captured in this pass.


## Pack refusal classification

These classify policy refusals. Disk failure, invalid JSON/ZIP, missing provider bytes, bad checksums, unsupported schemas and stale authorization/revisions are operational or integrity failures: acknowledgement cannot manufacture valid bytes or authority. They must report their specific cause, rather than pretending that retry or acknowledgement repairs it.

| Refusal rule / location | Classification | Current implementation |
|---|---|---|
| Traversal, absolute/drive paths, linked files/directories | hard | Never acknowledged; structured issue added for archive/install lexical path and symlink refusals |
| Download URL has credentials or is not HTTPS | hard | Refuses; original sanitized URL/rule provenance still incomplete |
| Executable outside mods/plugins/scripts/kubejs | hard | Named executable_directory issue |
| Protected server control file | hard | Named protected_server_control_file issue |
| Portable display name rejected despite safe private storage | warning | Provider names use stable hash aliases accepted by OS and catalogue; actual display name stays in metadata |
| Unusual game content directory, PDFs and licenses | warning | Accepted as data; imported install plans warn per destination; provider installs omit this warning |
| Aggregate selected pack >64 MiB | warning | Structured plan warning; apply requires acknowledgement |
| Unknown server side, missing dependency, inferred runtime, retained unidentified content, client delivery unavailable | warning | Structured plan warning; apply requires acknowledgement |
| Legacy in-memory archive >68 MiB, pinned member >16 MiB, combined blobs >64 MiB | warning | BUG: legacy path still refuses; normal spooled planning bypasses memory byte caps |
| ZIP >65,537 members, manifest >65,536 files | warning | BUG: rejects before plan; catalogue and apply representation need coordinated changes |
| Metadata JSON/text budget >32 MiB; file >8 GiB; aggregate >128 GiB | warning | BUG: catalogue limits still reject; no acknowledgement override |
| Metadata response >1 MiB; provider cache >4 MiB | warning | Response cap still refuses; cache budget evicts/declines caching rather than rejecting |
| Interactive pending intents >65,536 / staged bytes >128 MiB | warning | Legacy staging cap; spooled pack payload staging is independent of the interactive byte cap |
| Archive extra member outside declared override roots | warning | BUG: import parser still rejects rather than preserving for review |
| Case aliases / duplicate destinations | warning | BUG: cannot choose one candidate at plan time; current duplicate rejection is not acknowledgeable |
| Redirect count >5 / URL length >8,192 | warning | BUG: still refuses before planning; bounded redirect handling needs an explicit policy override |

This table records incomplete items explicitly; rows 6 and 7 must stay open.
