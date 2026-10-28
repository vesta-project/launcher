import { createEffect, createMemo, Show } from 'solid-js';
import { sameServerTarget, serverInstalledKeys, serverTargetInfo } from '../../features/browse/browse-targets';
import { serverTargetId, updateServerTarget } from '../../features/browse/browse-store';
import { connectionState } from '../../features/browse/install-targets';
import { useServerResource } from '../../features/servers/resources';
import { contentResource } from '../../features/servers/server-resources';
import { serverSnapshot } from '../../features/servers/store';

/**
 * Keeps the store's view of the target server current while Browse or a project page is
 * mounted: its snapshot, and the content inventory for the software and installed marks.
 * Offline servers use the last inventory read, if any, and otherwise report unknown software.
 */
function Sync(props: { id: string }) {
  const snapshot = () => serverSnapshot(props.id);
  const online = createMemo(() => {
    const current = snapshot();
    return !!current && connectionState(current) === 'online';
  }, { name: 'browseServerTargetOnline' });
  const inventory = useServerResource(() => props.id, contentResource, { enabled: online });
  const info = createMemo(
    () => serverTargetInfo(snapshot(), inventory.value(), !online() || !!inventory.error()),
    { name: 'browseServerTargetInfo', equals: sameServerTarget },
  );
  const installed = createMemo(() => inventory.value()?.items, { name: 'browseServerTargetItems' });
  createEffect(
    () => ({ info: info(), items: installed() }),
    ({ info, items }) => updateServerTarget(info, items ? serverInstalledKeys(items) : undefined),
    { name: 'browseServerTargetSync' },
  );
  return null;
}

export function ServerTargetSync() {
  return (
    <Show when={serverTargetId()} keyed>
      {(id) => <Sync id={id} />}
    </Show>
  );
}
