import { Button, Dialog, Skeleton, TextField, toast } from '@vesta/ui';
import { Show, createSignal } from 'solid-js';
import { SettingRow } from '../../../components/setting-row';
import { t } from '../../../localization';
import { gate } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { gameStopped, isExactSeed, mayOwn, seedProblem, worldConfirmed } from '../../../features/servers/hosting-model';
import type { ServerWorld } from '../../../features/servers/hosting-native';
import { IntentMemo } from '../../../features/servers/model';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import { invalidateServerResources, seedServerResource, useServerResource } from '../../../features/servers/resources';
import { worldResource } from '../../../features/servers/server-resources';
import { serverCommand } from '../../../features/servers/store';
import { CopyValue, SettingsPage, SettingsPanel } from '../settings-parts';
import { Hint, HostingError } from './parts';
import './hosting.css';

/** Settings → World: the world Minecraft loads, its seed, and starting a fresh one. */
export function WorldSection(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const world = useServerResource(id, worldResource);
  const [creating, setCreating] = createSignal(false, { name: 'server-world:creating' });
  const owner = () => mayOwn(props.snapshot.connection.role) && gate(props.snapshot.capabilities, 'config.edit') !== 'denied';
  const stopped = () => gameStopped(props.snapshot);

  return (
    <SettingsPage>
      <SettingsPanel title={t('server-hosting.world')} description={t('server-hosting.world-help')} name="world">
        <HostingError error={world.error()} onRetry={() => void world.refresh()} />
        <Show when={world.value()} fallback={<Show when={!world.error()}><Skeleton height={132} radius={0} /></Show>}>
          {(current) => (
            <div data-vesta="settings-panel-body">
              <SettingRow label={t('server-hosting.world-name')}>
                <span data-vesta="server-setting-value">{current().name}</span>
              </SettingRow>
              <SettingRow label={t('server-hosting.seed')} description={t('server-hosting.seed-description')}>
                <Show when={current().seed} fallback={<span data-vesta="server-setting-value">{t('server-hosting.seed-pending')}</span>}>
                  {(seed) => <CopyValue value={seed()} label={t('server-hosting.copy-seed')} />}
                </Show>
              </SettingRow>
              <SettingRow label={t('server-hosting.configured-seed')} description={t('server-hosting.configured-seed-description')}>
                <span data-vesta="server-setting-value">{current().configuredSeed || t('server-hosting.seed-random')}</span>
              </SettingRow>
            </div>
          )}
        </Show>
      </SettingsPanel>

      <Show when={owner() && world.value()}>
        <SettingsPanel title={t('server-hosting.new-world')} name="new-world">
          <div data-vesta="settings-panel-body">
            <SettingRow label={t('server-hosting.new-world-label')} description={t('server-hosting.new-world-description')}>
              <Button size="sm" variant="outline" disabled={!stopped()} onClick={() => setCreating(true)}>{t('server-hosting.new-world-action')}</Button>
            </SettingRow>
            <Hint when={!stopped()}>{t('server-hosting.stop-first')}</Hint>
          </div>
        </SettingsPanel>
      </Show>

      <Show when={creating() ? world.value() : undefined}>
        {(current) => (
          <NewWorldDialog
            snapshot={props.snapshot}
            world={current()}
            onClose={() => setCreating(false)}
            onCreated={(next) => {
              seedServerResource(id(), worldResource, next);
              // `level-name` and `level-seed` changed in server.properties.
              invalidateServerResources(id(), ['properties']);
              setCreating(false);
            }}
          />
        )}
      </Show>
    </SettingsPage>
  );
}

function NewWorldDialog(props: { snapshot: ServerSnapshot; world: ServerWorld; onClose: () => void; onCreated: (world: ServerWorld) => void }) {
  const [seed, setSeed] = createSignal('', { name: 'server-world:seed' });
  const [typed, setTyped] = createSignal('', { name: 'server-world:confirm' });
  const [busy, setBusy] = createSignal(false, { name: 'server-world:busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-world:error' });
  const [uncertain, setUncertain] = createSignal(false, { name: 'server-world:uncertain' });
  const intents = new IntentMemo();
  const id = () => props.snapshot.connection.id;
  const problem = () => seedProblem(seed());
  const seedHint = () => {
    const value = seed().trim();
    if (!value) return t('server-hosting.seed-hint-random');
    return isExactSeed(value) ? t('server-hosting.seed-hint-exact') : t('server-hosting.seed-hint-text');
  };
  const ready = () => !busy() && !problem() && worldConfirmed(typed(), props.world.name) && gameStopped(props.snapshot);

  const submit = async () => {
    if (!ready()) return;
    const payload = { seed: seed().trim(), revision: props.world.revision, confirm: typed() };
    const intentId = intents.idFor(payload);
    setBusy(true); setError(null);
    try {
      const result = await serverCommand((client) => client.worldNew(id(), payload.seed, payload.revision, payload.confirm, intentId));
      intents.settle();
      toast.show({ title: t('server-hosting.new-world-done'), description: t('server-hosting.new-world-done-description', { name: props.world.name }), tone: 'success' });
      props.onCreated(result.world);
    } catch (reason) {
      const failure = reason as ServerCommandError;
      intents.settle(failure);
      setError(failure);
    } finally {
      setUncertain(intents.uncertain);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(open) => { if (!open && !busy()) props.onClose(); }}
      title={t('server-hosting.new-world-title')}
      description={t('server-hosting.new-world-keeps', { name: props.world.name })}
      footer={
        <>
          <Button variant="ghost" disabled={busy()} onClick={props.onClose}>{t('common.cancel')}</Button>
          <Button tone="accent" disabled={!ready()} onClick={() => void submit()}>
            {uncertain() ? t('server-hosting.try-again') : t('server-hosting.create-world')}
          </Button>
        </>
      }
    >
      <div data-vesta="server-hosting-form" data-server-new-world>
        <TextField size="sm" label={t('server-hosting.new-seed')} placeholder={t('server-hosting.seed-random')} value={seed()}
          description={seedHint()} error={problem() ? t(problem()!) : undefined} disabled={busy()} onChange={setSeed} />
        <TextField size="sm" label={t('server-hosting.type-to-confirm', { name: props.world.name })} value={typed()}
          disabled={busy()} onChange={setTyped} autocomplete="off" spellcheck={false} />
        <Hint when={!gameStopped(props.snapshot)}>{t('server-hosting.stop-first')}</Hint>
        <Hint when={uncertain()}>{t('server-hosting.uncertain')}</Hint>
        <HostingError error={error()} />
      </div>
    </Dialog>
  );
}
