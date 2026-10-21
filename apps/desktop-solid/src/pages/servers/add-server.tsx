import { Button, Checkbox, SegmentedControl, Select, TextField } from '@vesta/ui';
import { For, Match, Show, Switch, createMemo, createSignal } from 'solid-js';
import { Board } from '../../components/board';
import { Icon } from '../../components/icon';
import { transitionTo } from '../../app/transition';
import { t } from '../../localization';
import { accounts } from '../../features/accounts/accounts';
import { isPairingCode, normalizePairingCode, parseAddressInput, type AddressProblem } from '../../features/servers/address';
import { differingGroups, sameFingerprint } from '../../features/servers/fingerprint';
import { putSnapshot, serverCommand } from '../../features/servers/store';
import type { Discovery, ServerCommandError, ServerSnapshot } from '../../features/servers/native';
import type { MessageId } from '../../localization/messages';
import { roleLabel } from '../../features/servers/model';
import { FingerprintView, ServerErrorNote } from './parts';

type Step = 'address' | 'verify' | 'sign-in' | 'done';
type Method = 'code' | 'minecraft';

const addressProblems: Record<AddressProblem, MessageId> = {
  empty: 'servers.address.problem-empty',
  scheme: 'servers.address.problem-scheme',
  credentials: 'servers.address.problem-credentials',
  path: 'servers.address.problem-path',
  host: 'servers.address.problem-host',
  port: 'servers.address.problem-port',
  link: 'servers.address.problem-link',
};

/** Connect to an existing Vesta server: address → verify identity → sign in. */
export function AddServer() {
  const [step, setStep] = createSignal<Step>('address');
  const [address, setAddress] = createSignal('');
  const [touched, setTouched] = createSignal(false);
  const [discovery, setDiscovery] = createSignal<Discovery | null>(null);
  const [compared, setCompared] = createSignal(false);
  const [method, setMethod] = createSignal<Method>('code');
  const [code, setCode] = createSignal('');
  const [account, setAccount] = createSignal<string | undefined>(undefined);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<ServerCommandError | null>(null);
  const [result, setResult] = createSignal<ServerSnapshot | null>(null);
  /** Explicit consent to keep credentials in memory when secure storage is unavailable. */
  const [memoryOnly, setMemoryOnly] = createSignal(false);
  const storageBlocked = () => discovery()?.secureStorageAvailable === false && !memoryOnly();

  const parsed = createMemo(() => parseAddressInput(address()), { name: 'servers:add-address' });
  const problem = () => {
    const value = parsed();
    return touched() && value.kind === 'invalid' ? t(addressProblems[value.problem]) : undefined;
  };
  const linkMatches = () => {
    const found = discovery();
    return !!found?.expectedFingerprint && sameFingerprint(found.expectedFingerprint, found.fingerprint);
  };
  const linkMismatch = () => {
    const found = discovery();
    return !!found?.expectedFingerprint && !sameFingerprint(found.expectedFingerprint, found.fingerprint);
  };
  const usableAccounts = () => accounts().filter((entry) => entry.account_type.toLowerCase() === 'microsoft' && !entry.is_expired);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await work(); }
    catch (reason) { setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };

  const discover = (event?: Event) => {
    event?.preventDefault();
    setTouched(true);
    if (parsed().kind === 'invalid') return;
    void run(async () => {
      const found = await serverCommand((client) => client.discover(address()));
      setDiscovery(found);
      setCompared(false);
      if (found.linkCode) setCode(found.linkCode);
      setStep('verify');
    });
  };

  const signIn = (event?: Event) => {
    event?.preventDefault();
    const found = discovery();
    if (!found) return;
    void run(async () => {
      const snapshot = method() === 'code'
        ? await serverCommand((client) => client.pair(found.discoveryId, normalizePairingCode(code()), { memoryOnly: memoryOnly() }))
        : await serverCommand((client) => client.signInMinecraft(found.discoveryId, account() ?? usableAccounts()[0]!.uuid, { memoryOnly: memoryOnly() }));
      putSnapshot(snapshot);
      setResult(snapshot);
      setStep('done');
    });
  };

  const back = () => {
    setError(null);
    if (step() === 'sign-in') setStep('verify');
    else if (step() === 'verify') setStep('address');
    else transitionTo('/servers');
  };

  return (
    <Board class="servers-board">
      <div data-vesta="server-add">
        <nav data-vesta="server-add-steps" aria-label={t('servers.add-steps')}>
          <StepIndicator current={step()} />
        </nav>
        <Switch>
          <Match when={step() === 'address'}>
            <form data-vesta="server-add-panel" onSubmit={discover}>
              <h1>{t('servers.add-title')}</h1>
              <p>{t('servers.add-description')}</p>
              <TextField
                label={t('servers.address.label')}
                description={t('servers.address.help')}
                placeholder="play.example.net:8443"
                value={address()}
                onChange={(value) => { setAddress(value); setError(null); }}
                onBlur={() => setTouched(address().trim().length > 0)}
                error={problem()}
                autofocus
                spellcheck={false}
                autocomplete="off"
              />
              <ServerErrorNote error={error()} onRetry={discover} />
              <footer>
                <Button variant="ghost" onClick={back}>{t('common.cancel')}</Button>
                <Button type="submit" tone="accent" disabled={busy() || !address().trim()}>{busy() ? t('servers.address.checking') : t('servers.continue')}</Button>
              </footer>
            </form>
          </Match>

          <Match when={step() === 'verify' && discovery()}>
            {(found) => (
              <div data-vesta="server-add-panel">
                <h1>{t('servers.verify.title')}</h1>
                <dl data-vesta="server-add-facts">
                  <dt>{t('servers.address.label')}</dt><dd>{found().endpoint}</dd>
                  <dt>{t('servers.server-id')}</dt><dd><code>{found().serverId}</code></dd>
                </dl>
                <Show when={found().existingConnectionId}>
                  <p data-vesta="server-callout" data-tone="neutral">{t('servers.verify.already-saved')}</p>
                </Show>
                <h2>{t('servers.fingerprint')}</h2>
                <FingerprintView
                  value={found().fingerprint}
                  highlight={linkMismatch() ? differingGroups(found().expectedFingerprint!, found().fingerprint) : undefined}
                />
                <Switch fallback={<p>{t('servers.verify.compare')}</p>}>
                  <Match when={linkMatches()}>
                    <p data-vesta="server-callout" data-tone="success"><Icon name="icons/security/shield-check" /> {t('servers.verify.link-matches')}</p>
                  </Match>
                  <Match when={linkMismatch()}>
                    <p data-vesta="server-callout" data-tone="danger" role="alert"><Icon name="icons/security/shield-off" /> {t('servers.verify.link-mismatch')}</p>
                  </Match>
                </Switch>
                <Show when={!found().expectedFingerprint}>
                  <Checkbox checked={compared()} onChange={setCompared} label={t('servers.verify.confirm')} />
                </Show>
                <footer>
                  <Button variant="ghost" onClick={back}>{t('common.back')}</Button>
                  <Button tone="accent"
                    disabled={linkMismatch() || (!linkMatches() && !compared())}
                    onClick={() => { setError(null); setStep('sign-in'); }}
                  >{t('servers.verify.trust')}</Button>
                </footer>
              </div>
            )}
          </Match>

          <Match when={step() === 'sign-in'}>
            <form data-vesta="server-add-panel" onSubmit={signIn}>
              <h1>{t('servers.sign-in.title')}</h1>
              <SegmentedControl
                aria-label={t('servers.sign-in.method')}
                value={method()}
                onChange={(value) => { setMethod(value as Method); setError(null); }}
                options={[
                  { value: 'code', label: t('servers.sign-in.code') },
                  { value: 'minecraft', label: t('servers.sign-in.minecraft') },
                ]}
              />
              <Show
                when={method() === 'code'}
                fallback={
                  <>
                    <p>{t('servers.sign-in.minecraft-help')}</p>
                    <Show when={usableAccounts().length > 0} fallback={<p data-vesta="server-callout" data-tone="warning">{t('servers.sign-in.no-account')}</p>}>
                      <Select
                        aria-label={t('servers.sign-in.account')}
                        value={account() ?? usableAccounts()[0]?.uuid}
                        options={usableAccounts().map((entry) => ({ value: entry.uuid, label: entry.username }))}
                        onChange={(value) => setAccount(value)}
                      />
                    </Show>
                  </>
                }
              >
                <p>{t('servers.sign-in.code-help')}</p>
                <TextField
                  label={t('servers.sign-in.code-label')}
                  value={code()}
                  onChange={(value) => { setCode(value); setError(null); }}
                  spellcheck={false}
                  autocomplete="off"
                  error={code().trim() && !isPairingCode(code()) ? t('servers.sign-in.code-format') : undefined}
                />
              </Show>
              <Show when={discovery()?.secureStorageAvailable === false}>
                <div data-vesta="server-callout" data-tone="warning">
                  <p>{t('servers.sign-in.storage-unavailable')}</p>
                  <Checkbox checked={memoryOnly()} onChange={setMemoryOnly} label={t('servers.sign-in.memory-only')} />
                </div>
              </Show>
              <ServerErrorNote error={error()} />
              <footer>
                <Button variant="ghost" onClick={back}>{t('common.back')}</Button>
                <Button tone="accent"
                  type="submit"
                  disabled={busy() || storageBlocked() || (method() === 'code' ? !isPairingCode(code()) : usableAccounts().length === 0)}
                >{busy() ? t('servers.sign-in.working') : t('servers.sign-in.submit')}</Button>
              </footer>
            </form>
          </Match>

          <Match when={step() === 'done' && result()}>
            {(snapshot) => (
              <div data-vesta="server-add-panel">
                <span data-vesta="server-add-done-icon"><Icon name="icons/controls/success" size={28} /></span>
                <h1>{t('servers.done.title', { name: snapshot().connection.name })}</h1>
                <p>
                  {snapshot().state.access === 'no_management_access'
                    ? t('servers.done.no-management')
                    : snapshot().connection.role
                      ? t('servers.done.paired-as', { name: roleLabel(snapshot().connection.role!) })
                      : t('servers.access.signed-in')}
                </p>
                <footer>
                  <Button variant="ghost" onClick={() => transitionTo('/servers')}>{t('servers.done.all-servers')}</Button>
                  <Button tone="accent" onClick={() => transitionTo(`/servers/${snapshot().connection.id}`)}>{t('servers.open')}</Button>
                </footer>
              </div>
            )}
          </Match>
        </Switch>
      </div>
    </Board>
  );
}

const steps: { id: Step; label: MessageId }[] = [
  { id: 'address', label: 'servers.step.address' },
  { id: 'verify', label: 'servers.step.verify' },
  { id: 'sign-in', label: 'servers.step.sign-in' },
];

function StepIndicator(props: { current: Step }) {
  const index = () => (props.current === 'done' ? steps.length : steps.findIndex((entry) => entry.id === props.current));
  return (
    <ol>
      <For each={steps}>
        {(entry, at) => (
          <li data-state={at() < index() ? 'done' : at() === index() ? 'current' : 'next'} aria-current={at() === index() ? 'step' : undefined}>
            <span>{at() + 1}</span>{t(entry.label)}
          </li>
        )}
      </For>
    </ol>
  );
}
