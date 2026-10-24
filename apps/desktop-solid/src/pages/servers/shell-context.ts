import { createContext, useContext, type Accessor } from 'solid-js';
import type { ServerSnapshot } from '../../features/servers/native';
import type { SettingsSectionId } from '../../features/servers/shell-model';

/**
 * The open server workspace, so shared parts can tell what the header already explains
 * and settings sections can point to each other.
 */
export const ServerShellContext = createContext<{ snapshot: Accessor<ServerSnapshot>; openSection?: (section: SettingsSectionId) => void } | undefined>(undefined);

/** The open workspace, or undefined outside one (Solid 2 throws for a context without a provider). */
export const useServerShell = () => {
  try { return useContext(ServerShellContext); }
  catch { return undefined; }
};
