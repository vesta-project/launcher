import './servers.css';
import { Badge, Button } from '@vesta/ui';
import { For, Show } from 'solid-js';
import { t } from '../../localization';
import { errorPresentation, toServerError } from '../../features/servers/errors';
import { groupFingerprint } from '../../features/servers/fingerprint';
import { age, type Dot, type Fact } from '../../features/servers/model';
import type { ServerCommandError } from '../../features/servers/native';

/** One state fact as a soft badge. */
export function FactBadge(props: { fact: Fact; now?: number }) {
  const text = () => {
    const main = t(props.fact.message, props.fact.args);
    const seen = props.fact.seen;
    return seen ? `${main} · ${t('servers.seen', { time: t(seen.message, { count: seen.count }) })}` : main;
  };
  return <Badge tone={props.fact.tone} variant="soft">{text()}</Badge>;
}

export function StatusDot(props: { dot: Dot; label?: string }) {
  return <span data-vesta="server-dot" data-dot={props.dot} role={props.label ? 'img' : undefined} aria-label={props.label} />;
}

/** Fingerprint in four-character groups; `highlight` marks groups that differ. */
export function FingerprintView(props: { value: string; highlight?: number[] }) {
  return (
    <code data-vesta="server-fingerprint" aria-label={t('servers.fingerprint')}>
      <For each={groupFingerprint(props.value)}>
        {(group, index) => <span data-differs={props.highlight?.includes(index()) ? '' : undefined}>{group}</span>}
      </For>
    </code>
  );
}

/** Last-known value age, e.g. "Updated 3 min ago". */
export function Freshness(props: { atMs: number | null; now: number }) {
  return (
    <Show when={props.atMs}>
      {(at) => {
        const seen = () => age(at(), props.now);
        return <span data-vesta="server-freshness">{t('servers.updated', { time: t(seen().message, { count: seen().count }) })}</span>;
      }}
    </Show>
  );
}

/** A localized error with its recovery action, if the caller can perform it. */
export function ServerErrorNote(props: {
  error: ServerCommandError | null | undefined;
  onRetry?: () => void;
}) {
  return (
    <Show when={props.error}>
      {(error) => {
        const presentation = () => errorPresentation[toServerError(error()).code];
        const seconds = () => Math.ceil((error().retryAfterMs ?? 0) / 1000);
        return (
          <div data-vesta="server-error" role="alert">
            <span>
              {t(presentation().message)}
              <Show when={seconds() > 0}> {t('servers.retry-after', { count: seconds() })}</Show>
            </span>
            <Show when={props.onRetry && (presentation().action === 'retry' || presentation().action === 'refresh')}>
              <Button size="sm" variant="ghost" onClick={() => props.onRetry?.()}>{t('common.retry')}</Button>
            </Show>
          </div>
        );
      }}
    </Show>
  );
}
