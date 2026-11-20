// Memory for a server on a Vesta Server, in the instance install page's card: the chosen amount
// and the suggestion side by side, then Edit for the slider. The slider runs from 512 MB to
// the most one server can have on the machine. Going above what other servers leave free is
// allowed (a stopped server uses none), so it is said softly, never blocked.
import { Button, Slider } from '@vesta/ui';
import { Show, createSignal, untrack } from 'solid-js';
import { formatNumber, t } from '../../localization';
import { clampMemory, formatMemory, memoryOverFree, memoryRange, type ResourceCheck } from '../../features/servers/host-add-model';
import '../create/memory-card.css';

export function ServerMemoryCard(props: {
  machine: string;
  value: number;
  onChange: (value: number) => void;
  /** What the machine suggested, shown beside the chosen amount; null when it couldn't say. */
  suggested: number | null;
  resources: ResourceCheck | null;
  /** Open on the slider, e.g. when review sent the person back to change memory. */
  startOpen?: boolean;
}) {
  const [editing, setEditing] = createSignal(untrack(() => !!props.startOpen), { name: 'server-memory:editing' });
  const [unit, setUnit] = createSignal<'MB' | 'GB'>('GB', { name: 'server-memory:unit' });
  const range = () => memoryRange(props.resources);
  const shown = () => clampMemory(props.value, range());
  const format = (mib: number) =>
    `${formatNumber(unit() === 'MB' ? mib : mib / 1024, { maximumFractionDigits: unit() === 'MB' ? 0 : 1 })} ${unit()}`;
  const free = () => props.resources?.availableMiB ?? null;
  const over = () => memoryOverFree(shown(), props.resources);

  return (
    <section data-vesta="install-memory-card" data-server-memory data-editing={editing() ? '' : undefined}>
      <header>
        <div>
          <h2>{t('instance-settings.memory')}</h2>
          <p>
            {free() !== null
              ? t('server-add.memory.free', { value: formatMemory(Math.max(0, free()!)), name: props.machine })
              : t('server-add.memory.unknown', { name: props.machine })}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing(!editing())} aria-expanded={editing() ? 'true' : 'false'}>
          {t(editing() ? 'install.hide-controls' : 'common.edit')}
        </Button>
      </header>
      <Show
        when={editing()}
        fallback={
          <div data-vesta="memory-comparison">
            <div data-selected>
              <span>{t('server-add.memory.chosen')}</span>
              <button type="button" data-tip={t('install.toggle-memory-unit')} aria-label={t('install.toggle-memory-unit')}
                onClick={() => setUnit(unit() === 'MB' ? 'GB' : 'MB')}>
                {format(shown())}
              </button>
            </div>
            <Show when={props.suggested} fallback={
              <div>
                <span>{t('server-add.memory.most-label')}</span>
                <strong>{formatMemory(range().max)}</strong>
              </div>
            }>
              {(suggested) => (
                <div>
                  <span>{t('install.suggested-memory')}</span>
                  <strong>{formatMemory(suggested())}</strong>
                </div>
              )}
            </Show>
          </div>
        }
      >
        <div data-vesta="memory-controls">
          <div data-vesta="memory-readout">
            <strong>{format(shown())}</strong>
            <span>{t('server-add.memory.most', { amount: formatMemory(range().max) })}</span>
          </div>
          <Slider value={[shown()]} min={range().min} max={range().max} step={range().step} showValue={false}
            aria-label={t('instance-settings.memory')} onChange={(value) => props.onChange(value[0] ?? props.value)} />
          <Show when={props.suggested !== null && props.suggested !== shown()}>
            <div data-vesta="memory-presets">
              <Button size="sm" variant="outline" onClick={() => props.onChange(clampMemory(props.suggested!, range()))}>
                {t('server-add.memory.suggested-preset', { amount: formatMemory(clampMemory(props.suggested!, range())) })}
              </Button>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={over()}>
        <p data-vesta="memory-warning" role="status">{t('server-add.memory.over-free', { name: props.machine })}</p>
      </Show>
    </section>
  );
}
