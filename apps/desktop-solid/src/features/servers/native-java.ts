import { invoke } from '@tauri-apps/api/core';
import type { ConnectionId } from './native';
import type { SoftwareJob } from './hosting-native';
export interface ServerJavaRuntime { id: string; path: string; version: string; major: number; vendor: string; arch: string; managed: boolean }
export interface ServerJavaInventory { runtimes: ServerJavaRuntime[]; selected: ServerJavaRuntime | null; customPathsAllowed: boolean; managedMajors: number[] }
export const serversJavaNative = {
  javaInventory: (connectionId: ConnectionId) => invoke<ServerJavaInventory>('server_java_inventory', { connectionId }),
  javaSelect: (connectionId: ConnectionId, runtimeId: string | null, customPath: string | null, intentId: string) => invoke<SoftwareJob>('server_java_select', { connectionId, runtimeId, customPath, intentId }),
  javaDownload: (connectionId: ConnectionId, major: number, intentId: string) => invoke<SoftwareJob>('server_java_download', { connectionId, major, intentId }),
};
