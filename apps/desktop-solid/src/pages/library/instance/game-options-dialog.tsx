import { Button, Dialog, SegmentedControl, Skeleton, TextField } from '@vesta/ui';
import { Show, createMemo, createSignal, onCleanup, onSettled, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { VirtualList } from '../../../components/virtual-list';
import { createGameOptionsEditor, gameOptionsAdapter, type GameOptionsMode } from '../../../features/instances/game-options';
import { UNBOUND_KEY } from '../../../features/settings/minecraft-keys';
import { formatOptionName } from '../../../features/settings/sync-model';
import { t } from '../../../localization';
import { SyncValueControl } from '../../settings/sections/sync-value';
import '../../settings/sections/sync.css';
import './game-options-dialog.css';

export function GameOptionsDialog(props: { id: string; name: string; disabled: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [mode, setMode] = createSignal<GameOptionsMode>('options', { name: 'instanceGameOptionsMode' });
  return <Dialog title={t('instance-settings.minecraft-options')} description={props.name} closeLabel={t('nav.close')}
    class="game-options-dialog" size="lg" open={props.open} onOpenChange={props.onOpenChange}>
    <Show when={props.open}>
      <Show when={mode()} keyed>{(current) => <Editor id={props.id} mode={current} disabled={props.disabled}
        tabs={<SegmentedControl size="sm" aria-label={t('prefs.sync.sections')} value={mode()} onChange={(value) => setMode(value as GameOptionsMode)}
          options={[{ value: 'options', label: t('prefs.sync.options') }, { value: 'keybinds', label: t('prefs.sync.keybinds') }]} />} />}</Show>
    </Show>
  </Dialog>;
}

function Editor(props: { id: string; mode: GameOptionsMode; disabled: boolean; tabs: import('@solidjs/web').JSX.Element }) {
  const editor = createGameOptionsEditor(untrack(() => props.id), untrack(() => props.mode), gameOptionsAdapter);
  const [search, setSearch] = createSignal('', { name: 'instanceGameOptionsSearch' });
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set(), { name: 'instanceGameOptionsGroups' });
  const [scroller, setScroller] = createSignal<HTMLElement>();
  onSettled(() => { void editor.load(); });
  onCleanup(editor.dispose);
  const items = createMemo(() => editor.items());
  const dirty = () => Object.keys(editor.changes()).length > 0;
  const groups = createMemo(() => {
    const map = new Map<string, ReturnType<typeof items>>();
    for (const item of items()) map.set(item.group, [...(map.get(item.group) ?? []), item]);
    const needle = search().trim().toLowerCase();
    return [...map].map(([group, members]) => ({ group, members: members.filter((item) => !needle || `${item.label} ${item.key}`.toLowerCase().includes(needle)) })).filter((group) => group.members.length);
  });
  const isOpen = (group: string) => !!search().trim() || groups().length === 1 || expanded().has(group);
  const rows = createMemo(() => groups().flatMap(({ group, members }) => [
    { key: `group:${group}`, group, item: undefined },
    ...(isOpen(group) ? members.map((item) => ({ key: item.key, group, item })) : []),
  ]));
  const conflicts = createMemo(() => {
    const counts = new Map<string, number>();
    if (props.mode === 'keybinds') for (const item of items())
      if (item.group !== 'other' && item.value !== UNBOUND_KEY) counts.set(item.value, (counts.get(item.value) ?? 0) + 1);
    return counts;
  });
  return <div data-vesta="game-options-editor">
    <div data-vesta="prefs-sync-toolbar">
      <fieldset disabled={dirty() || editor.pending()} data-vesta="game-options-tabs">{props.tabs}</fieldset>
      <TextField size="sm" aria-label={t('prefs.sync.search-values')} placeholder={t('prefs.sync.search-values')}
        icon={<Icon name="icons/content/search" size={14} />} value={search()} onChange={setSearch} />
    </div>
    <Show when={props.disabled}><p data-vesta="game-options-hint">{t('instance-options.idle')}</p></Show>
    <Show when={editor.error()}>{(error) => <p role="alert" data-vesta="settings-feedback">{error()}</p>}</Show>
    <Show when={editor.snapshot()} fallback={<Show when={editor.pending()} fallback={<Button variant="outline" onClick={() => void editor.load()}>{t('common.retry')}</Button>}><Skeleton height={180} /></Show>}>
      <Show when={!editor.snapshot()!.exists}><p data-vesta="game-options-hint">{t('instance-options.missing')}</p></Show>
      <div data-vesta="prefs-sync-list" ref={setScroller}>
        <Show when={rows().length} fallback={<p data-vesta="prefs-sync-none">{t('prefs.sync.no-values')}</p>}>
          <VirtualList items={rows()} key={(row) => row.key} rowHeight={40} scrollElement={scroller()}>
            {(row) => <Show when={row().item} fallback={<div data-vesta="prefs-sync-group" data-open={isOpen(row().group) ? '' : undefined}>
              <button type="button" aria-expanded={isOpen(row().group) ? 'true' : 'false'} onClick={() => setExpanded((current) => { const next = new Set(current); if (!next.delete(row().group)) next.add(row().group); return next; })}>
                <strong>{row().group === 'custom' ? t('prefs.sync.group-custom') : formatOptionName(row().group)}</strong>
                <Icon name="icons/controls/chevron-down" size={14} class="prefs-sync-chevron" />
              </button>
            </div>}>
              {(item) => <div data-vesta="prefs-sync-row">
                <span data-vesta="prefs-sync-label" data-tip={item().key}>{item().label}</span>
                <SyncValueControl item={item()} disabled={props.disabled || editor.pending()} conflict={item().group !== 'other' && (conflicts().get(item().value) ?? 0) > 1}
                  onSave={(value) => editor.change(item().key, value)} />
              </div>}
            </Show>}
          </VirtualList>
        </Show>
      </div>
      <footer data-vesta="game-options-actions">
        <span role="status">{dirty() ? t('instance-options.unsaved') : ''}</span>
        <Button size="sm" variant="outline" disabled={editor.pending()} onClick={() => void editor.load()}>{t('instance-options.reload')}</Button>
        <Button size="sm" tone="accent" disabled={!dirty() || props.disabled || editor.pending()} onClick={() => void editor.save()}>{t('instance-settings.save')}</Button>
      </footer>
    </Show>
  </div>;
}
