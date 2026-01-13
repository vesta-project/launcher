import { Component, createEffect, For, Show, createSignal, onMount, createMemo, untrack, onCleanup } from "solid-js";
import { resources, ResourceProject, ResourceVersion, SourcePlatform } from "@stores/resources";
import { instancesState } from "@stores/instances";
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
import CloseIcon from "@assets/close.svg";
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

const ResourceDetailsPage: Component<{ project?: ResourceProject, projectId?: string, platform?: SourcePlatform }> = (props) => {
    const [project, setProject] = createSignal<ResourceProject | undefined>(props.project);
    const [loading, setLoading] = createSignal(false);
    const [activeTab, setActiveTab] = createSignal<'description' | 'versions' | 'screenshots'>('description');
    const [versionFilter, setVersionFilter] = createSignal('');
    const [selectedScreenshot, setSelectedScreenshot] = createSignal<string | null>(null);
    const [isZoomed, setIsZoomed] = createSignal(false);
    const [versionPage, setVersionPage] = createSignal(1);
    const versionsPerPage = 15;

    const isVersionInstalled = (versionId: string) => {
        return resources.state.installedResources.some(ir => ir.remote_version_id === versionId);
    };

    const isVersionInstalling = (versionId: string) => {
        return resources.state.installingVersionIds.includes(versionId);
    };

    onMount(() => {
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

    const fetchFullProject = async (platform: SourcePlatform, id: string) => {
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
    };

    const handleInstall = (version: ResourceVersion) => {
        const p = project();
        const instanceId = resources.state.selectedInstanceId;
        const instance = instancesState.instances.find(i => i.id === instanceId);

        if (!version.download_url) {
            showToast({
                title: "Third-party download required",
                description: "CurseForge requires this mod to be downloaded through their website. Opening link...",
                severity: "Info"
            });
            open(p?.web_url || "");
            return;
        }

        if (p) {
            // Check for cross-loader compatibility warning
            if (instance) {
                const instLoader = instance.modloader?.toLowerCase() || "";
                const hasDirectLoader = version.loaders.some(l => l.toLowerCase() === instLoader);
                
                if (instLoader === "quilt" && !hasDirectLoader && version.loaders.some(l => l.toLowerCase() === "fabric")) {
                    showToast({
                        title: "Potential Incompatibility",
                        description: `Installing Fabric version of ${p.name} on a Quilt instance. Most mods work, but some may have issues.`,
                        severity: "Warning"
                    });
                }
            }

            resources.install(p, version);
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
                                        <Show when={isVersionInstalled("") || resources.state.installedResources.some(ir => ir.remote_id === project()?.id) || resources.state.installingVersionIds.some(id => resources.state.versions.find(v => v.id === id)?.project_id === project()?.id)}>
                                            <span class="installed-badge">{resources.state.installingVersionIds.some(id => resources.state.versions.find(v => v.id === id)?.project_id === project()?.id) ? "Installing..." : "Installed"}</span>
                                        </Show>
                                    </div>
                                    <div class="header-link-group">
                                        <Show when={project()?.external_ids?.curseforge && project()?.source === 'modrinth'}>
                                            <Button 
                                                variant="outline" 
                                                size="sm"
                                                onClick={() => router()?.navigate("/resource-details", { 
                                                    projectId: project()?.external_ids?.curseforge, 
                                                    platform: "curseforge" 
                                                })}
                                                class="header-external-link cf"
                                            >
                                                See on CurseForge
                                            </Button>
                                        </Show>
                                        <Button 
                                            variant="outline" 
                                            size="sm"
                                            onClick={() => open(project()?.web_url ?? "")}
                                            class="header-web-link"
                                        >
                                            View on {project()?.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}
                                        </Button>
                                    </div>
                                </div>
                                <div class="project-subtitle-row">
                                    <div class="subtitle-left">
                                        <p class="author">By {project()?.author}</p>
                                        <Show when={project()?.follower_count !== undefined}>
                                            <span class="stat-item">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
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
                                        <span class="picker-label">Target Instance:</span>
                                        <Select
                                            options={instancesState.instances}
                                            value={instancesState.instances.find(i => i.id === resources.state.selectedInstanceId)}
                                            onChange={(v) => {
                                                const id = (v as any)?.id || null;
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
                                                    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '2px' }}>
                                                        <span>{props.item.rawValue.name}</span>
                                                        <span style={{ "font-size": "11px", opacity: 0.6 }}>{props.item.rawValue.minecraftVersion} {props.item.rawValue.modloader ? `- ${props.item.rawValue.modloader}` : ''}</span>
                                                    </div>
                                                </SelectItem>
                                            )}
                                        >
                                            <SelectTrigger class="instance-select-header">
                                                <SelectValue<any>>
                                                    {(s) => {
                                                        const inst = s.selectedOption();
                                                        return inst ? `${inst.name}` : "Select instance...";
                                                    }}
                                                </SelectValue>
                                            </SelectTrigger>
                                            <SelectContent />
                                        </Select>
                                    </div>
                                </div>
                                <div class="project-categories">
                                    <For each={project()?.categories}>
                                        {(cat) => <span class="category-pill">{cat}</span>}
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
                                                                    disabled={!resources.state.selectedInstanceId || isVersionInstalling(version.id) || isVersionInstalled(version.id)}
                                                                    onClick={() => handleInstall(version)}
                                                                    style={{ width: '100%' }}
                                                                    variant={isVersionInstalled(version.id) ? 'outline' : (version.download_url ? 'solid' : 'outline')}
                                                                >
                                                                    <Show when={isVersionInstalling(version.id)}>Installing...</Show>
                                                                    <Show when={!isVersionInstalling(version.id)}>
                                                                        <Show when={isVersionInstalled(version.id)}>Installed</Show>
                                                                        <Show when={!isVersionInstalled(version.id)}>
                                                                            {version.download_url ? 'Install' : 'External'}
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
                                            <span class="value capitalize">{project()?.resource_type}</span>
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
                                                            disabled={!resources.state.selectedInstanceId}
                                                            onClick={() => handleInstall(version)}
                                                            style={{ width: '100%', "margin-top": "8px" }}
                                                            variant={version.download_url ? 'solid' : 'outline'}
                                                        >
                                                            {version.download_url ? 'Install' : 'External'}
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
            </Show>
        </Show>
    );
};

export default ResourceDetailsPage;
