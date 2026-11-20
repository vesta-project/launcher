import { Button } from '@vesta/ui';
import { For, Match, Show, Switch, createEffect, createSignal, onSettled, untrack } from 'solid-js';
import { Icon } from '../../components/icon';
import { ACCOUNT_TYPE_GUEST, accounts, activeAccount, usePlayerHead } from '../../features/accounts/accounts';
import { instances } from '../../features/instances/catalog';
import { tour } from '../../features/onboarding/tour';
import { whatsNew, type FeatureRelease } from '../../features/whats-new';
import { t } from '../../localization';
import { Atmosphere } from '../../pages/welcome/atmosphere';
import { Warp } from '../../pages/welcome/welcome-warp';
import { HighlightReel } from './highlight-reel';
import './whats-new.css';

/** Keeps Tab on the overlay's own controls; the app underneath is only on show. */
function holdFocus(root: () => HTMLElement | undefined, onEscape: () => void) {
  onSettled(() => {
    const onKey = (event: KeyboardEvent) => {
      const element = root();
      if (!element) return;
      if (event.key === 'Escape') { event.preventDefault(); onEscape(); }
      else if (event.key === 'Tab') {
        const controls = [...element.querySelectorAll<HTMLElement>('button:not([tabindex="-1"]), video[controls]')];
        if (!controls.length) return;
        const at = controls.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        controls[(at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    // Start on the main button so Enter moves things along straight away.
    queueMicrotask(() => root()?.querySelector<HTMLElement>('[data-autofocus]')?.focus());
    return () => window.removeEventListener('keydown', onKey, true);
  });
}

/** After a feature update: the release's highlights in a card over the app. */
function Showcase(props: { release: FeatureRelease }) {
  let root: HTMLDivElement | undefined;
  holdFocus(() => root, whatsNew.close);

  return (
    <div data-vesta="whats-new" ref={(element: HTMLDivElement) => (root = element)}>
      <div data-vesta="whats-new-scrim" onClick={whatsNew.close} />
      <section data-vesta="whats-new-card" role="dialog" aria-modal="true" aria-labelledby="whats-new-heading">
        <header data-vesta="whats-new-head">
          <span data-vesta="whats-new-kicker">{t('whats-new.kicker')}</span>
          <h2 id="whats-new-heading" data-vesta="whats-new-title">{t(props.release.title)}</h2>
          <Button size="sm" variant="ghost" class="whats-new-close" aria-label={t('nav.close')} onClick={whatsNew.close}
            icon={<Icon name="icons/actions/close" size={14} />} />
        </header>
        <HighlightReel
          release={props.release}
          finish={<Button size="sm" tone="accent" data-autofocus onClick={whatsNew.close}>{t('whats-new.done')}</Button>}
        />
      </section>
    </div>
  );
}

type Scene = 'hello' | 'kept' | 'reel';

/**
 * Someone arriving from the old launcher: a hello, reassurance that everything came along, the
 * highlights, then the warp into the new app (optionally followed by the tour).
 */
function WelcomeBack(props: { release: FeatureRelease | undefined }) {
  let root: HTMLDivElement | undefined;
  const [scene, setScene] = createSignal<Scene>('hello', { name: 'welcomeBackScene' });
  const [leaving, setLeaving] = createSignal<{ tour: boolean } | undefined>(undefined, { name: 'welcomeBackLeaving' });
  const leave = (withTour: boolean) => { if (!untrack(leaving)) setLeaving({ tour: withTour }); };
  holdFocus(() => root, () => leave(false));
  // Each scene starts on its main button.
  createEffect(scene, () => queueMicrotask(() => root?.querySelector<HTMLElement>("[data-autofocus]")?.focus()));

  const account = () => {
    const active = activeAccount();
    return active && active.account_type !== ACCOUNT_TYPE_GUEST ? active : undefined;
  };
  const head = usePlayerHead(() => account()?.uuid);
  const instanceCount = () => instances().length;
  const accountCount = () => accounts().filter((item) => item.account_type !== ACCOUNT_TYPE_GUEST).length;
  const kept = () => [
    ...(instanceCount() ? [{ icon: 'icons/rail/library', text: t('whats-new.kept-instances', { count: instanceCount() }) }] : []),
    ...(accountCount() ? [{ icon: 'icons/content/people', text: t('whats-new.kept-accounts', { count: accountCount() }) }] : []),
    { icon: 'icons/content/palette', text: t('whats-new.kept-settings') },
  ];
  const afterKept = () => (props.release ? setScene('reel') : leave(false));
  const finish = (
    <>
      <Button size="sm" variant="ghost" onClick={() => leave(true)}>{t('whats-new.tour')}</Button>
      <Button size="sm" tone="accent" data-autofocus onClick={() => leave(false)}>{t('whats-new.jump-in')}</Button>
    </>
  );

  return (
    <div data-vesta="welcome-back" role="dialog" aria-modal="true" aria-labelledby="welcome-back-heading"
      ref={(element: HTMLDivElement) => (root = element)}>
      <Atmosphere calm={false} />
      <div data-vesta="welcome-back-stage" data-scene={scene()}>
        <Switch>
          <Match when={scene() === 'hello'}>
            <div data-vesta="welcome-back-scene">
              <span data-vesta="welcome-back-avatar" aria-hidden="true">
                <Show when={head()} fallback={<Icon name="icons/content/skin-icon" size={34} />}>
                  {(url) => <img src={url()} alt="" />}
                </Show>
              </span>
              <h1 id="welcome-back-heading" data-vesta="welcome-back-title">
                <Show when={account()} fallback={t('whats-new.hello')}>
                  {(player) => t('whats-new.hello-name', { name: player().username })}
                </Show>
              </h1>
              <p data-vesta="welcome-back-lede">{t('whats-new.hello-body')}</p>
              <div data-vesta="welcome-back-actions">
                <Button size="sm" variant="ghost" onClick={() => leave(false)}>{t('whats-new.skip')}</Button>
                <Button size="sm" tone="accent" data-autofocus onClick={() => setScene('kept')}>{t('whats-new.show-me')}</Button>
              </div>
            </div>
          </Match>
          <Match when={scene() === 'kept'}>
            <div data-vesta="welcome-back-scene">
              <h1 id="welcome-back-heading" data-vesta="welcome-back-title">{t('whats-new.kept-title')}</h1>
              <ul data-vesta="welcome-back-kept">
                <For each={kept()}>
                  {(row, index) => (
                    <li data-vesta="welcome-back-kept-row" style={{ '--row': index() }}>
                      <span data-vesta="welcome-back-kept-icon"><Icon name={row.icon} size={16} /></span>
                      <span>{row.text}</span>
                      <span data-vesta="welcome-back-kept-tick"><Icon name="icons/controls/check" size={14} /></span>
                    </li>
                  )}
                </For>
              </ul>
              <div data-vesta="welcome-back-actions">
                <Button size="sm" tone="accent" data-autofocus onClick={afterKept}>
                  {props.release ? t('whats-new.kept-next') : t('whats-new.jump-in')}
                </Button>
              </div>
            </div>
          </Match>
          <Match when={scene() === 'reel' && props.release}>
            {(release) => (
              <div data-vesta="welcome-back-scene" data-wide="">
                <span data-vesta="whats-new-kicker">{t('whats-new.kicker')}</span>
                <h1 id="welcome-back-heading" data-vesta="welcome-back-title">{t(release().title)}</h1>
                <HighlightReel release={release()} finish={finish} />
              </div>
            )}
          </Match>
        </Switch>
      </div>
      <Show when={leaving()}>
        {(choice) => (
          <Warp
            onDone={() => {
              whatsNew.close();
              if (choice().tour) tour.replay();
            }}
          />
        )}
      </Show>
    </div>
  );
}

/** Shown once after an update (features/whats-new), or from the changelog on request. */
export function WhatsNew() {
  return (
    <Show when={whatsNew.moment()} keyed>
      {(moment) =>
        moment.kind === 'reborn' ? (
          <WelcomeBack release={whatsNew.release()} />
        ) : (
          <Show when={whatsNew.release()} keyed>
            {(release) => <Showcase release={release} />}
          </Show>
        )
      }
    </Show>
  );
}
