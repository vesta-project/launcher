import { invoke } from '@tauri-apps/api/core';
import type { ConnectionId } from './native';
export type HistoryMetric = 'tps' | 'game_cpu_percent' | 'game_memory_bytes' | 'players_online';
export interface MetricsHistoryRequest { series: HistoryMetric[]; from: number; to: number; resolution: 'raw' | '5m' | 'daily' | 'auto'; maxPoints: number; after?: string | null }
/** Aligned with timestamps. null is unknown, including in five-minute aggregates. */
export interface MetricColumn { avg: (number | null)[]; min: (number | null)[]; max: (number | null)[]; knownCount: number[]; unknownCount: number[] }
export interface MetricsHistory { timestamps: number[]; series: Partial<Record<HistoryMetric, MetricColumn>>; gaps: boolean[]; tickSource: (string | null)[]; resolution: 'raw' | '5m' | 'daily'; bucketMillis: number; cursor: string; retentionGap: boolean }
export const serversMetricsNative = { metricsHistory: (connectionId: ConnectionId, request: MetricsHistoryRequest) => invoke<MetricsHistory>('server_metrics_history', { connectionId, request }) };
