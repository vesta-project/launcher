/** Shapes returned by the host's Java commands. */
export interface JavaRequirement {
  major_version: number;
  recommended_name: string;
  is_required_for_latest?: boolean;
}
export interface DetectedJava {
  path: string;
  major_version: number;
  is_64bit: boolean;
}
export interface GlobalJavaPath {
  major_version: number;
  path: string;
  is_managed: boolean;
  is_active: boolean;
}
export interface JavaInventory {
  requirements: JavaRequirement[];
  detected: DetectedJava[];
  managed: DetectedJava[];
  global: GlobalJavaPath[];
}

export type JavaSource = 'managed' | 'system' | 'custom';
export interface JavaRuntime {
  source: JavaSource;
  /** Null for a managed runtime that is not downloaded yet. */
  path: string | null;
  active: boolean;
}
export interface JavaEnvironment {
  major: number;
  name: string;
  runtimes: JavaRuntime[];
  /** The active runtime, if one is chosen. */
  active?: JavaRuntime;
}

/**
 * Groups the host's flat lists into one environment per Java generation: the managed
 * runtime (downloaded or not), detected system installs, and any custom path the user chose.
 */
export function buildJavaEnvironments(inventory: JavaInventory): JavaEnvironment[] {
  return inventory.requirements.map((requirement) => {
    const major = requirement.major_version;
    const chosen = inventory.global.find((entry) => entry.major_version === major && entry.is_active);
    const managed = inventory.managed.filter((java) => java.major_version === major);
    const managedPaths = new Set(managed.map((java) => java.path));
    const system = inventory.detected.filter((java) => java.major_version === major && !managedPaths.has(java.path));
    const known = new Set([...managedPaths, ...system.map((java) => java.path)]);
    const custom = inventory.global.filter(
      (entry) => entry.major_version === major && !entry.is_managed && !known.has(entry.path),
    );

    const runtimes: JavaRuntime[] = [
      ...(managed.length
        ? managed.map((java) => ({
            source: 'managed' as const,
            path: java.path,
          }))
        : [{ source: 'managed' as const, path: null }]),
      ...system.map((java) => ({ source: 'system' as const, path: java.path })),
      ...custom.map((entry) => ({
        source: 'custom' as const,
        path: entry.path,
      })),
    ].map((runtime) => ({
      ...runtime,
      active: !!chosen && runtime.path !== null && runtime.path === chosen.path,
    }));

    return {
      major,
      name: requirement.recommended_name,
      runtimes,
      active: runtimes.find((runtime) => runtime.active),
    };
  });
}

export const javaFixture: JavaInventory = {
  requirements: [
    { major_version: 8, recommended_name: 'Java 8 (Legacy)' },
    { major_version: 17, recommended_name: 'Java 17' },
    {
      major_version: 21,
      recommended_name: 'Java 21',
      is_required_for_latest: true,
    },
  ],
  detected: [
    {
      path: '/usr/lib/jvm/temurin-17/bin/java',
      major_version: 17,
      is_64bit: true,
    },
    {
      path: '/usr/lib/jvm/temurin-21/bin/java',
      major_version: 21,
      is_64bit: true,
    },
  ],
  managed: [{ path: '~/.vesta/java/21/bin/java', major_version: 21, is_64bit: true }],
  global: [
    {
      major_version: 21,
      path: '~/.vesta/java/21/bin/java',
      is_managed: true,
      is_active: true,
    },
  ],
};
