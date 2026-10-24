// Pieces shared by the world, software and SFTP surfaces.
import { Show } from 'solid-js';
import { t } from '../../../localization';
import { rejectionMessage } from '../../../features/servers/hosting-model';
import type { ServerCommandError } from '../../../features/servers/native';
import { ServerErrorNote } from '../parts';

/** The agent's specific reason when it gave one, otherwise the usual error note. */
export function HostingError(props: { error: ServerCommandError | null | undefined; onRetry?: () => void }) {
  return (
    <Show when={rejectionMessage(props.error)} fallback={<ServerErrorNote error={props.error} onRetry={props.onRetry} />}>
      {(message) => <div data-vesta="server-error" role="alert"><span>{t(message())}</span></div>}
    </Show>
  );
}

/** One quiet line explaining why an action is unavailable right now. */
export function Hint(props: { when: unknown; children: string }) {
  return <Show when={props.when}><p data-vesta="server-hosting-hint">{props.children}</p></Show>;
}
