// Servers > Set up a Vesta Server: pick a machine (LAN list or typed address), enter its
// setup code (or a link code when someone already set it up), confirm the account, done.
import { Button, IconButton, TextField } from '@vesta/ui';
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onSettled } from 'solid-js';
import { Board } from '../../components/board';
import { Icon } from '../../components/icon';
import { transitionTo } from '../../app/transition';
import { detectPlatform } from '../../app/platform';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { activeAccount, addAccount, usePlayerHead } from '../../features/accounts/accounts';
import { codeComplete, canonicalCode, codeRejected, deviceName, enrollProblem, machineState, parseVestaAddress, sortDiscovered, type MachineState } from '../../features/servers/host-model';
import { discoverHosts, discovered, discovering, hostCommand, hosts, loadHostServers, refreshHosts } from '../../features/servers/hosts-store';
import type { HostDiscovery } from '../../features/servers/native-hosts';
import type { AddressProblem } from '../../features/servers/address';
import { CodeField, CommandLine, Steps, Working } from './vesta-parts';
import './vesta-server.css';

type Step = 'find' | 'code' | 'account' | 'waiting' | 'done';
type Purpose = 'claim' | 'link';
interface Target { address: string; hostId: string; name: string; purpose: Purpose }

const steps = [
  { id: 'find', label: 'vesta-server.step.find' },
  { id: 'code', label: 'vesta-server.step.code' },
  { id: 'account', label: 'vesta-server.step.account' },
] as const satisfies readonly { id: Step; label: MessageId }[];

const addressProblems: Record<AddressProblem, MessageId> = {
  empty: 'servers.address.problem-empty',
  scheme: 'servers.address.problem-scheme',
  credentials: 'servers.address.problem-credentials',
  path: 'servers.address.problem-path',
  host: 'servers.address.problem-host',
  port: 'servers.address.problem-port',
  link: 'servers.address.problem-host',
};

const stateLabels: Record<MachineState, MessageId> = {
  ready: 'vesta-server.found.ready',
  linked: 'vesta-server.found.linked',
  claimed: 'vesta-server.found.claimed',
};

const LINK_POLL_MS = 1500;
const LINK_ENDED = ['denied', 'rejected', 'expired', 'cancelled', 'revoked'];

export function VestaSetup() {
  const [step, setStep] = createSignal<Step>('find', { name: 'vesta-setup:step' });
  const [address, setAddress] = createSignal('', { name: 'vesta-setup:address' });
  const [touched, setTouched] = createSignal(false, { name: 'vesta-setup:touched' });
  const [target, setTarget] = createSignal<Target | null>(null, { name: 'vesta-setup:target' });
  const [code, setCode] = createSignal('', { name: 'vesta-setup:code' });
  const [busy, setBusy] = createSignal<string | null>(null, { name: 'vesta-setup:busy' });
  const [problem, setProblem] = createSignal<MessageId | null>(null, { name: 'vesta-setup:problem' });
  const [codeProblem, setCodeProblem] = createSignal<MessageId | null>(null, { name: 'vesta-setup:code-problem' });
  const [linkId, setLinkId] = createSignal<string | null>(null, { name: 'vesta-setup:link-id' });
  const [doneHost, setDoneHost] = createSignal<string | null>(null, { name: 'vesta-setup:done-host' });

  const machines = createMemo(() => sortDiscovered(discovered(), hosts()), { name: 'vesta-setup:machines' });
  const parsed = createMemo(() => parseVestaAddress(address()), { name: 'vesta-setup:parsed' });
  const addressError = () => {
    const value = parsed();
    return touched() && value.kind === 'invalid' ? t(addressProblems[value.problem]) : undefined;
  };
  const account = () => {
    const current = activeAccount();
    return current && current.account_type.toLowerCase() === 'microsoft' && !current.is_expired ? current : undefined;
  };
  const head = usePlayerHead(() => account()?.uuid);

  onSettled(() => void discoverHosts());

  const fail = (reason: unknown, purpose: Purpose) => {
    const message = enrollProblem(reason, purpose);
    if (codeRejected(reason)) {
      setCodeProblem(message);
      setStep('code');
    } else setProblem(message);
  };

  /** A machine was picked: linked ones just sign in; others need a code. */
  const choose = async (found: HostDiscovery, typed?: string) => {
    setProblem(null);
    setCodeProblem(null);
    const state = machineState(found, hosts());
    const name = found.name ?? typed ?? found.address;
    if (state === 'linked') {
      setBusy(found.hostId);
      try {
        await hostCommand((client) => client.signIn(found.hostId));
        await loadHostServers(found.hostId);
        transitionTo('/servers');
      } catch (reason) { setProblem(enrollProblem(reason, 'link')); }
      finally { setBusy(null); }
      return;
    }
    setTarget({ address: typed ?? found.address, hostId: found.hostId, name, purpose: state === 'ready' ? 'claim' : 'link' });
    setCode('');
    setStep('code');
  };

  const lookUp = async (event?: Event) => {
    event?.preventDefault();
    setTouched(true);
    if (parsed().kind === 'invalid') return;
    setBusy('address');
    setProblem(null);
    try {
      const typed = address().trim();
      const found = await hostCommand((client) => client.probe(typed));
      await choose(found, typed);
    } catch (reason) { setProblem(enrollProblem(reason, 'claim')); }
    finally { setBusy((current) => (current === 'address' ? null : current)); }
  };

  const enroll = async () => {
    const current = target();
    const who = account();
    if (!current || !who) return;
    setBusy('enroll');
    setProblem(null);
    const device = t(deviceName(detectPlatform()));
    try {
      if (current.purpose === 'claim') {
        const host = await hostCommand((client) => client.claim(current.address, canonicalCode(code()), who.uuid, device));
        await refreshHosts({ servers: false });
        setDoneHost(host.id);
        setCode('');
        setStep('done');
      } else {
        const link = await hostCommand((client) => client.linkStart(current.address, canonicalCode(code()), who.uuid, device));
        setCode('');
        setLinkId(link.linkId);
        setStep('waiting');
      }
    } catch (reason) { fail(reason, current.purpose); }
    finally { setBusy(null); }
  };

  // While waiting for an owner to approve this device, ask the machine about once a second.
  createEffect(() => (step() === 'waiting' ? linkId() : null), (id) => {
    if (!id) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      if (!live) return;
      try {
        const result = await hostCommand((client) => client.linkPoll(id));
        if (!live) return;
        if (result.state === 'approved') {
          await refreshHosts();
          setDoneHost(target()?.hostId ?? null);
          setStep('done');
          return;
        }
        if (LINK_ENDED.includes(result.state)) {
          setCodeProblem('vesta-server.problem.link-declined');
          setStep('code');
          return;
        }
      } catch (reason) {
        // Polling too fast is harmless; a lost connection means starting the link again.
        const code = (reason as { code?: string }).code;
        if (code !== 'rate_limited' && code !== 'server_busy') {
          setCodeProblem(code === 'not_found' ? 'vesta-server.problem.link-declined' : enrollProblem(reason, 'link'));
          setStep('code');
          return;
        }
      }
      timer = setTimeout(() => void check(), LINK_POLL_MS);
    };
    timer = setTimeout(() => void check(), LINK_POLL_MS);
    return () => { live = false; clearTimeout(timer); };
  }, { name: 'vesta-setup:link-poll' });

  const back = () => {
    setProblem(null);
    if (step() === 'account') setStep('code');
    else if (step() === 'code' || step() === 'waiting') { setCodeProblem(null); setStep('find'); }
    else transitionTo('/servers');
  };

  const flowStep = (): Step | 'done' => (step() === 'waiting' ? 'account' : step() === 'done' ? 'done' : step());

  return (
    <Board class="servers-board">
      <div data-vesta="server-add">
        <Steps steps={steps} current={flowStep()} />
        <Switch>
          <Match when={step() === 'find'}>
            <div data-vesta="server-add-panel">
              <h1>{t('vesta-server.setup.title')}</h1>
              <p>{t('vesta-server.setup.description')}</p>
              <section data-vesta="vesta-machines" aria-labelledby="vesta-machines-heading">
                <header>
                  <h2 id="vesta-machines-heading">{t('vesta-server.setup.on-network')}</h2>
                  <IconButton size="sm" variant="ghost" label={t('servers.refresh')} disabled={discovering()}
                    icon={<Icon name="icons/actions/refresh" />} onClick={() => void discoverHosts()} />
                </header>
                <Show when={machines().length > 0} fallback={
                  <Show when={discovering()} fallback={<p data-vesta="server-muted">{t('vesta-server.setup.none-found')}</p>}>
                    <Working label={t('vesta-server.setup.looking')} />
                  </Show>
                }>
                  <ul>
                    <For each={machines()}>
                      {(found) => {
                        const state = () => machineState(found, hosts());
                        return (
                          <li>
                            <button type="button" data-vesta="vesta-machine" data-state={state()} disabled={!!busy()} aria-busy={busy() === found.hostId ? 'true' : undefined}
                              onClick={() => void choose(found)}>
                              <Icon name="icons/content/server" size={18} />
                              <span data-vesta="vesta-machine-text">
                                <strong>{found.name ?? found.address}</strong>
                                <span>{t(stateLabels[state()])}</span>
                              </span>
                              <Show when={busy() === found.hostId} fallback={<Icon name="icons/controls/chevron-right" size={16} />}>
                                <span data-vesta="vesta-spinner" aria-hidden="true" />
                              </Show>
                            </button>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </Show>
              </section>
              <form data-vesta="vesta-address" onSubmit={(event) => void lookUp(event)}>
                <TextField
                  label={t('vesta-server.setup.address')}
                  description={t('vesta-server.setup.address-help')}
                  placeholder="192.168.1.67"
                  value={address()}
                  onChange={(value) => { setAddress(value); setProblem(null); }}
                  onBlur={() => setTouched(address().trim().length > 0)}
                  error={addressError()}
                  spellcheck={false}
                  autocomplete="off"
                />
                <Button type="submit" disabled={!!busy() || !address().trim()}>
                  {busy() === 'address' ? t('servers.address.checking') : t('servers.continue')}
                </Button>
              </form>
              <Show when={problem()}>{(message) => <p data-vesta="server-callout" data-tone="danger" role="alert">{t(message())}</p>}</Show>
              <footer>
                <Button variant="ghost" onClick={back}>{t('common.cancel')}</Button>
              </footer>
            </div>
          </Match>

          <Match when={step() === 'code' && target()}>
            {(current) => (
              <form data-vesta="server-add-panel" onSubmit={(event) => { event.preventDefault(); if (codeComplete(code())) { setCodeProblem(null); setStep('account'); } }}>
                <h1>{t(current().purpose === 'claim' ? 'vesta-server.code.setup-title' : 'vesta-server.code.link-title')}</h1>
                <p>{t(current().purpose === 'claim' ? 'vesta-server.code.setup-help' : 'vesta-server.code.link-help', { name: current().name })}</p>
                <CodeField
                  label={t(current().purpose === 'claim' ? 'vesta-server.code.setup-label' : 'vesta-server.code.link-label')}
                  value={code()}
                  onChange={(value) => { setCode(value); setCodeProblem(null); }}
                  autofocus
                />
                <Show when={codeProblem()}>
                  {(message) => (
                    <div data-vesta="server-callout" data-tone="danger" role="alert">
                      <p>{t(message())}</p>
                      <CommandLine command={current().purpose === 'claim' ? 'vesta setup-code' : 'vesta link'} />
                    </div>
                  )}
                </Show>
                <Show when={!codeProblem()}>
                  <div data-vesta="vesta-hint">
                    <p>{t(current().purpose === 'claim' ? 'vesta-server.code.setup-new' : 'vesta-server.code.link-new')}</p>
                    <CommandLine command={current().purpose === 'claim' ? 'vesta setup-code' : 'vesta link'} />
                  </div>
                </Show>
                <footer>
                  <Button variant="ghost" onClick={back}>{t('common.back')}</Button>
                  <Button type="submit" tone="accent" disabled={!codeComplete(code())}>{t('servers.continue')}</Button>
                </footer>
              </form>
            )}
          </Match>

          <Match when={step() === 'account' && target()}>
            {(current) => (
              <div data-vesta="server-add-panel">
                <h1>{t('vesta-server.account.title')}</h1>
                <p>{t(current().purpose === 'claim' ? 'vesta-server.account.claim-help' : 'vesta-server.account.link-help', { name: current().name })}</p>
                <Show when={account()} fallback={
                  <div data-vesta="server-callout" data-tone="warning">
                    <p>{t('vesta-server.account.missing')}</p>
                    <Button size="sm" onClick={() => void addAccount()}>{t('vesta-server.account.add')}</Button>
                  </div>
                }>
                  {(who) => (
                    <div data-vesta="vesta-account">
                      <Show when={head()} fallback={<span data-vesta="vesta-account-head" aria-hidden="true" />}>
                        {(url) => <img data-vesta="vesta-account-head" src={url()} alt="" />}
                      </Show>
                      <span>
                        <strong>{who().username}</strong>
                        <span>{t('vesta-server.account.microsoft')}</span>
                      </span>
                    </div>
                  )}
                </Show>
                <Show when={problem()}>{(message) => <p data-vesta="server-callout" data-tone="danger" role="alert">{t(message())}</p>}</Show>
                <footer>
                  <Button variant="ghost" disabled={busy() === 'enroll'} onClick={back}>{t('common.back')}</Button>
                  <Button tone="accent" disabled={!account() || busy() === 'enroll'} onClick={() => void enroll()}>
                    {busy() === 'enroll' ? t('vesta-server.account.working') : t(current().purpose === 'claim' ? 'vesta-server.account.claim' : 'vesta-server.account.link')}
                  </Button>
                </footer>
              </div>
            )}
          </Match>

          <Match when={step() === 'waiting' && target()}>
            {(current) => (
              <div data-vesta="server-add-panel">
                <h1>{t('vesta-server.waiting.title')}</h1>
                <p>{t('vesta-server.waiting.help', { name: current().name })}</p>
                <Working label={t('vesta-server.waiting.status')} />
                <div data-vesta="vesta-hint">
                  <p>{t('vesta-server.waiting.on-machine')}</p>
                  <CommandLine command="vesta link --approve" />
                </div>
                <footer>
                  <Button variant="ghost" onClick={back}>{t('common.cancel')}</Button>
                </footer>
              </div>
            )}
          </Match>

          <Match when={step() === 'done' && target()}>
            {(current) => (
              <div data-vesta="server-add-panel" data-vesta-done>
                <span data-vesta="server-add-done-icon"><Icon name="icons/controls/success" size={28} /></span>
                <h1>{t(current().purpose === 'claim' ? 'vesta-server.done.claimed' : 'vesta-server.done.linked', { name: current().name })}</h1>
                <p>{t(current().purpose === 'claim' ? 'vesta-server.done.claimed-help' : 'vesta-server.done.linked-help')}</p>
                <footer>
                  <Show when={current().purpose === 'claim'}>
                    <Button variant="ghost" onClick={() => transitionTo('/servers')}>{t('vesta-server.done.later')}</Button>
                  </Show>
                  <Button tone="accent" onClick={() => transitionTo(current().purpose === 'claim' ? `/servers/host/${doneHost() ?? current().hostId}/import` : '/servers')}>
                    {t(current().purpose === 'claim' ? 'vesta-server.done.first-server' : 'vesta-server.done.show-servers')}
                  </Button>
                </footer>
              </div>
            )}
          </Match>
        </Switch>
      </div>
    </Board>
  );
}
