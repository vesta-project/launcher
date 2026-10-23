import { createContext, useContext, type Accessor } from 'solid-js';
import type { ServerSnapshot } from '../../features/servers/native';
import type { SettingsSectionId } from '../../features/servers/shell-model';

/**
 * The open server workspace, so shared parts can tell what the header already explains
 * and settings sections can point to each other.
 */
export const ServerShellContext = createContext<{ snapshot: Accessor<ServerSnapshot>; openSection?: (section: SettingsSectionId) => void } | undefined>(undefined);

export const useServerShell = () => useContext(ServerShellContext);
