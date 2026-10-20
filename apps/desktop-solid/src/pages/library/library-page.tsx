import { For, Show, createEffect, createMemo, createSignal, onCleanup, onSettled } from 'solid-js';
import { Button, toast } from '@vesta/ui';
import { EmptyState } from '../../components/empty-state';
import { t } from '../../localization';
import { nativeInstances, nativeRecord, instancePending, instancesLoaded } from '../../features/instances/native-service';
import { NativeExportDialog } from "../../features/instances/native-export-dialog";
import { Board } from '../../components/board';
import { instances, playInstance, retryInstance, type InstanceEntry } from '../../features/instances/catalog';
import { InstanceCard } from '../../features/instances/instance-card';
import type { InstanceArrangeActions } from '../../features/instances/action-menu';
import {
  beginLibraryArrange, containerOf, createGroup, customOrder, endLibraryArrange, groupMembers, isGroupEntry,
  libraryArranging, libraryLayoutStore, moveEntry, recolorGroup, renameGroup, sameEntries, ungroup,
  type LibraryEntry, type LibraryGroup,
} from '../../features/instances/library-layout';
import { beforeForIndex, keyboardMoveKeys } from '../../features/instances/library-arrange';
import { createKeyboardMove, createLibraryDrag, flipItems, type LibraryDrag } from '../../features/instances/library-drag';
import { LibraryFolderPopup, LibraryFolderTile } from '../../features/instances/library-folder';
import { watchFileDragOverGroups } from '../../features/instances/library-file-drag';
import { getDropController } from '../../features/file-drop/native-bridge';
import { route } from '../../app/router';
import { transitionTo } from '../../app/transition';
import { InstancePage } from './instance/instance-page';
import './library-page.css';
import { useNativeDropZone } from '../../features/file-drop/zone';
import { importNativePaths } from '../../features/instances/native-import-dialog';

const store = libraryLayoutStore;

/** What every library item needs from the grid; plain functions so items stay cheap. */
interface LibraryContext {
  byId: () => Map<string, InstanceEntry>;
  groups: () => Map<string, LibraryGroup>;
  ids: () => readonly string[];
  drag: LibraryDrag;
  openGroup: () => string | null;
  toggleGroup: (id: string) => void;
  fileHoverGroup: () => string | null;
  moving: () => LibraryEntry | null;
  startKeyboardMove: (entry: LibraryEntry, key?: string) => void;
  arrange: (entry: LibraryEntry) => InstanceArrangeActions;
  editGroup: (id: string) => void;
  ungroup: (id: string) => void;
}

/**
 * One card. Each rendered card is a native drop target ahead of the scene's untargeted
 * fallback, except while arranging, when the card is carried instead.
 */
function LibraryInstanceItem(props: { id: string; context: LibraryContext }) {
  let card: HTMLElement | undefined;
  const entry = () => props.context.byId().get(props.id);
  useNativeDropZone({
    element: () => card?.querySelector<HTMLElement>('[data-vesta="instance-card"]') ?? undefined,
    accept: 'files',
    extensions: ['.jar', '.zip'],
    disabled: () => libraryArranging() || instancePending(props.id) || ['installing', 'pending', 'verifying-runtime', 'launch-preflight-repair']
      .includes(nativeRecord(props.id)?.installationStatus ?? ''),
    hint: () => t('drop.add-to'),
    drop: (paths) => { void importNativePaths(props.id, paths); },
  });
  const open = (to: string) => {
    if (!props.context.drag.suppressClick()) transitionTo(to, props.id);
  };
  const grouping = () => props.context.drag.groupTarget() === props.id ? 'active'
    : props.context.drag.groupPending() === props.id ? 'pending' : undefined;
  return (
    <li
      data-library-item={props.id}
      data-dragging={props.context.drag.dragging() === props.id ? '' : undefined}
      data-moving={props.context.moving() === props.id ? '' : undefined}
      onPointerDown={(event) => { if (libraryArranging()) props.context.drag.pointerDown(event, props.id); }}
    >
      <div
        ref={(element) => { card = element; }}
        data-vesta="library-card-slot"
        inert={libraryArranging() || undefined}
        data-drop-target={grouping() === 'active' ? 'active' : undefined}
        data-drop-hint={grouping() === 'active' ? t('library.release-to-group') : undefined}
        data-drop-invite={grouping() === 'pending' ? '' : undefined}
      >
        <Show when={entry()}>
          {(current) => (
            <InstanceCard
              instance={current().instance}
              state={current().state}
              pending={instancePending(props.id)}
              arrange={props.context.arrange(props.id)}
              onOpen={() => open(`/library/${props.id}`)}
              onOpenCrash={() => open(`/library/${props.id}/crash`)}
              onPlay={() => playInstance(props.id)}
              onRetry={() => retryInstance(props.id, 'Installing')}
              onResume={() => retryInstance(props.id, 'Resuming')}
            />
          )}
        </Show>
      </div>
      <Show when={libraryArranging()}>
        <button
          type="button"
          data-vesta="library-handle"
          data-library-control
          aria-label={t('library.move-handle', { name: entry()?.instance.name ?? '' })}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ' && !keyboardMoveKeys.has(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            props.context.startKeyboardMove(props.id, keyboardMoveKeys.has(event.key) ? event.key : undefined);
          }}
        />
      </Show>
    </li>
  );
}

function LibraryFolderItem(props: { id: string; context: LibraryContext }) {
  const group = () => props.context.groups().get(props.id);
  const members = () => {
    const current = group();
    if (!current) return [];
    const byId = props.context.byId();
    return groupMembers(current, new Set(props.context.ids())).flatMap((id) => byId.get(id)?.instance ?? []);
  };
  const dropState = () => props.context.drag.folderTarget() === props.id ? 'ready' as const
    : props.context.fileHoverGroup() === props.id ? 'pending' as const : undefined;
  return (
    <li
      data-library-item={props.id}
      data-dragging={props.context.drag.dragging() === props.id ? '' : undefined}
      data-moving={props.context.moving() === props.id ? '' : undefined}
      onPointerDown={(event) => { if (libraryArranging()) props.context.drag.pointerDown(event, props.id); }}
    >
      <Show when={group()}>
        {(current) => (
          <LibraryFolderTile
            group={current()}
            members={members()}
            open={props.context.openGroup() === props.id}
            arranging={libraryArranging()}
            dropState={dropState()}
            actions={props.context.arrange(props.id)}
            onEdit={() => props.context.editGroup(props.id)}
            onUngroup={() => props.context.ungroup(props.id)}
            onOpen={() => { if (!props.context.drag.suppressClick()) props.context.toggleGroup(props.id); }}
            onKeyDown={(event) => {
              if (!libraryArranging() || !keyboardMoveKeys.has(event.key)) return;
              event.preventDefault();
              props.context.startKeyboardMove(props.id, event.key);
            }}
          />
        )}
      </Show>
    </li>
  );
}

function LibraryItem(props: { id: string; context: LibraryContext }) {
  return (
    <Show when={isGroupEntry(props.id)} fallback={<LibraryInstanceItem id={props.id} context={props.context} />}>
      <LibraryFolderItem id={props.id} context={props.context} />
    </Show>
  );
}

/**
 * The library grid: instances and groups in the remembered order. Arranging, grouping and
 * keyboard moves change it; it is saved once per finished change.
 */
function LibraryGrid() {
  onSettled(() => { void store.load(); });
  const ids = createMemo(() => instances().map((entry) => entry.instance.id), { name: 'libraryInstanceIds', equals: sameEntries });
  const byId = createMemo(() => new Map(instances().map((entry) => [entry.instance.id, entry])), { name: 'libraryInstanceMap' });
  const groups = createMemo(() => new Map(store.layout().groups.map((group) => [group.id, group])), { name: 'libraryGroups' });
  const entries = createMemo(() => customOrder(store.layout(), ids()), { name: 'libraryEntries', equals: sameEntries });

  // Groups lose instances that were deleted, but only against an authoritative list.
  createEffect(
    () => (store.loaded() && (!nativeInstances || instancesLoaded()) ? ids() : undefined),
    (list) => { if (list) store.reconcile(list); },
    { name: 'libraryReconcile' },
  );

  const [openGroup, setOpenGroup] = createSignal<string | null>(null, { name: 'libraryOpenGroup' });
  const [announcement, setAnnouncement] = createSignal('', { name: 'libraryAnnouncement' });
  const [fileHoverGroup, setFileHoverGroup] = createSignal<string | null>(null, { name: 'libraryFileHoverGroup' });
  const [moving, setMoving] = createSignal<LibraryEntry | null>(null, { name: 'libraryKeyboardMoving' });
  const nameOf = (entry: LibraryEntry) => byId().get(entry)?.instance.name ?? groups().get(entry)?.name ?? '';
  const toggleGroup = (id: string) => setOpenGroup((current) => (current === id ? null : id));

  // A group that no longer exists cannot stay open.
  createEffect(
    () => { const id = openGroup(); return id !== null && !groups().has(id); },
    (gone) => { if (gone) setOpenGroup(null); },
  );

  const drag = createLibraryDrag({
    store,
    instanceIds: ids,
    openGroup,
    setOpenGroup,
    announce: setAnnouncement,
    messages: {
      groupCreated: () => t('library.group-created'),
      moved: (entry) => t('library.moved', { name: nameOf(entry) }),
      movedOut: (entry) => t('library.moved-out', { name: nameOf(entry) }),
      cancelled: () => t('library.move-cancelled'),
      newGroupName: () => t('library.new-group'),
    },
  });
  onCleanup(() => drag.dispose());

  // Files held over a group open it; disabled while arranging, when card drops are off too.
  onSettled(() => {
    if (!nativeInstances) return;
    return watchFileDragOverGroups({
      controller: getDropController(),
      getOpenGroup: openGroup,
      setOpenGroup,
      isEnabled: () => !libraryArranging(),
      onHoverGroup: setFileHoverGroup,
      onDropOnClosedGroup: () => toast.show({
        title: t('library.open-group-first'),
        description: t('library.open-group-first-description'),
        tone: 'neutral',
      }),
    });
  });

  const focusEntry = (entry: LibraryEntry) => requestAnimationFrame(() => {
    const item = document.querySelector(`[data-library-item="${CSS.escape(entry)}"]`);
    item?.querySelector<HTMLElement>('[data-vesta="library-handle"], [data-vesta="instance-card"], [data-vesta="library-folder"]')?.focus();
  });

  const keyboard = createKeyboardMove({
    store,
    instanceIds: ids,
    onStep: (_entry, position, count) => setAnnouncement(t('library.keyboard-position', { value: position, total: count })),
  });
  const stopKeyboard = () => {
    window.removeEventListener('keydown', onKeyboardKey, true);
    window.removeEventListener('pointerdown', onKeyboardPointer, true);
    setMoving(null);
  };
  /** Captured on the window so the card's own Enter/Space never opens it mid-move. */
  function onKeyboardKey(event: KeyboardEvent) {
    const entry = keyboard.active();
    if (!entry) return;
    if (event.key === 'Tab') {
      keyboard.commit();
      stopKeyboard();
      setAnnouncement(t('library.keyboard-placed', { name: nameOf(entry) }));
      return;
    }
    const container = containerOf(store.layout(), entry);
    if (!keyboard.key(event.key, (change) => flipItems(container, change))) return;
    event.preventDefault();
    event.stopPropagation();
    if (!keyboard.active()) {
      stopKeyboard();
      setAnnouncement(event.key === 'Escape' ? t('library.move-cancelled') : t('library.keyboard-placed', { name: nameOf(entry) }));
    }
    // Moving a node in the DOM drops its focus; put it back.
    focusEntry(entry);
  }
  function onKeyboardPointer() {
    keyboard.commit();
    stopKeyboard();
  }
  const startKeyboardMove = (entry: LibraryEntry, key?: string) => {
    if (keyboard.active()) keyboard.commit();
    keyboard.start(entry);
    setMoving(entry);
    window.addEventListener('keydown', onKeyboardKey, true);
    window.addEventListener('pointerdown', onKeyboardPointer, true);
    setAnnouncement(t('library.keyboard-start', { name: nameOf(entry) }));
    focusEntry(entry);
    if (key) onKeyboardKey(new KeyboardEvent('keydown', { key }));
  };
  onCleanup(() => {
    keyboard.commit();
    stopKeyboard();
    endLibraryArrange();
  });

  /** One saved step, animated, for the menu actions. */
  const step = (entry: LibraryEntry, change: (layout: ReturnType<typeof store.layout>) => ReturnType<typeof store.layout>) => {
    flipItems(containerOf(store.layout(), entry), () => store.update(change));
    setAnnouncement(t('library.moved', { name: nameOf(entry) }));
  };
  const siblings = (entry: LibraryEntry) => {
    const layout = store.layout();
    const container = containerOf(layout, entry);
    return container === null ? entries() : layout.groups.find((group) => group.id === container)?.instances ?? [];
  };
  const shift = (entry: LibraryEntry, direction: -1 | 1) => {
    const list = siblings(entry);
    const index = list.indexOf(entry) + direction;
    if (index < 0 || index >= list.length) return;
    const present = ids();
    step(entry, (layout) => moveEntry(layout, present, entry, containerOf(layout, entry), beforeForIndex(list, entry, index)));
  };
  const arrange = (entry: LibraryEntry): InstanceArrangeActions => ({
    canMoveEarlier: () => siblings(entry).indexOf(entry) > 0,
    canMoveLater: () => { const list = siblings(entry); const index = list.indexOf(entry); return index >= 0 && index < list.length - 1; },
    moveEarlier: () => shift(entry, -1),
    moveLater: () => shift(entry, 1),
    group: () => containerOf(store.layout(), entry),
    groups: () => store.layout().groups.filter((group) => !group.instances.includes(entry)).map(({ id, name }) => ({ id, name })),
    moveToGroup: (id) => {
      const present = ids();
      step(entry, (layout) => moveEntry(layout, present, entry, id, null));
    },
    newGroup: () => {
      const present = ids();
      flipItems(null, () => store.update((layout) => createGroup(layout, present, [entry], `group:${crypto.randomUUID()}`, t('library.new-group'))));
      setAnnouncement(t('library.group-created'));
    },
    moveWithKeyboard: () => startKeyboardMove(entry),
    arrangeLibrary: () => beginLibraryArrange(ids()),
  });

  // Entering and leaving arrange mode is announced; Escape leaves it when nothing else is open.
  createEffect(libraryArranging, (arranging, previous) => {
    if (previous === undefined && !arranging) return;
    setAnnouncement(arranging ? t('library.arranging') : t('library.arrange-saved'));
    if (!arranging) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || drag.dragging() !== null || keyboard.active() || openGroup() !== null) return;
      event.preventDefault();
      endLibraryArrange();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const context: LibraryContext = {
    byId, groups, ids, drag, openGroup, toggleGroup, fileHoverGroup, moving,
    startKeyboardMove, arrange,
    editGroup: (id) => { beginLibraryArrange(ids()); setOpenGroup(id); },
    ungroup: (id) => {
      const name = nameOf(id);
      const present = ids();
      const first = groups().get(id)?.instances.find((member) => present.includes(member));
      flipItems(null, () => store.update((layout) => ungroup(layout, present, id)));
      setAnnouncement(t('library.ungrouped', { name }));
      if (first) focusEntry(first);
    },
  };

  const openGroupData = () => { const id = openGroup(); return id === null ? undefined : groups().get(id); };

  return (
    <>
      <ul data-vesta="library-grid" data-library-surface="main" data-arranging={libraryArranging() ? '' : undefined}>
        <For each={entries()}>
          {(entry) => <LibraryItem id={entry} context={context} />}
        </For>
      </ul>
      <Show when={openGroupData() ? openGroup() : undefined} keyed>
        {(id) => {
          const group = () => groups().get(id);
          const members = createMemo(() => { const current = group(); return current ? groupMembers(current, new Set(ids())) : []; },
            { name: 'libraryOpenGroupMembers', equals: sameEntries });
          return (
            <Show when={group()}>
              {(current) => (
                <LibraryFolderPopup
                  group={current()}
                  count={members().length}
                  arranging={libraryArranging()}
                  onClose={() => setOpenGroup(null)}
                  onRename={(name) => store.update((layout) => renameGroup(layout, id, name))}
                  onRecolor={(hue) => store.update((layout) => recolorGroup(layout, id, hue))}
                >
                  <ul data-vesta="library-grid" data-library-surface={id} data-arranging={libraryArranging() ? '' : undefined}>
                    <For each={members()}>
                      {(entry) => <LibraryInstanceItem id={entry} context={context} />}
                    </For>
                  </ul>
                </LibraryFolderPopup>
              )}
            </Show>
          );
        }}
      </Show>
      <Show when={libraryArranging()}>
        <div data-vesta="library-arrange-bar">
          <span data-vesta="library-arrange-hint">{t('library.arrange-hint')}</span>
          <Button size="sm" tone="accent" onClick={() => endLibraryArrange()}>{t('library.arrange-done')}</Button>
        </div>
      </Show>
      <Show when={store.saveError()}>
        <p data-vesta="library-save-error" role="alert">{t('library.save-error')}</p>
      </Show>
      <span data-vesta="library-announcer" role="status" aria-live="polite">{announcement()}</span>
    </>
  );
}

/** Library: the instance grid, or one instance when the route names it. */
export function LibraryPage() {
  return (
    <>
      <Show when={route().section} keyed fallback={
        <Board>
          <Show when={!nativeInstances || instancesLoaded()} fallback={<p role="status">{t('management.loading')}</p>}>
          <Show when={instances().length > 0} fallback={<>
            <EmptyState icon="icons/rail/library" title={t('management.empty')} description={t('management.empty-description')} />
            <Button tone="accent" onClick={() => transitionTo('/create')}>{t('management.create')}</Button>
          </>}>
            <LibraryGrid />
          </Show></Show>
        </Board>
      }>
        {(id) => <InstancePage id={id} />}
      </Show>
      <NativeExportDialog />
    </>
  );
}
