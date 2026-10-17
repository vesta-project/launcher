import { Dialog, Skeleton } from '@vesta/ui';
import { For, Match, Switch } from 'solid-js';
import { Icon } from '../../components/icon';
import { t } from '../../localization';
import { closeWorldChoice, installIntoWorld, worldChoice } from './install-actions';

/** Data packs live in a world: after the instance is known, choose which of its worlds. */
export function WorldPickerDialog() {
  return (
    <Dialog
      open={!!worldChoice()}
      onOpenChange={(open) => !open && closeWorldChoice()}
      size="md"
      title={t('browse.world-title')}
      description={
        worldChoice()
          ? t('browse.world-description', { name: worldChoice()!.project.name, title: worldChoice()!.instance.name })
          : undefined
      }
    >
      <div data-vesta="browse-picker">
        <Switch>
          <Match when={worldChoice()?.error}>
            {(message) => <p data-vesta="browse-picker-empty">{message()}</p>}
          </Match>
          <Match when={!worldChoice()?.worlds}>
            <ul data-vesta="browse-picker-list" aria-busy="true">
              <For each={[0, 1, 2]}>
                {() => (
                  <li data-vesta="browse-picker-row">
                    <Skeleton height={36} />
                  </li>
                )}
              </For>
            </ul>
          </Match>
          <Match when={!worldChoice()?.worlds?.length}>
            <p data-vesta="browse-picker-empty">{t('browse.world-empty')}</p>
          </Match>
          <Match when={worldChoice()?.worlds}>
            {(worlds) => (
              <ul data-vesta="browse-picker-list">
                <For each={worlds()} keyed={(world) => world.id}>
                  {(world) => (
                    <li data-vesta="browse-picker-row" data-status="ready">
                      <button
                        type="button"
                        data-vesta="browse-picker-choice"
                        onClick={() => void installIntoWorld(world())}
                      >
                        {world().icon ? (
                          <img
                            data-vesta="browse-picker-icon"
                            src={world().icon}
                            alt=""
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span data-vesta="browse-picker-icon" data-empty="">
                            <Icon name="icons/content/globe" size={16} />
                          </span>
                        )}
                        <span data-vesta="browse-picker-text">
                          <strong>{world().name}</strong>
                          <span>{world().detail ?? ''}</span>
                        </span>
                        <span data-vesta="browse-picker-status" data-status="ready">
                          <Icon name="icons/actions/download" size={12} />
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            )}
          </Match>
        </Switch>
      </div>
    </Dialog>
  );
}
