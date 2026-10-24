// The one MOTD editor: the server-list entry players will see on top, and under it an
// input that draws the message in its real colours as you type. The toolbar applies
// colours and styles to the selection, so nobody has to learn `§` codes; the codes stay
// visible but faint, so the raw text is never hidden from people who know them.
import { Button, Menu, MenuItem, Popover, Separator, Tooltip } from '@vesta/ui';
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Icon } from '../../components/icon';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { initials, serverArt } from '../../features/servers/art';
import {
  MOTD_COLORS, MOTD_PLACEHOLDERS, activeCodesAt, applyMotdFormat, fillPlaceholders, motdTokens, parseMotd, type MotdSegment, type MotdStyle,
} from '../../features/servers/motd-model';
import type { ConnectionId } from '../../features/servers/native';
import { serverIcon } from '../../features/servers/store';

const colorNames: Record<string, MessageId> = {
  '0': 'servers.motd.color-black', '1': 'servers.motd.color-dark-blue', '2': 'servers.motd.color-dark-green', '3': 'servers.motd.color-dark-aqua',
  '4': 'servers.motd.color-dark-red', '5': 'servers.motd.color-dark-purple', '6': 'servers.motd.color-gold', '7': 'servers.motd.color-gray',
  '8': 'servers.motd.color-dark-gray', '9': 'servers.motd.color-blue', a: 'servers.motd.color-green', b: 'servers.motd.color-aqua',
  c: 'servers.motd.color-red', d: 'servers.motd.color-light-purple', e: 'servers.motd.color-yellow', f: 'servers.motd.color-white',
};

const styles: { code: string; label: MessageId; glyph: () => unknown }[] = [
  { code: 'l', label: 'servers.motd.bold', glyph: () => <b>B</b> },
  { code: 'o', label: 'servers.motd.italic', glyph: () => <i>I</i> },
  { code: 'n', label: 'servers.motd.underline', glyph: () => <u>U</u> },
  { code: 'm', label: 'servers.motd.strikethrough', glyph: () => <s>S</s> },
];

const textStyle = (style: Pick<MotdStyle, 'color' | 'bold' | 'italic' | 'underlined' | 'strikethrough'>) => ({
  color: style.color ?? undefined,
  'font-weight': style.bold ? '700' : undefined,
  'font-style': style.italic ? 'italic' : undefined,
  'text-decoration': [style.underlined && 'underline', style.strikethrough && 'line-through'].filter(Boolean).join(' ') || undefined,
});

/** The server's icon in the list: the given PNG, the server's own icon, or its generated art. */
function entryIcon(id: ConnectionId, name: string, iconPng?: string | null) {
  if (iconPng) return `data:image/png;base64,${iconPng}`;
  return serverIcon(id) ?? serverArt(id, initials(name));
}

/** A Minecraft multiplayer-list entry: icon, name, two MOTD lines, players and signal. */
export function MotdPreview(props: {
  id: ConnectionId;
  name: string;
  template: string;
  players: string;
  version?: string | null;
  iconPng?: string | null;
  /** Agent-rendered segments; when absent the template is rendered here. */
  segments?: MotdSegment[];
  samples?: Record<string, string>;
}) {
  const segments = () => props.segments ?? parseMotd(fillPlaceholders(props.template, props.samples ?? {}));
  const line = (index: 0 | 1) => segments().filter((segment) => segment.line === index);
  return (
    <div data-vesta="server-motd-entry" role="img" aria-label={t('server-settings.motd-preview-aria', { name: props.name, value: segments().map((segment) => segment.text).join(' ') })}>
      <img src={entryIcon(props.id, props.name, props.iconPng)} alt="" draggable="false" />
      <span data-vesta="server-motd-entry-body">
        <span data-vesta="server-motd-entry-title">
          <span>{props.name}</span>
          <span data-vesta="server-motd-entry-players">
            <Show when={props.version} fallback={props.players}>{(version) => <span data-vesta="server-motd-entry-version">{version()}</span>}</Show>
            <span data-vesta="server-motd-ping" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          </span>
        </span>
        <For each={[0, 1] as const}>
          {(index) => (
            <span data-vesta="server-motd-entry-line">
              <For each={line(index)}>
                {(segment) => <span style={textStyle(segment)}>{segment.obfuscated ? segment.text.replace(/\S/g, '▓') : segment.text}</span>}
              </For>
            </span>
          )}
        </For>
      </span>
    </div>
  );
}

export function MotdEditor(props: {
  id: ConnectionId;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Colours, styles and a second line. Off for plain-text sources. */
  formatting: boolean;
  /** Template placeholders are supported by Vesta status messages only. */
  placeholders?: boolean;
  readOnly?: boolean;
  /** Localized problem with the current text. */
  error?: string;
  /** Under the input when there is no error. */
  note?: string;
  placeholder?: string;
  players: string;
  version?: string | null;
  iconPng?: string | null;
  segments?: MotdSegment[];
  samples?: Record<string, string>;
}) {
  let input: HTMLTextAreaElement | undefined;
  let mirror: HTMLDivElement | undefined;
  const [colorsOpen, setColorsOpen] = createSignal(false, { name: 'server-motd-editor:colors-open' });
  const [caret, setCaret] = createSignal(0, { name: 'server-motd-editor:caret' });
  const tokens = createMemo(() => motdTokens(props.value), { name: 'server-motd-editor:tokens' });
  /** The colour at the cursor, shown on the colour button. */
  const currentColor = () => {
    const code = /§([0-9a-f])/i.exec(activeCodesAt(props.value, caret()))?.[1]?.toLowerCase();
    return code ? MOTD_COLORS[code] : '#AAAAAA';
  };

  const remember = () => setCaret(input?.selectionStart ?? 0);
  const replace = (next: { template: string; start: number; end: number }) => {
    props.onChange(next.template);
    queueMicrotask(() => { input?.focus(); input?.setSelectionRange(next.start, next.end); remember(); });
  };
  const format = (code: string) => {
    const start = input?.selectionStart ?? props.value.length;
    const end = input?.selectionEnd ?? start;
    replace(applyMotdFormat(props.value, start, end, code));
  };
  const insert = (text: string) => {
    const start = input?.selectionStart ?? props.value.length;
    const end = input?.selectionEnd ?? start;
    replace({ template: props.value.slice(0, start) + text + props.value.slice(end), start: start + text.length, end: start + text.length });
  };
  const sync = () => { if (mirror && input) mirror.scrollTop = input.scrollTop; };
  /** Grows with wrapped lines so the coloured mirror and the input always cover the same text. */
  const fit = () => {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  };
  createEffect(() => props.value, () => { queueMicrotask(fit); }, { name: 'server-motd-editor:fit' });

  return (
    <div data-vesta="server-motd">
      <MotdPreview id={props.id} name={props.name} template={props.value} players={props.players} version={props.version}
        iconPng={props.iconPng} segments={props.segments} samples={props.placeholders ? props.samples : undefined} />

      <Show when={props.formatting && !props.readOnly}>
        <div data-vesta="server-motd-toolbar" role="toolbar" aria-label={t('servers.presence.colors')}>
          <Popover
            open={colorsOpen()}
            onOpenChange={setColorsOpen}
            placement="bottom-start"
            trigger={(trigger) => (
              <Button {...trigger} size="sm" variant="ghost" icon={<span data-vesta="server-motd-current" style={{ '--swatch': currentColor() }} />}>
                {t('servers.motd.colour')}
              </Button>
            )}
          >
            <div data-vesta="server-motd-swatches">
              <For each={Object.entries(MOTD_COLORS)}>
                {([code, color]) => (
                  <Tooltip content={t(colorNames[code]!)} trigger={(tooltip) => (
                    <button {...tooltip} type="button" data-vesta="server-motd-swatch" style={{ '--swatch': color }} aria-label={t(colorNames[code]!)}
                      onClick={() => { setColorsOpen(false); format(code); }} />
                  )} />
                )}
              </For>
            </div>
          </Popover>
          <For each={styles}>
            {(style) => (
              <Tooltip content={t(style.label)} trigger={(tooltip) => (
                <Button {...tooltip} size="sm" variant="ghost" class="server-motd-format" aria-label={t(style.label)}
                  onPointerDown={(event: PointerEvent) => event.preventDefault()} onClick={() => format(style.code)}>
                  {style.glyph() as never}
                </Button>
              )} />
            )}
          </For>
          <Button size="sm" variant="ghost" onPointerDown={(event: PointerEvent) => event.preventDefault()} onClick={() => format('r')}>{t('servers.motd.clear')}</Button>
          <Show when={props.placeholders}>
            <Separator orientation="vertical" />
            <Menu trigger={(menu) => <Button {...menu} size="sm" variant="ghost" icon={<Icon name="icons/actions/add" />}>{t('servers.presence.placeholder')}</Button>}>
              <For each={MOTD_PLACEHOLDERS}>{(name) => <MenuItem onSelect={() => insert(`{${name}}`)}>{`{${name}}`}</MenuItem>}</For>
            </Menu>
          </Show>
          <span data-vesta="server-motd-hint">{t('servers.motd.hint')}</span>
        </div>
      </Show>

      <div data-vesta="server-motd-field" data-invalid={props.error ? '' : undefined}>
        <div data-vesta="server-motd-mirror" aria-hidden="true" ref={(element: HTMLDivElement) => { mirror = element; }}>
          <For each={tokens()}>
            {(token) => {
              if (token.kind === 'code') return <span data-code>{token.text}</span>;
              if (token.kind === 'newline') return token.text === '\n' ? '\n' : <span data-code>{token.text}</span>;
              return <span data-placeholder={props.placeholders && token.kind === 'placeholder' ? '' : undefined} style={textStyle(token.style)}>{token.text}</span>;
            }}
          </For>
          {'\n'}
        </div>
        <textarea
          ref={(element: HTMLTextAreaElement) => { input = element; }}
          aria-label={props.label}
          aria-invalid={props.error ? 'true' : undefined}
          rows={props.formatting ? 2 : 1}
          wrap="soft"
          spellcheck="false"
          readonly={props.readOnly}
          placeholder={props.placeholder}
          value={props.value}
          onInput={(event) => { props.onChange(event.currentTarget.value); remember(); }}
          onKeyDown={(event) => { if (!props.formatting && event.key === 'Enter') event.preventDefault(); }}
          onKeyUp={remember}
          onPointerUp={remember}
          onScroll={sync}
        />
      </div>
      <Show when={props.error || props.note}>
        <p data-vesta="server-motd-meta" data-tone={props.error ? 'danger' : undefined} role={props.error ? 'alert' : undefined}>{props.error ?? props.note}</p>
      </Show>
    </div>
  );
}
