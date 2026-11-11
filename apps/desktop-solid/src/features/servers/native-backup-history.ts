import { invoke } from '@tauri-apps/api/core';
import type { ConnectionId } from './native';

const call = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);

export interface BackupPoint { id: string; time: string; profile: string | null; safety: boolean; parentId: string | null; label: string | null; kept: boolean }
export interface BackupHistory { head: string | null; points: BackupPoint[] }
export interface BackupPointUpdate { label?: string | null; kept?: boolean }

export const serversBackupHistoryNative = {
  backupHistory: (connectionId: ConnectionId) => call<BackupHistory>('server_backup_history', { connectionId }),
  backupPointUpdate: (connectionId: ConnectionId, id: string, request: BackupPointUpdate, intentId: string) => call<BackupPoint>('server_backup_point_update', { connectionId, id, request, intentId }),
};
