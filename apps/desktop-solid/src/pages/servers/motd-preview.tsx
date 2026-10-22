import { For, Show } from 'solid-js';
import { Icon } from '../../components/icon';
import { fillPlaceholders, parseMotd, type MotdSegment } from '../../features/servers/motd-model';

/** A Minecraft multiplayer-list entry: icon, server name, two coloured MOTD lines and the player count. */
export function MotdPreview(props: {
  name: string;
  template: string;
  players: string;
  version?: string | null;
  iconPng?: string | null;
  /** Agent-rendered segments; when absent the template is rendered locally. */
  segments?: MotdSegment[];
  samples?: Record<string, string>;
}) {
  const segments = () => props.segments ?? parseMotd(fillPlaceholders(props.template, props.samples ?? {}));
  const line = (index: 0 | 1) => segments().filter((segment) => segment.line === index);
  return (
    <div data-vesta="server-motd-entry" role="img" aria-label={`${props.name}: ${segments().map((segment) => segment.text).join('')}`}>
      <span data-vesta="server-motd-entry-icon">
        <Show when={props.iconPng} fallback={<Icon name="icons/rail/servers" size={26} />}>
          {(png) => <img src={`data:image/png;base64,${png()}`} alt="" />}
        </Show>
      </span>
      <span data-vesta="server-motd-entry-body">
        <span data-vesta="server-motd-entry-title">
          <span>{props.name}</span>
          <span data-vesta="server-motd-entry-players">{props.version ? <span data-vesta="server-motd-entry-version">{props.version}</span> : null}{props.players}</span>
        </span>
        <For each={[0, 1] as const}>
          {(index) => (
            <span data-vesta="server-motd-entry-line">
              <For each={line(index)}>
                {(segment) => (
                  <span
                    data-obfuscated={segment.obfuscated ? '' : undefined}
                    style={{
                      color: segment.color ?? undefined,
                      'font-weight': segment.bold ? '700' : undefined,
                      'font-style': segment.italic ? 'italic' : undefined,
                      'text-decoration': [segment.underlined && 'underline', segment.strikethrough && 'line-through'].filter(Boolean).join(' ') || undefined,
                    }}
                  >{segment.obfuscated ? segment.text.replace(/\S/g, '▓') : segment.text}</span>
                )}
              </For>
            </span>
          )}
        </For>
      </span>
    </div>
  );
}
