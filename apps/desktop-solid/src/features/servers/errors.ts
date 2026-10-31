// One localized message and one recovery action for every closed client error code.
import { knownServerErrors } from './known-errors';
import { reasonMessage } from './hosting-model';
import type { MessageId } from '../../localization/messages';
import { isServerCommandError, type ServerCommandError, type ServerErrorCode } from './native';

export type RecoveryAction = 'retry' | 'wait' | 'refresh' | 'pair_again' | 'verify' | 'new_code' | 'fix_input' | 'none';

export const errorPresentation: Record<ServerErrorCode, { message: MessageId; action: RecoveryAction }> = {
  invalid_address: { message: 'servers.error.invalid-address', action: 'fix_input' },
  unreachable: { message: 'servers.error.unreachable', action: 'retry' },
  timeout: { message: 'servers.error.timeout', action: 'retry' },
  tls_failed: { message: 'servers.error.tls-failed', action: 'retry' },
  fingerprint_mismatch: { message: 'servers.error.fingerprint-mismatch', action: 'verify' },
  pair_code_invalid: { message: 'servers.error.pair-code-invalid', action: 'new_code' },
  pair_outcome_unknown: { message: 'servers.error.pair-outcome-unknown', action: 'new_code' },
  credentials_rejected: { message: 'servers.error.credentials-rejected', action: 'pair_again' },
  credentials_unavailable: { message: 'servers.error.credentials-unavailable', action: 'none' },
  no_management_access: { message: 'servers.error.no-management-access', action: 'none' },
  forbidden: { message: 'servers.error.forbidden', action: 'none' },
  not_found: { message: 'servers.error.not-found', action: 'refresh' },
  stale_target: { message: 'servers.error.stale-target', action: 'refresh' },
  confirmation_expired: { message: 'servers.error.confirmation-expired', action: 'retry' },
  conflict: { message: 'servers.error.conflict', action: 'refresh' },
  rate_limited: { message: 'servers.error.rate-limited', action: 'wait' },
  server_busy: { message: 'servers.error.server-busy', action: 'wait' },
  backups_not_configured: { message: 'servers.error.backups-not-configured', action: 'none' },
  unsupported: { message: 'servers.error.unsupported', action: 'none' },
  outcome_unknown: { message: 'servers.error.outcome-unknown', action: 'refresh' },
  invalid_input: { message: 'servers.error.invalid-input', action: 'fix_input' },
  internal: { message: 'servers.error.internal', action: 'retry' },
};

/** Normalizes anything a command rejected with into the closed model. */
export function toServerError(reason: unknown): ServerCommandError {
  if (isServerCommandError(reason) && Object.hasOwn(errorPresentation, reason.code)) return reason;
  return { code: 'internal' };
}

const packReasons: Record<string, { message: MessageId; action: RecoveryAction }> = {
  modpack_requires_stopped: { message: 'server-pack.stop-to-install', action: 'none' },
  pack_limit_invalid: { message: 'server-pack.error-pack-limit-invalid', action: 'none' },
  pack_path_protected: { message: 'server-pack.error-pack-path-protected', action: 'none' },
  pack_path_linked: { message: 'server-pack.error-pack-path-linked', action: 'none' },
  pack_unavailable: { message: 'server-pack.error-pack-unavailable', action: 'none' },
  pack_artifact_conflict: { message: 'server-pack.error-pack-artifact-conflict', action: 'none' },
  pack_artifact_not_published: { message: 'server-pack.error-pack-artifact-not-published', action: 'none' },
  pack_release_revision_exhausted: { message: 'server-pack.error-pack-release-revision-exhausted', action: 'none' },
  pack_release_revision_mismatch: { message: 'server-pack.error-pack-release-revision-mismatch', action: 'none' },
  pack_release_version_not_increasing: { message: 'server-pack.error-pack-release-version-not-increasing', action: 'none' },
  pack_release_version_invalid: { message: 'server-pack.error-pack-release-version-invalid', action: 'none' },
  pack_prune_recovery_required: { message: 'server-pack.error-pack-prune-recovery-required', action: 'none' },
  pack_custom_content_disabled: { message: 'server-pack.error-pack-custom-content-disabled', action: 'none' },
  pack_storage_low: { message: 'server-hosting.reason-storage-low', action: 'none' },
  content_pack_download_unavailable: { message: 'server-pack.download-unavailable', action: 'none' },
  content_pack_metadata_invalid: { message: 'server-pack.metadata-invalid', action: 'retry' },
  content_pack_download_failed: { message: 'server-pack.download-failed', action: 'retry' },
  content_pack_hash_mismatch: { message: 'server-pack.hash-mismatch', action: 'retry' },
  content_pack_source_unsafe: { message: 'server-pack.source-unsafe', action: 'none' },
  pack_path_invalid: { message: 'server-pack.path-invalid', action: 'none' },
  pack_catalogue_invalid: { message: 'server-pack.archive-invalid', action: 'none' },
  pack_archive_invalid: { message: 'server-pack.archive-invalid', action: 'none' },
  pack_too_large: { message: 'server-pack.too-large', action: 'none' },
  pack_unresolved_file: { message: 'server-pack.unresolved-file', action: 'none' },
};

const providerFailureMessages: Record<string, MessageId> = {
  filename_not_portable:'server-pack.provider-filename',
  download_host_not_allowed:'server-pack.provider-host',
  redirect_limit_exceeded:'server-pack.provider-redirect',
  manual_download_required:'server-pack.provider-manual',
};

export function serverErrorPresentation(reason: unknown) {
  const error = toServerError(reason);
  const issueReasons: Record<string, string> = {
    download_redirect_limit: 'redirect_limit_exceeded',
    download_https_without_credentials: 'download_host_not_allowed',
    download_url_valid: 'download_host_not_allowed',
  };
  const issueReason = error.issue?.code === error.reason && error.issue && Object.hasOwn(issueReasons, error.issue.rule)
    ? issueReasons[error.issue.rule] : undefined;
  const providerReason = providerDetails(error)?.reason ?? issueReason ?? error.reason;
  if (providerReason && Object.hasOwn(providerFailureMessages, providerReason)) return {message:providerFailureMessages[providerReason]!, action:'none' as const};
  if (error.reason && Object.hasOwn(knownServerErrors, error.reason)) return knownServerErrors[error.reason]!;
  if (error.reason && Object.hasOwn(packReasons, error.reason)) return packReasons[error.reason]!;
  if (error.reason === 'content_provider_not_configured')
    return { message: 'server-pack.provider-not-configured' as MessageId, action: 'none' as const };
  if (error.reason === 'content_provider_unavailable')
    return { message: 'server-pack.provider-unavailable' as MessageId, action: 'retry' as const };
  const specific = reasonMessage(error.reason);
  if (specific) return { message: specific, action: errorPresentation[error.code].action };
  if (error.localPressure && error.code === 'rate_limited')
    return { message: 'servers.error.client-rate-limited' as MessageId, action: 'wait' as const };
  if (error.localPressure && error.code === 'server_busy')
    return { message: 'servers.error.client-busy' as MessageId, action: 'wait' as const };
  return errorPresentation[error.code];
}

export const errorMessage = (reason: unknown): MessageId => serverErrorPresentation(reason).message;

function providerDetails(error: ServerCommandError) {
  const d = error.details;
  const id = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9_-]{0,128}$/.test(s);
  return d && ['metadata', 'download'].includes(d.stage) && ['curseforge', 'modrinth'].includes(d.provider)
    && id(d.projectId) && d.projectId && id(d.versionId) ? d : null;
}

export function serverErrorFile(reason: unknown): string | null {
  const filename = providerDetails(toServerError(reason))?.filename;
  return typeof filename === 'string' && filename.length > 0 && filename.length <= 256 && !/[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(filename)
    && !/[\\/:]/.test(filename) ? filename : null;
}

/** Safe diagnostics for support. Do not stringify arbitrary command rejections. */
export function serverErrorDetails(reason: unknown): string {
  const error = toServerError(reason);
  const lines: string[] = [error.code];
  if (error.issue && error.issue.code === error.reason) lines.push(`${error.issue.code}: ${error.issue.rule}: ${error.issue.item}`);
  if (error.reason && /^[a-zA-Z0-9_.]{1,96}$/.test(error.reason)) lines.push(error.reason);
  const d = providerDetails(error);
  if (d) {
    lines.push(`${d.stage}: ${d.provider} ${d.projectId}${d.versionId ? ` / ${d.versionId}` : ''}`);
    if (d.reason && ['filename_not_portable', 'download_host_not_allowed', 'redirect_limit_exceeded', 'manual_download_required', 'provider_request_failed'].includes(d.reason)) lines.push(d.reason);
    const filename = serverErrorFile(reason);
    if (filename) lines.push(filename);
  }
  return lines.join('\n');
}

/** Used by the inventory coverage check; unknown codes must never count as mapped. */
export function hasExplicitServerErrorPresentation(code: string): boolean {
  return Object.hasOwn(knownServerErrors, code) || Object.hasOwn(packReasons, code)
    || Object.hasOwn(providerFailureMessages, code) || reasonMessage(code) !== null
    || ['content_provider_not_configured', 'content_provider_unavailable'].includes(code);
}
