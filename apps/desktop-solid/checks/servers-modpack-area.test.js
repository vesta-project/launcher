import { describe, expect, test } from 'bun:test';
import {
  archiveDecision, bulkRemove, bulkRequiredTarget, bulkSetRequired, canPublish, defaultInstallChoices, draftHasContent, filterEntries,
  firstRunChoices, installApplyRequest, installBlocker, installSource, installStagedCount, installWarning, liveSelection, modpackGates,
  modpackSubTabs, packDirectory, packRootCounts, packSourceKind, packUploadTarget, pickProviderVersion, publishReducer, resolveSubTab,
  scratchSelections, syncApplyRequest, updateEntry,
} from '../src/features/servers/modpack-area-model.ts';
import { seedArchiveInspection, seedPackInstallPlan, seedPackWorkspace, seedRedesignWorkspace } from '../src/features/servers/fixtures-pack.ts';
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
  });
});

describe('first run', () => {
  test('choices follow pack.edit', () => {
    expect(firstRunChoices({ edit: true }).map((choice) => [choice.id, choice.enabled])).toEqual([['provider', true], ['upload', true], ['scratch', true]]);
    expect(firstRunChoices({ edit: false }).every((choice) => !choice.enabled)).toBe(true);
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

describe('install on this server', () => {
  test('the source is the provider pointer or the current draft', () => {
    const provider = seedRedesignWorkspace('provider');
    expect(installSource(provider, 'provider')).toEqual({ source: 'provider', provider: 'modrinth', projectId: 'pack', versionId: 'v2' });
    expect(installSource(seedPackWorkspace('fabric'), 'custom')).toEqual({ source: 'draft', revision: '3' });
  });

  test('one choice per conflict; project versions replace by default', () => {
    const plan = seedPackInstallPlan('conflicts');
    const picks = defaultInstallChoices(plan);
    expect(picks).toEqual({ 'mods/example.jar': 'replace' });
    expect(installApplyRequest(plan, picks, true)).toEqual({ planId: plan.planId, confirmationToken: plan.confirmationToken, choices: [{ path: 'mods/example.jar', choice: 'replace' }], setAsModpack: true });
    expect(installApplyRequest(plan, {}, true)).toBeNull();
    expect(installStagedCount(plan, { 'mods/example.jar': 'keep' })).toBe(0);
    expect(installApplyRequest(seedPackInstallPlan('archive'), {}, false).choices).toEqual([]);
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
