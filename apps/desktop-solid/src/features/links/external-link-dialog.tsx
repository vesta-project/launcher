import { Button, Checkbox, Dialog } from '@vesta/ui';
import { createMemo, createSignal, Show } from 'solid-js';
import { t } from '../../localization';
import { answerPendingLink, pendingLink, type PendingLink } from './external-links';
import './links.css';

/** Splits a URL so the host can be read at a glance: the part that decides where it goes. */
function parts(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'mailto:') return { lead: 'mailto:', host: decodeURIComponent(parsed.pathname), rest: parsed.search };
    const host = parsed.host;
    const at = url.indexOf(host);
    if (at < 0) return { lead: '', host: '', rest: url };
    return { lead: url.slice(0, at), host, rest: url.slice(at + host.length) };
  } catch {
    return { lead: '', host: '', rest: url };
  }
}

/**
 * The one confirmation before a link leaves the launcher (see external-links.ts). Mount once,
 * in the shell. The full address is shown with its host emphasised, so a misleading link text
 * cannot hide where it really goes.
 */
export function ExternalLinkDialog() {
  const [remember, setRemember] = createSignal(false, { name: 'externalLinkRemember' });
  // Keeps the last address while the dialog animates out, instead of emptying mid-fade.
  const shown = createMemo<PendingLink | undefined>((previous) => pendingLink() ?? previous, {
    name: 'externalLinkShown',
  });
  const close = (open: boolean) => {
    answerPendingLink(open, remember());
    setRemember(false);
  };

  return (
    <Dialog
      closeLabel={t('nav.close')}
      size="sm"
      open={!!pendingLink()}
      onOpenChange={(open) => !open && close(false)}
      title={t('links.open-title')}
      description={t('links.open-description')}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            {t('links.stay')}
          </Button>
          <Button tone="accent" onClick={() => close(true)}>
            {t('links.open')}
          </Button>
        </>
      }
    >
      <Show when={shown()}>
        {(link) => {
          const split = () => parts(link().url);
          return (
            <div data-vesta="external-link">
              <p data-vesta="external-link-url">
                <span>{split().lead}</span>
                <strong>{split().host}</strong>
                <span>{split().rest}</span>
              </p>
              <Show when={link().site}>
                {(site) => (
                  <Checkbox
                    size="sm"
                    checked={remember()}
                    onChange={setRemember}
                    label={t('links.trust-site', { value: site() })}
                  />
                )}
              </Show>
            </div>
          );
        }}
      </Show>
    </Dialog>
  );
}
