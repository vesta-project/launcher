import { Select, Slider, Switch, TextField } from '@vesta/ui';
import { Match, Switch as Branch, createMemo, createSignal, onSettled } from 'solid-js';
import {
  UNBOUND_KEY,
  minecraftKeyFromEvent,
  minecraftKeyFromMouse,
  minecraftKeyLabel,
} from '../../../features/settings/minecraft-keys';
import { formatOptionName, type SyncEditor, type SyncItem } from '../../../features/settings/sync-model';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';

type Choice =
  | 'off'
  | 'all'
  | 'decreased'
  | 'minimal'
  | 'maximum'
  | 'crosshair'
  | 'hotbar'
  | 'shown'
  | 'commands-only'
  | 'hidden'
  | 'chat-only'
  | 'system-only'
  | 'peaceful'
  | 'easy'
  | 'normal'
  | 'hard'
  | 'fast'
  | 'fancy'
  | 'fabulous'
  | 'threaded'
  | 'semi-blocking'
  | 'fully-blocking'
  | 'none';

/** options.txt stores many choices as numbers; these name them the way the game's menus do. */
const choiceNames: Record<string, Record<string, Choice>> = {
  particles: { 0: 'all', 1: 'decreased', 2: 'minimal' },
  attackIndicator: { 0: 'off', 1: 'crosshair', 2: 'hotbar' },
  chatVisibility: { 0: 'shown', 1: 'commands-only', 2: 'hidden' },
  narrator: { 0: 'off', 1: 'all', 2: 'chat-only', 3: 'system-only' },
  difficulty: { 0: 'peaceful', 1: 'easy', 2: 'normal', 3: 'hard' },
  ao: { 0: 'off', 1: 'minimal', 2: 'maximum' },
  renderClouds: { false: 'off', fast: 'fast', true: 'fancy' },
  graphicsMode: { 0: 'fast', 1: 'fancy', 2: 'fabulous' },
  prioritizeChunkUpdates: { 0: 'threaded', 1: 'semi-blocking', 2: 'fully-blocking' },
};

const choiceLabel = (key: string, value: string) => {
  const named = choiceNames[key]?.[value];
  if (named) return t(`prefs.sync.choice-${named}` as MessageId);
  return /^-?\d+(\.\d+)?$/.test(value) ? value : formatOptionName(value);
};

const places = (step: number | null) => {
  const text = String(step ?? 0.01);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : Math.min(4, text.length - dot - 1);
};

type Mode = 'key' | 'boolean' | 'enum' | 'range' | 'number' | 'text';

/** Picks the richest control the host metadata and the stored value allow. */
function modeOf(item: SyncItem): Mode {
  if (item.key.startsWith('key_')) return 'key';
  if (item.value === 'true' || item.value === 'false') return 'boolean';
  const editor = item.editor;
  if (!editor) return 'text';
  if (editor.kind === 'enum' && editor.values.length) return 'enum';
  if (editor.kind !== 'integer' && editor.kind !== 'decimal') return 'text';
  const value = Number(item.value);
  const bounded = editor.min !== null && editor.max !== null && editor.min < editor.max;
  return bounded && Number.isFinite(value) && value >= editor.min! && value <= editor.max! ? 'range' : 'number';
}

/** One shared option's value, edited with a control that matches its type. */
export function SyncValueControl(props: {
  item: SyncItem;
  disabled: boolean;
  /** Another shared keybind uses the same key. */
  conflict?: boolean;
  onSave: (value: string) => void;
}) {
  const label = () => t('prefs.sync.value-label', { name: props.item.label });
  // A new options array makes the select rebuild its list, so only rebuild when the choices change.
  const choices = createMemo(
    () =>
      [...new Set([...(props.item.editor?.values ?? []), props.item.value])].map((value) => ({
        value,
        label: choiceLabel(props.item.key, value),
      })),
    {
      name: 'syncValueChoices',
      equals: (a, b) =>
        a.length === b.length &&
        a.every((option, index) => option.value === b[index].value && option.label === b[index].label),
    },
  );
  return (
    <div data-vesta="prefs-sync-control">
      <Branch fallback={<CommitField {...props} label={label()} numeric={false} />}>
        <Match when={modeOf(props.item) === 'key'}>
          <KeyCapture {...props} label={label()} />
        </Match>
        <Match when={modeOf(props.item) === 'boolean'}>
          <Switch
            size="sm"
            aria-label={label()}
            disabled={props.disabled}
            checked={props.item.value === 'true'}
            onChange={(on) => props.onSave(String(on))}
          />
        </Match>
        <Match when={modeOf(props.item) === 'enum'}>
          <Select
            size="sm"
            aria-label={label()}
            disabled={props.disabled}
            value={props.item.value}
            onChange={(value) => value !== props.item.value && props.onSave(value)}
            options={choices()}
          />
        </Match>
        <Match when={modeOf(props.item) === 'range'}>
          <RangeControl {...props} editor={props.item.editor!} label={label()} />
        </Match>
        <Match when={modeOf(props.item) === 'number'}>
          <CommitField {...props} label={label()} numeric />
        </Match>
      </Branch>
    </div>
  );
}

function RangeControl(props: {
  item: SyncItem;
  editor: SyncEditor;
  label: string;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const percent = () => props.editor.unit === 'percent';
  const scale = () => (percent() ? 100 : 1);
  const step = () => (props.editor.step ?? (props.editor.kind === 'integer' ? 1 : 0.01)) * scale();
  const format = (display: number) => {
    const rounded = Number(display.toFixed(Math.min(2, places(step()))));
    return percent() ? `${rounded}%` : props.editor.unit === 'multiplier' ? `${rounded}×` : String(rounded);
  };
  return (
    <Slider
      size="sm"
      aria-label={props.label}
      disabled={props.disabled}
      min={props.editor.min! * scale()}
      max={props.editor.max! * scale()}
      step={step()}
      value={[Number(props.item.value) * scale()]}
      showValue
      getValueLabel={(values) => format(values[0])}
      onChangeEnd={(values) => {
        const stored = Number((values[0] / scale()).toFixed(places(props.editor.step)));
        if (String(stored) !== props.item.value) props.onSave(String(stored));
      }}
    />
  );
}

/** Text and unbounded numbers save on Enter or blur, never on every keystroke. */
function CommitField(props: {
  item: SyncItem;
  label: string;
  numeric: boolean;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = createSignal<string | undefined>(undefined, { name: 'syncValueDraft' });
  const commit = () => {
    const value = draft();
    setDraft(undefined);
    if (value === undefined || value === props.item.value) return;
    if (props.numeric && !Number.isFinite(Number(value))) return;
    props.onSave(value);
  };
  return (
    <TextField
      size="sm"
      aria-label={props.label}
      disabled={props.disabled}
      inputmode={props.numeric ? 'decimal' : undefined}
      placeholder={t('prefs.sync.value-empty')}
      value={draft() ?? props.item.value}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
        if (event.key === 'Escape') {
          setDraft(undefined);
          (event.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/**
 * A keybind button, as in the game's Controls screen: click it, then press a key or mouse
 * button. Escape unbinds, the way Minecraft does.
 */
function KeyCapture(props: {
  item: SyncItem;
  label: string;
  disabled: boolean;
  conflict?: boolean;
  onSave: (value: string) => void;
}) {
  const [listening, setListening] = createSignal(false, { name: 'keyCaptureListening' });
  // The press that binds a mouse button is followed by a click; that click must not re-arm.
  let swallowClick = false;
  const finish = (value?: string) => {
    setListening(false);
    if (value !== undefined && value !== props.item.value) props.onSave(value);
  };
  onSettled(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!listening()) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') return finish(UNBOUND_KEY);
      const key = minecraftKeyFromEvent(event);
      if (key) finish(key);
    };
    // Mouse buttons bind too, but only presses after the click that started listening.
    const onMouse = (event: MouseEvent) => {
      if (!listening()) {
        swallowClick = false;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      swallowClick = true;
      finish(minecraftKeyFromMouse(event.button));
    };
    const onBlur = () => listening() && finish();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('blur', onBlur);
    };
  });
  return (
    <button
      type="button"
      data-vesta="prefs-sync-key"
      data-listening={listening() ? '' : undefined}
      data-conflict={props.conflict && !listening() ? '' : undefined}
      data-unbound={minecraftKeyLabel(props.item.value) ? undefined : ''}
      aria-label={props.label}
      data-tip={listening() ? t('prefs.sync.key-hint') : props.conflict ? t('prefs.sync.key-conflict') : undefined}
      disabled={props.disabled}
      onContextMenu={(event) => listening() && event.preventDefault()}
      onClick={() => {
        if (swallowClick) swallowClick = false;
        else setListening(true);
      }}
    >
      {listening() ? t('prefs.sync.key-listening') : minecraftKeyLabel(props.item.value) || t('prefs.sync.key-unbound')}
    </button>
  );
}
