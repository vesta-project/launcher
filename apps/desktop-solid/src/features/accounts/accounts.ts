import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createEffect, createSignal, onCleanup } from 'solid-js';

/** The slice of the backend's Account the shell needs. */
export interface Account {
  uuid: string;
  username: string;
  account_type: string;
  is_active: boolean;
  is_expired: boolean;
}

export const ACCOUNT_TYPE_GUEST = 'Guest';

const hasWindow = typeof window !== 'undefined';

// Outside Tauri (the workbench, plain browser) there is no backend: fixtures keep the UI testable.
const fixtures: Account[] = [
  { uuid: '069a79f444e94726a5befca90e38aaf5', username: 'PlayerOne', account_type: 'Microsoft', is_active: true, is_expired: false },
  { uuid: '853c80ef3c3749fdaa49938b674adae6', username: 'AltPlayer', account_type: 'Microsoft', is_active: false, is_expired: false },
  { uuid: 'f84c6a790a4e45e0879bcd49ebd4c4e2', username: 'OldAccount', account_type: 'Microsoft', is_active: false, is_expired: true },
];

const [accounts, setAccounts] = createSignal<Account[]>(hasWindow && isTauri() ? [] : fixtures, { name: 'accounts' });
const [loaded, setLoaded] = createSignal(!(hasWindow && isTauri()), { name: 'accountsLoaded' });

export { accounts, loaded as accountsLoaded };

export const activeAccount = (): Account | undefined => accounts().find((account) => account.is_active) ?? accounts()[0];

/** Fetch accounts from the backend. Safe to call repeatedly. */
export async function refreshAccounts(): Promise<void> {
  if (!isTauri()) return;
  try {
    setAccounts(await invoke<Account[]>('get_accounts'));
  } catch (error) {
    console.error('Failed to load accounts:', error);
  } finally {
    setLoaded(true);
  }
}

export async function switchAccount(uuid: string): Promise<void> {
  if (!isTauri()) {
    setAccounts((list) => list.map((account) => ({ ...account, is_active: account.uuid === uuid })));
    return;
  }
  await invoke('set_active_account', { targetUuid: uuid });
  await refreshAccounts();
}

export async function removeAccount(uuid: string): Promise<void> {
  if (!isTauri()) {
    setAccounts((list) => list.filter((account) => account.uuid !== uuid));
    return;
  }
  await invoke('remove_account', { targetUuid: uuid });
  await refreshAccounts();
}

export async function addAccount(): Promise<void> {
  if (isTauri()) await invoke('start_login');
}

/** Keep the list fresh while the shell is mounted. Call once from the shell. */
export function useAccountSync() {
  if (!hasWindow || !isTauri()) return;
  void refreshAccounts();
  const stops: (() => void)[] = [];
  onCleanup(() => stops.forEach((stop) => stop()));
  void listen<{ field: string }>('config-updated', (event) => {
    if (event.payload?.field === 'active_account_uuid') void refreshAccounts();
  }).then((stop) => stops.push(stop));
}

const [headVersion, setHeadVersion] = createSignal(0, { name: 'headVersion' });
if (hasWindow && isTauri()) {
  void listen('core://account-heads-updated', () => setHeadVersion((version) => version + 1));
}

/**
 * URL of a player's head image, or undefined while loading or when unavailable.
 * The backend downloads and caches heads; the file is served through the asset protocol.
 */
export function usePlayerHead(uuid: () => string | undefined) {
  const [url, setUrl] = createSignal<string | undefined>(undefined, { name: 'headUrl' });

  let latest = 0;
  const load = async (id: string | undefined, version: number) => {
    const request = ++latest;
    if (!id || !isTauri()) return setUrl(undefined);
    try {
      const path = await invoke<string>('get_player_head_path', { playerUuid: id, forceDownload: false });
      // A newer request started while this one was in flight; drop the stale result.
      if (request === latest) setUrl(`${convertFileSrc(path)}?t=${version}`);
    } catch (error) {
      console.error('Failed to load player head:', error);
      if (request === latest) setUrl(undefined);
    }
  };

  createEffect(
    () => ({ id: uuid(), version: headVersion() }),
    ({ id, version }) => {
      void load(id, version);
    },
  );

  return url;
}
