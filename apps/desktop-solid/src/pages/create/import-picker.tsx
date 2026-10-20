import { Checkbox, Select, Skeleton } from '@vesta/ui';
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, untrack } from 'solid-js';
import { Icon } from '../../components/icon';
import { candidateState, loadCandidates, type ImportCandidate, type LauncherSummary } from '../../features/launcher-import';
import { t } from '../../localization';
import './import-picker.css';

/**
 * Pick instances from another launcher, several at a time. A launcher switch (only when more
 * than one was found), a "n of m selected" bar with select all/none, and a compact checklist.
 * Instances that are already in Vesta stay listed but cannot be picked again.
 *
 * The selection is reported upward on every change; the caller owns the import button.
 */
export function ImportPicker(props: {
  launchers: LauncherSummary[];
  onSelection: (launcher: string, candidates: ImportCandidate[]) => void;
}) {
  const [launcher, setLauncher] = createSignal(untrack(() => props.launchers[0]?.id ?? ''), { name: 'importPickerLauncher' });
  const [picked, setPicked] = createSignal<ReadonlySet<string>>(new Set(), { name: 'importPickerPicked' });
  // Scans are preloaded in the background, so the state is usually ready before this opens.
  const state = createMemo(() => candidateState(launcher()), { name: 'importPickerState' });
  const candidates = () => (state().status === 'ready' ? state().candidates ?? [] : undefined);
  const error = () => (state().status === 'error' ? state().error : undefined);
  const seeded = new Set<string>();

  createEffect(
    () => launcher(),
    (id) => {
      // Joins the in-flight preload when there is one; a no-op once cached.
      if (id && untrack(state).status === 'idle') void loadCandidates(id).catch(() => undefined);
    },
  );
  // The first time a launcher's list arrives, start with everything new picked: most people
  // bring their whole launcher across. Later visits keep whatever was chosen.
  createEffect(
    () => ({ id: launcher(), rows: candidates() }),
    ({ id, rows }) => {
      if (!rows || seeded.has(id)) return;
      seeded.add(id);
      setPicked(new Set(rows.filter((row) => !row.alreadyImported).map((row) => row.key)));
    },
  );

  const available = createMemo(() => (candidates() ?? []).filter((row) => !row.alreadyImported), {
    name: 'importPickerAvailable',
  });
  const selection = createMemo(() => available().filter((row) => picked().has(row.key)), {
    name: 'importPickerSelection',
  });
  createEffect(
    () => selection(),
    // Block body: an expression body would hand the caller's return value back as a cleanup.
    (rows) => {
      untrack(() => props.onSelection(launcher(), rows));
    },
  );

  const toggle = (key: string, on: boolean) => {
    const next = new Set(picked());
    if (on) next.add(key);
    else next.delete(key);
    setPicked(next);
  };
  const all = () => available().length > 0 && selection().length === available().length;
  const meta = (row: ImportCandidate) =>
    [row.minecraft, row.loader, row.modCount ? t('import.picker-mods', { count: row.modCount }) : undefined]
      .filter(Boolean)
      .join(' · ');

  return (
    <div data-vesta="import-picker">
      <div data-vesta="import-picker-layout" data-multiple={props.launchers.length > 1 ? '' : undefined}>
      <Show when={props.launchers.length > 1}>
        {/* Launchers as a column beside the list (a dropdown when the space is narrow). */}
        <ul data-vesta="import-picker-launchers" aria-label={t('import.picker-launcher')}>
          <For each={props.launchers}>
            {(item) => (
              <li>
                <button
                  type="button"
                  data-vesta="import-picker-launcher"
                  aria-pressed={launcher() === item.id ? 'true' : 'false'}
                  data-empty={item.instanceCount === 0 ? '' : undefined}
                  onClick={() => setLauncher(item.id)}
                >
                  <Show when={item.icon} fallback={<Icon name="icons/content/cube" size={14} />}>
                    {(icon) => <Icon name={icon()} size={14} />}
                  </Show>
                  <span data-vesta="import-picker-launcher-name" data-tip-overflow>{item.label}</span>
                  <Show when={item.instanceCount !== undefined}>
                    <span data-vesta="import-picker-launcher-count">{item.instanceCount}</span>
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
        <Select
          size="sm"
          class="import-picker-launcher-select"
          aria-label={t('import.picker-launcher')}
          value={launcher()}
          onChange={setLauncher}
          options={props.launchers.map((item) => ({
            value: item.id,
            label: item.instanceCount === undefined ? item.label : `${item.label} (${item.instanceCount})`,
            icon: item.icon ? () => <Icon name={item.icon!} size={14} /> : undefined,
          }))}
        />
      </Show>

      <div data-vesta="import-picker-main">

      <Switch>
        <Match when={error()}>
          {(message) => (
            <p data-vesta="import-picker-message" data-tone="danger" role="alert">
              {message()}
            </p>
          )}
        </Match>
        <Match when={!candidates()}>
          <ul data-vesta="import-picker-list" aria-busy="true">
            <For each={[0, 1, 2]}>
              {() => (
                <li data-vesta="import-picker-row">
                  <Skeleton height={28} />
                </li>
              )}
            </For>
          </ul>
        </Match>
        <Match when={!candidates()!.length}>
          <p data-vesta="import-picker-message">{t('import.picker-empty')}</p>
        </Match>
        <Match when={candidates()}>
          {(rows) => (
            <>
              <div data-vesta="import-picker-bar">
                <span data-vesta="import-picker-count">
                  {t('import.picker-selected', { count: selection().length, total: available().length })}
                </span>
                <Show when={available().length > 1}>
                  <button
                    type="button"
                    data-vesta="import-picker-all"
                    onClick={() => setPicked(all() ? new Set() : new Set(available().map((row) => row.key)))}
                  >
                    {all() ? t('import.picker-none') : t('import.picker-all')}
                  </button>
                </Show>
              </div>
              <ul data-vesta="import-picker-list">
                <For each={rows()} keyed={(row) => row.key}>
                  {(row) => (
                    <li data-vesta="import-picker-row" data-imported={row().alreadyImported ? '' : undefined}>
                      {/* The whole row is the checkbox's label, so it toggles from anywhere. */}
                      <Checkbox
                        class="import-picker-check"
                        checked={row().alreadyImported || picked().has(row().key)}
                        disabled={row().alreadyImported}
                        onChange={(on) => toggle(row().key, on)}
                        label={
                          <span data-vesta="import-picker-entry">
                            <span data-vesta="import-picker-icon" aria-hidden="true">
                              <Show when={row().iconUrl} fallback={<Icon name="icons/content/cube" size={14} />}>
                                {(src) => <img src={src()} alt="" loading="lazy" decoding="async" />}
                              </Show>
                            </span>
                            <span data-vesta="import-picker-text">
                              <span data-vesta="import-picker-name" data-tip-overflow>{row().name}</span>
                              <span data-vesta="import-picker-meta">{meta(row())}</span>
                            </span>
                          </span>
                        }
                      />
                      <Show when={row().alreadyImported}>
                        <span data-vesta="import-picker-badge">{t('import.picker-imported')}</span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </>
          )}
        </Match>
      </Switch>
      </div>
      </div>
    </div>
  );
}
