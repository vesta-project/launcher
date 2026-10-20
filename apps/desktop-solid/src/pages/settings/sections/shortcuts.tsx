import { Button, Dialog } from '@vesta/ui';
import { For, Show, createSignal } from 'solid-js';
import { detectPlatform } from '../../../app/platform';
import { Icon } from '../../../components/icon';
import {
  shortcuts,
  shortcutError,
  chordKeys,
  chordFromEvent,
  setShortcut,
  resetShortcut,
  shortcutGroups,
  type Shortcut,
} from '../../../features/settings/shortcuts';
import { t } from '../../../localization';
import { Keycaps } from '../parts';
import { Card } from '../parts';
import './shortcuts.css';

export function ShortcutsSettings() {
  const [recording, setRecording] = createSignal<string>();
  const [conflict, setConflict] = createSignal<{
    id: string;
    chord: string;
    with: Shortcut;
  }>();
  const platform = detectPlatform();

  const record = (id: string, event: KeyboardEvent) => {
    if (recording() !== id) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') return setRecording(undefined);
    if (event.key === 'Backspace' || event.key === 'Delete') {
      setShortcut(id, null);
      return setRecording(undefined);
    }
    const chord = chordFromEvent(event, platform);
    if (!chord) return;
    setRecording(undefined);
    const clash = shortcuts().find((item) => item.id !== id && item.chord === chord);
    if (clash) setConflict({ id, chord, with: clash });
    else setShortcut(id, chord);
  };

  return (
    <>
      <Show when={shortcutError()}><p role="alert">{shortcutError()}</p></Show>
      <For each={shortcutGroups}>
        {(group) => (
          <Card title={t(group.label)}>
            <ul data-vesta="prefs-shortcuts">
              <For each={shortcuts().filter((item) => item.group === group.id)}>
                {(item) => (
                  <li>
                    <div>
                      <strong>{t(item.label)}</strong>
                      <Show when={item.description}>{(description) => <span>{t(description())}</span>}</Show>
                    </div>
                    <button
                      type="button"
                      data-vesta="prefs-chord"
                      data-recording={recording() === item.id ? '' : undefined}
                      aria-label={t('prefs.shortcuts.change', {
                        name: t(item.label),
                      })}
                      onClick={() => setRecording(item.id)}
                      onKeyDown={(event) => record(item.id, event)}
                      onBlur={() => recording() === item.id && setRecording(undefined)}
                    >
                      <Show when={recording() !== item.id} fallback={<span>{t('prefs.shortcuts.press')}</span>}>
                        <Show
                          when={item.chord}
                          fallback={<span data-vesta="prefs-chord-empty">{t('prefs.shortcuts.unassigned')}</span>}
                        >
                          <Keycaps keys={chordKeys(item.chord!, platform)} />
                        </Show>
                      </Show>
                    </button>
                    <Button size="sm" variant="ghost" disabled={!item.chord} onClick={() => setShortcut(item.id, null)}>
                      {t('prefs.shortcuts.clear')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={item.chord === item.defaultChord}
                      onClick={() => resetShortcut(item.id)}
                    >
                      {t('prefs.reset')}
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Card>
        )}
      </For>

      <Dialog
        closeLabel={t('nav.close')}
        size="sm"
        open={!!conflict()}
        onOpenChange={(open) => !open && setConflict(undefined)}
        title={t('prefs.shortcuts.replace-title')}
        description={t('prefs.shortcuts.replace-description', {
          name: conflict() ? t(conflict()!.with.label) : '',
        })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConflict(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button
              tone="accent"
              onClick={() => {
                const pending = conflict();
                setConflict(undefined);
                if (!pending) return;
                setShortcut(pending.id, pending.chord, true);
              }}
            >
              {t('prefs.shortcuts.replace')}
            </Button>
          </>
        }
      />
      <p data-vesta="prefs-note-line">
        <Icon name="icons/status/info" size={12} /> {t('prefs.shortcuts.preview')}
      </p>
    </>
  );
}
