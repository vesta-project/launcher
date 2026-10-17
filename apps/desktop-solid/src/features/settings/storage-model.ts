export interface StorageCategory {
  id: string;
  label: string;
  bytes: number;
  clearable: boolean;
  openable: boolean;
}
export interface StorageSnapshot {
  totalBytes: number;
  categories: StorageCategory[];
  instancesTotalBytes: number;
  instances: { id: number; name: string; bytes: number }[];
  artifactCacheLimitBytes: number;
  artifactCacheUsageBytes: number;
}

const MB = 1024 * 1024;
export const storageFixture: StorageSnapshot = {
  totalBytes: 6_240 * MB,
  categories: [
    {
      id: 'instances',
      label: 'Instances',
      bytes: 4_120 * MB,
      clearable: false,
      openable: true,
    },
    {
      id: 'artifacts',
      label: 'Installer artifacts',
      bytes: 910 * MB,
      clearable: true,
      openable: false,
    },
    {
      id: 'modpacks',
      label: 'Modpack archives',
      bytes: 640 * MB,
      clearable: true,
      openable: false,
    },
    {
      id: 'manifests',
      label: 'Manifest metadata',
      bytes: 210 * MB,
      clearable: true,
      openable: false,
    },
    {
      id: 'database',
      label: 'Database metadata',
      bytes: 96 * MB,
      clearable: false,
      openable: false,
    },
    {
      id: 'runtime',
      label: 'Runtime cache',
      bytes: 180 * MB,
      clearable: true,
      openable: true,
    },
    {
      id: 'temp',
      label: 'Temporary files',
      bytes: 52 * MB,
      clearable: true,
      openable: false,
    },
    {
      id: 'logs',
      label: 'Logs',
      bytes: 32 * MB,
      clearable: false,
      openable: true,
    },
  ],
  instancesTotalBytes: 4_120 * MB,
  instances: [
    { id: 1, name: 'Create Skyblock', bytes: 1_840 * MB },
    { id: 2, name: 'Modded Survival', bytes: 1_310 * MB },
    { id: 3, name: 'Vanilla 1.21', bytes: 620 * MB },
    { id: 4, name: 'Creative World', bytes: 350 * MB },
  ],
  artifactCacheLimitBytes: 1024 * MB,
  artifactCacheUsageBytes: 910 * MB,
};

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** The host serializes snapshot aggregates in camelCase; category fields retain
 * their simple names. Keep the page Interface independent of extra host diagnostics. */
export function storageSnapshotFromHost(snapshot: StorageSnapshot): StorageSnapshot {
  return {
    totalBytes: snapshot.totalBytes,
    categories: snapshot.categories.map(({ id, label, bytes, clearable, openable }) => ({ id, label, bytes, clearable, openable })),
    instancesTotalBytes: snapshot.instancesTotalBytes,
    instances: snapshot.instances.map(({ id, name, bytes }) => ({ id, name, bytes })),
    artifactCacheLimitBytes: snapshot.artifactCacheLimitBytes,
    artifactCacheUsageBytes: snapshot.artifactCacheUsageBytes,
  };
}
