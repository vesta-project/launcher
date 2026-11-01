import { Button } from '@vesta/ui';
import { Show, createSignal } from 'solid-js';
import { EditRevision } from '../../features/servers/edit-revision';
import { resourceEditor } from '../../features/servers/resources';
import { useServersClock } from '../../features/servers/store';
import { t } from '../../localization';
export function useEditRevision(revision: () => unknown) {
  const guard = new EditRevision();
  const [version, bump] = createSignal(0, { name: 'edit-revision:version' });
  const update = (run: () => void) => { run(); bump(v => v + 1); };
  return {
    begin: () => update(() => guard.begin(revision())),
    reset: () => update(() => guard.reset()),
    review: () => update(() => guard.review(revision())),
    conflict: () => { version(); return guard.conflicts(revision()); },
  };
}
export function editorWhen(atMs?: number, now = Date.now()) {
  return atMs && now - atMs >= 60_000
    ? t('servers.conflict.at-time', { time: new Date(atMs).toLocaleString() })
    : t('servers.conflict.just-now');
}
export function EditConflictNotice(props: { id: string; resource: string; show: boolean; current: unknown; onReview: () => void }) {
  const editor = () => resourceEditor(props.id, props.resource);
  const now = useServersClock();
  return <Show when={props.show}><div data-vesta="server-callout" data-tone="warning" role="alert">
    <p>{t('servers.conflict.review', { name: editor()?.display_name ?? t('servers.conflict.unknown-editor'), when: editorWhen(editor()?.at_ms, now()) })}</p>
    <pre>{JSON.stringify(props.current, null, 2)}</pre>
    <Button size="sm" variant="outline" onClick={props.onReview}>{t('servers.conflict.review-current')}</Button>
  </div></Show>;
}
