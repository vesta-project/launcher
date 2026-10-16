/** Display data only. Authentication and launch decisions remain in Rust. */
export interface Account {
  uuid: string;
  username: string;
  account_type: string;
  is_active: boolean;
  is_expired: boolean;
}

interface AccountBootstrap {
  snapshot_id?: string;
  account_summaries?: Account[] | null;
}

/** Native initialization scripts replay on reload. Consume each window snapshot once
 * so a reload cannot resurrect an account removed since window creation.
 */
export function takeAccountBootstrap(
  bootstrap: AccountBootstrap | undefined,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): Account[] | undefined {
  const key = 'vesta:account-bootstrap';
  if (!bootstrap?.snapshot_id || !Array.isArray(bootstrap.account_summaries)) return undefined;
  try {
    if (storage.getItem(key) === bootstrap.snapshot_id) return undefined;
    storage.setItem(key, bootstrap.snapshot_id);
    return bootstrap.account_summaries;
  } catch {
    // If session storage is unavailable, prefer a current IPC read to a replayed snapshot.
    return undefined;
  }
}
