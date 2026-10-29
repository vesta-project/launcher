import { createContext, createEffect, createMemo, createSignal, onCleanup, untrack, useContext, type Accessor } from 'solid-js';
import { transitionTo } from '../../../app/transition';
import { loadProject, peekProject } from '../../../features/browse/browse-projects';
import type { ResourceProject } from '../../../features/browse/browse-model';
import { initials, serverArt } from '../../../features/servers/art';
import { IntentMemo } from '../../../features/servers/model';
import {
  clientModeRequest, clientPackMode, linkProvider, modpackGates, modpackPath, packSourceKind, serverLinkView, serverModpackPath,
  type ClientPackMode, type LinkReviewMode, type ModpackGates, type ModpackSubTab, type PackSourceKind, type ServerLinkView,
} from '../../../features/servers/modpack-area-model';
import type { ServerCommandError, ServerSnapshot } from '../../../features/servers/native';
import type { PackDraft, PackInstallSource, PackManifest, PackPreview, PackWorkspace } from '../../../features/servers/native-pack';
import { seedServerResource } from '../../../features/servers/resources';
import { packWorkspaceResource } from '../../../features/servers/server-resources';
import { serverCommand } from '../../../features/servers/store';

/** A link or update review of the server's own modpack. */
export interface InstallRequestSource {
  source: PackInstallSource;
  /** What the review calls the pack. */
  name: string;
  mode: LinkReviewMode;
  /** An archive upload to cancel if the review is abandoned. */
  uploadId?: string;
}

export interface ModpackAreaValue {
  snapshot: Accessor<ServerSnapshot>;
  id: Accessor<string>;
  gates: Accessor<ModpackGates>;
  workspace: Accessor<PackWorkspace | undefined>;
  /** The custom client pack's draft state (legacy provider pointer, custom, or nothing yet). */
  kind: Accessor<PackSourceKind>;
  /** The server's own modpack link, independent of what players get. */
  link: Accessor<ServerLinkView>;
  /** The provider project the server is linked to, when the link has one. */
  linkProject: Accessor<ResourceProject | undefined>;
  /** What players get: none, the server's modpack, or the custom pack. */
  clientMode: Accessor<ClientPackMode>;
  setClientMode: (mode: ClientPackMode, requireUpdate?: boolean) => Promise<void>;
  loading: Accessor<boolean>;
  error: Accessor<ServerCommandError | null>;
  reload: () => Promise<void>;
  applyDraft: (draft: PackDraft) => void;
  /** Saves a whole manifest against the current draft revision. */
  writeManifest: (manifest: PackManifest) => Promise<void>;
  /** Client pack art for its header: provider icon, uploaded icon, or generated art. */
  icon: Accessor<string>;
  /** Server modpack art: the linked project's icon or generated art. */
  linkIcon: Accessor<string>;
  providerProject: Accessor<ResourceProject | undefined>;
  /** The publication preview for the current draft, for change counts; undefined until read. */
  preview: Accessor<PackPreview | undefined>;
  refreshPreview: () => void;
  markStarted: () => void;
  /** A client pack section. */
  open: (tab: ModpackSubTab) => void;
  openServer: () => void;
  install: Accessor<InstallRequestSource | null>;
  startInstall: (request: InstallRequestSource | null) => void;
}

export const ModpackAreaContext = createContext<ModpackAreaValue>();
export const useModpackArea = () => useContext(ModpackAreaContext)!;

/** Loads the pack workspace once per server and keeps derived pieces next to it. */
export function createModpackArea(snapshot: Accessor<ServerSnapshot>): ModpackAreaValue {
  const id = () => snapshot().connection.id;
  const gates = createMemo(() => modpackGates(snapshot().capabilities, snapshot().connection.role), { name: 'modpack:gates' });
  const [workspace, setWorkspace] = createSignal<PackWorkspace | undefined>(undefined, { name: 'modpack:workspace' });
  const [loading, setLoading] = createSignal(false, { name: 'modpack:loading' });
  const [error, setError] = createSignal<ServerCommandError | null>(null, { name: 'modpack:error' });
  const [started, setStarted] = createSignal(false, { name: 'modpack:started' });
  const [iconData, setIconData] = createSignal<string | undefined>(undefined, { name: 'modpack:icon' });
  const [preview, setPreview] = createSignal<PackPreview | undefined>(undefined, { name: 'modpack:preview' });
  const [install, setInstall] = createSignal<InstallRequestSource | null>(null, { name: 'modpack:install' });
  const kind = createMemo(() => packSourceKind(workspace(), started()), { name: 'modpack:kind' });
  const link = createMemo(() => serverLinkView(workspace()), { name: 'modpack:link' });
  const clientMode = createMemo(() => clientPackMode(workspace()), { name: 'modpack:client-mode' });
  const writes = new IntentMemo();
  const modes = new IntentMemo();
  let disposed = false;
  onCleanup(() => { disposed = true; });

  /** Every read also refreshes the shared copy Resources uses for ownership badges. */
  const accept = (value: PackWorkspace) => {
    setWorkspace(value);
    seedServerResource(untrack(id), packWorkspaceResource, value);
  };

  let sequence = 0;
  const reload = async () => {
    if (!untrack(gates).edit) return;
    const request = ++sequence;
    setLoading(true); setError(null);
    try {
      const value = await serverCommand((api) => api.packDraft(untrack(id)));
      if (!disposed && request === sequence) accept(value);
    } catch (reason) {
      if (!disposed && request === sequence) setError(reason as ServerCommandError);
    } finally {
      if (!disposed && request === sequence) setLoading(false);
    }
  };
  createEffect(() => [id(), gates().edit] as const, ([, edit]) => { if (edit) void reload(); }, { name: 'modpack:load' });

  const applyDraft = (draft: PackDraft) => {
    setWorkspace((current) => (current ? { ...current, draft, pendingPublication: true } : current));
  };

  const writeManifest = async (manifest: PackManifest) => {
    const current = untrack(workspace);
    if (!current) return;
    const request = { expectedRevision: current.draft.revision, manifest };
    try {
      const draft = await serverCommand((api) => api.packWrite(untrack(id), request, writes.idFor(request)));
      writes.settle();
      applyDraft(draft);
    } catch (reason) {
      writes.settle(reason as ServerCommandError);
      // Someone else edited the draft: show theirs; the caller reports the error.
      if ((reason as ServerCommandError).code === 'stale_target') void reload();
      throw reason;
    }
  };

  /** Stores the player offering. The custom workspace is kept whatever the mode. */
  const setClientMode = async (mode: ClientPackMode, requireUpdate = false) => {
    const request = clientModeRequest(mode, requireUpdate);
    try {
      const value = await serverCommand((api) => api.clientPackMode(untrack(id), request, modes.idFor(request)));
      modes.settle();
      if (disposed) return;
      setWorkspace((current) => (current ? { ...current, clientPack: value } : current));
      const current = untrack(workspace);
      if (current) seedServerResource(untrack(id), packWorkspaceResource, current);
    } catch (reason) {
      modes.settle(reason as ServerCommandError);
      throw reason;
    }
  };

  // The uploaded icon, read again only when its hash changes.
  createEffect(() => workspace()?.draft.manifest.icon ?? null, (sha) => {
    if (!sha) { setIconData(undefined); return; }
    void serverCommand((api) => api.packIcon(untrack(id))).then((icon) => {
      if (!disposed) setIconData(icon ? `data:${icon.mimeType};base64,${icon.contentBase64}` : undefined);
    }).catch(() => {});
  }, { name: 'modpack:icon-load' });

  createEffect(() => workspace()?.providerPack ?? null, (provider) => {
    if (provider) void loadProject(provider.provider, provider.projectId).catch(() => {});
  }, { name: 'modpack:provider-project' });
  const providerProject = () => {
    const provider = workspace()?.providerPack;
    return provider ? peekProject(provider.provider, provider.projectId) : undefined;
  };

  const linkKey = () => { const provider = linkProvider(link().source); return provider ? `${provider.provider}:${provider.projectId}` : null; };
  createEffect(linkKey, (key) => {
    const provider = key ? linkProvider(untrack(link).source) : null;
    if (provider) void loadProject(provider.provider, provider.projectId).catch(() => {});
  }, { name: 'modpack:link-project' });
  const linkProject = () => {
    const provider = linkProvider(link().source);
    return provider ? peekProject(provider.provider, provider.projectId) : undefined;
  };

  // A preview names how many changes publication would make. Read once per draft revision.
  let previewed: string | null = null;
  const refreshPreview = () => {
    const current = untrack(workspace);
    if (!current || !untrack(gates).build) return;
    previewed = current.draft.revision;
    void serverCommand((api) => api.packPreview(untrack(id), current.draft.revision)).then((value) => {
      if (!disposed && untrack(workspace)?.draft.revision === value.draftRevision) setPreview(value);
    }).catch(() => {});
  };
  createEffect(() => {
    const current = workspace();
    return current && clientMode() === 'custom' && kind() === 'custom' && current.pendingPublication ? current.draft.revision : null;
  }, (revision) => {
    if (!revision) { setPreview(undefined); return; }
    if (revision !== previewed) refreshPreview();
  }, { name: 'modpack:preview-load' });

  const icon = () => providerProject()?.icon_url ?? iconData() ?? serverArt(`${snapshot().connection.serverId}:pack`, initials(workspace()?.draft.manifest.name ?? snapshot().connection.name));
  const linkIcon = () => linkProject()?.icon_url ?? serverArt(`${snapshot().connection.serverId}:server-modpack`, initials(linkProject()?.name ?? snapshot().connection.name));

  return {
    snapshot, id, gates, workspace, kind, link, linkProject, clientMode, setClientMode, loading, error, reload, applyDraft, writeManifest,
    icon, linkIcon, providerProject, preview, refreshPreview,
    markStarted: () => setStarted(true),
    open: (tab) => transitionTo(modpackPath(untrack(id), tab)),
    openServer: () => transitionTo(serverModpackPath(untrack(id))),
    install, startInstall: setInstall,
  };
}
