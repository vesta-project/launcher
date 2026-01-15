import { Component, createEffect, For, Show, createSignal, onMount, createMemo, untrack, onCleanup, createResource } from "solid-js";
import { resources, ResourceProject, ResourceVersion, SourcePlatform, findBestVersion } from "@stores/resources";
import { instancesState, Instance } from "@stores/instances";
import { invoke } from "@tauri-apps/api/core";
import Button from "@ui/button/button";
import { 
    Select, 
    SelectContent, 
    SelectItem, 
    SelectTrigger, 
    SelectValue 
} from "@ui/select/select";
import {
    Pagination,
    PaginationItems,
    PaginationItem,
    PaginationEllipsis,
    PaginationPrevious,
    PaginationNext
} from "@ui/pagination/pagination";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from "@ui/tooltip/tooltip";
import { router } from "@components/page-viewer/page-viewer";
import { showToast } from "@ui/toast/toast";
import { open } from "@tauri-apps/plugin-shell";
import { marked } from "marked";
import { formatDate } from "@utils/date";
import { DEFAULT_ICONS } from "@utils/instances";
import { getCompatibilityForInstance, getShaderEnginesInOrder, type ShaderEngineInfo } from "@utils/resources";
import InstanceSelectionDialog from "./instance-selection-dialog";
import CloseIcon from "@assets/close.svg";
import HeartIcon from "@assets/heart.svg";
import "./resource-details.css";

// Configure marked for GFM
marked.setOptions({
    gfm: true,
    breaks: false
});

const VersionTags = (props: { versions: string[] }) => {
    const limit = 2;
    const items = () => props.versions.slice(0, limit);
    const hasMore = () => props.versions.length > limit;
    const remainingCount = () => props.versions.length - limit;
    const remainingItems = () => props.versions.slice(limit);

    // Try to detect version range
    const displayVersions = () => {
        if (props.versions.length <= 3) return items();
        
        const sorted = [...props.versions].sort((a, b) => {
            // Very basic version sorting
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        });
        return [sorted[0], "...", sorted[sorted.length - 1]];
    };

    return (
        <div class="version-meta">
            <For each={displayVersions()}>
                {(v) => <span class="meta-tag">{v}</span>}
            </For>
            <Show when={hasMore() && displayVersions().length === limit}>
                <Tooltip>
                    <TooltipTrigger>
                        <span class="meta-tag more">+{remainingCount()} more</span>
                    </TooltipTrigger>
                    <TooltipContent>
                        <div class="version-tooltip-list">
                            <For each={remainingItems()}>
                                {(v) => <div class="tooltip-version-item">{v}</div>}
                            </For>
                        </div>
                    </TooltipContent>
                </Tooltip>
            </Show>
        </div>
    );
};

const ResourceDetailsPage: Component<{ 
    project?: ResourceProject, 
    projectId?: string, 
    platform?: SourcePlatform,
    setRefetch?: (fn: () => Promise<void>) => void
}> = (props) => {
    const [project, setProject] = createSignal<ResourceProject | undefined>(props.project);
    const [loading, setLoading] = createSignal(false);
    const [activeTab, setActiveTab] = createSignal<'description' | 'versions' | 'screenshots'>('description');
    const [versionFilter, setVersionFilter] = createSignal('');
    const [selectedScreenshot, setSelectedScreenshot] = createSignal<string | null>(null);
    const [isZoomed, setIsZoomed] = createSignal(false);
    const [versionPage, setVersionPage] = createSignal(1);
    const versionsPerPage = 15;

    const [peerProject] = createResource(project, async (p: ResourceProject) => {
        if (!p) return null;
        try {
            return await invoke<ResourceProject | null>("find_peer_resource", { project: p });
        } catch (e) {
            console.error("Failed to find peer project:", e);
            return null;
        }
    });

    const InstanceIcon = (iconProps: { instance?: any }) => {
        const iconPath = () => iconProps.instance?.iconPath || DEFAULT_ICONS[0];
        return (
            <Show when={iconProps.instance && iconProps.instance.id !== null}>
                <div 
                    class="instance-item-icon" 
                    style={iconPath().startsWith("linear-gradient")
                        ? { background: iconPath() }
                        : { "background-image": `url('${iconPath()}')`, "background-size": "cover", "background-position": "center" }
                    } 
                />
            </Show>
        );
    };

    const isVersionInstalled = (versionId: string, hash?: string) => {
        return resources.state.installedResources.some(ir => 
            ir.remote_version_id === versionId || (hash && ir.hash === hash)
        );
    };

    const isVersionInstalling = (versionId: string) => {
        return resources.state.installingVersionIds.includes(versionId);
    };

    const isModpack = () => project()?.resource_type === 'modpack';

    const isProjectInstalled = createMemo(() => {
        const p = project();
        if (!p) return false;
        
        const mainId = p.id.toLowerCase();
        const peerId = peerProject()?.id.toLowerCase();
        const extIds = p.external_ids || {};
        const projectName = p.name.toLowerCase();
        const resType = p.resource_type;

        return resources.state.installedResources.some(ir => {
            const irRemoteId = ir.remote_id.toLowerCase();
            
            // 1. IDs (direct or peer)
            if (irRemoteId === mainId || (peerId && irRemoteId === peerId)) return true;

            // 2. External IDs
            for (const id of Object.values(extIds)) {
                if (irRemoteId === id.toLowerCase()) return true;
            }

            // 3. Hash match
            if (ir.hash && resources.state.versions.some(v => v.hash === ir.hash)) return true;

            // 4. Name + Type match
            return ir.resource_type === resType && ir.display_name.toLowerCase() === projectName;
        });
    });

    const installedResource = createMemo(() => {
        const p = project();
        if (!p) return null;

        const mainId = p.id.toLowerCase();
        const peerId = peerProject()?.id.toLowerCase();
        const extIds = p.external_ids || {};
        const projectName = p.name.toLowerCase();
        const resType = p.resource_type;

        return resources.state.installedResources.find(ir => {
            const irRemoteId = ir.remote_id.toLowerCase();
            if (irRemoteId === mainId || (peerId && irRemoteId === peerId)) return true;

            for (const id of Object.values(extIds)) {
                if (irRemoteId === id.toLowerCase()) return true;
            }

            if (ir.hash && resources.state.versions.some(v => v.hash === ir.hash)) return true;

            return ir.resource_type === resType && ir.display_name.toLowerCase() === projectName;
        });
    });

    const isProjectInstalling = createMemo(() => {
        const p = project();
        if (!p) return false;
        return resources.state.installingVersionIds.some(id => 
            resources.state.versions.find(v => v.id === id)?.project_id === p.id
        );
    });

    const handleUninstall = async () => {
        const res = installedResource();
        if (res) {
            try {
                await resources.uninstall(res.instance_id, res.id);
                showToast({
                    title: "Resource removed",
                    description: `${project()?.name} has been uninstalled.`,
                    severity: "Success"
                });
            } catch (e) {
                console.error("Failed to uninstall:", e);
                showToast({
                    title: "Uninstall failed",
                    description: String(e),
                    severity: "Error"
                });
            }
        }
    };

    onMount(() => {
        if (props.setRefetch) {
            props.setRefetch(async () => {
                const p = project();
                if (p) await fetchFullProject(p.source, p.id);
            });
        }

        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && selectedScreenshot()) {
                // Prevent PageViewer from closing when a screenshot is open
                e.stopImmediatePropagation();
                e.preventDefault();
                setSelectedScreenshot(null);
                setIsZoomed(false);
            }
        };

        document.addEventListener("keydown", handleGlobalKeyDown, { capture: true });
        onCleanup(() => document.removeEventListener("keydown", handleGlobalKeyDown, { capture: true }));
    });

    // Reset state when navigating to a different project
    createEffect(() => {
        if (props.projectId) {
            setActiveTab('description');
            setVersionFilter('');
            setVersionPage(1);
            setSelectedScreenshot(null);
        }
    });

    const filteredVersions = createMemo(() => {
        const query = versionFilter().toLowerCase();
        let list = resources.state.versions;
        if (query) {
            list = list.filter(v => 
                v.version_number.toLowerCase().includes(query) || 
                v.game_versions.some(gv => gv.toLowerCase().includes(query)) ||
                v.loaders.some(l => l.toLowerCase().includes(query))
            );
        }
        return list;
    });

    createEffect(() => {
        filteredVersions();
        setVersionPage(1);
    });

    const paginatedVersions = createMemo(() => {
        const start = (versionPage() - 1) * versionsPerPage;
        return filteredVersions().slice(start, start + versionsPerPage);
    });

    const totalPages = createMemo(() => Math.ceil(filteredVersions().length / versionsPerPage));

    const [isInstanceDialogOpen, setIsInstanceDialogOpen] = createSignal(false);
    const [installContext, setInstallContext] = createSignal<{ version: ResourceVersion } | null>(null);
    const [confirmUninstall, setConfirmUninstall] = createSignal(false);
    const [confirmVersionId, setConfirmVersionId] = createSignal<string | null>(null);

    const getCompatibility = (version: ResourceVersion) => {
        const instanceId = resources.state.selectedInstanceId;
        if (!instanceId) return { type: 'compatible' as const };

        const instance = instancesState.instances.find(i => i.id === instanceId);
        if (!instance) return { type: 'compatible' as const };

        return getCompatibilityForInstance(project(), version, instance);
    };

    const bestVersionForCurrent = createMemo(() => {
        const instId = resources.state.selectedInstanceId;
        const inst = instancesState.instances.find(i => i.id === instId);
        if (!inst || !resources.state.versions.length) return null;
        
        return findBestVersion(
            resources.state.versions, 
            inst.minecraftVersion, 
            inst.modloader,
            'release',
            project()?.resource_type
        );
    });

    const isProjectIncompatible = createMemo(() => {
        const instId = resources.state.selectedInstanceId;
        if (!instId || isModpack()) return false;
        
        const inst = instancesState.instances.find(i => i.id === instId);
        if (!inst) return false;
        
        const instLoader = inst.modloader?.toLowerCase() || "";
        const resType = project()?.resource_type;
        
        // Vanilla restriction
        if (instLoader === "" || instLoader === "vanilla") {
            if (resType === 'mod' || resType === 'shader') return true;
        }
        
        // No compatible version found
        if (!bestVersionForCurrent()) return true;
        
        return false;
    });

    const isUpdateAvailable = createMemo(() => {
        const installed = installedResource();
        const best = bestVersionForCurrent();
        if (!installed || !best) return false;

        // If it's the same file (same hash), then no update is available
        if (installed.hash && best.hash && installed.hash === best.hash) return false;
        
        // If platforms match, we can trust the ID check too
        const p = project();
        if (p && installed.platform.toLowerCase() === p.source.toLowerCase()) {
            return installed.remote_version_id !== best.id;
        }

        // Otherwise fallback to version strings
        return installed.current_version !== best.version_number;
    });

    const handleQuickAction = () => {
        if (isProjectInstalled()) {
            if (isUpdateAvailable()) {
                const best = bestVersionForCurrent();
                if (best) {
                    handleInstall(best);
                    return;
                }
            }

            if (!confirmUninstall()) {
                setConfirmUninstall(true);
                setTimeout(() => setConfirmUninstall(false), 3000);
                return;
            }
            handleUninstall();
            setConfirmUninstall(false);
            return;
        }

        if (isModpack()) {
            if (resources.state.versions.length > 0) {
                handleInstall(resources.state.versions[0]);
            }
            return;
        }

        const instId = resources.state.selectedInstanceId;
        if (!instId) {
            // Logic similar to card quick install when no instance selected
            const p = project();
            if (p) {
                resources.setRequestInstall(p, resources.state.versions);
                setIsInstanceDialogOpen(true);
            }
            return;
        }

        const best = bestVersionForCurrent();
        if (best) {
            handleInstall(best);
        } else {
            setActiveTab('versions');
            showToast({
                title: "Choose version",
                description: "No automatically compatible version found. Please select one manually.",
                severity: "Info"
            });
        }
    };

    const handleDescriptionLink = async (url: string) => {
        try {
            const parsedUrl = new URL(url);
            let platform: SourcePlatform | null = null;
            let id: string | null = null;

            // Modrinth
            if (parsedUrl.hostname === 'modrinth.com' || parsedUrl.hostname.endsWith('.modrinth.com')) {
                const pathParts = parsedUrl.pathname.split('/').filter(p => p);
                // URL structure: /<type>/<slug>
                if (pathParts.length >= 2) {
                    const type = pathParts[0];
                    const slug = pathParts[1];
                    const validTypes = ['mod', 'resourcepack', 'shader', 'datapack', 'modpack'];
                    if (validTypes.includes(type)) {
                        platform = 'modrinth';
                        id = slug;
                    }
                }
            } 
            // CurseForge
            else if (parsedUrl.hostname === 'www.curseforge.com' || parsedUrl.hostname === 'curseforge.com') {
                const pathParts = parsedUrl.pathname.split('/').filter(p => p);
                // Expected: /minecraft/mc-mods/<slug>
                if (pathParts.length >= 3 && pathParts[0] === 'minecraft') {
                    platform = 'curseforge';
                    id = pathParts[2]; // This is the slug
                }
            }

            if (platform && id) {
                console.log(`[ResourceDetails] Intercepted link to ${platform} resource: ${id}`);
                router()?.navigate("/resource-details", { projectId: id, platform });
                return;
            }

            // Fallback: Open in browser
            await open(url);
        } catch (e) {
            console.error("[ResourceDetails] Link handling error:", e);
            try {
                await open(url);
            } catch (inner) {
                console.error("[ResourceDetails] Failed to open in browser:", inner);
            }
        }
    };

    createEffect(() => {
        const id = props.projectId;
        const platform = props.platform;
        const initialProject = props.project;

        // Use untrack so updates to project() signal don't re-trigger this effect
        const currentProjectId = untrack(() => project()?.id);

        if (initialProject) {
            if (currentProjectId !== initialProject.id) {
                setProject(initialProject);
                resources.selectProject(initialProject);
            }
            // If it's just hit data (missing description), fetch full details
            if (!initialProject.description && id && platform) {
                fetchFullProject(platform, id);
            }
        } else if (id && platform && currentProjectId !== id) {
            fetchFullProject(platform, id);
        }
    });

    async function fetchFullProject(platform: SourcePlatform, id: string) {
        console.log("[ResourceDetails] Fetching full project details for:", id);
        setLoading(true);
        try {
            const p = await resources.getProject(platform, id);
            console.log("[ResourceDetails] Fetched project:", p?.name);
            setProject(p);
            resources.selectProject(p);
        } catch (e) {
            console.error("Failed to load project details:", e);
        } finally {
            setLoading(false);
        }
    }

    const handleInstall = async (version: ResourceVersion, targetInstance?: Instance) => {
        const p = project();
        const instId = targetInstance?.id || resources.state.selectedInstanceId;
        const inst = targetInstance || instancesState.instances.find(i => i.id === instId);

        if (!inst && !isModpack()) {
            setInstallContext({ version });
            setIsInstanceDialogOpen(true);
            return;
        }

        if (!version.download_url) {
            showToast({
                title: "Third-party download required",
                description: "CurseForge requires this mod to be downloaded through their website. Opening link...",
                severity: "Info"
            });
            await open(p?.web_url || "");
            return;
        }

        if (p) {
            try {
                // Check for shader engine dependencies
                if (p.resource_type === 'shader' && inst) {
                    const engines = getShaderEnginesInOrder(inst.modloader);
                    const installedInTarget = await resources.getInstalled(inst.id);
                    // Check if *either* major shader engine is installed
                    const isAnyEngineInstalled = installedInTarget.some(ir => 
                        ir.display_name.toLowerCase().includes('iris') || 
                        ir.display_name.toLowerCase().includes('oculus')
                    );

                    if (!isAnyEngineInstalled && engines.length > 0) {
                        let bestEngineVersion = null;
                        let engineProject = null;
                        
                        for (const engineInfo of engines) {
                            try {
                                const versions = await resources.getVersions(engineInfo.source, engineInfo.id);
                                const vBest = findBestVersion(versions, inst.minecraftVersion, inst.modloader, 'release', 'mod');
                                if (vBest) {
                                    bestEngineVersion = vBest;
                                    engineProject = await resources.getProject(engineInfo.source, engineInfo.id);
                                    break;
                                }
                            } catch (e) {
                                console.error(`Failed to check engine ${engineInfo.name}:`, e);
                            }
                        }

                        if (bestEngineVersion && engineProject) {
                            showToast({
                                title: "Shader Engine Required",
                                description: `Installing ${engineProject.name} to support shaders...`,
                                severity: "Info"
                            });
                            await resources.install(engineProject, bestEngineVersion, inst.id);
                        }
                    }
                }

                // Check for cross-loader compatibility warning
                if (inst) {
                    const instLoader = inst.modloader?.toLowerCase() || "";
                    const hasDirectLoader = version.loaders.some(l => l.toLowerCase() === instLoader);
                    
                    if (instLoader === "quilt" && !hasDirectLoader && version.loaders.some(l => l.toLowerCase() === "fabric")) {
                        showToast({
                            title: "Potential Incompatibility",
                            description: `Installing Fabric version of ${p.name} on a Quilt instance. Most mods work, but some may have issues.`,
                            severity: "Warning"
                        });
                    }
                }

                await resources.install(p, version, inst?.id);
                showToast({
                    title: "Success",
                    description: `Installed ${p.name} to ${inst?.name}`,
                    severity: "Success"
                });
            } catch (err) {
                showToast({
                    title: "Failed to install",
                    description: err instanceof Error ? err.message : String(err),
                    severity: "Error"
                });
            } finally {
                // Refresh counts/states
                if (inst) {
                    resources.fetchInstalled(inst.id);
                }
            }
        }
    };

    const handleCreateNew = () => {
        setIsInstanceDialogOpen(false);
        const p = project();
        if (p) {
            router()?.navigate("/install", { 
                projectId: p.id, 
                platform: p.source,
                projectName: p.name,
                projectIcon: p.icon_url || "",
                resourceType: p.resource_type
            });
        }
    };

    const handleSelectInstance = (instance: Instance) => {
        setIsInstanceDialogOpen(false);
        resources.setRequestInstall(null);
        // Also update the global selection so the UI reflects the choice
        resources.setInstance(instance.id);
        
        const ctx = installContext();
        if (ctx) {
            handleInstall(ctx.version, instance);
            setInstallContext(null);
        } else {
            // This was a quick install from the header button
            const best = bestVersionForCurrent();
            if (best) {
                handleInstall(best, instance);
            }
        }
    };

    const renderedDescription = createMemo(() => {
        const desc = project()?.description;
        if (!desc) return "No description provided.";
        
        // Explicitly set marked options for each parse to ensure consistency
        return marked.parse(desc, {
            gfm: true,
            breaks: false, // Treat single newlines as spaces (Modrinth behavior)
        });
    });

    return (
        <Show when={!loading()} fallback={<div class="loading-state">Loading details...</div>}>
            <Show when={project()} fallback={<div class="error-state">Project not found.</div>}>
                <div class="resource-details">
                    <div class="resource-details-header">
                        <div class="project-header-info">
                            <Show when={project()?.icon_url}>
                                <img src={project()?.icon_url ?? ""} alt={project()?.name} class="project-icon" />
                            </Show>
                            <div class="project-header-text">
                                <div class="project-title-row">
                                    <div class="project-title-group">
                                        <h1>{project()?.name}</h1>
                                        <Show when={isProjectInstalled() || isProjectInstalling()}>
                                            <span class="installed-badge">{isProjectInstalling() ? "Installing..." : "Installed"}</span>
                                        </Show>
                                    </div>
                                    <div class="header-link-group">
                                        <Show when={peerProject()}>
                                            <div class="source-toggle">
                                                <button 
                                                    class="source-btn" 
                                                    classList={{ active: project()?.source === 'modrinth' }}
                                                    onClick={() => {
                                                        if (project()?.source === 'modrinth') return;
                                                        const peer = peerProject();
                                                        if (peer && peer.source === 'modrinth') {
                                                            router()?.navigate("/resource-details", { 
                                                                projectId: peer.id, 
                                                                platform: "modrinth" 
                                                            });
                                                        }
                                                    }}
                                                >
                                                    Modrinth
                                                </button>
                                                <button 
                                                    class="source-btn" 
                                                    classList={{ active: project()?.source === 'curseforge' }}
                                                    onClick={() => {
                                                        if (project()?.source === 'curseforge') return;
                                                        const peer = peerProject();
                                                        if (peer && peer.source === 'curseforge') {
                                                            router()?.navigate("/resource-details", { 
                                                                projectId: peer.id, 
                                                                platform: "curseforge" 
                                                            });
                                                        }
                                                    }}
                                                >
                                                    CurseForge
                                                </button>
                                            </div>
                                        </Show>
                                        <Button 
                                            variant="outline" 
                                            size="sm"
                                            onClick={() => open(project()?.web_url ?? "")}
                                            class="header-web-link"
                                            tooltip_text={`View on ${project()?.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}`}
                                        >
                                            <div style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}>
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                                <span>Browser</span>
                                            </div>
                                        </Button>
                                    </div>
                                </div>
                                <div class="project-subtitle-row">
                                    <div class="subtitle-left">
                                        <p class="author">By {project()?.author}</p>
                                        <Show when={project()?.follower_count !== undefined}>
                                            <span class="stat-item">
                                                <HeartIcon/>
                                                {project()?.follower_count.toLocaleString()}
                                            </span>
                                        </Show>
                                        <Show when={project()?.updated_at}>
                                            <span class="stat-item">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                                Updated {formatDate(project()?.updated_at || "")}
                                            </span>
                                        </Show>
                                    </div>
                                    <div class="header-instance-picker">
                                        <Show when={!isModpack()} fallback={
                                            <div class="modpack-instance-notice">
                                                <span>Modpacks will create a new instance when installed</span>
                                            </div>
                                        }>
                                            <span class="picker-label">Target Instance:</span>
                                            <Select<any>
                                                options={[{ id: null, name: "No Instance" }, ...instancesState.instances]}
                                                value={instancesState.instances.find(i => i.id === resources.state.selectedInstanceId) || { id: null, name: "No Instance" }}
                                                onChange={(v) => {
                                                    const id = (v as any)?.id ?? null;
                                                    resources.setInstance(id);
                                                    if (id) {
                                                        const inst = instancesState.instances.find(i => i.id === id);
                                                        if (inst) {
                                                            resources.setGameVersion(inst.minecraftVersion);
                                                            resources.setLoader(inst.modloader);
                                                        }
                                                    }
                                                }}
                                                optionValue="id"
                                                optionTextValue="name"
                                                placeholder="Select instance..."
                                                itemComponent={(props) => (
                                                    <SelectItem item={props.item}>
                                                        <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                                                            <InstanceIcon instance={props.item.rawValue} />
                                                            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '2px' }}>
                                                                <span>{props.item.rawValue.name}</span>
                                                                <Show when={props.item.rawValue.id !== null}>
                                                                    <span style={{ "font-size": "11px", opacity: 0.6 }}>{props.item.rawValue.minecraftVersion} {props.item.rawValue.modloader ? `- ${props.item.rawValue.modloader}` : ''}</span>
                                                                </Show>
                                                            </div>
                                                        </div>
                                                    </SelectItem>
                                                )}
                                            >
                                                <SelectTrigger class="instance-select-header">
                                                    <SelectValue<any>>
                                                        {(s) => {
                                                            const inst = s.selectedOption();
                                                            return (
                                                                <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                                                                    <InstanceIcon instance={inst} />
                                                                    <span>{inst ? `${inst.name}` : "Select instance..."}</span>
                                                                </div>
                                                            );
                                                        }}
                                                    </SelectValue>
                                                </SelectTrigger>
                                                <SelectContent />
                                            </Select>
                                        </Show>
                                        <div class="header-action-row" style={{ "margin-top": "8px" }}>
                                            <Button
                                                size="sm"
                                                style={{ width: "100%" }}
                                                color={isUpdateAvailable() ? 'secondary' : (isProjectInstalled() ? 'destructive' : (isProjectIncompatible() && !isProjectInstalled() ? 'none' : 'primary'))}
                                                variant={isProjectInstalled() && !isUpdateAvailable() ? 'outline' : 'solid'}
                                                onClick={handleQuickAction}
                                                disabled={isProjectInstalling() || (isProjectIncompatible() && !isProjectInstalled() && resources.state.selectedInstanceId !== null)}
                                            >
                                                <Show when={isProjectInstalling()}>
                                                    <span>Installing...</span>
                                                </Show>
                                                <Show when={!isProjectInstalling()}>
                                                    <Show when={isProjectInstalled()}>
                                                        <Show when={isUpdateAvailable()} fallback={
                                                            <>
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ "margin-right": "8px" }}><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                                                                <Show when={confirmUninstall()} fallback="Uninstall">Confirm?</Show>
                                                            </>
                                                        }>
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ "margin-right": "8px" }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                                            Update
                                                        </Show>
                                                    </Show>
                                                    <Show when={!isProjectInstalled()}>
                                                        <Show when={isProjectIncompatible()} fallback={
                                                            <>
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ "margin-right": "8px" }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                                                Install
                                                            </>
                                                        }>
                                                            Unsupported
                                                        </Show>
                                                    </Show>
                                                </Show>
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                                <div class="project-categories">
                                    <For each={project()?.categories}>
                                        {(cat) => (
                                            <span 
                                                class="category-pill clickable" 
                                                onClick={() => {
                                                    const p = project();
                                                    if (p) {
                                                        resources.setType(p.resource_type);
                                                        resources.setSource(p.source);
                                                    }
                                                    resources.setQuery("");
                                                    resources.setCategories([cat.toLowerCase()]);
                                                    resources.setOffset(0);
                                                    router()?.navigate("/resources");
                                                }}
                                            >
                                                {cat}
                                            </span>
                                        )}
                                    </For>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="resource-details-layout">
                        <div class="resource-details-main">
                            <div class="details-tabs">
                                <button 
                                    class={`tab-btn ${activeTab() === 'description' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('description')}
                                >
                                    Description
                                </button>
                                <button 
                                    class={`tab-btn ${activeTab() === 'versions' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('versions')}
                                >
                                    Versions ({resources.state.versions.length})
                                </button>
                                <Show when={(project()?.screenshots?.length ?? 0) > 0}>
                                    <button 
                                        class={`tab-btn ${activeTab() === 'screenshots' ? 'active' : ''}`}
                                        onClick={() => setActiveTab('screenshots')}
                                    >
                                        Screenshots ({project()?.screenshots?.length})
                                    </button>
                                </Show>
                            </div>

                            <div class="tab-content">
                                <Show when={activeTab() === 'description'}>
                                    <div 
                                        class="description" 
                                        innerHTML={renderedDescription() as string} 
                                        onClick={(e) => {
                                            const target = e.target as HTMLElement;
                                            const anchor = target.closest('a');
                                            if (anchor) {
                                                e.preventDefault();
                                                handleDescriptionLink(anchor.href);
                                            }
                                        }}
                                    />
                                </Show>

                                <Show when={activeTab() === 'screenshots'}>
                                    <div class="screenshots-grid">
                                        <For each={project()?.screenshots}>
                                            {(screenshot) => (
                                                <div class="screenshot-container" onClick={() => setSelectedScreenshot(screenshot)}>
                                                    <img src={screenshot} alt="Screenshot" />
                                                </div>
                                            )}
                                        </For>
                                    </div>
                                </Show>

                                <Show when={activeTab() === 'versions'}>
                                    <div class="version-page">
                                        <div class="version-filters">
                                            <input 
                                                type="text" 
                                                placeholder="Filter versions (e.g. 1.21.1, Fabric)..."
                                                value={versionFilter()}
                                                onInput={(e) => {
                                                    setVersionFilter(e.currentTarget.value);
                                                    setVersionPage(1);
                                                }}
                                                class="version-search-input"
                                            />
                                        </div>
                                        <div class="version-list full-width">
                                            <Show when={!resources.state.loading} fallback={<div>Loading versions...</div>}>
                                                <For each={paginatedVersions()}>
                                                    {(version) => (
                                                        <div class="version-item">
                                                            <div class="version-main-info">
                                                                <span class="version-name">{version.version_number}</span>
                                                                <span class="version-filename">{version.file_name}</span>
                                                            </div>

                                                            <div class="version-loaders-row">
                                                                <div class="meta-group">
                                                                    <span class="meta-label">Versions</span>
                                                                    <VersionTags versions={version.game_versions} />
                                                                </div>
                                                                <div class="meta-group">
                                                                    <span class="meta-label">Loaders</span>
                                                                    <div class="version-meta">
                                                                        <For each={version.loaders}>
                                                                            {(l) => <span class="meta-tag loader-tag">{l}</span>}
                                                                        </For>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <div class="version-actions">
                                                                <span class={`version-tag ${version.release_type}`}>{version.release_type}</span>
                                                                <Button 
                                                                    size="sm" 
                                                                    disabled={isVersionInstalling(version.id) || (!!resources.state.selectedInstanceId && !isVersionInstalled(version.id, version.hash) && getCompatibility(version).type === 'incompatible')}
                                                                    tooltip_text={
                                                                        (() => {
                                                                            const instId = resources.state.selectedInstanceId;
                                                                            const comp = getCompatibility(version);
                                                                            
                                                                            if (instId && !isVersionInstalled(version.id, version.hash) && comp.type !== 'compatible') {
                                                                                return comp.reason;
                                                                            }
                                                                            if (isVersionInstalling(version.id)) return "Installation in progress";
                                                                            if (isVersionInstalled(version.id, version.hash)) return "Already installed - Click to remove";
                                                                            if (!isModpack() && !instId) return "Select an instance to install";
                                                                            return version.download_url ? "Click to install" : "External download required";
                                                                        })()
                                                                    }
                                                                    onClick={() => {
                                                                        if (isVersionInstalled(version.id, version.hash)) {
                                                                            if (confirmVersionId() !== version.id) {
                                                                                setConfirmVersionId(version.id);
                                                                                setTimeout(() => setConfirmVersionId(null), 3000);
                                                                                return;
                                                                            }
                                                                            handleUninstall();
                                                                            setConfirmVersionId(null);
                                                                        } else if (getCompatibility(version).type !== 'incompatible') {
                                                                            handleInstall(version);
                                                                        }
                                                                    }}
                                                                    style={{ width: '100%' }}
                                                                    variant={isVersionInstalled(version.id, version.hash) ? 'outline' : (version.download_url ? 'solid' : 'outline')}
                                                                    color={(() => {
                                                                        if (isVersionInstalled(version.id, version.hash)) return 'destructive';
                                                                        const comp = getCompatibility(version);
                                                                        if (comp.type === 'warning') return 'warning';
                                                                        if (comp.type === 'incompatible') return 'none'; // Subdued
                                                                        return undefined;
                                                                    })()}
                                                                >
                                                                    <Show when={isVersionInstalling(version.id)}>Installing...</Show>
                                                                    <Show when={!isVersionInstalling(version.id)}>
                                                                        <Show when={isVersionInstalled(version.id, version.hash)}>
                                                                            <Show when={confirmVersionId() === version.id} fallback="Uninstall">Confirm?</Show>
                                                                        </Show>
                                                                        <Show when={!isVersionInstalled(version.id, version.hash)}>
                                                                            <Show when={!isModpack() && !resources.state.selectedInstanceId}>Select Instance</Show>
                                                                            <Show when={isModpack() || resources.state.selectedInstanceId}>
                                                                                <Show when={getCompatibility(version).type === 'incompatible'} fallback={version.download_url ? 'Install' : 'External'}>
                                                                                    {(() => {
                                                                                        const instId = resources.state.selectedInstanceId;
                                                                                        const inst = instancesState.instances.find(i => i.id === instId);
                                                                                        if ((inst?.modloader?.toLowerCase() === "vanilla" || !inst?.modloader) && 
                                                                                            (project()?.resource_type === 'mod' || project()?.resource_type === 'shader')) {
                                                                                            return "Unsupported";
                                                                                        }
                                                                                        return "Incompatible";
                                                                                    })()}
                                                                                </Show>
                                                                            </Show>
                                                                        </Show>
                                                                    </Show>
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </For>

                                                <Show when={totalPages() > 1}>
                                                    <div class="version-pagination">
                                                        <Pagination 
                                                            count={totalPages()} 
                                                            page={versionPage()} 
                                                            onPageChange={setVersionPage}
                                                            itemComponent={(props) => (
                                                                <PaginationItem page={props.page}>{props.page}</PaginationItem>
                                                            )}
                                                            ellipsisComponent={() => <PaginationEllipsis />}
                                                        >
                                                            <PaginationPrevious />
                                                            <PaginationItems />
                                                            <PaginationNext />
                                                        </Pagination>
                                                    </div>
                                                </Show>
                                            </Show>
                                        </div>
                                    </div>
                                </Show>
                            </div>
                        </div>

                        <div class="resource-details-sidebar">
                            <div class="sidebar-scrollable-area">
                                <div class="sidebar-section">
                                    <h3 class="sidebar-title">Information</h3>
                                    <div class="sidebar-metadata">
                                        <div class="meta-item">
                                            <span class="label">Platform</span>
                                            <span class="value capitalize">{project()?.source}</span>
                                        </div>
                                        <div class="meta-item">
                                            <span class="label">Downloads</span>
                                            <span class="value">{project()?.download_count.toLocaleString()}</span>
                                        </div>
                                        <div class="meta-item">
                                            <span class="label">Type</span>
                                            <div class="value-group">
                                                <span class="value capitalize">{project()?.resource_type}</span>
                                                <Show when={project()?.categories?.some(c => c.toLowerCase() === 'datapack') && project()?.resource_type !== 'datapack'}>
                                                    <span class="value capitalize">, Datapack</span>
                                                </Show>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="sidebar-section">
                                    <div class="sidebar-section-header">
                                        <h3 class="sidebar-title">Recent Versions</h3>
                                        <button class="view-all-link" onClick={() => setActiveTab('versions')}>View All</button>
                                    </div>
                                    <div class="sidebar-version-list">
                                        <Show when={!resources.state.loading} fallback={<div>Loading...</div>}>
                                            <For each={resources.state.versions.slice(0, 5)}>
                                                {(version) => (
                                                    <div class="sidebar-version-item">
                                                        <div class="sidebar-version-top">
                                                            <span class="version-name" title={version.version_number}>{version.version_number}</span>
                                                            <div class="version-tags-mini">
                                                                <span class={`mini-tag ${version.release_type}`}>{version.release_type.charAt(0).toUpperCase()}</span>
                                                                <For each={version.loaders.slice(0, 1)}>
                                                                    {(l) => <span class="mini-tag loader">{l}</span>}
                                                                </For>
                                                            </div>
                                                        </div>
                                                        <div class="sidebar-version-meta">
                                                            <VersionTags versions={version.game_versions} />
                                                        </div>
                                                        <Button 
                                                            size="sm" 
                                                            disabled={isVersionInstalling(version.id) || (!!resources.state.selectedInstanceId && !isVersionInstalled(version.id, version.hash) && getCompatibility(version).type === 'incompatible')}
                                                            color={(() => {
                                                                if (isVersionInstalled(version.id, version.hash)) return 'destructive';
                                                                const comp = getCompatibility(version);
                                                                if (comp.type === 'warning') return 'warning';
                                                                if (comp.type === 'incompatible') return 'none';
                                                                return undefined;
                                                            })()}
                                                            tooltip_text={
                                                                (() => {
                                                                    const instId = resources.state.selectedInstanceId;
                                                                    const comp = getCompatibility(version);
                                                                    if (instId && !isVersionInstalled(version.id, version.hash) && comp.type !== 'compatible') {
                                                                        return comp.reason;
                                                                    }
                                                                    if (isVersionInstalling(version.id)) return "Installation in progress";
                                                                    if (isVersionInstalled(version.id, version.hash)) return "Already installed - Click to remove";
                                                                    if (!isModpack() && !instId) return "Select an instance to install";
                                                                    return version.download_url ? "Click to install" : "External download required";
                                                                })()
                                                            }
                                                            onClick={() => {
                                                                if (isVersionInstalled(version.id, version.hash)) {
                                                                    if (confirmVersionId() !== version.id) {
                                                                        setConfirmVersionId(version.id);
                                                                        setTimeout(() => setConfirmVersionId(null), 3000);
                                                                        return;
                                                                    }
                                                                    handleUninstall();
                                                                    setConfirmVersionId(null);
                                                                } else {
                                                                    handleInstall(version);
                                                                }
                                                            }}
                                                            style={{ width: '100%', "margin-top": "8px" }}
                                                            variant={isVersionInstalled(version.id, version.hash) ? 'outline' : (version.download_url ? 'solid' : 'outline')}
                                                        >
                                                            <Show when={isVersionInstalling(version.id)}>Installing...</Show>
                                                            <Show when={!isVersionInstalling(version.id)}>
                                                                <Show when={isVersionInstalled(version.id, version.hash)}>
                                                                    <Show when={confirmVersionId() === version.id} fallback="Uninstall">Confirm?</Show>
                                                                </Show>
                                                                <Show when={!isVersionInstalled(version.id, version.hash)}>
                                                                    <Show when={!isModpack() && !resources.state.selectedInstanceId}>Select Instance</Show>
                                                                    <Show when={isModpack() || resources.state.selectedInstanceId}>
                                                                        <Show when={getCompatibility(version).type === 'incompatible'} fallback={version.download_url ? 'Install' : 'External'}>
                                                                            {(() => {
                                                                                const instId = resources.state.selectedInstanceId;
                                                                                const inst = instancesState.instances.find(i => i.id === instId);
                                                                                if ((inst?.modloader?.toLowerCase() === "vanilla" || !inst?.modloader) && 
                                                                                    (project()?.resource_type === 'mod' || project()?.resource_type === 'shader')) {
                                                                                    return "Unsupported";
                                                                                }
                                                                                return "Incompatible";
                                                                            })()}
                                                                        </Show>
                                                                    </Show>
                                                                </Show>
                                                            </Show>
                                                        </Button>
                                                    </div>
                                                )}
                                            </For>
                                        </Show>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <Show when={selectedScreenshot()}>
                        <div class="screenshot-overlay" onClick={() => { setSelectedScreenshot(null); setIsZoomed(false); }}>
                            <button class="screenshot-close-btn" onClick={() => { setSelectedScreenshot(null); setIsZoomed(false); }}>
                                <CloseIcon />
                            </button>
                            <div 
                                class={`screenshot-large-view ${isZoomed() ? 'zoomed' : ''}`} 
                                onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setIsZoomed(!isZoomed()); 
                                    console.log("Zoom toggled:", !isZoomed());
                                }}
                            >
                                <img src={selectedScreenshot() || ""} alt="Project Screenshot Full" />
                                <div class="screenshot-info-bar">
                                    <span>Click to {isZoomed() ? 'shrink' : 'zoom'}</span>
                                </div>
                            </div>
                        </div>
                    </Show>
                </div>
                <InstanceSelectionDialog 
                    isOpen={isInstanceDialogOpen()}
                    onClose={() => {
                        setIsInstanceDialogOpen(false);
                        resources.setRequestInstall(null);
                    }}
                    onSelect={handleSelectInstance}
                    onCreateNew={handleCreateNew}
                    project={project()}
                    version={installContext()?.version}
                    versions={resources.state.versions}
                />            </Show>
        </Show>
    );
};

export default ResourceDetailsPage;
