import { Button, Dialog } from '@vesta/ui';
import { createEffect, createMemo, createSignal, Show, untrack } from 'solid-js';
import { Notice, noticeCause } from '../../../components/notice';
import { projectPath, type ResourceProject } from '../../../features/browse/browse-model';
import { loadProject } from '../../../features/browse/browse-projects';
import { loadInstanceServerStatus, serverLinkOf, unlinkInstanceServer } from '../../../features/browse/server-links';
import type { InstanceServerStatus } from '../../../features/browse/server-listing';
import type { LinkedPack, PackRelease } from '../../../features/instances/versions';
import { t } from '../../../localization';

/** What a pack card shows instead of the pack when it follows a server listing. */
export interface ListingIdentity {
  name: string;
  icon: string | null;
  /** The listing's project page. */
  path: string;
}

/**
 * The Modrinth server listing an instance follows: the link (from the record), the listing's
 * project (name, icon, live ping; shared Browse cache) and the host status (pack update state).
 * Everything is undefined while the instance has no link.
 */
export function useModrinthServer(instanceId: string) {
  const link = createMemo(() => serverLinkOf(instanceId), {
    name: 'instance:server-link',
    equals: (a, b) => a?.projectId === b?.projectId && a?.address === b?.address,
  });
  const [project, setProject] = createSignal<ResourceProject | undefined>(undefined, { name: 'instance:server-project' });
  const [status, setStatus] = createSignal<InstanceServerStatus | null | undefined>(undefined, {
    name: 'instance:server-status',
  });
  const [error, setError] = createSignal<unknown>(undefined, { name: 'instance:server-error' });
  const [attempt, setAttempt] = createSignal(0, { name: 'instance:server-attempt' });

  // The host keeps the link outside the instance record: the status is how it is known at all.
  createEffect(
    () => ({ projectId: link()?.projectId, attempt: attempt() }),
    ({ attempt: tries }) => {
      setError(undefined);
      let live = true;
      loadInstanceServerStatus(instanceId, tries > 0).then(
        (found) => live && setStatus(found),
        (reason) => live && setError(reason),
      );
      return () => {
        live = false;
      };
    },
    { name: 'instance:server-status-load' },
  );
  // The listing project is optional decoration (name, icon); a failure leaves the address.
  createEffect(
    () => link()?.projectId,
    (projectId) => {
      setProject(undefined);
      if (!projectId) return;
      let live = true;
      loadProject('modrinth', projectId).then(
        (found) => live && setProject(found),
        () => undefined,
      );
      return () => {
        live = false;
      };
    },
    { name: 'instance:server-project-load' },
  );

  const identity = createMemo(
    (): ListingIdentity | undefined => {
      const current = link();
      if (!current) return undefined;
      const found = project();
      return {
        name: found?.name ?? current.address,
        icon: found?.icon_url ?? null,
        path: projectPath('modrinth', current.projectId),
      };
    },
    { name: 'instance:server-identity' },
  );
  /** The latest ping: the host's cached one, else the listing's. */
  const ping = () => status()?.ping ?? project()?.server?.ping ?? null;

  return { link, project, status, error, identity, ping, retry: () => setAttempt((count) => count + 1) };
}

export type ModrinthServer = ReturnType<typeof useModrinthServer>;

/**
 * The pack release a server-linked instance should move to: the listing's own pack version when
 * it differs from the installed one. Newer releases the listing has not adopted are not offered.
 */
export function serverUpdateTarget(pack: LinkedPack, status: InstanceServerStatus | null | undefined): PackRelease | undefined {
  const id = status?.versionId;
  if (!id || id === pack.installed) return undefined;
  return pack.releases.find((release) => release.id === id);
}

/** Unlink offers one thing for a listing: keep the instance and its content, drop the link. */
export function ServerUnlinkDialog(props: { instanceId: string; name: string; open: boolean; onClose: () => void }) {
  const [busy, setBusy] = createSignal(false, { name: 'instance:server-unlink-busy' });
  const [error, setError] = createSignal<unknown>(undefined, { name: 'instance:server-unlink-error' });
  const confirm = async () => {
    if (untrack(busy)) return;
    setBusy(true);
    setError(undefined);
    try {
      await unlinkInstanceServer(props.instanceId);
      props.onClose();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      closeLabel={t('nav.close')}
      size="sm"
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          setError(undefined);
          props.onClose();
        }
      }}
      title={t('instance-pack.unlink-server-title', { name: props.name })}
      description={t('instance-pack.unlink-server-description')}
      footer={
        <>
          <Button variant="ghost" onClick={() => props.onClose()}>
            {t('common.cancel')}
          </Button>
          <Button tone="accent" disabled={busy()} data-busy={busy() ? '' : undefined} onClick={() => void confirm()}>
            {t('instance-pack.unlink-server-confirm')}
          </Button>
        </>
      }
    >
      <Show when={error()}>
        {(reason) => (
          <Notice variant="inline" cause={noticeCause(reason())} details={String(reason())}>
            {t('instance-pack.unlink-server-failed')}
          </Notice>
        )}
      </Show>
    </Dialog>
  );
}
