import { Badge, Button, Dialog, IconButton, SegmentedControl, Select, Switch as Toggle, TextField, toast } from '@vesta/ui';
import { For, Show, createMemo, createSignal, untrack } from 'solid-js';
import { Icon } from '../../../components/icon';
import { SettingRow } from '../../../components/setting-row';
import { t } from '../../../localization';
import type { MessageId } from '../../../localization/messages';
import { gate, roleKey } from '../../../features/servers/capabilities';
import { stableConnectionId } from '../../../features/servers/connection-id';
import { errorMessage } from '../../../features/servers/errors';
import { age, newIntentId, roleLabel } from '../../../features/servers/model';
import { invalidateServerResources, seedServerResource, useServerResource } from '../../../features/servers/resources';
import { accessSourcesResource, devicesResource, invitationsResource, rolesResource, usersResource } from '../../../features/servers/server-resources';
import { serverCommand, useServersClock } from '../../../features/servers/store';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import type { AccessSources, Invitation, IssuedInvitation, RoleSummary, ServerDevice, ServerUser } from '../../../features/servers/native-manage';
import { Sensitive, ServerErrorNote } from '../parts';
import { SettingsGroup, SettingsPage, SettingsPanel } from '../settings-parts';
import { activeDevices, deviceNameProblem, groupAccess, renamable, type AccessPerson } from '../../../features/servers/access-model';
import { IntentMemo } from '../../../features/servers/model';

type View = 'people' | 'invitations' | 'rules';

/** Roles the local console grants; never assignable remotely. */
const LOCAL_ONLY = new Set(['owner', 'administrator']);
/** Automatic sources may only hold public and pack roles. */
const SAFE_SOURCE_ROLES = ['public', 'player'];

export function AccessTab(props: { snapshot: ServerSnapshot }) {
  const can = (capability: string) => gate(props.snapshot.capabilities, capability) === 'allowed';
  const views = (): { value: View; label: MessageId }[] => [
    // People and their devices are one view: devices sit under the person they belong to.
    ...(can('principals.view') || can('devices.revoke') ? [{ value: 'people' as const, label: 'servers.access.people' as MessageId }] : []),
    ...(can('invitations.create') ? [{ value: 'invitations' as const, label: 'servers.access.invitations' as MessageId }] : []),
    ...(can('access-sources.manage') ? [{ value: 'rules' as const, label: 'servers.access.rules' as MessageId }] : []),
  ];
  const [view, setView] = createSignal<View>(untrack(() => views()[0]?.value ?? 'people'), { name: 'server-access:view' });
  return (
    <SettingsPage>
      <Show when={views().length > 1}>
        <div data-vesta="server-settings-bar">
          <SegmentedControl size="md" aria-label={t('servers.tab.access')} value={view()} onChange={(value) => setView(value as View)}
            options={views().map((entry) => ({ value: entry.value, label: t(entry.label) }))} />
        </div>
      </Show>
      <Show when={view() === 'people'}><PeopleView snapshot={props.snapshot} /></Show>
      <Show when={view() === 'invitations'}><InvitationsView snapshot={props.snapshot} /></Show>
      <Show when={view() === 'rules'}><RulesView snapshot={props.snapshot} /></Show>
    </SettingsPage>
  );
}

/** Rank of this device's role, used to offer only roles the server would accept. */
const myRank = (snapshot: ServerSnapshot, roles: RoleSummary[]) => roles.find((role) => role.id === roleKey(snapshot.connection.role))?.rank ?? 0;

/** Roles from the shared cache; an unavailable list offers nothing rather than guessing. */
function useRoles(snapshot: () => ServerSnapshot) {
  const roles = useServerResource(stableConnectionId(snapshot), rolesResource);
  return () => roles.value() ?? [];
}

/**
 * People with management roles first, each with their devices nested under them; pack users
 * (who only download the pack) folded into one group. Revoke and rename stay per device.
 */
function PeopleView(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const can = (capability: string) => gate(props.snapshot.capabilities, capability) === 'allowed';
  const roles = useRoles(() => props.snapshot);
  const users = useServerResource(id, usersResource, { enabled: () => can('principals.view') });
  const devices = useServerResource(id, devicesResource, { enabled: () => can('devices.revoke') });
  const groups = createMemo(() => groupAccess(users.value(), devices.value()), { name: 'server-access:groups' });
  const [editing, setEditing] = createSignal<ServerUser | null>(null, { name: 'server-access:editing' });

  const [renaming, setRenaming] = createSignal<ServerDevice | null>(null, { name: 'server-access:renaming' });
  const [packOpen, setPackOpen] = createSignal(false, { name: 'server-access:pack-open' });
  const canManage = () => can('principals.manage');
  const saved = (next: ServerUser) => seedServerResource(id(), usersResource, (users.value() ?? []).map((entry) => (entry.id === next.id ? next : entry)));
  const renamed = (device: ServerDevice, name: string) =>
    seedServerResource(id(), devicesResource, (devices.value() ?? []).map((entry) => (entry.id === device.id ? { ...entry, name } : entry)));
  const loaded = () => !!(users.value() || devices.value());
  const Person = (row: { entry: AccessPerson }) => (
    <PersonRow snapshot={props.snapshot} person={row.entry} roles={roles()} canManage={canManage()} canRevoke={can('devices.revoke')}
      allDevices={devices.value() ?? []} onRole={setEditing} onRevoke={target => {
        const connection = id();
        const previous = devices.value() ?? [];
        toast.undo({ title: t('servers.access.revoke-title', { name: target.name }), undoLabel: 'Undo',
          apply: () => seedServerResource(connection, devicesResource, previous.filter(item => item.id !== target.id)),
          rollback: () => invalidateServerResources(connection, [devicesResource.name, usersResource.name]),
          commit: async () => { await serverCommand(client => client.revokeDevice(connection, target.id, newIntentId())); invalidateServerResources(connection, [devicesResource.name, usersResource.name]); },
          onError: reason => toast.show({ title: t(errorMessage(reason)), tone: 'danger' }) });
      }} onRename={setRenaming} />
  );
  return (
    <>
      <SettingsPanel title={t('servers.access.people')} name="access-people">
        <ServerErrorNote error={users.error() ?? devices.error()} onRetry={() => { void users.refresh(); void devices.refresh(); }} />
        <Show when={loaded()} fallback={<Show when={!users.error() && !devices.error()}><p data-vesta="server-muted" class="server-panel-note">{t('servers.loading')}</p></Show>}>
          <div data-vesta="server-access-people">
            <For each={groups().people} keyed={(entry) => entry.key}>{(entry) => <Person entry={entry()} />}</For>
            <For each={groups().others} keyed={(entry) => entry.key}>{(entry) => <Person entry={entry()} />}</For>
            <Show when={!groups().people.length && !groups().others.length}>
              <p data-vesta="server-muted" class="server-panel-note">{t('servers.access.no-people')}</p>
            </Show>
          </div>
        </Show>
      </SettingsPanel>
      <Show when={groups().packUsers.length}>
        <SettingsGroup title={t('servers.access.pack-users', { count: groups().packUsers.length })} open={packOpen()} onToggle={() => setPackOpen(!packOpen())}
          summary={t('servers.access.pack-users-summary', { count: groups().packUsers.reduce((sum, entry) => sum + activeDevices(entry), 0) })}>
          <p data-vesta="server-muted" class="server-panel-note">{t('servers.access.pack-users-help')}</p>
          <div data-vesta="server-access-people">
            <For each={groups().packUsers} keyed={(entry) => entry.key}>{(entry) => <Person entry={entry()} />}</For>
          </div>
        </SettingsGroup>
      </Show>
      <Show when={editing()} keyed>
        {(user) => <RoleDialog snapshot={props.snapshot} user={user} roles={roles()} onClose={() => setEditing(null)} onSaved={saved} />}
      </Show>
      <Show when={renaming()} keyed>
        {(device) => <RenameDialog snapshot={props.snapshot} device={device} onClose={() => setRenaming(null)} onSaved={(name) => { renamed(device, name); setRenaming(null); }} />}
      </Show>

    </>
  );
}

/** One person: avatar, roles and role change, with their devices nested underneath. */
function PersonRow(props: {
  snapshot: ServerSnapshot; person: AccessPerson; roles: RoleSummary[]; canManage: boolean; canRevoke: boolean; allDevices: ServerDevice[];
  onRole: (user: ServerUser) => void; onRevoke: (device: ServerDevice) => void; onRename: (device: ServerDevice) => void;
}) {
  const now = useServersClock();
  const user = () => props.person.user;
  const count = () => user()?.deviceCount ?? activeDevices(props.person);
  return (
    <div data-vesta="server-access-person" data-self={props.person.self ? '' : undefined}>
      <div data-vesta="setting-row">
        <div data-vesta="server-person">
          <span data-vesta="server-activity-avatar" aria-hidden="true">{(props.person.name || '?').slice(0, 1).toUpperCase()}</span>
          <div data-vesta="setting-row-copy">
            <span data-vesta="setting-row-label">
              {props.person.name || t('servers.access.unknown-person')}
              <Show when={props.person.self}><Badge size="sm" variant="soft" tone="accent">{t('servers.access.you')}</Badge></Show>
              <For each={user()?.roles ?? []}>{(entry) => <Badge size="sm" variant="soft" tone={entry.role.rank >= 90 ? 'accent' : 'neutral'}>{entry.role.name}</Badge>}</For>
            </span>
            <span data-vesta="setting-row-description">{t('servers.access.devices-count', { count: count() })}</span>
          </div>
        </div>
        <Show when={user() && props.canManage && user()!.rank < myRank(props.snapshot, props.roles)}>
          <div data-vesta="setting-row-control">
            <Button size="sm" variant="outline" onClick={() => props.onRole(user()!)}>{t('servers.access.change-role')}</Button>
          </div>
        </Show>
      </div>
      <Show when={props.person.devices.length}>
        <ul data-vesta="server-access-devices" aria-label={t('servers.access.devices-of', { name: props.person.name })}>
          <For each={props.person.devices} keyed={(device) => device.id}>
            {(device) => (
              <li data-revoked={device().revoked ? '' : undefined}>
                <Icon name="icons/content/monitor" size={14} />
                <div>
                  <span>
                    {device().current && device().name === 'Vesta Launcher' ? t('servers.access.this-device') : device().name}
                    <Show when={device().current && device().name !== 'Vesta Launcher'}><Badge size="sm" variant="soft" tone="accent">{t('servers.access.this-device')}</Badge></Show>
                    <Show when={device().revoked}><Badge size="sm" variant="soft" tone="danger">{t('servers.access.revoked')}</Badge></Show>
                  </span>
                  <Show when={device().lastSeenAtMs}>
                    {(seen) => <small>{t('servers.seen', { time: t(age(seen(), now()).message, { count: age(seen(), now()).count }) })}</small>}
                  </Show>
                </div>
                <Show when={renamable(device(), props.allDevices)}>
                  <IconButton size="sm" variant="ghost" label={t('servers.access.rename-device', { name: device().name })} icon={<Icon name="icons/actions/edit" />}
                    onClick={() => props.onRename(device())} />
                </Show>
                <Show when={props.canRevoke && !device().current && !device().revoked}>
                  <Button size="sm" variant="ghost" tone="danger" onClick={() => props.onRevoke(device())}>{t('servers.access.revoke')}</Button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function RenameDialog(props: { snapshot: ServerSnapshot; device: ServerDevice; onClose: () => void; onSaved: (name: string) => void }) {
  const [name, setName] = createSignal(untrack(() => props.device.name), { name: 'server-device:rename' });
  const [busy, setBusy] = createSignal(false, { name: 'server-device:rename-busy' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'server-device:rename-error' });
  const intents = new IntentMemo();
  const problem = () => deviceNameProblem(name());
  const save = async () => {
    if (problem()) return;
    const value = name().trim();
    setBusy(true); setError(null);
    const intentId = intents.idFor({ device: props.device.id, name: value });
    try {
      const result = await serverCommand((client) => client.renameDevice(props.snapshot.connection.id, props.device.id, value, intentId));
      intents.settle();
      props.onSaved(result.name);
    } catch (reason) {
      intents.settle(reason as ServerCommandError);
      setError(reason as ServerCommandError);
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }} title={t('servers.access.rename-title')} size="sm"
      footer={<><Button variant="ghost" onClick={props.onClose}>{t('common.cancel')}</Button><Button tone="accent" disabled={busy() || !!problem() || name().trim() === props.device.name} onClick={() => void save()}>{t('servers.save')}</Button></>}>
      <TextField label={t('servers.access.device-name')} value={name()} onChange={setName} maxlength={64}
        error={problem() && problem() !== 'empty' ? t(problem() === 'long' ? 'servers.access.device-name-long' : 'servers.access.device-name-invalid') : undefined} />
      <ServerErrorNote error={error()} />
    </Dialog>
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
  const invitations = useServerResource(id, invitationsResource);
  const [creating, setCreating] = createSignal(false, { name: 'server-access:creating' });
  const reload = () => invalidateServerResources(id(), [invitationsResource.name]);
  const revoke = (invitation: Invitation) => {
    if (!invitation.id) return;
    const connection = id(), target = invitation.id, previous = invitations.value();
    toast.undo({ title: t('servers.access.revoke'), undoLabel: 'Undo',
      apply: () => { if (previous) seedServerResource(connection, invitationsResource, previous.filter(item => item.id !== target)); },
      rollback: () => invalidateServerResources(connection, [invitationsResource.name]),
      commit: async () => { await serverCommand(client => client.revokeInvitation(connection, target, newIntentId())); invalidateServerResources(connection, [invitationsResource.name]); },
      onError: reason => toast.show({ title: t(errorMessage(reason)), tone: 'danger' }) });
  };
  const unsupported = () => invitations.error()?.code === 'unsupported';
  return (
    <SettingsPanel
      title={t('servers.access.invitations')}

      name="access-invitations"
      action={<Show when={!unsupported()}><Button size="sm" tone="accent" icon={<Icon name="icons/actions/add" />} onClick={() => setCreating(true)}>{t('servers.access.invite')}</Button></Show>}
    >
      <Show when={!unsupported()} fallback={<p data-vesta="server-muted" class="server-panel-note">{t('servers.access.invitations-unsupported')}</p>}>
        <ServerErrorNote error={invitations.error()} onRetry={() => void invitations.refresh()} />
        <div data-vesta="settings-panel-body">
          <For each={invitations.value() ?? []} fallback={<Show when={invitations.value()}><p data-vesta="server-muted" class="server-panel-note">{t('servers.access.no-invitations')}</p></Show>}>
            {(invitation) => {
              const left = () => Math.max(0, Math.ceil((invitation.expiresAtMs - now()) / 60_000));
              return (
                <div data-vesta="setting-row">
                  <div data-vesta="setting-row-copy">
                    <span data-vesta="setting-row-label">{t('servers.access.invitation-for', { name: invitation.role.name })}</span>
                    <span data-vesta="setting-row-description" style={{ display: 'flex', gap: 'var(--vesta-space-2)', 'flex-wrap': 'wrap' }}>
                      <span>{t('servers.access.expires-in', { count: left() })}</span>
                      <Show when={invitation.createdBy}>{(who) => <span>{t('servers.access.created-by', { name: who() })}</span>}</Show>
                    </span>
                  </div>
                  <div data-vesta="setting-row-control">
                    <Button size="sm" variant="outline" tone="danger" disabled={!invitation.id} onClick={() => void revoke(invitation)}>{t('servers.access.revoke')}</Button>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
      <Show when={creating()}>
        <InviteDialog snapshot={props.snapshot} roles={roles()} onClose={() => { setCreating(false); reload(); }} />
      </Show>
    </SettingsPanel>
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

const sourceRows: { key: 'anonymous' | 'newUser' | 'whitelist' | 'password'; label: MessageId; help: MessageId }[] = [
  { key: 'anonymous', label: 'servers.access.rule-anonymous', help: 'servers.access.rule-anonymous-help' },
  { key: 'newUser', label: 'servers.access.rule-new-user', help: 'servers.access.rule-new-user-help' },
  { key: 'whitelist', label: 'servers.access.rule-whitelist', help: 'servers.access.rule-whitelist-help' },
  { key: 'password', label: 'servers.access.rule-password', help: 'servers.access.rule-password-help' },
];

function RulesView(props: { snapshot: ServerSnapshot }) {
  const id = stableConnectionId(() => props.snapshot);
  const sources = useServerResource(id, accessSourcesResource);
  const [busy, setBusy] = createSignal(false, { name: 'server-access:sources-busy' });
  const update = async (patch: Partial<Omit<AccessSources, 'version'>>) => {
    const current = sources.value();
    if (!current || busy()) return;
    setBusy(true);
    try { seedServerResource(id(), accessSourcesResource, await serverCommand((client) => client.updateAccessSources(id(), patch, current.version, newIntentId()))); }
    catch (reason) {
      toast.show({ title: t(errorMessage(reason)), tone: 'danger' });
      if ((reason as ServerCommandError).code === 'stale_target') void sources.refresh();
    } finally { setBusy(false); }
  };
  return (
    <SettingsPanel title={t('servers.access.rules')} name="access-rules">
      <ServerErrorNote error={sources.error()} onRetry={() => void sources.refresh()} />
      <Show when={sources.value()}>
        {(current) => (
          <div data-vesta="settings-panel-body">
            <SettingRow label={t('servers.access.rule-whitelist-sync')} description={t('servers.access.rule-whitelist-sync-help')}>
              <Toggle size="sm" aria-label={t('servers.access.rule-whitelist-sync')} disabled={busy()} checked={current().whitelistEnabled} onChange={(value: boolean) => void update({ whitelistEnabled: value })} />
            </SettingRow>
            <For each={sourceRows}>
              {(row) => (
                <SettingRow label={t(row.label)} description={t(row.help)}>
                  <Select size="sm" aria-label={t(row.label)} disabled={busy()} value={current()[row.key]} onChange={(value) => void update({ [row.key]: value })}
                    options={SAFE_SOURCE_ROLES.map((role) => ({ value: role, label: roleLabel(role) }))} />
                </SettingRow>
              )}
            </For>
          </div>
        )}
      </Show>
    </SettingsPanel>
  );
}
