import { describe, expect, test } from 'bun:test';
import {
  SERVER_MODPACK_DELIVERY_LIVE, archiveDecision, archiveLinkSource, bulkRemove, bulkRequiredTarget, bulkSetRequired, canPublish, clientModeOptions,
  clientModeRequest, clientPackMode, clientSubTabs, defaultInstallChoices, draftHasContent, filterEntries, firstRunChoices, installApplyRequest,
  installBlocker, installStagedCount, installWarning, linkProvider, linkReview, linkSourceKind, liveSelection, modpackGates, modpackPath,
  modpackSection, modpackSubTabs, offerToPlayers, packDirectory, packRootCounts, packSourceKind, packUploadTarget, pickProviderVersion,
  publishReducer, resolveSubTab, scratchSelections, serverLinkView, serverModpackPath, syncApplyRequest, updateCheckOutcome, updateEntry,
} from '../src/features/servers/modpack-area-model.ts';
import { isModpackOwned, rowActions } from '../src/features/servers/content-model.ts';
import { seedArchiveInspection, seedPackInstallPlan, seedPackWorkspace, seedRedesignWorkspace, seedServerModpackModel } from '../src/features/servers/fixtures-pack.ts';
import { searchExample } from '../src/features/browse/browse-targets.ts';

const empty = () => {
  const workspace = seedPackWorkspace('fabric');
  workspace.publishedRevision = '0';
  workspace.draft.manifest.entries = [];
  return workspace;
};

describe('modpack source and sub-nav gating', () => {
  test('provider, custom and first-run sources', () => {
    expect(packSourceKind(undefined)).toBe('none');
    expect(packSourceKind(empty())).toBe('none');
    expect(packSourceKind(empty(), true)).toBe('custom');
    expect(packSourceKind(seedPackWorkspace('fabric'))).toBe('custom');
    expect(packSourceKind(seedRedesignWorkspace('provider'))).toBe('provider');
    expect(packSourceKind({ ...seedRedesignWorkspace('provider'), pendingPublication: true })).toBe('provider');
    const customized = { ...seedRedesignWorkspace('provider'), pendingPublication: true, customizingProvider: true };
    expect(packSourceKind(customized)).toBe('custom');
    const withFiles = empty();
    withFiles.draft.manifest.overrideFiles = [{ root: 'overrides', path: 'config/a.toml', sha256: 'a', trashed: false }];
    expect(draftHasContent(withFiles.draft.manifest)).toBe(true);
    withFiles.draft.manifest.overrideFiles[0].trashed = true;
    expect(draftHasContent(withFiles.draft.manifest)).toBe(false);
  });

  test('provider packs lock Files and make Content read-only; players only see Overview', () => {
    const provider = modpackSubTabs('provider', true);
    expect(provider.map((tab) => [tab.id, tab.state])).toEqual([['overview', 'ready'], ['content', 'read-only'], ['files', 'locked'], ['versions', 'ready']]);
    expect(modpackSubTabs('custom', true).every((tab) => tab.state === 'ready')).toBe(true);
    expect(modpackSubTabs('custom', false).map((tab) => tab.id)).toEqual(['overview']);
    expect(modpackSubTabs('none', true).map((tab) => tab.id)).toEqual(['overview']);
    expect(resolveSubTab('files', provider)).toBe('files');
    expect(resolveSubTab('nope', provider)).toBe('overview');
    expect(resolveSubTab('files', modpackSubTabs('custom', false))).toBe('overview');
  });

  test('install on server needs owner/administrator with content.install and pack.edit', () => {
    const view = (granted) => ({ source: 'session', granted, refused: [] });
    expect(modpackGates(view(['content.install', 'pack.edit']), 'owner').installOnServer).toBe(true);
    expect(modpackGates(view(['content.install', 'pack.edit']), 'admin').installOnServer).toBe(true);
    expect(modpackGates(view(['content.install', 'pack.edit']), 'maintainer').installOnServer).toBe(false);
    expect(modpackGates(view(['pack.edit']), 'owner').installOnServer).toBe(false);
    expect(modpackGates(view(['pack.build']), 'owner').publish).toBe(false);
    expect(modpackGates(view(['pack.access']), 'pack-user').download).toBe(true);
    const granted = ['content.install', 'pack.edit'];
    expect(modpackGates({ ...view(granted), roles: ['owner'] }, null).installOnServer).toBe(true);
    expect(modpackGates({ ...view(granted), roles: ['administrator'] }, 'viewer').installOnServer).toBe(true);
    expect(modpackGates({ ...view(granted), roles: [] }, 'owner').installOnServer).toBe(false);
    expect(modpackGates({ ...view(granted), roles: ['custom'] }, null).installOnServer).toBe(false);
    expect(modpackGates({ ...view(granted), roles: ['owner'], refused: ['content.install'] }, null).installOnServer).toBe(false);
  });
});

describe('first run', () => {
  test('linking the server takes a provider or a file (install gate); a custom client pack starts from a file or scratch', () => {
    expect(firstRunChoices('server', { edit: true, installOnServer: true }).map((choice) => [choice.id, choice.enabled])).toEqual([['provider', true], ['upload', true]]);
    expect(firstRunChoices('server', { edit: true, installOnServer: false }).every((choice) => !choice.enabled)).toBe(true);
    expect(firstRunChoices('client', { edit: true, installOnServer: false }).map((choice) => [choice.id, choice.enabled])).toEqual([['upload', true], ['scratch', true]]);
    expect(firstRunChoices('client', { edit: false, installOnServer: true }).every((choice) => !choice.enabled)).toBe(true);
  });

  test('an uploaded file links to its identified provider version, otherwise to the file itself', () => {
    const mrpack = seedArchiveInspection('mrpack');
    expect(archiveLinkSource(mrpack, 'up-1')).toEqual({ source: 'uploaded_archive', uploadId: 'up-1' });
    const identified = { ...mrpack, providerPack: { provider: 'modrinth', projectId: 'fo', versionId: 'v3' } };
    expect(archiveLinkSource(identified, 'up-1')).toEqual({ source: 'provider', provider: 'modrinth', projectId: 'fo', versionId: 'v3' });
  });

  test('an identified provider archive links (not hosted); anything else is hosted', () => {
    const mrpack = seedArchiveInspection('mrpack');
    expect(archiveDecision(mrpack)).toMatchObject({ primary: 'host', link: null, unresolved: ['mods/unresolved.jar'] });
    const identified = { ...mrpack, providerPack: { provider: 'modrinth', projectId: 'fo', versionId: 'v3' } };
    expect(archiveDecision(identified)).toMatchObject({ primary: 'link', link: identified.providerPack });
    // CurseForge manifests name mods, not the pack itself: custom import only.
    expect(archiveDecision(seedArchiveInspection('curseforge')).primary).toBe('host');
    expect(archiveDecision(seedArchiveInspection('zip')).runtimeInferred).toBe(true);
    expect(archiveDecision(seedArchiveInspection('vesta')).runtimeInferred).toBe(false);
  });

  test('start from scratch offers only missing client mods, once each', () => {
    const provider = { provider: 'modrinth', projectId: 'sodium', versionId: 'v1' };
    expect(scratchSelections([
      { kind: 'client_mod_missing', provider }, { kind: 'client_mod_missing', provider: { ...provider, versionId: 'v2' } },
      { kind: 'newer_compatible_version', provider: { ...provider, projectId: 'lithium' } }, { kind: 'minecraft_version_drift', provider: null },
    ])).toEqual([provider]);
  });
});

describe('pack files', () => {
  const files = seedRedesignWorkspace('overrides').draft.manifest.overrideFiles;

  test('roots list their own files; trashed rows hidden; implied and explicit folders first', () => {
    const extra = [...files, { root: 'overrides', path: 'config/deep/x.json', sha256: 'e', trashed: false }];
    expect(packDirectory(extra, 'overrides', '')).toEqual([
      { name: 'config', path: 'config', kind: 'directory', sha256: null },
      { name: 'defaultconfigs', path: 'defaultconfigs', kind: 'directory', sha256: null },
    ]);
    expect(packDirectory(extra, 'overrides', 'config').map((row) => [row.name, row.kind])).toEqual([['deep', 'directory'], ['shared.toml', 'file']]);
    expect(packDirectory(extra, 'client-overrides', 'config').map((row) => row.name)).toEqual(['client.toml']);
    expect(packDirectory(extra, 'server-overrides', 'config').map((row) => row.name)).toEqual(['server.toml']);
    expect(packRootCounts(files)).toEqual({ overrides: 1, 'client-overrides': 1, 'server-overrides': 1 });
  });

  test('uploads respect the portable path allowlist and the blob limit', () => {
    expect(packUploadTarget('config', 'a.toml', 10)).toEqual({ path: 'config/a.toml' });
    expect(packUploadTarget('', 'options.txt', 10)).toEqual({ path: 'options.txt' });
    expect(packUploadTarget('', 'evil.exe', 10)).toEqual({ problem: 'server-pack.upload-path-refused' });
    expect(packUploadTarget('config', 'big.bin', 17 * 1_048_576)).toEqual({ problem: 'server-pack.upload-too-large' });
  });
});

describe('publish state machine', () => {
  const preview = (extra = {}) => ({ draftRevision: '4', publishedRevision: '14', resolvedEntries: [{ id: 'dep' }], reviewSha256: 'sha', valid: true, issues: [], ...extra });
  const gates = { publish: true, forceUpdate: true };

  test('review → choose required → publish freezes the reviewed request', () => {
    let state = publishReducer({ step: 'idle' }, { type: 'review' });
    expect(state.step).toBe('reviewing');
    state = publishReducer(state, { type: 'previewed', preview: preview() });
    expect(canPublish(state, gates)).toBe(true);
    state = publishReducer(state, { type: 'required', value: true });
    expect(canPublish(state, { publish: true, forceUpdate: false })).toBe(false);
    state = publishReducer(state, { type: 'publish' });
    expect(state.step).toBe('publishing');
    expect(state.request).toEqual({ expectedRevision: '14', draftRevision: '4', resolvedEntries: [{ id: 'dep' }], reviewSha256: 'sha', requiredUpdate: true, acknowledgeLowerVersion: false });
    state = publishReducer(state, { type: 'published', outcome: { hostedRevision: '15', minimumRevision: '15' } });
    expect(state).toMatchObject({ step: 'published', required: true });
  });

  test('invalid previews and unacknowledged lower versions cannot publish', () => {
    const invalid = publishReducer({ step: 'reviewing' }, { type: 'previewed', preview: preview({ valid: false }) });
    expect(canPublish(invalid, gates)).toBe(false);
    expect(publishReducer(invalid, { type: 'publish' }).step).toBe('review');
    let lower = publishReducer({ step: 'reviewing' }, { type: 'previewed', preview: preview({ issues: [{ code: 'display_version_lower', entryId: null, severity: 'warning' }] }) });
    expect(canPublish(lower, gates)).toBe(false);
    lower = publishReducer(lower, { type: 'acknowledge', value: true });
    expect(canPublish(lower, gates)).toBe(true);
    expect(publishReducer(lower, { type: 'publish' }).request.acknowledgeLowerVersion).toBe(true);
  });

  test('an uncertain outcome replays the same request; a stale one reviews again', () => {
    const publishing = publishReducer(publishReducer({ step: 'reviewing' }, { type: 'previewed', preview: preview() }), { type: 'publish' });
    const uncertain = publishReducer(publishing, { type: 'failed', code: 'timeout' });
    expect(uncertain.reason).toBe('uncertain');
    const replay = publishReducer(uncertain, { type: 'retry' });
    expect(replay.step).toBe('publishing');
    expect(replay.request).toBe(publishing.request);
    const stale = publishReducer(publishing, { type: 'failed', code: 'stale_target' });
    expect(stale.reason).toBe('stale');
    expect(publishReducer(stale, { type: 'retry' }).step).toBe('reviewing');
    expect(publishReducer(publishing, { type: 'failed', code: 'conflict' }).reason).toBe('invalid');
  });
});

describe('bulk content actions', () => {
  const manifest = seedPackWorkspace('diff').draft.manifest;
  const ids = manifest.entries.map((entry) => entry.id);

  test('remove and required toggle only touch the selection', () => {
    expect(bulkRemove(manifest, [ids[0]]).entries.map((entry) => entry.id)).toEqual(ids.slice(1));
    const optional = bulkSetRequired(manifest, ids.slice(0, 2), false);
    expect(optional.entries.map((entry) => entry.required)).toEqual([false, false, ...manifest.entries.slice(2).map((entry) => entry.required)]);
    expect(bulkRequiredTarget(manifest.entries, ids)).toBe(!manifest.entries.every((entry) => entry.required));
    expect(bulkRequiredTarget(optional.entries, ids.slice(0, 2))).toBe(true);
    expect(liveSelection([...ids, 'gone'], manifest.entries)).toEqual(ids);
  });

  test('search and kind filter; update pins a provider version', () => {
    expect(filterEntries(manifest.entries, '', 'resource_pack').every((entry) => entry.kind === 'resource_pack')).toBe(true);
    expect(filterEntries(manifest.entries, 'SODIUM', 'all').length).toBe(1);
    const sodium = manifest.entries.find((entry) => entry.source.type === 'provider');
    const next = { ...sodium.source, versionId: 'newer' };
    const updated = updateEntry(manifest, sodium.id, { provider: next.provider, projectId: next.projectId, versionId: 'newer' });
    expect(updated.entries.find((entry) => entry.id === sodium.id).source.versionId).toBe('newer');
  });
});

describe('link / update review', () => {
  test('one choice per conflict; project versions replace by default; linking never publishes a client pack', () => {
    const plan = seedPackInstallPlan('conflicts');
    const picks = defaultInstallChoices(plan);
    expect(picks).toEqual({ 'mods/example.jar': 'replace' });
    expect(installApplyRequest(plan, picks)).toEqual({ planId: plan.planId, confirmationToken: plan.confirmationToken, choices: [{ path: 'mods/example.jar', choice: 'replace' }], setAsModpack: false });
    expect(installApplyRequest(plan, {})).toBeNull();
    expect(installStagedCount(plan, { 'mods/example.jar': 'keep' })).toBe(0);
    expect(installApplyRequest(seedPackInstallPlan('archive'), {}).choices).toEqual([]);
  });

  test('the review groups added, updated and removed server entries, overrides and unchanged files', () => {
    const plan = {
      ...seedPackInstallPlan('provider'),
      files: [
        { path: 'mods/new.jar', sha256: 'a', expectedSha256: null, conflict: null, operation: 'added' },
        { path: 'mods/lithium.jar', sha256: 'b', expectedSha256: 'c', conflict: null, operation: 'updated' },
        { path: 'mods/same.jar', sha256: 'd', expectedSha256: 'd', conflict: null, operation: 'unchanged' },
        { path: 'config/pack.toml', sha256: 'e', expectedSha256: null, conflict: null, operation: 'added' },
        { path: 'mods/legacy.jar', sha256: 'f', expectedSha256: null, conflict: null },
      ],
      removed: [['mods/gone.jar', 'g'.repeat(64)]],
    };
    expect(linkReview(plan)).toEqual({ added: ['mods/new.jar', 'mods/legacy.jar'], updated: ['mods/lithium.jar'], removed: ['mods/gone.jar'], overrides: ['config/pack.toml'], unchanged: 1 });
    // Four staged files plus one removal; the unchanged file is not a change.
    expect(installStagedCount(plan, {})).toBe(5);
  });

  test('software switches, invalid and expired plans block apply', () => {
    const now = Date.now();
    expect(installBlocker(seedPackInstallPlan('provider'), now)).toBeNull();
    expect(installBlocker(seedPackInstallPlan('software_switch'), now)).toBe('server-pack.install-switch-first');
    expect(installBlocker({ ...seedPackInstallPlan('provider'), valid: false }, now)).toBe('server-pack.install-invalid');
    expect(installBlocker(seedPackInstallPlan('provider'), now + 3_600_000)).toBe('server-pack.install-expired');
    expect(installWarning('unknown_server_side:mods/a.jar', (id, args) => `${id}|${args.path}`)).toBe('server-pack.warning-unknown-side|mods/a.jar');
    expect(installWarning('something_new', () => 'x')).toBe('something_new');
  });
});

describe('get the modpack and Browse glue', () => {
  test('executable consent names the reviewed revision; linking carries none', () => {
    const review = { reviewId: 'r', revision: '9007199254740993', name: 'Pack', consentRequired: true };
    expect(syncApplyRequest(review, false, false)).toBeNull();
    expect(syncApplyRequest(review, true, false)).toEqual({ reviewId: 'r', consentRevision: '9007199254740993', linkOnly: false, name: 'Pack' });
    expect(syncApplyRequest(review, true, true).consentRevision).toBeNull();
  });

  test('provider version choice prefers a release for the server version', () => {
    const versions = [
      { id: 'b', game_versions: ['1.21.4'], release_type: 'beta' },
      { id: 'r', game_versions: ['1.21.4'], release_type: 'release' },
      { id: 'o', game_versions: ['1.20.1'], release_type: 'release' },
    ];
    expect(pickProviderVersion(versions, '1.21.4').id).toBe('r');
    expect(pickProviderVersion(versions, '1.19')).toBeUndefined();
  });

  test('the search hint example follows the target', () => {
    expect(searchExample({ type: 'mod', minecraftVersion: null, loader: null })).toBe('mc:1.21.1 loader:fabric');
    expect(searchExample({ type: 'plugin', minecraftVersion: '1.21.4', loader: null, server: { software: 'paper' } })).toBe('mc:1.21.4 loader:paper');
    expect(searchExample({ type: 'datapack', minecraftVersion: '1.21.4', loader: null, server: { software: 'vanilla' } })).toBe('mc:1.21.4');
    expect(searchExample({ type: 'mod', minecraftVersion: '1.20.1', loader: null, server: { software: 'neoforge' } })).toBe('mc:1.20.1 loader:neoforge');
    expect(searchExample({ type: 'mod', minecraftVersion: '1.21.4', loader: null, server: { software: 'vanilla' } })).toBe('mc:1.21.4');
  });
});

describe('server modpack link (optional, like an instance linked to a modpack)', () => {
  const linked = () => seedServerModpackModel('linked-custom');

  test('unlinked is a normal state: nothing pending, nothing owned', () => {
    const view = serverLinkView(seedServerModpackModel('none'));
    expect(view).toEqual({ phase: 'unlinked', source: null, installed: null, pending: null, pendingIds: [], owned: [], canChange: true });
    expect(serverLinkView(undefined).phase).toBe('unlinked');
  });

  test('linked: installed identity, owned files, provider reference', () => {
    const view = serverLinkView(linked());
    expect(view.phase).toBe('installed');
    expect(view.installed).toEqual({ source: { source: 'provider', provider: 'modrinth', projectId: 'friends-pack', versionId: 'v2' }, displayVersion: '2' });
    expect(view.owned).toEqual(['mods/fabric-api.jar']);
    expect(view.canChange).toBe(true);
    expect(linkProvider(view.source)).toEqual({ provider: 'modrinth', projectId: 'friends-pack', versionId: 'v2' });
    expect(linkSourceKind(view.source)).toBe('modrinth');
    expect(linkSourceKind({ source: 'uploaded_archive', uploadId: 'u' })).toBe('upload');
    expect(linkProvider({ source: 'uploaded_archive', uploadId: 'u' })).toBeNull();
  });

  test('pending until restart: first install has no confirmed version; an update keeps the installed one', () => {
    const installing = linked();
    installing.serverModpack.installed = null;
    installing.serverModpack.pending = { source: installing.serverModpack.source, displayVersion: '2' };
    installing.serverModpack.pendingIds = ['p-1', 'p-2'];
    installing.serverModpack.state = 'staged_until_restart';
    expect(serverLinkView(installing)).toMatchObject({ phase: 'installing', installed: null, pendingIds: ['p-1', 'p-2'], canChange: false });

    const updating = linked();
    updating.serverModpack.pending = { source: { ...updating.serverModpack.source, versionId: 'v3' }, displayVersion: '3' };
    const view = serverLinkView(updating);
    expect(view).toMatchObject({ phase: 'updating', installed: { displayVersion: '2' }, pending: { displayVersion: '3' }, canChange: false });
    // The installed label never jumps to the pending version.
    expect(view.source.versionId).toBe('v2');

    // Older agents: only source + state. Staged means pending with no invented history.
    const legacy = { serverModpack: { source: { source: 'uploaded_archive', uploadId: 'u' }, displayVersion: '1', files: {}, state: 'staged_until_restart' } };
    expect(serverLinkView(legacy)).toMatchObject({ phase: 'installing', installed: null, pending: { displayVersion: '1' } });
  });

  test('update available only when discovery returns a candidate; pending suppresses it', () => {
    const next = { source: 'provider', provider: 'modrinth', projectId: 'friends-pack', versionId: 'v3' };
    expect(updateCheckOutcome({ installed: null, pending: null, available: next })).toEqual({ step: 'available', source: next });
    expect(updateCheckOutcome({ installed: null, pending: null, available: null })).toEqual({ step: 'current' });
    expect(updateCheckOutcome({ installed: null, pending: { source: next, displayVersion: '3' }, available: next })).toEqual({ step: 'pending' });
  });
});

describe('client pack mode (optional, independent of the server link)', () => {
  const publisher = { publish: true };

  test('defaults to none; sections only exist for a custom pack', () => {
    expect(clientPackMode(undefined)).toBe('none');
    expect(clientPackMode({ ...seedServerModpackModel('none'), clientPack: undefined })).toBe('none');
    expect(clientPackMode(seedServerModpackModel('linked-custom'))).toBe('custom');
    expect(clientSubTabs('none', 'custom', true)).toEqual([]);
    expect(clientSubTabs('server-modpack', 'custom', true)).toEqual([]);
    expect(clientSubTabs('custom', 'custom', true).map((tab) => tab.id)).toEqual(['overview', 'content', 'files', 'versions']);
    expect(clientSubTabs('custom', 'none', true).map((tab) => tab.id)).toEqual(['overview']);
  });

  test('"Same as the server\'s modpack" stays disabled (coming soon) until delivery is live', () => {
    // Delivery went live on 2026-10-29; the gate still governs the disabled path.
    expect(SERVER_MODPACK_DELIVERY_LIVE).toBe(true);
    const options = clientModeOptions(seedServerModpackModel('linked-custom'), publisher, false);
    expect(options.map((option) => [option.id, option.enabled, option.note])).toEqual([
      ['none', true, null], ['server-modpack', false, 'coming-soon'], ['custom', true, null],
    ]);
    // With the flag flipped it still needs a link and publish authority.
    expect(clientModeOptions(seedServerModpackModel('linked-custom'), publisher, true)[1]).toEqual({ id: 'server-modpack', enabled: true, note: null });
    expect(clientModeOptions(seedServerModpackModel('unlinked-custom'), publisher, true)[1]).toEqual({ id: 'server-modpack', enabled: false, note: 'needs-link' });
    expect(clientModeOptions(seedServerModpackModel('linked-custom'), { publish: false }, true).every((option) => !option.enabled && option.note === 'no-permission')).toBe(true);
  });

  test('require-update belongs to following the server modpack; custom keeps its publication policy', () => {
    expect(clientModeRequest('server-modpack', true)).toEqual({ mode: 'server-modpack', requireUpdate: true });
    expect(clientModeRequest('custom', true)).toEqual({ mode: 'custom', requireUpdate: false });
    expect(clientModeRequest('none')).toEqual({ mode: 'none', requireUpdate: false });
  });

  test('"Also offer it to players" after linking: disabled while delivery is not live, hidden once offered', () => {
    expect(offerToPlayers(seedServerModpackModel('linked-custom'), publisher, false)).toEqual({ id: 'server-modpack', enabled: false, note: 'coming-soon' });
    expect(offerToPlayers(seedServerModpackModel('linked-custom'), publisher, true)).toEqual({ id: 'server-modpack', enabled: true, note: null });
    expect(offerToPlayers(seedServerModpackModel('linked-follow'), publisher, true)).toBeNull();
    expect(offerToPlayers(seedServerModpackModel('linked-custom'), { publish: false }, true)).toBeNull();
  });

  test('routes: /pack is the server modpack; client sections live under the client pack', () => {
    expect(modpackSection(undefined)).toBe('server');
    expect(modpackSection('client')).toBe('client');
    expect(modpackSection('files')).toBe('client');
    expect(serverModpackPath('s')).toBe('/servers/s/pack');
    expect(modpackPath('s', 'overview')).toBe('/servers/s/pack/client');
    expect(modpackPath('s', 'versions')).toBe('/servers/s/pack/versions');
  });
});

describe('Resources ownership', () => {
  const gates = { running: false, install: true, update: true, remove: true, toggle: true, cancel: true, identify: true, datapackToggle: true };
  const entry = { kind: 'mod', path: 'mods/fabric-api.jar', filename: 'fabric-api.jar', size: '1', enabled: true, sha256: 'a', provider: { provider: 'modrinth', projectId: 'fabric-api', versionId: '1' }, declared: null, pending: null, pendingId: null, pendingError: null };

  test('rows the server modpack owns are marked (agent flag or link paths); user additions are not', () => {
    const owned = new Set(Object.keys(seedServerModpackModel('linked-custom').serverModpack.files));
    expect(isModpackOwned(entry, owned)).toBe(true);
    expect(isModpackOwned({ ...entry, path: 'mods/mine.jar' }, owned)).toBe(false);
    expect(isModpackOwned({ ...entry, path: 'mods/mine.jar', modpackOwned: true })).toBe(true);
    expect(isModpackOwned(entry)).toBe(false);
  });

  test('owned rows cannot be removed or updated one by one', () => {
    expect(rowActions(entry, gates, true, true)).toMatchObject({ managed: true, remove: false, update: false, toggle: true });
    expect(rowActions(entry, gates, true)).toMatchObject({ managed: false, remove: true, update: true });
  });
});
