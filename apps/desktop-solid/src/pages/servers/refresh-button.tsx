import { Button, toast } from '@vesta/ui';
import { Icon } from '../../components/icon';
import { t } from '../../localization';
import { errorMessage } from '../../features/servers/errors';
import { refreshServer, serverRefreshing } from '../../features/servers/store';

export async function refreshServerWithFeedback(id: string) {
  try { await refreshServer(id); }
  catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
}

/** Available offline too; native admission still honors server cooldowns and trust. */
export function ServerRefreshButton(props: { id: string }) {
  return <Button size="sm" variant="ghost" icon={<Icon name="icons/actions/refresh" />}
    disabled={serverRefreshing(props.id)} aria-busy={serverRefreshing(props.id) ? 'true' : 'false'}
    onClick={() => void refreshServerWithFeedback(props.id)}>{t('servers.refresh')}</Button>;
}
