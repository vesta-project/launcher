import { editorWhen } from './edit-conflict';
import { Metadata } from '../../components/metadata';
import { Notice, createNoticeRegistry, type NoticeRegistry } from '../../components/notice';
import './servers.css';
import { Badge, Button, toast } from '@vesta/ui';
import { For, Show, createMemo, createSignal, onCleanup } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { setting } from '../../features/settings/config';
import { t } from '../../localization';
import { serverErrorDetails, serverErrorFile, serverErrorPresentation } from '../../features/servers/errors';
import { copyText } from '../../platform/clipboard';
import { groupFingerprint } from '../../features/servers/fingerprint';
import { age, freshnessVisible, type Dot, type Fact } from '../../features/servers/model';
import type { ServerCommandError, ServerSnapshot } from '../../features/servers/native';
import { useServersClock } from '../../features/servers/store';
import { serverPressure } from '../../features/servers/resources';
import { headerExplains } from '../../features/servers/shell-model';
import { useServerShell } from './shell-context';

type ConnectionPhase = ServerSnapshot['state']['phase'];

/** One state fact as a soft badge. */
export function FactBadge(props: { fact: Fact; now?: number }) {
  const text = () => {
    const main = t(props.fact.message, props.fact.args);
    const seen = props.fact.seen;
    return seen ? <Metadata parts={[main, t('servers.seen', { time: t(seen.message, { count: seen.count }) })]} /> : main;
  };
  return <Badge tone={props.fact.tone} variant="soft">{text()}</Badge>;
}

export function StatusDot(props: { dot: Dot; label?: string }) {
  return <span data-vesta="server-dot" data-dot={props.dot} role={props.label ? 'img' : undefined} aria-label={props.label} />;
}

/** Fingerprint in four-character groups; `highlight` marks groups that differ. */
export function FingerprintView(props: { value: string; highlight?: number[] }) {
  return (
    <Sensitive label={t('servers.fingerprint')}>
    <code data-vesta="server-fingerprint" aria-label={t('servers.fingerprint')}>
      <For each={groupFingerprint(props.value)}>
        {(group, index) => <span data-differs={props.highlight?.includes(index()) ? '' : undefined}>{group}</span>}
      </For>
    </code>
    </Sensitive>
  );
}

/**
 * Last-known value age, e.g. "Updated 3 min ago". Shown only while the connection is
 * disrupted or the value is stale (see `freshnessVisible`); a live value needs no age.
 */
export function Freshness(props: { atMs: number | null; now: number; phase: ConnectionPhase }) {
  return (
    <Show when={freshnessVisible(props.phase, props.atMs, props.now) ? props.atMs : null}>
      {(at) => {
        const seen = () => age(at(), props.now);
        return <span data-vesta="server-freshness">{t('servers.updated', { time: t(seen().message, { count: seen().count }) })}</span>;
      }}
    </Show>
  );
}

const shellNotices = new WeakMap<object, NoticeRegistry>();

/**
 * A localized error with its recovery action, if the caller can perform it. Inside a server
 * workspace, connection and capacity errors the header strip already explains stay quiet, and
 * equal errors from several panels show once (see `Notice`).
 */
export function ServerErrorNote(props: {
  error: ServerCommandError | null | undefined;
  onRetry?: () => void;
  variant?: 'section' | 'inline';
}) {
  const now = useServersClock();
  const shell = useServerShell();
  let scope: NoticeRegistry | undefined;
  if (shell) {
    scope = shellNotices.get(shell);
    if (!scope) shellNotices.set(shell, (scope = createNoticeRegistry()));
  }
  const retryAt = createMemo(() => Date.now() + (props.error?.retryAfterMs ?? 0), { name: 'server-error:retry-at' });
  const explained = () => {
    const snapshot = shell?.snapshot();
    return !!snapshot && headerExplains(props.error, snapshot, serverPressure(snapshot.connection.id), now());
  };
  return (
    <Show when={explained() ? null : props.error}>
      {(error) => {
        const presentation = () => serverErrorPresentation(error());
        const seconds = () => Math.ceil(Math.max(0, Math.min(error().retryAfterMs ?? 0, retryAt() - now())) / 1000);
        const retryable = () => !!props.onRetry && (presentation().action === 'retry' || presentation().action === 'refresh' || presentation().action === 'wait');
        return (
          <Notice
            class="server-error"
            variant={props.variant}
            scope={scope}
            cause={props.onRetry ? `${error().code}:${error().reason ?? ''}:${presentation().message}` : undefined}
            action={retryable() ? { label: t('common.retry'), onClick: () => props.onRetry?.(), disabled: presentation().action === 'wait' && seconds() > 0 } : undefined}
            details={
              <>
                <Show when={serverErrorFile(error())}>{(filename) => <code data-vesta="server-error-file">{filename()}</code>}</Show>
                <Show when={error().issue}>{issue => <code data-vesta="server-error-file">{issue().code}: {issue().rule}: {issue().item}</code>}</Show>
                <Show when={error().code === 'conflict' && error().current}>
                  <details open>
                    <summary>{t('servers.conflict.review', { name: String((error().current as { editor?: { display_name?: string } })?.editor?.display_name ?? t('servers.conflict.unknown-editor')), when: editorWhen((error().current as { editor?: { at_ms?: number } })?.editor?.at_ms) })}</summary>
                    <pre>{JSON.stringify(error().current, null, 2)}</pre>
                  </details>
                </Show>
                <details data-vesta="server-error-details">
                  <summary>{t('server-pack.error-details')}</summary>
                  <pre>{serverErrorDetails(error())}</pre>
                  <Button size="sm" variant="ghost" onClick={() => {
                    void copyText(serverErrorDetails(error())).then(
                      () => toast.show({ title: t('servers.copied'), tone: 'neutral' }),
                      () => toast.show({ title: t('server-pack.error-copy-failed'), tone: 'danger' }),
                    );
                  }}>{t('servers.copy')}</Button>
                </details>
              </>
            }
          >
            {t(presentation().message)}
            <Show when={seconds() > 0}> {t('servers.retry-after', { count: seconds() })}</Show>
          </Notice>
        );
      }}
    </Show>
  );
}

/**
 * Wraps addresses, IPs, server IDs and fingerprints. With privacy mode on they are
 * blurred until clicked, and re-hide after a few seconds, so they stay safe on a stream.
 */
export function Sensitive(props: { children: JSX.Element; label?: string }) {
  const [revealed, setRevealed] = createSignal(false, { name: 'servers:sensitive-revealed' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const hidden = () => setting('servers_privacy_mode') && !revealed();
  const reveal = (event: Event) => {
    if (!setting('servers_privacy_mode')) return;
    event.stopPropagation();
    setRevealed(true);
    clearTimeout(timer);
    timer = setTimeout(() => setRevealed(false), 8000);
  };
  return (
    <span
      data-vesta="sensitive"
      data-hidden={hidden() ? '' : undefined}
      tabindex={hidden() ? 0 : undefined}
      role={hidden() ? 'button' : undefined}
      aria-label={hidden() ? t('servers.privacy.hidden', { name: props.label ?? t('servers.address.label') }) : undefined}
      title={hidden() ? t('servers.privacy.reveal') : undefined}
      onClick={reveal}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); reveal(event); } }}
    >
      <span aria-hidden={hidden() ? 'true' : undefined}>{props.children}</span>
    </span>
  );
}
