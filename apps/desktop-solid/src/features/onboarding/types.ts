export interface FeaturedPack {
  projectId: string; source: 'modrinth'; name: string; author?: string; summary?: string;
  iconUrl?: string; downloads?: number; minecraft?: string; loader?: string;
}
export interface DetectedLauncher { id: string; label: string; icon?: string; instanceCount?: number; path?: string }
