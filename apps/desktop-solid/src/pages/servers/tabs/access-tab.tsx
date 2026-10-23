import { Badge, Button, Dialog, IconButton, SegmentedControl, Select, Switch as Toggle, toast } from '@vesta/ui';
import { For, Show, createEffect, createSignal, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { SettingRow } from '../../../components/setting-row';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { gate, roleKey } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { errorMessage } from '../../../features/servers/errors';
import { age, newIntentId, roleLabel } from '../../../features/servers/model';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import type { AccessSources, Invitation, IssuedInvitation, RoleSummary, ServerDevice, ServerUser } from '../../../features/servers/native-manage';
import { Sensitive, ServerErrorNote } from '../parts';
import '../../library/instance/settings-tab.css';

type View = 'people' | 'invitations' | 'devices' | 'rules';

/** Roles the local console grants; never assignable remotely. */
const LOCAL_ONLY = new Set(['owner', 'administrator']);
/** Automatic sources may only hold public and pack roles. */
const SAFE_SOURCE_ROLES = ['public', 'player'];

export function AccessTab(props: { snapshot: ServerSnapshot }) {
  const can = (capability: string) => gate(props.snapshot.capabilities, capability) !== 'denied';
  const views = (): { value: View; label: MessageId }[] => [
    ...(can('principals.view') ? [{ value: 'people' as const, label: 'servers.access.people' as MessageId }] : []),
    ...(can('invitations.create') ? [{ value: 'invitations' as const, label: 'servers.access.invitations' as MessageId }] : []),
    ...(can('devices.revoke') ? [{ value: 'devices' as const, label: 'servers.access.devices' as MessageId }] : []),
    ...(can('access-sources.manage') ? [{ value: 'rules' as const, label: 'servers.access.rules' as MessageId }] : []),
  ];
  const [view, setView] = createSignal<View>(untrack(() => views()[0]?.value ?? 'people'), { name: 'server-access:view' });
  return (
    <div data-vesta="server-activity">
      <div data-vesta="pane-toolbar">
        <SegmentedControl size="md" aria-label={t('servers.tab.access')} value={view()} onChange={(value) => setView(value as View)}
          options={views().map((entry) => ({ value: entry.value, label: t(entry.label) }))} />
      </div>
      <div data-vesta="instance-settings-scroll">
        <Show when={view() === 'people'}><PeopleView snapshot={props.snapshot} /></Show>
        <Show when={view() === 'invitations'}><InvitationsView snapshot={props.snapshot} /></Show>
        <Show when={view() === 'devices'}><DevicesView snapshot={props.snapshot} /></Show>
        <Show when={view() === 'rules'}><RulesView snapshot={props.snapshot} /></Show>
      </div>
    </div>
  );
}

/** Rank of this device's role, used to offer only roles the server would accept. */
const myRank = (snapshot: ServerSnapshot, roles: RoleSummary[]) => roles.find((role) => role.id === roleKey(snapshot.connection.role))?.rank ?? 0;

function useRoles(snapshot: () => ServerSnapshot) {
  const [roles, setRoles] = createSignal<RoleSummary[]>([], { name: 'server-access:roles' });
  createEffect(stableConnectionId(snapshot), (id) => { void serverCommand((client) => client.roles(id)).then(setRoles).catch(() => {}); }, { name: 'server-access:load-roles' });
  return roles;
}

function PeopleView(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const roles = useRoles(() => props.snapshot);
  const [users, setUsers] = createSignal<ServerUser[] | null>(null, { name: 'server-access:users' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-access:users-error' });
  const [editing, setEditing] = createSignal<ServerUser | null>(null, { name: 'server-access:editing' });
  const load = () => serverCommand((client) => client.users(id(), 0)).then((page) => setUsers(page.users)).catch((reason) => setError(reason as ServerCommandError));
  createEffect(id, () => { void load(); }, { name: 'server-access:load-users' });
  const canManage = () => gate(props.snapshot.capabilities, 'principals.manage') !== 'denied';
  return (
    <section data-vesta="settings-panel">
      <h3>{t('servers.access.people')}</h3>
      <ServerErrorNote error={error()} onRetry={() => void load()} />
      <Show when={users()} fallback={<p data-vesta="server-muted" class="server-panel-note">{t('servers.loading')}</p>}>
        {(list) => (
          <div data-vesta="settings-panel-body">
            <For each={list()}>
              {(user) => (
                <div data-vesta="setting-row">
                  <div data-vesta="server-person">
                    <span data-vesta="server-activity-avatar" aria-hidden="true">{user.displayName.slice(0, 1).toUpperCase()}</span>
                    <div data-vesta="setting-row-copy">
                      <span data-vesta="setting-row-label">{user.displayName}</span>
                      <span data-vesta="setting-row-description">{t('servers.access.devices-count', { count: user.deviceCount })}</span>
                    </div>
                  </div>
                  <div data-vesta="setting-row-control">
                    <For each={user.roles}>{(entry) => <Badge size="sm" variant="soft" tone={entry.role.rank >= 90 ? 'accent' : 'neutral'}>{entry.role.name}</Badge>}</For>
                    <Show when={canManage() && user.rank < myRank(props.snapshot, roles())}>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(user)}>{t('servers.access.change-role')}</Button>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
      <p data-vesta="server-muted" class="server-panel-note">{t('servers.access.local-only')}</p>
      <Show when={editing()} keyed>
        {(user) => <RoleDialog snapshot={props.snapshot} user={user} roles={roles()} onClose={() => setEditing(null)} onSaved={(next) => setUsers((current) => current?.map((entry) => (entry.id === next.id ? next : entry)) ?? null)} />}
      </Show>
    </section>
  );
}

function RoleDialog(props: { snapshot: ServerSnapshot; user: ServerUser; roles: RoleSummary[]; onClose: () => void; onSaved: (user: ServerUser) => void }) {
  const assignable = () => props.roles.filter((role) => role.rank < myRank(props.snapshot, props.roles) && !LOCAL_ONLY.has(role.id));
  const current = () => props.user.roles.find((entry) => !LOCAL_ONLY.has(entry.role.id))?.role.id ?? '';
  const [choice, setChoice] = createSignal(untrack(current), { name: 'server-role:choice' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-role:error' });
  const save = async () => {
    const remove = props.user.roles.map((entry) => entry.role.id).filter((role) => role !== choice() && assignable().some((entry) => entry.id === role));
    try {
      const next = await serverCommand((client) => client.userRoles(props.snapshot.connection.id, props.user.id, choice() ? [choice()] : [], remove, props.user.version, newIntentId()));
      props.onSaved(next);
      props.onClose();
    } catch (reason) { setError(reason as ServerCommandError); }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }} title={t('servers.access.role-title', { name: props.user.displayName })} size="sm"
      footer={<><Button variant="ghost" onClick={props.onClose}>{t('common.cancel')}</Button><Button tone="accent" disabled={!choice() || choice() === current()} onClick={() => void save()}>{t('servers.save')}</Button></>}
    >
      <Select aria-label={t('servers.access.role')} value={choice()} onChange={setChoice} options={assignable().map((role) => ({ value: role.id, label: role.name }))} />
      <p data-vesta="server-muted">{t('servers.access.role-help')}</p>
      <ServerErrorNote error={error()} />
    </Dialog>
  );
}

function InvitationsView(props: { snapshot: ServerSnapshot }) {
  const now = useServersClock();
  const id = stableConnectionId(() => props.snapshot);
  const roles = useRoles(() => props.snapshot);
  const [invitations, setInvitations] = createSignal<Invitation[] | null>(null, { name: 'server-access:invitations' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-access:invitations-error' });
  const [creating, setCreating] = createSignal(false, { name: 'server-access:creating' });
  const load = () => serverCommand((client) => client.invitations(id())).then(setInvitations).catch((reason) => setError(reason as ServerCommandError));
  createEffect(id, () => { void load(); }, { name: 'server-access:load-invitations' });
  const revoke = async (invitation: Invitation) => {
    if (!invitation.id) return;
    try { await serverCommand((client) => client.revokeInvitation(id(), invitation.id!, newIntentId())); void load(); }
    catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
  };
  return (
    <section data-vesta="settings-panel">
      <h3>{t('servers.access.invitations')}</h3>
      <div data-vesta="server-panel-actions">
        <p data-vesta="server-muted">{t('servers.access.invite-help')}</p>
        <Button size="sm" tone="accent" icon={<Icon name="icons/actions/add" />} onClick={() => setCreating(true)}>{t('servers.access.invite')}</Button>
      </div>
      <Show when={error()?.code !== 'unsupported'} fallback={<p data-vesta="server-muted" class="server-panel-note">{t('servers.access.invitations-unsupported')}</p>}>
        <ServerErrorNote error={error()} onRetry={() => void load()} />
        <div data-vesta="settings-panel-body">
          <For each={invitations() ?? []} fallback={<p data-vesta="server-muted" class="server-panel-note">{t('servers.access.no-invitations')}</p>}>
            {(invitation) => {
              const left = () => Math.max(0, Math.ceil((invitation.expiresAtMs - now()) / 60_000));
              return (
                <div data-vesta="setting-row">
                  <div data-vesta="setting-row-copy">
                    <span data-vesta="setting-row-label">{t('servers.access.invitation-for', { name: invitation.role.name })}</span>
                    <span data-vesta="setting-row-description">
                      {t('servers.access.expires-in', { count: left() })}
                      <Show when={invitation.createdBy}>{(who) => <> · {t('servers.access.created-by', { name: who() })}</>}</Show>
                    </span>
                  </div>
                  <div data-vesta="setting-row-control">
                    <Button size="sm" variant="ghost" tone="danger" disabled={!invitation.id} onClick={() => void revoke(invitation)}>{t('servers.access.revoke')}</Button>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
      <Show when={creating()}>
        <InviteDialog snapshot={props.snapshot} roles={roles()} onClose={() => { setCreating(false); void load(); }} />
      </Show>
    </section>
  );
}

function InviteDialog(props: { snapshot: ServerSnapshot; roles: RoleSummary[]; onClose: () => void }) {
  const assignable = () => props.roles.filter((role) => role.rank < myRank(props.snapshot, props.roles) && !LOCAL_ONLY.has(role.id));
  const [role, setRole] = createSignal('', { name: 'server-invite:role' });
  const [minutes, setMinutes] = createSignal('30', { name: 'server-invite:minutes' });
  const [issued, setIssued] = createSignal<IssuedInvitation | null>(null, { name: 'server-invite:issued' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-invite:error' });
  const [busy, setBusy] = createSignal(false, { name: 'server-invite:busy' });
  const create = async () => {
    setBusy(true); setError(null);
    try { setIssued(await serverCommand((client) => client.createInvitation(props.snapshot.connection.id, role() || assignable()[0]!.id, Number(minutes()), newIntentId()))); }
    catch (reason) { setError(reason as ServerCommandError); }
    finally { setBusy(false); }
  };
  const copy = (value: string) => { void navigator.clipboard?.writeText(value); toast.show({ title: t('servers.copied'), tone: 'neutral' }); };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }} title={t('servers.access.invite')} size="sm"
      footer={
        <Show when={!issued()} fallback={<Button tone="accent" onClick={props.onClose}>{t('servers.done')}</Button>}>
          <Button variant="ghost" onClick={props.onClose}>{t('common.cancel')}</Button>
          <Button tone="accent" disabled={busy() || assignable().length === 0} onClick={() => void create()}>{t('servers.access.create-invite')}</Button>
        </Show>
      }
    >
      <Show
        when={issued()}
        fallback={
          <>
            <Select aria-label={t('servers.access.role')} value={role() || assignable()[0]?.id} onChange={setRole} options={assignable().map((entry) => ({ value: entry.id, label: entry.name }))} />
            <Select aria-label={t('servers.access.expiry')} value={minutes()} onChange={setMinutes}
              options={['10', '30', '60'].map((value) => ({ value, label: t('servers.access.expires-in', { count: Number(value) }) }))} />
            <p data-vesta="server-muted">{t('servers.access.invite-role-help')}</p>
          </>
        }
      >
        {(invite) => (
          <div data-vesta="server-invite-result">
            <p>{t('servers.access.invite-once')}</p>
            <Show when={invite().pairingLink}>
              {(link) => (
                <div data-vesta="server-invite-value">
                  <span>{t('servers.access.pairing-link')}</span>
                  <code><Sensitive label={t('servers.access.pairing-link')}>{link()}</Sensitive></code>
                  <IconButton size="sm" variant="ghost" label={t('servers.copy')} icon={<Icon name="icons/actions/copy" />} onClick={() => copy(link())} />
                </div>
              )}
            </Show>
            <div data-vesta="server-invite-value">
              <span>{t('servers.sign-in.code-label')}</span>
              <code><Sensitive label={t('servers.sign-in.code-label')}>{invite().code}</Sensitive></code>
              <IconButton size="sm" variant="ghost" label={t('servers.copy')} icon={<Icon name="icons/actions/copy" />} onClick={() => copy(invite().code)} />
            </div>
          </div>
        )}
      </Show>
      <ServerErrorNote error={error()} />
    </Dialog>
  );
}

function DevicesView(props: { snapshot: ServerSnapshot }) {
  const now = useServersClock();
  const id = stableConnectionId(() => props.snapshot);
  const [devices, setDevices] = createSignal<ServerDevice[] | null>(null, { name: 'server-access:devices' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-access:devices-error' });
  const [revoking, setRevoking] = createSignal<ServerDevice | null>(null, { name: 'server-access:revoking' });
  const load = () => serverCommand((client) => client.devices(id())).then(setDevices).catch((reason) => setError(reason as ServerCommandError));
  createEffect(id, () => { void load(); }, { name: 'server-access:load-devices' });
  const revoke = async () => {
    const target = revoking();
    if (!target) return;
    try { await serverCommand((client) => client.revokeDevice(id(), target.id, newIntentId())); setRevoking(null); void load(); }
    catch (reason) { toast.show({ title: t(errorMessage(reason)), tone: 'danger' }); }
  };
  return (
    <section data-vesta="settings-panel">
      <h3>{t('servers.access.devices')}</h3>
      <ServerErrorNote error={error()} onRetry={() => void load()} />
      <div data-vesta="settings-panel-body">
        <For each={devices() ?? []}>
          {(device) => (
            <div data-vesta="setting-row" data-revoked={device.revoked ? '' : undefined}>
              <div data-vesta="setting-row-copy">
                <span data-vesta="setting-row-label">
                  {device.name}
                  <Show when={device.current}><Badge size="sm" variant="soft" tone="accent">{t('servers.access.this-device')}</Badge></Show>
                  <Show when={device.revoked}><Badge size="sm" variant="soft" tone="danger">{t('servers.access.revoked')}</Badge></Show>
                </span>
                <span data-vesta="setting-row-description">
                  {device.userName ?? ''}
                  <Show when={device.lastSeenAtMs}>{(seen) => <> · {t('servers.seen', { time: t(age(seen(), now()).message, { count: age(seen(), now()).count }) })}</>}</Show>
                </span>
              </div>
              <Show when={!device.current && !device.revoked}>
                <div data-vesta="setting-row-control">
                  <Button size="sm" variant="ghost" tone="danger" onClick={() => setRevoking(device)}>{t('servers.access.revoke')}</Button>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
      <Dialog open={!!revoking()} onOpenChange={(open) => { if (!open) setRevoking(null); }} title={t('servers.access.revoke-title', { name: revoking()?.name ?? '' })}
        description={t('servers.access.revoke-description')} size="sm"
        footer={<><Button variant="ghost" onClick={() => setRevoking(null)}>{t('common.cancel')}</Button><Button tone="danger" onClick={() => void revoke()}>{t('servers.access.revoke')}</Button></>}
      />
    </section>
  );
}

const sourceRows: { key: 'anonymous' | 'newUser' | 'whitelist' | 'password'; label: MessageId; help: MessageId }[] = [
  { key: 'anonymous', label: 'servers.access.rule-anonymous', help: 'servers.access.rule-anonymous-help' },
  { key: 'newUser', label: 'servers.access.rule-new-user', help: 'servers.access.rule-new-user-help' },
  { key: 'whitelist', label: 'servers.access.rule-whitelist', help: 'servers.access.rule-whitelist-help' },
  { key: 'password', label: 'servers.access.rule-password', help: 'servers.access.rule-password-help' },
];

function RulesView(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const [sources, setSources] = createSignal<AccessSources | null>(null, { name: 'server-access:sources' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-access:sources-error' });
  const load = () => serverCommand((client) => client.accessSources(id())).then(setSources).catch((reason) => setError(reason as ServerCommandError));
  createEffect(id, () => { void load(); }, { name: 'server-access:load-sources' });
  const update = async (patch: Partial<Omit<AccessSources, 'version'>>) => {
    const current = sources();
    if (!current) return;
    try { setSources(await serverCommand((client) => client.updateAccessSources(id(), patch, current.version, newIntentId()))); }
    catch (reason) {
      toast.show({ title: t(errorMessage(reason)), tone: 'danger' });
      if ((reason as ServerCommandError).code === 'stale_target') void load();
    }
  };
  return (
    <section data-vesta="settings-panel">
      <h3>{t('servers.access.rules')}</h3>
      <p data-vesta="server-muted" class="server-panel-note">{t('servers.access.rules-help')}</p>
      <ServerErrorNote error={error()} onRetry={() => void load()} />
      <Show when={sources()}>
        {(current) => (
          <div data-vesta="settings-panel-body">
            <SettingRow label={t('servers.access.rule-whitelist-sync')} description={t('servers.access.rule-whitelist-sync-help')}>
              <Toggle size="sm" aria-label={t('servers.access.rule-whitelist-sync')} checked={current().whitelistEnabled} onChange={(value: boolean) => void update({ whitelistEnabled: value })} />
            </SettingRow>
            <For each={sourceRows}>
              {(row) => (
                <SettingRow label={t(row.label)} description={t(row.help)}>
                  <Select aria-label={t(row.label)} value={current()[row.key]} onChange={(value) => void update({ [row.key]: value })}
                    options={SAFE_SOURCE_ROLES.map((role) => ({ value: role, label: roleLabel(role) }))} />
                </SettingRow>
              )}
            </For>
          </div>
        )}
      </Show>
    </section>
  );
}
