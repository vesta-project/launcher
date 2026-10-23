import { createContext, useContext, type Accessor } from 'solid-js';
import type { ServerSnapshot } from '../../features/servers/native';

/** The open server workspace, so shared parts can tell what the header already explains. */
export const ServerShellContext = createContext<{ snapshot: Accessor<ServerSnapshot> } | undefined>(undefined);

export const useServerShell = () => useContext(ServerShellContext);
