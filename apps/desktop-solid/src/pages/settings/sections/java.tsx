import { IconTile } from '../../../components/icon-tile';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Badge, Button, IconButton, Menu, MenuItem, Skeleton } from '@vesta/ui';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { Icon } from '../../../components/icon';
import { buildJavaEnvironments, type JavaEnvironment, type JavaRuntime } from '../../../features/settings/java-model';
import { setGlobalJavaPath } from '../../../features/settings/java-service';
import { javaInventory } from '../../../features/settings/resources';
import { copyText } from '../../../platform/clipboard';
import { browseJavaExecutable, canBrowseJava, verifyJavaExecutable } from '../../../platform/java';
import { t } from '../../../localization';
import { Callout, Card } from '../parts';
import './java.css';

type Test = { state: 'busy' } | { state: 'ok'; text: string } | { state: 'failed'; text: string };

/** Java runtimes per game generation: which one each uses, installed or downloadable. */
export function JavaSettings() {
  const environments = createMemo(() => buildJavaEnvironments(javaInventory.data()));
  const [tests, setTests] = createSignal<Record<string, Test>>({});
  const [downloading, setDownloading] = createSignal<Set<number>>(new Set());
  const [error, setError] = createSignal('');
  const key = (major: number, runtime: JavaRuntime) => `${major}:${runtime.source}:${runtime.path ?? 'missing'}`;

  const activate = async (major: number, runtime: JavaRuntime) => {
    if (!runtime.path) return;
    const path = runtime.path;
    // Optimistic: the radio moves now; the host confirms in the background.
    javaInventory.set({
      ...javaInventory.data(),
      global: [
        ...javaInventory.data().global.filter((entry) => entry.major_version !== major),
        {
          major_version: major,
          path,
          is_managed: runtime.source === 'managed',
          is_active: true,
        },
      ],
    });
    if (isTauri())
      await setGlobalJavaPath(major, path, runtime.source === 'managed').catch((reason: unknown) => {
        setError(String(reason));
        void javaInventory.refresh(true);
      });
  };

  const download = async (major: number) => {
    setDownloading((set) => new Set(set).add(major));
    try {
      if (isTauri()) await invoke('download_managed_java', { version: major });
      else await new Promise((resolve) => setTimeout(resolve, 900));
      const path = `~/.vesta/java/${major}/bin/java`;
      if (!isTauri()) {
        javaInventory.set({
          ...javaInventory.data(),
          managed: [...javaInventory.data().managed, { path, major_version: major, is_64bit: true }],
        });
        await activate(major, { source: 'managed', path, active: false });
      } else {
        await javaInventory.refresh(true);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setDownloading((set) => {
        const next = new Set(set);
        next.delete(major);
        return next;
      });
    }
  };

  const test = async (major: number, runtime: JavaRuntime) => {
    if (!runtime.path) return;
    const id = key(major, runtime);
    setTests((all) => ({ ...all, [id]: { state: 'busy' } }));
    try {
      const info = await verifyJavaExecutable(runtime.path);
      setTests((all) => ({
        ...all,
        [id]: {
          state: 'ok',
          text: t('prefs.java.verified', {
            version: info.major_version,
            bits: info.is_64bit ? '64' : '32',
          }),
        },
      }));
    } catch (reason) {
      setTests((all) => ({
        ...all,
        [id]: {
          state: 'failed',
          text: reason instanceof Error ? reason.message : String(reason),
        },
      }));
    }
  };

  const browse = async (environment: JavaEnvironment) => {
    try {
      const path = await browseJavaExecutable();
      if (!path) return;
      const info = await verifyJavaExecutable(path);
      if (info.major_version !== environment.major) {
        setError(
          t('prefs.java.wrong-version', {
            found: info.major_version,
            expected: environment.major,
          }),
        );
        return;
      }
      setError('');
      javaInventory.set({
        ...javaInventory.data(),
        global: [
          ...javaInventory.data().global.filter((entry) => entry.path !== path),
          {
            major_version: environment.major,
            path,
            is_managed: false,
            is_active: false,
          },
        ],
      });
      await activate(environment.major, {
        source: 'custom',
        path,
        active: false,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const sourceLabel = (source: JavaRuntime['source']) => t(`prefs.java.source-${source}` as never);

  return (
    <>
      <div data-vesta="prefs-java-toolbar">
        <p>{t('prefs.java.environments-description')}</p>
        <Button
          variant="outline"
          disabled={javaInventory.refreshing()}
          icon={<Icon name="icons/actions/refresh" />}
          onClick={() => void javaInventory.refresh(true)}
        >
          {javaInventory.refreshing() ? t('prefs.java.scanning') : t('prefs.java.rescan')}
        </Button>
      </div>
      <Show when={error()}>
        <Card danger>
          <Callout tone="danger">{error()}</Callout>
        </Card>
      </Show>

      <Show
        when={javaInventory.ready()}
        fallback={
          <>
            <Skeleton height={132} radius={12} />
            <Skeleton height={132} radius={12} />
          </>
        }
      >
        <For each={environments()}>
          {(environment) => (
            <section
              data-vesta="prefs-java"
              data-using={environment.active ? '' : undefined}
              aria-label={environment.name}
            >
              <header>
                <IconTile hook="prefs-java-mark" tone={environment.active ? 'accent' : 'neutral'}>
                  {environment.major}
                </IconTile>
                <div>
                  <h3>{environment.name}</h3>
                  <p>
                    {environment.active
                      ? t('prefs.java.using', {
                          source: sourceLabel(environment.active.source).toLowerCase(),
                        })
                      : t('prefs.java.none-selected')}
                  </p>
                </div>
                <Show when={canBrowseJava()}>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Icon name="icons/content/folder" />}
                    onClick={() => void browse(environment)}
                  >
                    {t('prefs.java.browse')}
                  </Button>
                </Show>
              </header>
              <ul>
                <For each={environment.runtimes}>
                  {(runtime) => {
                    const id = key(environment.major, runtime);
                    return (
                      <li data-active={runtime.active ? '' : undefined}>
                        <span data-vesta="prefs-java-radio" aria-hidden="true" />
                        <div>
                          <span>
                            <Badge size="sm" tone={runtime.source === 'managed' ? 'accent' : undefined}>
                              {sourceLabel(runtime.source)}
                            </Badge>
                            <Show when={runtime.active}>
                              <Badge size="sm" tone="success">
                                {t('prefs.java.active')}
                              </Badge>
                            </Show>
                          </span>
                          <code>{runtime.path ?? t('prefs.java.not-installed')}</code>
                          <Show when={tests()[id]}>
                            {(result) => (
                              <small data-state={result().state}>
                                {result().state === 'busy' ? t('prefs.testing') : (result() as { text: string }).text}
                              </small>
                            )}
                          </Show>
                        </div>
                        <Show
                          when={runtime.path}
                          fallback={
                            <Button
                              size="sm"
                              tone="accent"
                              disabled={downloading().has(environment.major)}
                              icon={<Icon name="icons/actions/download" />}
                              onClick={() => void download(environment.major)}
                            >
                              {downloading().has(environment.major)
                                ? t('prefs.java.downloading')
                                : t('prefs.java.download')}
                            </Button>
                          }
                        >
                          <Show when={!runtime.active}>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void activate(environment.major, runtime)}
                            >
                              {t('prefs.java.use')}
                            </Button>
                          </Show>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={tests()[id]?.state === 'busy'}
                            onClick={() => void test(environment.major, runtime)}
                          >
                            {t('prefs.test')}
                          </Button>
                          <Menu
                            placement="bottom-end"
                            trigger={(menuProps) => (
                              <IconButton
                                {...menuProps}
                                size="sm"
                                variant="ghost"
                                tooltip={false}
                                label={t('prefs.java.actions')}
                                icon={<Icon name="icons/content/ellipsis-v" />}
                              />
                            )}
                          >
                            <MenuItem
                              icon={<Icon name="icons/actions/copy" />}
                              onSelect={() => void copyText(runtime.path!)}
                            >
                              {t('prefs.java.copy-path')}
                            </MenuItem>
                          </Menu>
                        </Show>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </section>
          )}
        </For>
      </Show>
    </>
  );
}
