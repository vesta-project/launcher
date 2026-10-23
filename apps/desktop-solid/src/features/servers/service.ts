// One API for the server UI: the native manager in Tauri, the fixture server in a browser preview.
import { Channel } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { nativeServers, retireNativeServerReads, serversNative, SERVERS_CHANGED_EVENT, type ConnectionId, type ServerEvent, type ServerTopic, type ServersNative } from './native';

export type Unsubscribe = () => void;

export interface ServersApi extends Omit<ServersNative, 'subscribe' | 'unsubscribe'> {
  /** Resolves once the subscription is open; the returned function closes it. */
  subscribe(connectionId: ConnectionId, topic: ServerTopic, onEvent: (event: ServerEvent) => void): Promise<Unsubscribe>;
  /** Saved connections or any snapshot changed. */
  onChanged(listener: () => void): Unsubscribe;
}

function nativeApi(): ServersApi {
  const { subscribe, unsubscribe, ...commands } = serversNative;
  return {
    ...commands,
    async subscribe(connectionId, topic, onEvent) {
      const channel = new Channel<ServerEvent>();
      channel.onmessage = onEvent;
      const handle = await subscribe(connectionId, topic, channel);
      let open = true;
      return () => {
        if (!open) return;
        open = false;
        channel.onmessage = () => {};
        void unsubscribe(handle).catch(() => {});
      };
    },
    onChanged(listener) {
      let stop: (() => void) | undefined;
      let closed = false;
      void listen(SERVERS_CHANGED_EVENT, () => listener()).then((unlisten) => {
        if (closed) unlisten();
        else stop = unlisten;
      });
      return () => { closed = true; stop?.(); };
    },
  };
}

let fixtureApi: Promise<ServersApi> | undefined;
const fixtures = () => (fixtureApi ??= import('./fixtures').then((module) => module.createFixtureServers()));

const native = nativeServers ? nativeApi() : undefined;

/** Resolves the API for this environment. Fixtures are loaded only in browser previews. */
export const serversApi = (): Promise<ServersApi> => (native ? Promise.resolve(native) : fixtures());
export const usingFixtures = !nativeServers;

/** Browser fixtures have no native projection cache. Await this before a forced reread. */
export const retireServerReads = (connectionId: ConnectionId): Promise<void> =>
  nativeServers ? retireNativeServerReads(connectionId) : Promise.resolve();
