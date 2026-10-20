import { Button, Dialog, Skeleton } from '@vesta/ui';
import { For, Match, Show, Switch, createEffect, createSignal, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { loadReleases, sameVersion, type Release } from '../../../features/changelog/changelog';
import { openExternal } from '../../../features/links/external-links';
import { formatDate, t } from '../../../localization';
import { RichTextView } from '../../browse/project/rich-text-view';
import './changelog-dialog.css';

const anchor = (tag: string) => `changelog-${tag.replace(/[^\w.-]/g, '')}`;

/**
 * "What's new": every release, newest first. The list on the left jumps to a release and
 * follows the reading position as the notes scroll; the running version is marked.
 */
export function ChangelogDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; version: string }) {
  const [releases, setReleases] = createSignal<Release[]>();
  const [error, setError] = createSignal<string>();
  const [active, setActive] = createSignal<string>();
  let notes: HTMLDivElement | undefined;
  let jumping = false;

  const load = () => {
    setError(undefined);
    loadReleases()
      .then((rows) => {
        setReleases(rows);
        if (!untrack(active)) setActive(rows[0]?.tag);
      })
      .catch((reason) => setError(String(reason)));
  };
  createEffect(
    () => props.open,
    (open) => {
      if (open && !untrack(releases)) load();
    },
  );

  // Scroll-spy: the release whose heading last passed the top of the notes is the current one.
  const follow = () => {
    if (jumping || !notes) return;
    const top = notes.getBoundingClientRect().top + 24;
    let current: string | undefined;
    for (const section of notes.querySelectorAll<HTMLElement>('[data-vesta="changelog-release"]')) {
      if (section.getBoundingClientRect().top <= top) current = section.dataset.tag;
      else break;
    }
    setActive(current ?? releases()?.[0]?.tag);
  };
  const jump = (tag: string) => {
    const section = notes?.querySelector<HTMLElement>(`#${anchor(tag)}`);
    if (!section || !notes) return;
    setActive(tag);
    jumping = true;
    const offset = section.getBoundingClientRect().top - notes.getBoundingClientRect().top;
    notes.scrollTo({ top: notes.scrollTop + offset, behavior: 'smooth' });
    setTimeout(() => (jumping = false), 600);
  };

  const date = (value: string) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : formatDate(parsed, { dateStyle: 'medium' });
  };

  return (
    <Dialog closeLabel={t('nav.close')} open={props.open} onOpenChange={props.onOpenChange} size="lg" class="changelog-dialog" title={t('prefs.about.whats-new')}>
      <Switch>
        <Match when={error()}>
          {(message) => (
            <div data-vesta="changelog-message" role="alert">
              <p>{t('prefs.about.changelog-error')}</p>
              <small>{message()}</small>
              <Button size="sm" variant="outline" onClick={load}>
                {t('common.retry')}
              </Button>
            </div>
          )}
        </Match>
        <Match when={!releases()}>
          <div data-vesta="changelog" aria-busy="true">
            <div data-vesta="changelog-versions">
              <For each={[0, 1, 2, 3, 4]}>{() => <Skeleton height={28} />}</For>
            </div>
            <div data-vesta="changelog-notes">
              <Skeleton height={20} width={180} />
              <Skeleton height={14} />
              <Skeleton height={14} width={320} />
            </div>
          </div>
        </Match>
        <Match when={releases()?.length === 0}>
          <p data-vesta="changelog-message">{t('prefs.about.changelog-empty')}</p>
        </Match>
        <Match when={releases()}>
          {(rows) => (
            <div data-vesta="changelog">
              <nav data-vesta="changelog-versions" aria-label={t('prefs.about.changelog-versions')}>
                <For each={rows()} keyed={(row) => row.tag}>
                  {(release) => (
                    <button
                      type="button"
                      data-vesta="changelog-version"
                      aria-current={active() === release().tag ? 'true' : undefined}
                      onClick={() => jump(release().tag)}
                    >
                      <span data-vesta="changelog-version-tag">{release().tag}</span>
                      <Show when={sameVersion(release().tag, props.version)}>
                        <span data-vesta="changelog-badge" data-tone="accent">{t('prefs.about.changelog-current')}</span>
                      </Show>
                      <Show when={release().prerelease && !sameVersion(release().tag, props.version)}>
                        <span data-vesta="changelog-badge">{t('prefs.about.changelog-prerelease')}</span>
                      </Show>
                    </button>
                  )}
                </For>
              </nav>
              <div data-vesta="changelog-notes" ref={(element: HTMLDivElement) => (notes = element)} onScroll={follow}>
                <For each={rows()} keyed={(row) => row.tag}>
                  {(release) => (
                    <section data-vesta="changelog-release" id={anchor(release().tag)} data-tag={release().tag}>
                      <header data-vesta="changelog-release-head">
                        <h3 data-vesta="changelog-release-title">{release().name}</h3>
                        <span data-vesta="changelog-release-meta">
                          {release().tag} · {date(release().publishedAt)}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          class="changelog-release-link"
                          icon={<Icon name="icons/actions/external-link" size={12} />}
                          onClick={() => void openExternal(release().url)}
                        >
                          {t('prefs.about.changelog-github')}
                        </Button>
                      </header>
                      <Show
                        when={release().body.trim()}
                        fallback={<p data-vesta="changelog-release-empty">{t('prefs.about.changelog-no-notes')}</p>}
                      >
                        <RichTextView source={release().body} format="markdown" aria-label={release().name} />
                      </Show>
                    </section>
                  )}
                </For>
              </div>
            </div>
          )}
        </Match>
      </Switch>
    </Dialog>
  );
}
