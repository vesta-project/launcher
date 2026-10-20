export interface FeaturedPack {
  projectId: string; source: 'modrinth'; name: string; author?: string; summary?: string;
  iconUrl?: string; downloads?: number; minecraft?: string; loader?: string;
}
export type { LauncherSummary as DetectedLauncher } from '../launcher-import/model';
