import { openExternal } from '../links/external-links';
import { Button, Dialog } from '@vesta/ui';
import { createSignal } from 'solid-js';
import { t } from '../../localization';

const [pending, setPending] = createSignal<{ resolve: (accepted: boolean) => void } | null>(null, { name: 'server-eula:prompt' });
export function requestEulaConsent(): Promise<boolean> {
  if (pending()) return Promise.resolve(false);
  return new Promise(resolve => setPending({ resolve }));
}
export function ServerEulaDialog() {
  const answer = (accepted: boolean) => { const request = pending(); setPending(null); request?.resolve(accepted); };
  return <Dialog open={!!pending()} onOpenChange={open => { if (!open) answer(false); }} title={t('servers.eula.title')} size="sm"
    footer={<><Button variant="ghost" onClick={() => answer(false)}>{t('common.cancel')}</Button><Button tone="accent" onClick={() => answer(true)}>{t('servers.eula.accept-start')}</Button></>}>
    <p>{t('servers.eula.description')}</p>
    <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer" onClick={event => { event.preventDefault(); void openExternal('https://aka.ms/MinecraftEULA'); }}>{t('servers.eula.read')}</a>
  </Dialog>;
}
