import { invoke } from '@tauri-apps/api/core';
import type { ConnectionId, Discovery, ServerSnapshot } from './native';
import type { SoftwareId } from './hosting-native';
const call = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);
export interface SetupReadiness {
  apiVersion: string; installationId: string; serverId: string;
  status: 'awaiting_app_onboarding'; managementAvailable: boolean; provisioningAvailable: boolean;
}
export interface SetupDiscovery { discovery: Discovery; readiness: SetupReadiness }
export interface SetupStatus { installationId: string; serverId: string; claimed: boolean }
export type SetupPlanRequest =
  | { kind: 'install'; name: string; software: SoftwareId; version: string; build: number | null; loaderVersion: string | null; experimental: boolean }
  | { kind: 'adopt_copy'; name: string; minecraftVersion: string };
export type SetupJobState = 'planning' | 'review' | 'applying' | 'ready' | 'complete' | 'failed' | 'interrupted';
export interface SetupReview {
  name: string; minecraftVersion: string; software: SoftwareId | null; loaderVersion: string | null;
  files: number; bytes: string; warnings: string[];
}
export interface SetupJob {
  id: string; state: SetupJobState;
  /** Detailed server phase, e.g. metadata or preparing; no percentage is available. */
  phase: string; error: string | null; review: SetupReview | null;
}
export const serversSetupNative = {
  /** Detect a pending host (default localhost:8443); returns pinned discovery for existing Minecraft sign-in with invitationCode. */
  readiness: (address?: string) => call<SetupDiscovery>('server_setup_readiness', { address: address ?? null }),
  /** Claim this installation's first server with the current verified account. */
  claim: (connectionId: ConnectionId, intentId: string) => call<SetupStatus>('server_setup_claim', { connectionId, intentId }),
  /** Read the current account's claim status. */
  status: (connectionId: ConnectionId) => call<SetupStatus>('server_setup_status', { connectionId }),
  /** Prepare an install or exported copy for review; use a new intent for a new plan. */
  plan: (connectionId: ConnectionId, request: SetupPlanRequest, intentId: string) => call<SetupJob>('server_setup_plan', { connectionId, request, intentId }),
  /** Apply the reviewed job with native confirmation; retry with the same intent and acknowledgements. */
  apply: (connectionId: ConnectionId, jobId: string, acknowledgeWarnings: boolean, acknowledgeLegacyChecksum: boolean, intentId: string) =>
    call<SetupJob>('server_setup_apply', { connectionId, jobId, acknowledgeWarnings, acknowledgeLegacyChecksum, intentId }),
  /** Poll a job, retaining its confirmation exclusively in native memory. */
  job: (connectionId: ConnectionId, jobId: string) => call<SetupJob>('server_setup_job', { connectionId, jobId }),
  /** Verify managed status on the same pin/identity, renew the signed session and refresh the normal snapshot. Retry transient failures. */
  handoff: (connectionId: ConnectionId) => call<ServerSnapshot>('server_setup_handoff', { connectionId }),
};
