// Servers > Set up a Vesta Server: sign in first, pick a machine (LAN list or typed address).
// A new machine asks for its setup code, checked the moment it is complete; claim follows on
// its own. A machine someone already set up needs no code: the Minecraft account is the
// permission, so this device signs in as that account. Link codes stay as a fallback.
import { Button, IconButton, TextField } from '@vesta/ui';
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onSettled, untrack } from 'solid-js';
import { Board } from '../../components/board';
import { Icon } from '../../components/icon';
import { transitionTo } from '../../app/transition';
import { detectPlatform } from '../../app/platform';
import { t } from '../../localization';
import type { MessageId } from '../../localization/messages';
import { activeAccount, addAccount, usePlayerHead } from '../../features/accounts/accounts';
import { AccountMenu } from '../../features/accounts/account-menu';
import { codeComplete, codeProblem, deviceName, enrollProblemForFind, formatFingerprint, machineState, parseVestaAddress, setupProblem, signInProblem, sortDiscovered, waitSeconds, type MachineState, type SetupProblem } from '../../features/servers/host-model';
import { discoverHosts, discovered, discovering, hostCommand, hosts, loadHostServers, refreshHosts } from '../../features/servers/hosts-store';
import type { HostDiscovery } from '../../features/servers/native-hosts';
import type { AddressProblem } from '../../features/servers/address';
import { CodeInput, CommandLine, Steps, Working, type CodeInputApi, type CodeInputState } from './vesta-parts';
import './vesta-server.css';

type Step = 'find' | 'signin' | 'code' | 'waiting' | 'done';
type Purpose = 'claim' | 'link';
/** entry: typing. checking: PAKE running. accepted: code proven. enrolling: account proof and claim or link. */
type Phase = 'entry' | 'checking' | 'accepted' | 'enrolling';
type Reach = 'checking' | 'online' | 'offline';
/** `setUp`: the machine said it is set up (true) or ready (false); null when it didn't say (outside the LAN). */
interface Target { address: string; hostId: string; name: string; purpose: Purpose; fingerprint: string; setUp: boolean | null }
type StepId = 'account' | 'find' | 'code';

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

const reachLabels: Record<Reach, MessageId> = {
  checking: 'vesta-server.reach.checking',
  online: 'vesta-server.reach.online',
  offline: 'vesta-server.reach.offline',
};

const SETUP_COMMAND = 'sudo vesta setup-code';
const LINK_COMMAND = 'vesta link';
const LINK_POLL_MS = 1500;
/** A light discovery probe while the code screen is open; never faster than this. */
const REACH_MS = 5000;
const LINK_ENDED = ['denied', 'rejected', 'expired', 'cancelled', 'revoked'];
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function VestaSetup() {
  const [step, setStep] = createSignal<Step>('find', { name: 'vesta-setup:step' });
  const [address, setAddress] = createSignal('', { name: 'vesta-setup:address' });
  const [touched, setTouched] = createSignal(false, { name: 'vesta-setup:touched' });
  const [target, setTarget] = createSignal<Target | null>(null, { name: 'vesta-setup:target' });
  // The code stays in memory until setup ends, so a lost exchange can be redone without retyping.
  const [code, setCode] = createSignal('', { name: 'vesta-setup:code' });
  const [phase, setPhase] = createSignal<Phase>('entry', { name: 'vesta-setup:phase' });
  const [codeState, setCodeState] = createSignal<CodeInputState>('idle', { name: 'vesta-setup:code-state' });
  const [verification, setVerification] = createSignal<string | null>(null, { name: 'vesta-setup:verification' });
  const [failure, setFailure] = createSignal<SetupProblem | null>(null, { name: 'vesta-setup:failure' });
  const [retryReady, setRetryReady] = createSignal(true, { name: 'vesta-setup:retry-ready' });
  const [reach, setReach] = createSignal<Reach>('checking', { name: 'vesta-setup:reach' });
  const [busy, setBusy] = createSignal<string | null>(null, { name: 'vesta-setup:busy' });
  const [problem, setProblem] = createSignal<MessageId | null>(null, { name: 'vesta-setup:problem' });
  const [linkId, setLinkId] = createSignal<string | null>(null, { name: 'vesta-setup:link-id' });
  const [doneHost, setDoneHost] = createSignal<string | null>(null, { name: 'vesta-setup:done-host' });
  const [signingIn, setSigningIn] = createSignal(false, { name: 'vesta-setup:signing-in' });
  // Kept with the account it was for: switching account clears it without a write.
  const [signInFailure, setSignInFailure] = createSignal<{ problem: SetupProblem; account: string } | null>(null, { name: 'vesta-setup:signin-failure' });
  const [notice, setNotice] = createSignal<MessageId | null>(null, { name: 'vesta-setup:notice' });

  let codeInput: CodeInputApi | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(retryTimer));

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
  // Account first: until someone is signed in, sign in is the step. Everything typed so far stays put.
  const needsAccount = () => !account() && step() !== 'done';

  onSettled(() => void discoverHosts());

  const resetCode = () => {
    setCode('');
    setPhase('entry');
    setCodeState('idle');
    setVerification(null);
    setFailure(null);
  };

  const failed = (reason: unknown, purpose: Purpose) => {
    const next = setupProblem(reason, purpose);
    setPhase('entry');
    setFailure(next);
    if (next.kind === 'unreachable') setReach('offline');
    if (codeProblem(next.kind)) {
      // The code itself is wrong or used up: shake, clear and start over on the first cell.
      setVerification(null);
      setCodeState('error');
      codeInput?.reject();
    } else setCodeState('idle');
    setRetryWait(next);
  };

  const setRetryWait = (next: SetupProblem) => {
    clearTimeout(retryTimer);
    if (next.kind === 'too-many') {
      setRetryReady(false);
      retryTimer = setTimeout(() => setRetryReady(true), waitSeconds(next.retryAfterMs) * 1000);
    } else setRetryReady(true);
  };

  /** The link code screen, for an owner who approves new devices or someone who has a code. */
  const toLinkCode = (current: Target, why: MessageId | null) => {
    setTarget({ ...current, purpose: 'link' });
    resetCode();
    setNotice(why);
    setReach('online');
    setStep('code');
  };

  const toSignIn = (current: Target) => {
    setTarget({ ...current, purpose: 'link', setUp: true });
    resetCode();
    setNotice(null);
    setSignInFailure(null);
    setStep('signin');
  };

  /** A machine was picked: linked ones just sign in, set up ones sign in as the account, new ones need the setup code. */
  const choose = async (found: HostDiscovery, typed?: string) => {
    setProblem(null);
    setNotice(null);
    const state = machineState(found, hosts());
    const next: Target = {
      address: typed ?? found.address, hostId: found.hostId, name: found.name ?? typed ?? found.address,
      purpose: state === 'ready' ? 'claim' : 'link', fingerprint: found.fingerprint,
      setUp: found.state === 'claimed' ? true : found.state === 'unclaimed' ? false : null,
    };
    if (state === 'linked') {
      setBusy(found.hostId);
      try {
        // Native signs in again with the account on its own if this device lost access.
        await hostCommand((client) => client.signIn(found.hostId));
        await loadHostServers(found.hostId);
        transitionTo('/servers');
      } catch (reason) {
        if (signInProblem(reason).kind === 'approval') toLinkCode(next, 'vesta-server.account.approval');
        else setProblem(enrollProblemForFind(reason));
      }
      finally { setBusy(null); }
      return;
    }
    if (state === 'claimed') return toSignIn(next);
    setTarget(next);
    resetCode();
    setReach('online');
    setStep('code');
  };

  /** No code: this device signs in as the Minecraft account, then shows the machine's servers. */
  const signInWithAccount = async () => {
    const current = target();
    const who = account();
    if (!current || !who || signingIn() || !retryReady()) return;
    setSigningIn(true);
    setSignInFailure(null);
    try {
      const host = await hostCommand((client) => client.signInWithAccount(current.address, current.hostId, who.uuid, t(deviceName(detectPlatform()))));
      await refreshHosts({ servers: false });
      // The servers list shows its own note if this first read doesn't answer.
      await loadHostServers(host.id).catch(() => undefined);
      transitionTo('/servers');
    } catch (reason) {
      if (target() !== current) return;
      const next = signInProblem(reason);
      if (next.kind === 'approval') return toLinkCode(current, 'vesta-server.account.approval');
      setSignInFailure({ problem: next, account: who.uuid });
      setRetryWait(next);
    } finally {
      setSigningIn(false);
    }
  };
  const shownSignInFailure = () => {
    const failure = signInFailure();
    return failure && failure.account === account()?.uuid ? failure.problem : null;
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
    } catch (reason) { setProblem(enrollProblemForFind(reason)); }
    finally { setBusy((current) => (current === 'address' ? null : current)); }
  };

  /** Account proof, then claim or link. Native reuses the proven exchange or redoes it with the code. */
  const enroll = async () => {
    const current = target();
    const who = account();
    if (!current) return;
    if (!who) { setPhase('entry'); return; }
    setPhase('enrolling');
    setFailure(null);
    const device = t(deviceName(detectPlatform()));
    try {
      if (current.purpose === 'claim') {
        const host = await hostCommand((client) => client.claim(current.address, code(), who.uuid, device, verification()));
        await refreshHosts({ servers: false });
        setDoneHost(host.id);
        resetCode();
        setStep('done');
      } else {
        const link = await hostCommand((client) => client.linkStart(current.address, code(), who.uuid, device, verification()));
        resetCode();
        setLinkId(link.linkId);
        setStep('waiting');
      }
    } catch (reason) {
      if (target() === current) failed(reason, current.purpose);
    }
  };

  /** Runs as soon as the last cell is filled: a wrong code is reported right here. */
  const verify = async (value: string) => {
    const current = target();
    if (!current || phase() !== 'entry' || !account()) return;
    setFailure(null);
    setPhase('checking');
    setCodeState('checking');
    try {
      const proven = await hostCommand((client) => client.verifyCode(current.address, value, current.purpose));
      if (target() !== current || code() !== value) return;
      setVerification(proven.verificationId);
      setReach('online');
      setCodeState('success');
      setPhase('accepted');
      // Let the cells settle so the success is seen, then carry on without another click.
      await pause(reducedMotion() ? 400 : 750);
      if (target() !== current || phase() !== 'accepted') return;
      await enroll();
    } catch (reason) {
      if (target() === current && code() === value) failed(reason, current.purpose);
    }
  };

  const retry = () => {
    if (!retryReady()) return;
    if (verification()) void enroll();
    else if (codeComplete(code())) void verify(code());
    else { setFailure(null); codeInput?.focus(); }
  };

  // Keep an eye on the machine while the code screen is open, so going offline shows up
  // before anything is typed. Stops when the screen goes away or the window is hidden.
  createEffect(() => (step() === 'code' && !needsAccount() ? target()?.address ?? null : null), (watched) => {
    if (!watched) return;
    let live = true;
    let inflight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const schedule = () => {
      clearTimeout(timer);
      if (live && !hidden()) timer = setTimeout(() => void probe(), REACH_MS);
    };
    const probe = async () => {
      if (!live || inflight || hidden()) return;
      // The exchange itself proves reachability; don't add a second connection meanwhile.
      if (phase() !== 'entry') return schedule();
      inflight = true;
      try {
        await hostCommand((client) => client.probe(watched));
        if (live) setReach('online');
      } catch {
        if (live) setReach('offline');
      } finally {
        inflight = false;
      }
      schedule();
    };
    const visibility = () => (hidden() ? clearTimeout(timer) : void probe());
    document.addEventListener('visibilitychange', visibility);
    // A machine picked from the list may have been found a while ago: look right away.
    if (untrack(reach) === 'checking') void probe();
    else timer = setTimeout(() => void probe(), REACH_MS);
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, { name: 'vesta-setup:reach' });

  // While waiting for an owner to approve this device, ask the machine about once a second.
  createEffect(() => (step() === 'waiting' ? linkId() : null), (id) => {
    if (!id) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const backToCode = (reason: unknown) => {
      const current = target();
      setStep('code');
      if (current) failed(reason, current.purpose);
    };
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
          setStep('code');
          setFailure({ kind: 'other', message: 'vesta-server.problem.link-declined' });
          return;
        }
      } catch (reason) {
        // Polling too fast is harmless; a lost connection means starting the link again.
        const code = (reason as { code?: string }).code;
        if (code !== 'rate_limited' && code !== 'server_busy') {
          if (code === 'not_found') {
            setStep('code');
            setFailure({ kind: 'other', message: 'vesta-server.problem.link-declined' });
          } else backToCode(reason);
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
    const current = target();
    // A set up machine's link code screen is the fallback from signing in, so go back there.
    if (step() === 'code' && current?.setUp === true) toSignIn(current);
    else if (step() === 'code' || step() === 'waiting' || step() === 'signin') { resetCode(); setNotice(null); setStep('find'); }
    else transitionTo('/servers');
  };

  const steps = (): { id: StepId; label: MessageId }[] => [
    { id: 'account', label: 'vesta-server.step.account' },
    { id: 'find', label: 'vesta-server.step.find' },
    { id: 'code', label: step() === 'signin' ? 'vesta-server.step.connect' : 'vesta-server.step.code' },
  ];

  const flowStep = (): StepId | 'done' =>
    needsAccount() ? 'account' : step() === 'find' ? 'find' : step() === 'done' ? 'done' : 'code';

  const waitText = (ms: number | undefined) => {
    const seconds = waitSeconds(ms);
    return seconds >= 90
      ? t('vesta-server.problem.too-many-minutes', { count: Math.ceil(seconds / 60) })
      : t('vesta-server.problem.too-many-seconds', { count: seconds });
  };

  const FailureNote = (props: { failure: SetupProblem; current: Target }) => (
    <div data-vesta="server-callout" data-tone="danger" role="alert">
      <Switch fallback={<p>{t(props.failure.message)}</p>}>
        <Match when={props.failure.kind === 'unreachable'}>
          <p>{t('vesta-server.problem.unreachable-at', { address: props.current.address })}</p>
        </Match>
        <Match when={props.failure.kind === 'too-many'}>
          <p>{props.failure.retryAfterMs ? waitText(props.failure.retryAfterMs) : t(props.failure.message)}</p>
        </Match>
      </Switch>
      <Show when={props.failure.kind === 'expired-code' && props.current.purpose === 'claim'}>
        <CommandLine command={SETUP_COMMAND} />
      </Show>
      <div data-vesta="vesta-failure-actions">
        <Show when={props.failure.kind === 'claimed'}>
          <Button size="sm" onClick={() => toSignIn(props.current)}>{t('vesta-server.problem.claimed-signin')}</Button>
        </Show>
        <Show when={props.failure.kind === 'account-signin'}>
          <Button size="sm" onClick={() => void addAccount()}>{t('vesta-server.signin.button')}</Button>
        </Show>
        <Show when={!codeProblem(props.failure.kind) && props.failure.kind !== 'claimed' && props.failure.message !== 'vesta-server.problem.link-declined'}>
          <Button size="sm" variant={props.failure.kind === 'account-signin' ? 'ghost' : undefined} disabled={!retryReady()} onClick={retry}>{t('common.retry')}</Button>
        </Show>
      </div>
    </div>
  );

  return (
    <Board class="servers-board">
      <div data-vesta="server-add">
        <Steps steps={steps()} current={flowStep()} />
        <Switch>
          <Match when={needsAccount()}>
            <div data-vesta="server-add-panel">
              <h1>{t('vesta-server.signin.title')}</h1>
              <p>{t('vesta-server.signin.help')}</p>
              <footer>
                <Button variant="ghost" onClick={() => transitionTo('/servers')}>{t('common.cancel')}</Button>
                <Button tone="accent" onClick={() => void addAccount()}>{t('vesta-server.signin.button')}</Button>
              </footer>
            </div>
          </Match>

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

          <Match when={step() === 'signin' && target()}>
            {(current) => (
              <form data-vesta="server-add-panel" onSubmit={(event) => { event.preventDefault(); void signInWithAccount(); }}>
                <h1>{t('vesta-server.account.title', { name: current().name })}</h1>
                <p>{t('vesta-server.account.help', { name: current().name })}</p>
                {/* No code proves this is the machine, so say once which one is trusted. */}
                <div data-vesta="vesta-trust">
                  <p>
                    <Icon name="icons/content/server" size={16} />
                    <span>{t('vesta-server.account.trust', { name: current().name, address: current().address })}</span>
                  </p>
                  <details>
                    <summary>{t('vesta-server.account.details')}</summary>
                    <span>{t('vesta-server.account.fingerprint')}</span>
                    <code>{formatFingerprint(current().fingerprint)}</code>
                  </details>
                </div>
                <Show when={account()}>
                  {(who) => (
                    <div data-vesta="vesta-account">
                      <Show when={head()} fallback={<span data-vesta="vesta-account-head" aria-hidden="true" />}>
                        {(url) => <img data-vesta="vesta-account-head" src={url()} alt="" />}
                      </Show>
                      <span data-vesta="vesta-account-name">
                        <strong>{who().username}</strong>
                        <span>{t('vesta-server.account.minecraft')}</span>
                      </span>
                      <AccountMenu placement="bottom-end" label={t('vesta-server.account.switch')} />
                    </div>
                  )}
                </Show>
                <Show when={signingIn()}>
                  <Working label={t('vesta-server.account.signing-in', { name: current().name })} />
                </Show>
                <Show when={shownSignInFailure()}>
                  {(shown) => (
                    <div data-vesta="server-callout" data-tone={shown().kind === 'no-access' ? 'neutral' : 'danger'} role="alert">
                      <Switch fallback={<p>{t(shown().message)}</p>}>
                        <Match when={shown().kind === 'no-access'}>
                          <p>{t('vesta-server.account.no-access', { name: current().name })}</p>
                        </Match>
                        <Match when={shown().kind === 'unreachable'}>
                          <p>{t('vesta-server.problem.unreachable-at', { address: current().address })}</p>
                        </Match>
                        <Match when={shown().kind === 'too-many'}>
                          <p>{shown().retryAfterMs ? waitText(shown().retryAfterMs) : t(shown().message)}</p>
                        </Match>
                      </Switch>
                      <div data-vesta="vesta-failure-actions">
                        <Show when={shown().kind === 'no-access'}>
                          <Button size="sm" variant="ghost" onClick={() => toLinkCode(current(), null)}>{t('vesta-server.problem.claimed-link')}</Button>
                        </Show>
                        <Show when={shown().kind === 'account-signin'}>
                          <Button size="sm" onClick={() => void addAccount()}>{t('vesta-server.signin.button')}</Button>
                        </Show>
                      </div>
                    </div>
                  )}
                </Show>
                <footer>
                  <Button variant="ghost" disabled={signingIn()} onClick={back}>{t('common.back')}</Button>
                  <Button type="submit" tone="accent" disabled={signingIn() || !retryReady() || !account()}>
                    {t('vesta-server.account.sign-in-as', { name: account()?.username ?? '' })}
                  </Button>
                </footer>
              </form>
            )}
          </Match>

          <Match when={step() === 'code' && target()}>
            {(current) => (
              <form data-vesta="server-add-panel" onSubmit={(event) => { event.preventDefault(); if (codeComplete(code())) retry(); }}>
                <header data-vesta="vesta-code-head">
                  <h1>{t(current().purpose === 'claim' ? 'vesta-server.code.setup-title' : 'vesta-server.code.link-title')}</h1>
                  <p data-vesta="vesta-reach" data-state={reach()} role="status">
                    <span data-vesta="vesta-reach-dot" aria-hidden="true" />
                    {t(reachLabels[reach()], { name: current().name })}
                  </p>
                </header>
                <Show when={notice()}>{(why) => <p data-vesta="server-callout" data-tone="neutral" role="status">{t(why())}</p>}</Show>
                <p>{t(current().purpose === 'claim' ? 'vesta-server.code.setup-help' : 'vesta-server.code.link-help', { name: current().name })}</p>
                <CodeInput
                  label={t(current().purpose === 'claim' ? 'vesta-server.code.setup-label' : 'vesta-server.code.link-label')}
                  value={code()}
                  state={codeState()}
                  autofocus
                  controls={(api) => (codeInput = api)}
                  onChange={(value) => {
                    setCode(value);
                    if (phase() !== 'entry') return;
                    setVerification(null);
                    // Clearing after a wrong code keeps the message up until the next keystroke.
                    if (!value) return;
                    setCodeState('idle');
                    const kind = failure()?.kind;
                    if (kind && kind !== 'too-many') setFailure(null);
                  }}
                  onComplete={(value) => { if (retryReady()) void verify(value); }}
                />
                <Switch>
                  <Match when={phase() === 'checking'}><Working label={t('vesta-server.code.checking')} /></Match>
                  <Match when={phase() === 'accepted'}>
                    <p data-vesta="vesta-working" data-tone="success" role="status">
                      <Icon name="icons/controls/check" size={16} />
                      <span>{t('vesta-server.code.accepted')}</span>
                    </p>
                  </Match>
                  <Match when={phase() === 'enrolling'}>
                    <Working label={t(current().purpose === 'claim' ? 'vesta-server.code.claiming' : 'vesta-server.code.linking', { name: current().name })} />
                  </Match>
                </Switch>
                <Show when={failure()}>{(shown) => <FailureNote failure={shown()} current={current()} />}</Show>
                <Show when={!failure() || failure()!.kind === 'wrong-code'}>
                  <div data-vesta="vesta-hint">
                    <p>{t(current().purpose === 'claim' ? 'vesta-server.code.setup-new' : 'vesta-server.code.link-new')}</p>
                    <CommandLine command={current().purpose === 'claim' ? SETUP_COMMAND : LINK_COMMAND} />
                  </div>
                </Show>
                <Show when={account()}>
                  {(who) => (
                    <div data-vesta="vesta-account" data-size="compact">
                      <Show when={head()} fallback={<span data-vesta="vesta-account-head" aria-hidden="true" />}>
                        {(url) => <img data-vesta="vesta-account-head" src={url()} alt="" />}
                      </Show>
                      <span>{t(current().purpose === 'claim' ? 'vesta-server.code.owner-as' : 'vesta-server.code.link-as', { name: who().username })}</span>
                    </div>
                  )}
                </Show>
                <footer>
                  <Button variant="ghost" disabled={phase() === 'enrolling'} onClick={back}>{t('common.back')}</Button>
                  {/* Outside the LAN a machine doesn't say whether it is set up. */}
                  <Show when={current().purpose === 'claim' && current().setUp === null}>
                    <Button variant="ghost" disabled={phase() !== 'entry'} onClick={() => toSignIn(current())}>{t('vesta-server.code.already-set-up')}</Button>
                  </Show>
                </footer>
              </form>
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
