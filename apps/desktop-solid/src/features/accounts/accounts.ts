import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createEffect, createSignal, onSettled } from 'solid-js';
import { CacheInvalidatedError, RequestCache } from '../../platform/cache/request-cache';

import { startAccountLogin } from './login';
import { takeAccountBootstrap, type Account } from './account-bootstrap';
export type { Account } from './account-bootstrap';

export const ACCOUNT_TYPE_GUEST = 'Guest';

const hasWindow = typeof window !== 'undefined';

// Outside Tauri (the workbench, plain browser) there is no backend: fixtures keep the UI testable.
const fixtures: Account[] = [
  { uuid: '069a79f444e94726a5befca90e38aaf5', username: 'PlayerOne', account_type: 'Microsoft', is_active: true, is_expired: false },
  { uuid: '853c80ef3c3749fdaa49938b674adae6', username: 'AltPlayer', account_type: 'Microsoft', is_active: false, is_expired: false },
  { uuid: 'f84c6a790a4e45e0879bcd49ebd4c4e2', username: 'OldAccount', account_type: 'Microsoft', is_active: false, is_expired: true },
];

const native = hasWindow && isTauri();
const accountCache = new RequestCache<Account[]>({ maxEntries: 1, staleTimeMs: 30_000, retentionMs: 300_000 });
const headCache = new RequestCache<string>({ maxEntries: 128, staleTimeMs: 300_000, retentionMs: 1_800_000 });
const ACCOUNT_KEY = 'account-summaries';

// This injected snapshot is display-only. Never store credentials in frontend caches.
function initialAccounts() {
  if (!native) return undefined;
  try {
    return takeAccountBootstrap(
      (window as Window & { __VESTA_BOOTSTRAP__?: Parameters<typeof takeAccountBootstrap>[0] }).__VESTA_BOOTSTRAP__,
      window.sessionStorage,
    );
  } catch { return undefined; }
}
const bootstrap = initialAccounts();
if (bootstrap) accountCache.seed(ACCOUNT_KEY, bootstrap, false);
const [accounts, setAccounts] = createSignal<Account[]>(native ? bootstrap ?? [] : fixtures, { name: 'accounts' });
const [loaded, setLoaded] = createSignal(!native || !!bootstrap, { name: 'accountsLoaded' });

const [accountsError, setAccountsError] = createSignal(false, { name: 'accountsLoadError' });
export { accounts, accountsError, loaded as accountsLoaded };
export const accountCacheMetrics = () => ({ accounts: { ...accountCache.metrics }, heads: { ...headCache.metrics } });
export const activeAccount = (): Account | undefined => accounts().find((account) => account.is_active) ?? accounts()[0];

/** Explicit refresh invalidates once; routine reads reuse fresh results and concurrent IPC. */
export async function refreshAccounts(force = false): Promise<void> {
  if (!native) return;
  if (force) accountCache.invalidate(ACCOUNT_KEY);
  try {
    await accountCache.read(ACCOUNT_KEY, () => invoke<Account[]>('get_account_summaries'));
  } catch (error) {
    if (!(error instanceof CacheInvalidatedError)) { setAccountsError(true); console.error('Failed to load accounts:', error); }
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
  await refreshAccounts(true);
}

export async function removeAccount(uuid: string): Promise<void> {
  if (!isTauri()) {
    setAccounts((list) => list.filter((account) => account.uuid !== uuid));
    return;
  }
  await invoke('remove_account', { targetUuid: uuid });
  headCache.invalidate(uuid.replaceAll('-', ''), true);
  await refreshAccounts(true);
}

export async function addAccount(): Promise<void> {
  await startAccountLogin();
}

/** Keep all window listeners within the shell lifetime, including late registrations. */
export function useAccountSync() {
  if (!native) return;
  onSettled(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const retain = (stop: () => void) => { if (disposed) stop(); else stops.push(stop); };
    const refresh = () => { if (!disposed) void refreshAccounts(); };
    const completed = () => { if (!disposed) void refreshAccounts(true); };
    window.addEventListener('focus', refresh);
    window.addEventListener('vesta:account-login-complete', completed);
    retain(accountCache.subscribe(ACCOUNT_KEY, (snapshot) => {
      setAccountsError(!!snapshot.error);
      if (snapshot.hasData) { setAccounts(snapshot.data!); setLoaded(true); }
    }));
    // Attach invalidation before the initial read to close the subscription/startup gap.
    void Promise.all([
      listen<{ field: string }>('config-updated', (event) => {
        if (!disposed && event.payload?.field === 'active_account_uuid') void refreshAccounts(true);
      }).then(retain),
      listen('core://accounts-changed', () => {
        if (!disposed) void refreshAccounts(true);
      }).then(retain),
      listen('core://account-heads-updated', () => {
        if (disposed) return;
        headCache.invalidateAll();
        setHeadVersion((version) => version + 1);
      }).then(retain),
    ]).catch((error: unknown) => console.error('Account event subscription failed:', error))
      .finally(refresh);
    return () => {
      disposed = true;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('vesta:account-login-complete', completed);
      stops.forEach((stop) => stop());
    };
  });
}

let headRevision = 0;
const [headVersion, setHeadVersion] = createSignal(0, { name: 'headVersion' });

/** Rust owns/downloads head files. Only their asset URLs are reused here. */
export function usePlayerHead(uuid: () => string | undefined) {
  const [url, setUrl] = createSignal<string | undefined>(undefined, { name: 'headUrl' });
  createEffect(
    () => ({ id: uuid()?.replaceAll('-', ''), version: headVersion() }),
    ({ id }) => {
      if (!id || !native) { setUrl(undefined); return; }
      const stop = headCache.subscribe(id, (snapshot) => setUrl(snapshot.data));
      void headCache.read(id, async () => {
        const path = await invoke<string>('get_player_head_path', { playerUuid: id, forceDownload: false });
        return `${convertFileSrc(path)}?v=${Date.now()}-${++headRevision}`;
      }).catch((error: unknown) => {
        if (!(error instanceof CacheInvalidatedError)) console.error('Failed to load player head:', error);
      });
      return stop;
    },
  );
  return url;
}
