import type { JSX } from '@solidjs/web';
import { Button, Skeleton } from '@vesta/ui';
import { For, Match, Show, Switch, createMemo, createSignal } from 'solid-js';
import { Icon } from '../../components/icon';
import { formatCompact } from '../../features/browse/browse-model';
import type { ImportCandidate } from '../../features/launcher-import';
import { firstInstance, onboarding, type FeaturedPack } from '../../features/onboarding';
import { ImportPicker } from '../create/import-picker';
import { locale, t } from '../../localization';

type Choice = 'import' | 'pack' | 'blank';

/**
 * Step 5: one starting point, chosen calmly. At most three rows; only the modpack row opens
 * up (a small grid of six), and nothing starts until the footer button, whose label says
 * exactly what will happen. Work runs in the background; the activity pill shows it.
 */
export function FirstInstanceStep() {
  const [choice, setChoice] = createSignal<Choice | undefined>(undefined, { name: 'welcomeChoice' });
  const [pack, setPack] = createSignal<FeaturedPack | undefined>(undefined, { name: 'welcomePack' });
  const [busy, setBusy] = createSignal(false, { name: 'welcomeBusy' });
  const [error, setError] = createSignal<string>();
  const [imports, setImports] = createSignal<{ launcher: string; candidates: ImportCandidate[] }>(
    { launcher: '', candidates: [] },
    { name: 'welcomeImports' },
  );

  const launcher = createMemo(() => firstInstance.launchers()?.[0], { name: 'welcomeLauncher' });
  const moreLaunchers = () => Math.max(0, (firstInstance.launchers()?.length ?? 0) - 1);
  const blank = () => firstInstance.blankSummary();

  const action = () => {
    switch (choice()) {
      case 'import':
        return t('welcome.first-do-import-count', { count: imports().candidates.length });
      case 'pack':
        return pack() ? t('welcome.first-do-pack', { name: pack()!.name }) : t('welcome.first-pick-pack');
      case 'blank':
        return t('welcome.first-do-blank');
      default:
        return t('welcome.continue');
    }
  };
  const ready = () =>
    choice() === 'pack' ? !!pack() : choice() === 'import' ? imports().candidates.length > 0 : choice() !== undefined;

  const run = async () => {
    if (!ready() || busy()) return;
    setBusy(true);
    setError(undefined);
    try {
      if (choice() === 'import') {
        const { launcher: from, candidates } = imports();
        const result = await firstInstance.importMany(from, candidates);
        // Anything that could not be queued is reported here; what did queue carries on in the pill.
        if (result.failed.length && !result.queued) throw new Error(result.failed[0]!.error);
      }
      else if (choice() === 'pack' && pack()) await firstInstance.installPack(pack()!);
      else if (choice() === 'blank') await firstInstance.createBlank();
      // Some paths already advance; going to the step directly never skips past it.
      await onboarding.goTo('complete');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-vesta="welcome-first">
      <header data-vesta="welcome-head">
        <h2 data-vesta="welcome-title">{t('welcome.first-title')}</h2>
        <p data-vesta="welcome-lead">{t('welcome.first-lead')}</p>
      </header>

      <div data-vesta="welcome-choices" role="radiogroup" aria-label={t('welcome.first-title')}>
        <Show when={launcher()}>
          {(found) => (
            <ChoiceRow
              selected={choice() === 'import'}
              onSelect={() => setChoice('import')}
              icon={<Icon name={found().icon ?? 'icons/actions/move'} size={18} />}
              title={t('welcome.first-import-title')}
              detail={
                moreLaunchers()
                  ? t('welcome.first-import-more', { launcher: found().label, count: moreLaunchers() })
                  : found().instanceCount
                    ? t('welcome.first-import-count', { launcher: found().label, count: found().instanceCount! })
                    : t('welcome.first-import-from', { launcher: found().label })
              }
            >
              <Show when={choice() === 'import'}>
                <div data-vesta="welcome-import">
                  <ImportPicker
                    launchers={firstInstance.launchers() ?? []}
                    onSelection={(from, candidates) => setImports({ launcher: from, candidates })}
                  />
                </div>
              </Show>
            </ChoiceRow>
          )}
        </Show>

        <ChoiceRow
          selected={choice() === 'pack'}
          onSelect={() => setChoice('pack')}
          icon={<Icon name="icons/content/modpack" size={18} />}
          title={t('welcome.first-pack-title')}
          detail={pack() && choice() === 'pack' ? pack()!.name : t('welcome.first-pack-detail')}
        >
          <Show when={choice() === 'pack'}>
            <div data-vesta="welcome-packs">
              <Switch>
                <Match when={firstInstance.packsError()}>
                  {(message) => <p data-vesta="welcome-error">{message()}</p>}
                </Match>
                <Match when={!firstInstance.packs()}>
                  <For each={[0, 1, 2, 3, 4, 5]}>{() => <Skeleton height={64} />}</For>
                </Match>
                <Match when={firstInstance.packs()}>
                  {(packs) => (
                    <For each={packs()} keyed={(item) => item.projectId}>
                      {(item) => (
                        <button
                          type="button"
                          data-vesta="welcome-pack"
                          aria-pressed={pack()?.projectId === item().projectId ? 'true' : 'false'}
                          data-tip={item().summary ? `${item().name}: ${item().summary}` : item().name}
                          onClick={() => setPack(item())}
                        >
                          <span data-vesta="welcome-pack-icon">
                            <Show when={item().iconUrl} fallback={<Icon name="icons/content/modpack" size={18} />}>
                              {(src) => <img src={src()} alt="" loading="lazy" decoding="async" />}
                            </Show>
                          </span>
                          <span data-vesta="welcome-pack-name">{item().name}</span>
                          <span data-vesta="welcome-pack-meta">
                            {[item().minecraft, item().downloads ? formatCompact(item().downloads!, locale()) : undefined]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </button>
                      )}
                    </For>
                  )}
                </Match>
              </Switch>
            </div>
          </Show>
        </ChoiceRow>

        <ChoiceRow
          selected={choice() === 'blank'}
          onSelect={() => setChoice('blank')}
          icon={<Icon name="icons/content/cube" size={18} />}
          title={t('welcome.first-blank-title')}
          detail={
            blank().minecraft
              ? t('welcome.first-blank-detail', { version: blank().minecraft! })
              : t('welcome.first-blank-detail-plain')
          }
        />
      </div>

      <Show when={error()}>
        {(message) => (
          <p data-vesta="welcome-error" role="alert">
            <Icon name="icons/status/error" size={13} />
            <span>{message()}</span>
          </p>
        )}
      </Show>

      <footer data-vesta="welcome-foot">
        <Button variant="ghost" onClick={() => void onboarding.back()}>
          {t('common.back')}
        </Button>
        <span data-vesta="welcome-foot-spacer" />
        <button
          type="button"
          data-vesta="welcome-quiet-link"
          disabled={busy()}
          onClick={() => void firstInstance.skip()}
        >
          {t('welcome.first-skip')}
        </button>
        <Button tone="accent" disabled={!ready() || busy()} onClick={() => void run()}>
          {action()}
        </Button>
      </footer>
    </div>
  );
}

function ChoiceRow(props: {
  selected: boolean;
  onSelect: () => void;
  icon: JSX.Element;
  title: string;
  detail: string;
  children?: JSX.Element;
}) {
  return (
    <div data-vesta="welcome-choice" data-selected={props.selected ? '' : undefined}>
      <button
        type="button"
        role="radio"
        aria-checked={props.selected ? 'true' : 'false'}
        data-vesta="welcome-choice-button"
        onClick={() => props.onSelect()}
      >
        <span data-vesta="welcome-choice-icon">{props.icon}</span>
        <span data-vesta="welcome-choice-text">
          <span data-vesta="welcome-choice-title">{props.title}</span>
          <span data-vesta="welcome-choice-detail" data-tip-overflow>{props.detail}</span>
        </span>
        <span data-vesta="welcome-choice-radio" aria-hidden="true" />
      </button>
      {props.children}
    </div>
  );
}
