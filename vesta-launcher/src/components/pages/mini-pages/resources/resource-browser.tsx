import { Component, createEffect, For, Show, createSignal, createResource, createMemo, untrack, onMount, onCleanup, JSX, batch } from "solid-js";
import { resources, ResourceProject, ResourceVersion, findBestVersion } from "@stores/resources";
import { instancesState, Instance } from "@stores/instances";
import { TextField } from "@ui/text-field/text-field";
import Button from "@ui/button/button";
import { 
    Select, 
    SelectContent, 
    SelectItem, 
    SelectTrigger, 
    SelectValue 
} from "@ui/select/select";
import { showToast } from "@ui/toast/toast";
import {
    Combobox,
    ComboboxContent,
    ComboboxItem,
    ComboboxTrigger,
    ComboboxInput,
    ComboboxControl
} from "@ui/combobox/combobox";
import {
    Pagination,
    PaginationItems,
    PaginationItem,
    PaginationEllipsis,
    PaginationNext,
    PaginationPrevious
} from "@ui/pagination/pagination";
import { getMinecraftVersions, DEFAULT_ICONS } from "@utils/instances";
import { getShaderEnginesInOrder, type ShaderEngineInfo } from "@utils/resources";
import { router } from "@components/page-viewer/page-viewer";
import InstanceSelectionDialog from "./instance-selection-dialog";
import { openModpackInstallFromUrl } from "@stores/modpack-install";
import "./resource-browser.css";

import HeartIcon from "@assets/heart.svg";
import PanelOpenIcon from "@assets/left_panel_open.svg";
import PanelCloseIcon from "@assets/left_panel_close.svg";

const SearchIcon = (props: { class?: string }) => (
    <svg 
        xmlns="http://www.w3.org/2000/svg" 
        width="20" 
        height="20" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        stroke-width="2" 
        stroke-linecap="round" 
        stroke-linejoin="round" 
        class={props.class}
    >
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>
);

const ListIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
);

const GridIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
);

const LOADERS = ["Forge", "Fabric", "Quilt", "NeoForge"];

const SORT_OPTIONS = {
    modrinth: [
        { label: "Relevance", value: "relevance" },
        { label: "Downloads", value: "downloads" },
        { label: "Followers", value: "follows" },
        { label: "Newest", value: "newest" },
        { label: "Updated", value: "updated" }
    ],
    curseforge: [
        { label: "Featured", value: "featured" },
        { label: "Popularity", value: "popularity" },
        { label: "Last Updated", value: "updated" },
        { label: "Newest", value: "newest" },
        { label: "Rating", value: "rating" },
        { label: "Name", value: "name" },
        { label: "Author", value: "author" },
        { label: "Total Downloads", value: "total_downloads" }
    ]
};

// These are used as a fallback before metadata loads or if it fails.
// We include major/popular versions to ensure the UI is functional immediately.
const VERSION_OPTIONS = [
    "All versions",
    "1.21.4", "1.21.1", "1.20.1", "1.19.2", "1.18.2", "1.17.1", "1.16.5", "1.12.2", "1.8.9", "1.7.10"
];

// Common categories across platforms

const InstanceSelector: Component = () => {
    const selectedInstance = createMemo(() => 
        instancesState.instances.find(i => i.id === resources.state.selectedInstanceId)
    );

    const isModpack = () => resources.state.resourceType === 'modpack';

    const InstanceIcon = (props: { instance?: Instance | null }) => {
        const iconPath = () => props.instance?.iconPath || DEFAULT_ICONS[0];
        return (
            <Show when={props.instance}>
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

    return (
        <div class="instance-selector-wrapper" classList={{ disabled: isModpack() }} title={isModpack() ? "Instance selection is disabled for modpacks" : undefined}>
            <Select<any>
                disabled={isModpack()}
                options={[{ id: null, name: "No Instance" } as any, ...instancesState.instances]}
                value={selectedInstance()}
                onChange={(instance: any) => {
                    batch(() => {
                        const id = instance?.id ?? null;
                        resources.setInstance(id);
                        if (id && instance) {
                            resources.setGameVersion(instance.minecraftVersion);

                            // Only set loader filter if we are currently looking at mods
                            if (resources.state.resourceType === "mod") {
                                // Don't set "vanilla" or empty as a loader filter
                                const loader = instance.modloader?.toLowerCase();
                                if (loader && loader !== "vanilla") {
                                    resources.setLoader(instance.modloader);
                                } else {
                                    resources.setLoader(null);
                                }
                            } else {
                                resources.setLoader(null);
                            }
                        } else {
                            // Reset versions/loaders when going back to No Instance
                            resources.setGameVersion(null);
                            resources.setLoader(null);
                        }

                        // Sync with router
                        router()?.updateQuery("selectedInstanceId", id);
                        router()?.updateQuery("gameVersion", resources.state.gameVersion);
                        router()?.updateQuery("loader", resources.state.loader);
                    });
                }}
            optionValue="id"
            optionTextValue="name"
            itemComponent={(props) => (
                <SelectItem item={props.item} class="instance-select-item">
                    <div class="instance-item-content">
                        <InstanceIcon instance={props.item.rawValue.id ? props.item.rawValue : null} />
                        <span class="instance-item-name">{props.item.rawValue.name}</span>
                    </div>
                </SelectItem>
            )}
        >
            <SelectTrigger class="instance-toolbar-select">
                <div class="instance-trigger-content">
                    <InstanceIcon instance={selectedInstance()} />
                    <div class="instance-trigger-info">
                        <span class="instance-trigger-label">Instance</span>
                        <SelectValue<any>>{(s) => s.selectedOption()?.name ?? "No Instance"}</SelectValue>
                    </div>
                </div>
            </SelectTrigger>
            <SelectContent />
        </Select>
    </div>
);
};

const ResourceCard: Component<{ project: ResourceProject; viewMode: 'grid' | 'list' }> = (props) => {
    const isInstalled = createMemo(() => {
        const instanceId = resources.state.selectedInstanceId;
        const mainId = props.project.id.toLowerCase();
        const extIds = props.project.external_ids || {};
        const projectName = props.project.name.toLowerCase();
        const resType = props.project.resource_type;

        return resources.state.installedResources.some(ir => {
            if (instanceId && ir.instance_id !== instanceId) return false;
            
            const irRemoteId = ir.remote_id.toLowerCase();
            // 1. Direct ID match
            if (irRemoteId === mainId) return true;
            
            // 2. Hash match
            if (ir.hash && props.project.source !== ir.platform) {
                // If we have versions in state for this project, check if any match the hash
                const versions = resources.state.versions.filter(v => v.project_id === props.project.id);
                if (versions.some(v => v.hash === ir.hash)) return true;
            }
            
            // 3. External IDs match
            for (const id of Object.values(extIds)) {
                if (irRemoteId === id.toLowerCase()) return true;
            }

            // 3. Name + Type match (Heuristic)
            return ir.resource_type === resType && ir.display_name.toLowerCase() === projectName;
        });
    });

    const installedResource = createMemo(() => {
        const instanceId = resources.state.selectedInstanceId;
        const mainId = props.project.id.toLowerCase();
        const extIds = props.project.external_ids || {};
        const projectName = props.project.name.toLowerCase();
        const resType = props.project.resource_type;

        return resources.state.installedResources.find(ir => {
            if (instanceId && ir.instance_id !== instanceId) return false;
            
            const irRemoteId = ir.remote_id.toLowerCase();
            if (irRemoteId === mainId) return true;
            for (const id of Object.values(extIds)) {
                if (irRemoteId === id.toLowerCase()) return true;
            }
            return ir.resource_type === resType && ir.display_name.toLowerCase() === projectName;
        });
    });

    const isInstallingProject = createMemo(() => {
        return resources.state.installingProjectIds.includes(props.project.id);
    });

    const [localInstalling, setLocalInstalling] = createSignal(false);
    const [confirmUninstall, setConfirmUninstall] = createSignal(false);
    const [latestCompatibleVersion, setLatestCompatibleVersion] = createSignal<ResourceVersion | null>(null);
    const installing = () => localInstalling() || isInstallingProject();

    const isUpdateAvailable = createMemo(() => {
        const installed = installedResource();
        const latest = latestCompatibleVersion();
        if (!installed || !latest) return false;

        // Check hash first
        if (installed.hash && latest.hash && installed.hash === latest.hash) return false;
        
        if (installed.platform.toLowerCase() === props.project.source.toLowerCase()) {
            return installed.remote_version_id !== latest.id;
        }
        return installed.current_version !== latest.version_number;
    });

    createEffect(async () => {
        const instanceId = resources.state.selectedInstanceId;
        const project = props.project;
        if (isInstalled() && instanceId && project) {
            const inst = instancesState.instances.find(i => i.id === instanceId);
            if (inst) {
                try {
                    const versions = await resources.getVersions(project.source, project.id);
                    const best = findBestVersion(versions, inst.minecraftVersion, inst.modloader, 'release', project.resource_type);
                    setLatestCompatibleVersion(best);
                } catch (_) {
                    // Silently fail update check
                }
            }
        } else {
            setLatestCompatibleVersion(null);
        }
    });

    const compatibility = createMemo(() => {
        const instanceId = resources.state.selectedInstanceId;
        if (!instanceId) return { type: 'compatible' as const };
        
        const instance = instancesState.instances.find(i => i.id === instanceId);
        if (!instance) return { type: 'compatible' as const };
        
        const instLoader = instance.modloader?.toLowerCase() || "";
        const resType = props.project.resource_type;
        
        // Vanilla restriction
        if (instLoader === "" || instLoader === "vanilla") {
            if (resType === 'mod' || resType === 'shader') {
                return { 
                    type: 'incompatible' as const, 
                    reason: `Vanilla instances do not support ${resType}s.` 
                };
            }
            return { type: 'compatible' as const };
        }
        
        // Shaders, Resource Packs, and Data Packs are generally compatible across loaders
        if (resType === 'shader' || resType === 'resourcepack' || resType === 'datapack') return { type: 'compatible' as const };
        
        // Mod compatibility check based on categories/loaders
        const categories = props.project.categories.map(c => c.toLowerCase());
        
        // Check if the project has ANY loaders mentioned in categories
        const hasFabric = categories.includes('fabric');
        const hasForge = categories.includes('forge');
        const hasQuilt = categories.includes('quilt');
        const hasNeoForge = categories.includes('neoforge');
        
        // If it specifies no loaders, we assume it's ambiguous
        if (!hasFabric && !hasForge && !hasQuilt && !hasNeoForge) return { type: 'compatible' as const };
        
        if (instLoader === 'fabric') {
            if (hasFabric) return { type: 'compatible' as const };
            return { 
                type: 'incompatible' as const, 
                reason: "This mod is not compatible with Fabric." 
            };
        }
        
        if (instLoader === 'forge') {
            if (hasForge) return { type: 'compatible' as const };
            return { 
                type: 'incompatible' as const, 
                reason: "This mod is not compatible with Forge." 
            };
        }
        
        if (instLoader === 'quilt') {
            if (hasQuilt || hasFabric) {
                if (!hasQuilt && hasFabric) {
                    return { 
                        type: 'warning' as const, 
                        reason: "Fabric mod on Quilt instance." 
                    };
                }
                return { type: 'compatible' as const };
            }
            return { 
                type: 'incompatible' as const, 
                reason: "This mod is not compatible with Quilt." 
            };
        }

        if (instLoader === 'neoforge') {
            if (hasNeoForge || hasForge) {
                if (!hasNeoForge && hasForge) {
                    return { 
                        type: 'warning' as const, 
                        reason: "Forge mod on NeoForge instance." 
                    };
                }
                return { type: 'compatible' as const };
            }
            return { 
                type: 'incompatible' as const, 
                reason: "This mod is not compatible with NeoForge." 
            };
        }
        
        return { type: 'compatible' as const };
    });

    const navigateToDetails = () => {
        resources.setRequestInstall(null);
        router()?.navigate("/resource-details", { 
            projectId: props.project.id, 
            platform: props.project.source 
        }, { 
            project: props.project 
        });
    };

    const handleQuickInstall = async (e: MouseEvent) => {
        e.stopPropagation();

        if (props.project.resource_type === 'modpack') {
            router()?.navigate("/install", {
                projectId: props.project.id,
                platform: props.project.source,
                isModpack: true,
                resourceType: 'modpack',
                projectName: props.project.name,
                projectIcon: props.project.icon_url || undefined,
                projectAuthor: props.project.author,
            });
            return;
        }

        if (isInstalled()) {
            // Check for update first
            const latest = latestCompatibleVersion();
            if (isUpdateAvailable() && latest) {
                const instanceId = resources.state.selectedInstanceId;
                if (!instanceId) return;

                setLocalInstalling(true);
                try {
                    await resources.install(props.project, latest);
                    showToast({
                        title: "Updated",
                        description: `${props.project.name} has been updated.`,
                        severity: "Success"
                    });
                } catch (err) {
                    showToast({
                        title: "Failed to update",
                        description: err instanceof Error ? err.message : String(err),
                        severity: "Error"
                    });
                } finally {
                    setLocalInstalling(false);
                }
                return;
            }

            if (!confirmUninstall()) {
                setConfirmUninstall(true);
                // Reset after 3 seconds
                setTimeout(() => setConfirmUninstall(false), 3000);
                return;
            }

            const res = installedResource();
            if (res) {
                try {
                    await resources.uninstall(res.instance_id, res.id);
                    setConfirmUninstall(false);
                    showToast({
                        title: "Resource removed",
                        description: `${props.project.name} has been uninstalled.`,
                        severity: "Success"
                    });
                } catch (e) {
                    console.error("Failed to uninstall:", e);
                }
            }
            return;
        }

        const instanceId = resources.state.selectedInstanceId;
        if (!instanceId) {
            setLocalInstalling(true);
            try {
                const versions = await resources.getVersions(props.project.source, props.project.id);
                resources.setRequestInstall(props.project, versions);
            } catch (err) {
                console.error("Failed to fetch versions for request install:", err);
                resources.setRequestInstall(props.project);
            } finally {
                setLocalInstalling(false);
            }
            return;
        }

        const instance = instancesState.instances.find(i => i.id === instanceId);
        if (!instance) return;

        setLocalInstalling(true);
        try {
            const versions = await resources.getVersions(props.project.source, props.project.id);
            const best = findBestVersion(versions, instance.minecraftVersion, instance.modloader, 'release', props.project.resource_type);
            if (best) {
                const instLoader = instance.modloader?.toLowerCase() || "";
                const hasDirectLoader = best.loaders.some(l => l.toLowerCase() === instLoader);
                
                if (instLoader === "quilt" && !hasDirectLoader && best.loaders.some(l => l.toLowerCase() === "fabric")) {
                    showToast({
                        title: "Potential Incompatibility",
                        description: `Installing Fabric version of ${props.project.name} on a Quilt instance.`,
                        severity: "Warning"
                    });
                }

                // If it's a shader, check for required engine
                if (props.project.resource_type === 'shader') {
                    const engines = getShaderEnginesInOrder(instance.modloader);
                    const installedInTarget = await resources.getInstalled(instance.id);
                    
                    const engineInstalled = installedInTarget.some(ir => 
                        ir.display_name.toLowerCase().includes('iris') || 
                        ir.display_name.toLowerCase().includes('oculus')
                    );

                    if (!engineInstalled && engines.length > 0) {
                        // Find the first engine that is compatible with the instance MC version
                        let bestEngine = null;
                        let engineProject = null;
                        
                        for (const engineInfo of engines) {
                            try {
                                const versions = await resources.getVersions(engineInfo.source, engineInfo.id);
                                const best = findBestVersion(versions, instance.minecraftVersion, instance.modloader, 'release', 'mod');
                                if (best) {
                                    bestEngine = best;
                                    engineProject = await resources.getProject(engineInfo.source, engineInfo.id);
                                    break;
                                }
                            } catch (e) {
                                console.error(`Failed to check engine ${engineInfo.name}:`, e);
                            }
                        }

                        if (bestEngine && engineProject) {
                            showToast({
                                title: "Shader Engine Required",
                                description: `Installing ${engineProject.name} to support shaders...`,
                                severity: "Info"
                            });
                            await resources.install(engineProject, bestEngine, instance.id);
                        }
                    }
                }

                await resources.install(props.project, best);
                showToast({
                    title: "Success",
                    description: `Installed ${props.project.name} to ${instance.name}`,
                    severity: "Success"
                });
            } else {
                showToast({
                    title: "No compatible version",
                    description: `Could not find a version for ${instance.minecraftVersion} with ${instance.modloader || 'no loader'}.`,
                    severity: "Error"
                });
            }
        } catch (err) {
            showToast({
                title: "Failed to install",
                description: err instanceof Error ? err.message : String(err),
                severity: "Error"
            });
        } finally {
            setLocalInstalling(false);
        }
    };

    return (
        <div 
            class={`resource-card ${props.viewMode}`} 
            onClick={navigateToDetails}
            classList={{ 'installed': isInstalled() }}
        >
            <div class="resource-card-icon">
                <Show when={props.project.icon_url} fallback={<div class="icon-placeholder" />}>
                    <img src={props.project.icon_url ?? ""} alt={props.project.name} />
                </Show>
            </div>
            <div class="resource-card-content">
                <div class="resource-card-header">
                    <div class="resource-card-title-group">
                        <h3 class="resource-card-title">{props.project.name}</h3>
                        <span class="resource-card-author">by {props.project.author}</span>
                    </div>
                </div>
                <p class="resource-card-summary">{props.project.summary}</p>
                <div class="resource-card-footer">
                    <span class="resource-card-downloads">{props.project.download_count.toLocaleString()} downloads</span>
                    <Show when={props.project.source === 'modrinth' && (props.project.follower_count || 0) > 0}>
                        <span class="resource-card-followers"><HeartIcon /> {(props.project.follower_count || 0).toLocaleString()}</span>
                    </Show>
                    <Show when={props.project.published_at}>
                        <span class="resource-card-date">
                            {new Date(props.project.published_at ?? "").toLocaleDateString()}
                        </span>
                    </Show>
                </div>
                <Show when={props.project.categories && props.project.categories.length > 0}>
                    <div class="resource-card-tags">
                        <For each={props.project.categories.slice(0, 4)}>
                            {(tag) => {
                                // Find the category object in availableCategories if possible to get its real ID/Slug
                                const categoryObj = createMemo(() => 
                                    resources.state.availableCategories.find(c => 
                                        c.name.toLowerCase() === tag.toLowerCase() || 
                                        c.id.toLowerCase() === tag.toLowerCase()
                                    )
                                );

                                return (
                                    <span 
                                        class="resource-tag"
                                        classList={{ active: resources.state.categories.includes((categoryObj()?.id || tag).toLowerCase()) }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            // Normalize tag to ID if possible
                                            const filterId = categoryObj()?.id || tag;
                                            resources.toggleCategory(filterId.toLowerCase());
                                            resources.setOffset(0);
                                        }}
                                    >
                                        {categoryObj()?.name || tag}
                                    </span>
                                );
                            }}
                        </For>
                        <Show when={props.project.categories.length > 4}>
                            <span class="resource-tag-more">+{props.project.categories.length - 4}</span>
                        </Show>
                    </div>
                </Show>
            </div>
            <div class="resource-card-actions">
                <Button 
                    onClick={handleQuickInstall} 
                    disabled={installing() || (compatibility().type === 'incompatible' && !isInstalled())}
                    size="sm"
                    variant={isInstalled() && !isUpdateAvailable() ? "outline" : "solid"}
                    color={isUpdateAvailable() ? "secondary" : (isInstalled() ? "destructive" : (compatibility().type === 'warning' ? 'warning' : undefined))}
                    tooltip_text={compatibility().reason}
                >
                    <Show when={installing()}>Installing...</Show>
                    <Show when={!installing() && isInstalled()}>
                        <Show when={isUpdateAvailable()} fallback={
                            <Show when={confirmUninstall()} fallback="Uninstall">Confirm?</Show>
                        }>
                            Update
                        </Show>
                    </Show>
                    <Show when={!installing() && !isInstalled()}>
                        <Show when={compatibility().type === 'incompatible'} fallback="Install">
                            Unsupported
                        </Show>
                    </Show>
                </Button>
            </div>
        </div>
    );
};

const FiltersPanel: Component = () => {
    const [mcVersions] = createResource(getMinecraftVersions);

    onMount(() => {
        resources.fetchCategories();
    });

    // Auto-expand groups that contain active categories
    createEffect(() => {
        const activeCats = resources.state.categories;
        const available = availableCategories();
        if (activeCats.length > 0 && available.length > 0) {
            const current = resources.state.expandedCategoryGroups;
            const next = new Set(current);
            let changed = false;
            
            for (const group of available) {
                // Expand if group itself is active or any items are active
                const id = group.id || group.name;
                const groupIsActive = group.id && activeCats.includes(group.id);
                const itemIsActive = group.items.some(item => activeCats.includes(item.id));
                
                if ((groupIsActive || itemIsActive) && id) {
                    if (!next.has(id)) {
                        next.add(id);
                        changed = true;
                    }
                }
            }
            
            if (changed) {
                resources.setExpandedCategoryGroups(Array.from(next));
            }
        }
    });

    const toggleGroupExpand = (groupId: string, e: MouseEvent) => {
        e.stopPropagation();
        resources.toggleCategoryGroup(groupId);
    };

    const gameVersions = createMemo(() => {
        const meta = mcVersions();
        const current = resources.state.gameVersion;
        const base = VERSION_OPTIONS;

        // If metadata is available, use it as the primary source
        if (meta && meta.game_versions) {
            const releases = meta.game_versions
                .filter(v => v.version_type === 'release')
                .map(v => v.id);
            
            // Build the list: "All versions" first, then all releases from metadata
            const merged = ["All versions", ...releases];
            
            // Ensure the current selection is in the list even if it's not a release (e.g. snapshot)
            if (current && current !== "All versions" && !merged.includes(current)) {
                merged.push(current);
            }
            return merged;
        }

        // Fallback to static list if metadata is still loading or failed
        if (current && current !== "All versions" && !base.includes(current)) {
            return [...base, current];
        }
        return base;
    });

    const availableCategories = createMemo(() => {
        const type = resources.state.resourceType;
        const source = resources.state.activeSource;
        const allCats = resources.state.availableCategories;

        if (allCats.length === 0) return [];

        // Filter by project type
        const filtered = allCats.filter(c => {
            if (!c.project_type) return true;
            return c.project_type === type;
        });

        if (source === 'curseforge') {
            interface CategoryItem { id: string; name: string; icon: string | null; displayIndex: number };
            interface CategoryGroup { id?: string; name: string; icon?: string | null; displayIndex: number; items: CategoryItem[] };
            
            const result: CategoryGroup[] = [];
            
            // 1. Identify "Top Level" categories for this resource type.
            const topLevel = filtered.filter(c => !c.parent_id || !filtered.some(p => p.id === c.parent_id));
            
            const generalGroup: CategoryGroup = { id: undefined, name: "General", icon: undefined, displayIndex: -1, items: [] };

            for (const tl of topLevel) {
                const children = filtered.filter(c => c.parent_id === tl.id);
                if (children.length > 0) {
                    result.push({
                        id: tl.id,
                        name: tl.name,
                        icon: tl.icon_url,
                        displayIndex: tl.display_index ?? 0,
                        items: children.map(c => ({ 
                            id: c.id, 
                            name: c.name, 
                            icon: c.icon_url,
                            displayIndex: c.display_index ?? 0
                        })).sort((a,b) => (a.displayIndex - b.displayIndex) || a.name.localeCompare(b.name))
                    });
                } else {
                    generalGroup.items.push({ 
                        id: tl.id, 
                        name: tl.name, 
                        icon: tl.icon_url,
                        displayIndex: tl.display_index ?? 0
                    });
                }
            }

            result.sort((a, b) => (a.displayIndex - b.displayIndex) || a.name.localeCompare(b.name));
            if (generalGroup.items.length > 0) {
                generalGroup.items.sort((a, b) => (a.displayIndex - b.displayIndex) || a.name.localeCompare(b.name));
                result.unshift(generalGroup); // General at the very top
            }

            return result;
        }

        // Flat list for Modrinth (Single group with empty name to avoid double header)
        return [{
            id: undefined as string | undefined, 
            name: "", 
            icon: undefined as string | undefined,
            displayIndex: 0,
            items: filtered.map(c => ({
                id: c.id,
                name: c.name,
                icon: c.icon_url,
                displayIndex: c.display_index ?? 0
            })).sort((a, b) => a.name.localeCompare(b.name))
        }];
    });

    const shouldShowLoader = () => resources.state.resourceType === 'mod' || resources.state.resourceType === 'modpack';
    const shouldShowGameVersion = () => true;

    return (
        <div class="filters-panel">
            <div class="filters-header">
                <h3>Filters</h3>
                <Button 
                    size="sm" 
                    variant="ghost"
                    onClick={() => resources.resetFilters()}
                >
                    Reset
                </Button>
            </div>

            <div class="filter-section mobile-only-instance">
                <label class="filter-label">Target Instance</label>
                <InstanceSelector />
            </div>

            <div class="filter-section">
                <label class="filter-label">Resource Type</label>
                <div class="filter-options">
                    <For each={['mod', 'resourcepack', 'shader', 'datapack', 'modpack', 'world'] as const}>
                        {(type) => (
                            <button
                                class="filter-option"
                                classList={{ 
                                    active: resources.state.resourceType === type,
                                    disabled: type === 'world' && resources.state.activeSource === 'modrinth'
                                }}
                                disabled={type === 'world' && resources.state.activeSource === 'modrinth'}
                                title={type === 'world' && resources.state.activeSource === 'modrinth' ? "Modrinth does not support worlds" : undefined}
                                onClick={() => {
                                    batch(() => {
                                        resources.setType(type);
                                        resources.setOffset(0);
                                        router()?.updateQuery("resourceType", type);
                                    });
                                }}
                            >
                                {type.charAt(0).toUpperCase() + type.slice(1)}s
                            </button>
                        )}
                    </For>
                </div>
            </div>

            <Show when={shouldShowGameVersion()}>
                <div class="filter-section">
                    <label class="filter-label">Minecraft Version</label>
                    <Combobox 
                        options={gameVersions()} 
                        value={resources.state.gameVersion || "All versions"}
                        onChange={(v: string | null) => {
                            batch(() => {
                                const val = v === "All versions" || !v ? null : v;
                                resources.setGameVersion(val);
                                resources.setOffset(0);
                                router()?.updateQuery("gameVersion", val);
                            });
                        }}
                        itemComponent={(props) => (
                            <ComboboxItem item={props.item}>
                                {String(props.item.rawValue)}
                            </ComboboxItem>
                        )}
                    >
                        <ComboboxControl class="filter-combobox">
                            <ComboboxInput />
                            <ComboboxTrigger />
                        </ComboboxControl>
                        <ComboboxContent />
                    </Combobox>
                </div>
            </Show>

            <Show when={shouldShowLoader()}>
                <div class="filter-section">
                    <label class="filter-label">Mod Loader</label>
                    <Select 
                        options={["All Loaders", ...LOADERS]} 
                        value={LOADERS.find(l => l.toLowerCase() === resources.state.loader) || "All Loaders"}
                        onChange={(v: string | null) => {
                            batch(() => {
                                const val = v === "All Loaders" || !v ? null : v.toLowerCase();
                                resources.setLoader(val);
                                resources.setOffset(0);
                                router()?.updateQuery("loader", val);
                            });
                        }}
                        itemComponent={(props) => (
                            <SelectItem item={props.item}>
                                {String(props.item.rawValue)}
                            </SelectItem>
                        )}
                    >
                        <SelectTrigger class="filter-select">
                            <SelectValue<string>>{(s) => String(s.selectedOption() || "All Loaders")}</SelectValue>
                        </SelectTrigger>
                        <SelectContent />
                    </Select>
                </div>
            </Show>

            <Show when={availableCategories().length > 0}>
                <div class="filter-section">
                    <label class="filter-label">Categories</label>
                    <div class="category-groups">
                        <For each={availableCategories()}>
                            {(group) => (
                                <div class="category-group">
                                    <Show when={group.name !== ""}>
                                        <div 
                                            class="category-group-header"
                                            classList={{ 'not-clickable': !group.id }}
                                        >
                                            <div 
                                                class="category-group-title" 
                                                title={group.id}
                                                classList={{ 
                                                    clickable: !!group.id, 
                                                    active: group.id ? resources.state.categories.includes(group.id) : false 
                                                }}
                                                onClick={() => {
                                                    if (group.id) {
                                                        batch(() => {
                                                            resources.toggleCategory(group.id!);
                                                            resources.setOffset(0);
                                                            router()?.updateQuery("categories", resources.state.categories);
                                                        });
                                                    }
                                                }}
                                            >
                                                <Show when={group.icon}>
                                                    <div class="category-tag-icon">
                                                        <Show when={group.icon?.startsWith("http")} fallback={
                                                            <div class="category-tag-icon-svg" innerHTML={group.icon ?? ""} />
                                                        }>
                                                            <img src={group.icon ?? ""} class="category-tag-icon-img" alt={group.name} />
                                                        </Show>
                                                    </div>
                                                </Show>
                                                <span>{group.name}</span>
                                            </div>
                                            <Show when={group.items.length > 0 && resources.state.activeSource === 'curseforge'}>
                                                <button 
                                                    class="expand-toggle"
                                                    classList={{ expanded: resources.state.expandedCategoryGroups.includes(group.id || group.name) }}
                                                    onClick={(e) => toggleGroupExpand(group.id || group.name, e)}
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                                </button>
                                            </Show>
                                        </div>
                                    </Show>
                                    <Show when={resources.state.expandedCategoryGroups.includes(group.id || group.name) || resources.state.activeSource !== 'curseforge'}>
                                        <div class="category-grid">
                                            <For each={group.items}>
                                                {(cat) => (
                                                    <button
                                                        class="category-tag"
                                                        title={cat.id}
                                                        classList={{ active: resources.state.categories.includes(cat.id) }}
                                                        onClick={() => {
                                                            resources.toggleCategory(cat.id);
                                                            resources.setOffset(0);
                                                        }}
                                                    >
                                                        <Show when={cat.icon}>
                                                            <div class="category-tag-icon">
                                                                <Show when={cat.icon?.startsWith("http")} fallback={
                                                                    <div class="category-tag-icon-svg" innerHTML={cat.icon ?? ""} />
                                                                }>
                                                                    <img src={cat.icon ?? ""} class="category-tag-icon-img" alt={cat.name} />
                                                                </Show>
                                                            </div>
                                                        </Show>
                                                        <span class="category-tag-text">{cat.name}</span>
                                                    </button>
                                                )}
                                            </For>
                                        </div>
                                    </Show>
                                </div>
                            )}
                        </For>
                    </div>
                </div>
            </Show>
        </div>
    );
};

const ResourceBrowser: Component<{ 
    setRefetch?: (fn: () => Promise<void>) => void;
    query?: string;
    resourceType?: any;
    gameVersion?: string;
    loader?: string;
    activeSource?: any;
    sortBy?: string;
    sortOrder?: string;
    showFilters?: boolean;
    categories?: string[];
    selectedInstanceId?: string;
    limit?: number;
    offset?: number;
    viewMode?: 'grid' | 'list';
    expandedCategoryGroups?: string[];
}> = (props) => {
    let debounceTimer: number | undefined;
    const [isSearchExpanded, setIsSearchExpanded] = createSignal(false);
    const [isInstanceDialogOpen, setIsInstanceDialogOpen] = createSignal(false);
    let lastWidth = window.innerWidth;
    let isInitializedFromProps = false;

    const currentSortOptions = () => SORT_OPTIONS[resources.state.activeSource as keyof typeof SORT_OPTIONS] || [];

    createEffect(() => {
        if (resources.state.requestInstallProject) {
            setIsInstanceDialogOpen(true);
        }
    });

    const handleSelectInstance = async (instance: Instance) => {
        const project = resources.state.requestInstallProject;
        const versions = resources.state.requestInstallVersions;
        if (!project) return;

        setIsInstanceDialogOpen(false);
        resources.setRequestInstall(null);

        // Carry out the install using the logic similar to details page
        try {
            // Use existing versions if available, else fetch
            const finalVersions = versions.length > 0 ? versions : await resources.getVersions(project.source, project.id);
            const best = findBestVersion(finalVersions, instance.minecraftVersion, instance.modloader, 'release', project.resource_type);
            
            if (best) {
                // If it's a shader, check for required engine
                if (project.resource_type === 'shader') {
                    const engines = getShaderEnginesInOrder(instance.modloader);
                    const installedInTarget = await resources.getInstalled(instance.id);
                    // Check if *either* major shader engine is installed
                    const engineInstalled = installedInTarget.some(ir => 
                        ir.display_name.toLowerCase().includes('iris') || 
                        ir.display_name.toLowerCase().includes('oculus')
                    );

                    if (!engineInstalled && engines.length > 0) {
                        let bestEngine = null;
                        let engineProject = null;
                        
                        for (const engineInfo of engines) {
                            try {
                                const versions = await resources.getVersions(engineInfo.source, engineInfo.id);
                                const vBest = findBestVersion(versions, instance.minecraftVersion, instance.modloader, 'release', 'mod');
                                if (vBest) {
                                    bestEngine = vBest;
                                    engineProject = await resources.getProject(engineInfo.source, engineInfo.id);
                                    break;
                                }
                            } catch (e) {
                                console.error(`Failed to check engine ${engineInfo.name}:`, e);
                            }
                        }

                        if (bestEngine && engineProject) {
                            showToast({
                                title: "Shader Engine Required",
                                description: `Installing ${engineProject.name} to support shaders...`,
                                severity: "Info"
                            });
                            await resources.install(engineProject, bestEngine, instance.id);
                        }
                    }
                }

                await resources.install(project, best, instance.id);
                showToast({
                    title: "Success",
                    description: `Installed ${project.name} to ${instance.name}`,
                    severity: "Success"
                });
            } else {
                showToast({
                    title: "No compatible version",
                    description: `Could not find a version for ${instance.minecraftVersion} with ${instance.modloader || 'no loader'}.`,
                    severity: "Error"
                });
            }
        } catch (err) {
            showToast({
                title: "Installation failed",
                description: err instanceof Error ? err.message : String(err),
                severity: "Error"
            });
        }
    };

    const handleCreateNew = () => {
        const project = resources.state.requestInstallProject;
        if (!project) return;
        
        setIsInstanceDialogOpen(false);
        resources.setRequestInstall(null);
        
        router()?.navigate("/install", { 
            projectId: project.id, 
            platform: project.source,
            isModpack: project.resource_type === 'modpack',
            projectName: project.name,
            projectIcon: project.icon_url || "",
            resourceType: project.resource_type
        });
    };

    onMount(() => {
        // Apply props to global store if provided (e.g. from pop-out handoff)
        // We do this here instead of a createEffect to ensure props only initialize the store once
        // and don't overwrite manual user changes during the session.
        batch(() => {
            if (props.query !== undefined) { resources.setQuery(props.query); isInitializedFromProps = true; }
            if (props.resourceType !== undefined) { resources.setType(props.resourceType); isInitializedFromProps = true; }
            if (props.gameVersion !== undefined) { resources.setGameVersion(props.gameVersion === "All versions" ? null : props.gameVersion); isInitializedFromProps = true; }
            if (props.loader !== undefined) { resources.setLoader(props.loader === "All Loaders" ? null : props.loader); isInitializedFromProps = true; }
            if (props.activeSource !== undefined) { resources.setSource(props.activeSource); isInitializedFromProps = true; }
            if (props.sortBy !== undefined) { resources.setSortBy(props.sortBy); isInitializedFromProps = true; }
            if (props.sortOrder !== undefined) { resources.setSortOrder(props.sortOrder as any); isInitializedFromProps = true; }
            if (props.showFilters !== undefined && props.showFilters !== resources.state.showFilters) { resources.toggleFilters(); isInitializedFromProps = true; }
            if (props.categories !== undefined) { resources.setCategories(props.categories); isInitializedFromProps = true; }
            if (props.selectedInstanceId !== undefined) { 
                resources.setInstance(props.selectedInstanceId ? parseInt(props.selectedInstanceId as any) : null);
                isInitializedFromProps = true;
            }
            if (props.limit !== undefined) { resources.setLimit(props.limit); isInitializedFromProps = true; }
            if (props.offset !== undefined) { resources.setOffset(props.offset); isInitializedFromProps = true; }
            if (props.viewMode !== undefined) { resources.setViewMode(props.viewMode); isInitializedFromProps = true; }
            if (props.expandedCategoryGroups !== undefined) { resources.setExpandedCategoryGroups(props.expandedCategoryGroups); isInitializedFromProps = true; }
        });

        // Register state provider for pop-out window handoff
        router()?.registerStateProvider("/resources", () => ({
            query: resources.state.query,
            resourceType: resources.state.resourceType,
            gameVersion: resources.state.gameVersion,
            loader: resources.state.loader,
            activeSource: resources.state.activeSource,
            sortBy: resources.state.sortBy,
            sortOrder: resources.state.sortOrder,
            showFilters: resources.state.showFilters,
            categories: [...resources.state.categories],
            selectedInstanceId: resources.state.selectedInstanceId,
            limit: resources.state.limit,
            offset: resources.state.offset,
            viewMode: resources.state.viewMode,
            expandedCategoryGroups: [...resources.state.expandedCategoryGroups]
        }));

        if (props.setRefetch) {
            props.setRefetch(async () => {
                await resources.search();
            });
        }

        // Automatic filter visibility based on screen size
        const handleResize = () => {
            const width = window.innerWidth;
            const isSmall = width <= 768;
            const wasSmall = lastWidth <= 768;

            if (isSmall !== wasSmall) {
                if (isSmall && resources.state.showFilters) {
                    resources.toggleFilters();
                } else if (!isSmall && !resources.state.showFilters) {
                    resources.toggleFilters();
                }
            }
            lastWidth = width;
        };

        // Run once on mount
        handleResize();

        window.addEventListener('resize', handleResize);
        onCleanup(() => window.removeEventListener('resize', handleResize));

        if (resources.state.selectedInstanceId) {
            resources.fetchInstalled(resources.state.selectedInstanceId);
        }

        const content = document.querySelector('.page-viewer-content');
        if (content instanceof HTMLElement) {
            content.style.overflow = 'hidden';
        }

        onCleanup(() => {
            if (content instanceof HTMLElement) {
                content.style.overflow = '';
            }
        });
    });

    const handleSearchInput = (value: string) => {
        resources.setQuery(value);
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(async () => {
            resources.setOffset(0);
            await resources.search();
            
            // Only update the router query if the search value hasn't changed 
            // and it's actually different from the current router state.
            untrack(() => {
                const currentRouterQuery = router()?.currentParams.get().query;
                if (resources.state.query === value && currentRouterQuery !== value) {
                    router()?.updateQuery("query", value);
                }
            });
        }, 500);
    };

    let hasInitializedFilters = false;

    createEffect(() => {
        const instances = instancesState.instances;
        const selectedId = resources.state.selectedInstanceId;
        const currentVersion = resources.state.gameVersion;

        // Sync filters with selected instance if they are currently null
        // We only do this once on mount/initial load to avoid fighting user manual changes
        // CRITICAL: Skip if we were already initialized from handoff props to preserve pop-out state
        if (!hasInitializedFilters && !isInitializedFromProps && instances.length > 0 && selectedId && !currentVersion) {
            hasInitializedFilters = true;
            untrack(() => {
                const inst = instances.find(i => i.id === selectedId);
                if (inst) {
                    resources.setGameVersion(inst.minecraftVersion);
                    if (resources.state.resourceType === 'mod') {
                        const loader = inst.modloader?.toLowerCase();
                        if (loader && loader !== 'vanilla') {
                            resources.setLoader(inst.modloader);
                        }
                    }
                }
            });
        }
    });

    createEffect(() => {
        resources.state.activeSource;
        resources.state.resourceType;
        resources.state.gameVersion;
        resources.state.loader;
        resources.state.categories;
        resources.state.sortBy;
        resources.state.sortOrder;
        resources.state.limit;
        resources.state.offset;
        const reconciling = resources.state.reconcilingCategories;
        
        if (reconciling) return;

        untrack(() => {
            resources.search();
        });
    });

    const currentPage = () => Math.floor(resources.state.offset / resources.state.limit) + 1;
    const totalPages = () => Math.ceil(resources.state.totalHits / resources.state.limit);

    return (
        <div class="resource-browser">
            <Show when={resources.state.showFilters}>
                <FiltersPanel />
            </Show>
            
            <div class="resource-browser-main">
                <div class="resource-browser-toolbar" classList={{ 'is-search-expanded': isSearchExpanded() }}>
                    <div class="toolbar-left">
                        <Button 
                            size="sm" 
                            variant="ghost"
                            icon_only
                            onClick={resources.toggleFilters}
                            title={resources.state.showFilters ? "Hide Filters" : "Show Filters"}
                            class="filter-toggle-btn"
                        >
                            <Show when={resources.state.showFilters} fallback={<PanelOpenIcon />}>
                                <PanelCloseIcon />
                            </Show>
                        </Button>
                        <div class="search-container" classList={{ 'expanded': isSearchExpanded() }}>
                            <Button
                                size="sm"
                                variant="ghost"
                                icon_only
                                class="mobile-search-trigger"
                                onClick={() => {
                                    setIsSearchExpanded(true);
                                    // Focus the input after expanding
                                    const input = document.querySelector('.toolbar-search-field input') as HTMLInputElement;
                                    input?.focus();
                                }}
                            >
                                <SearchIcon />
                            </Button>
                            <div class="search-input-wrapper">
                                <SearchIcon class="search-svg" />
                                <TextField 
                                    placeholder="Search resources..." 
                                    value={resources.state.query}
                                    onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) => handleSearchInput(e.currentTarget.value)}
                                    class="toolbar-search-field"
                                    onFocus={() => setIsSearchExpanded(true)}
                                    onBlur={() => {
                                        setTimeout(() => setIsSearchExpanded(false), 200);
                                    }}
                                />
                            </div>
                        </div>
                    </div>

                    <div class="toolbar-center">
                        <InstanceSelector />
                    </div>

                    <div class="toolbar-right">
                        <div class="source-toggle">
                            <button
                                class="source-btn"
                                classList={{ active: resources.state.activeSource === 'modrinth' }}
                                onClick={() => {
                                    batch(() => {
                                        resources.setSource('modrinth');
                                        resources.setOffset(0);
                                        router()?.updateQuery("activeSource", "modrinth");
                                    });
                                }}
                            >
                                Modrinth
                            </button>
                            <button
                                class="source-btn"
                                classList={{ active: resources.state.activeSource === 'curseforge' }}
                                onClick={() => {
                                    batch(() => {
                                        resources.setSource('curseforge');
                                        resources.setOffset(0);
                                        router()?.updateQuery("activeSource", "curseforge");
                                    });
                                }}
                            >
                                CurseForge
                            </button>
                        </div>
                        <div class="view-toggle">
                            <button 
                                class="view-btn" 
                                classList={{ active: resources.state.viewMode === 'list' }}
                                onClick={() => resources.setViewMode('list')}
                                title="List View"
                            >
                                <ListIcon />
                            </button>
                            <button 
                                class="view-btn" 
                                classList={{ active: resources.state.viewMode === 'grid' }}
                                onClick={() => resources.setViewMode('grid')}
                                title="Grid View"
                            >
                                <GridIcon />
                            </button>
                        </div>
                    </div>
                </div>
                <div class="resource-results-info">
                    <div class="results-stats">
                        <Show when={resources.state.totalHits > 0}>
                            Showing {resources.state.totalHits.toLocaleString()} results
                            <Show when={resources.state.categories.length > 0}>
                                {" • "}
                                {resources.state.categories.map(catId => {
                                    const cat = resources.state.availableCategories.find(c => c.id === catId);
                                    return cat ? cat.name : (catId.charAt(0).toUpperCase() + catId.slice(1));
                                }).join(", ")}
                            </Show>
                        </Show>
                    </div>
                    <div class="results-sort">
                        <div class="limit-selector">
                            <span class="sort-label">Per Page:</span>
                            <Select 
                                options={[20, 50, 100]} 
                                value={resources.state.limit}
                                onChange={(v: number | null) => resources.setLimit(v || 20)}
                                itemComponent={(props) => (
                                    <SelectItem item={props.item}>
                                        {props.item.rawValue}
                                    </SelectItem>
                                )}
                            >
                                <SelectTrigger class="limit-select-trigger">
                                    <SelectValue<number>>{(s) => s.selectedOption()}</SelectValue>
                                </SelectTrigger>
                                <SelectContent />
                            </Select>
                        </div>

                        <span class="sort-label">Sort By:</span>
                        <Select 
                            options={currentSortOptions()} 
                            value={resources.state.sortBy || (currentSortOptions()[0]?.value)}
                            onChange={(val: string | null) => {
                                batch(() => {
                                    // val is the primitive value because optionValue="value" is set
                                    resources.setSortBy(val || 'relevance');
                                    resources.setOffset(0);
                                    router()?.updateQuery("sortBy", val);
                                });
                            }}
                            optionValue="value"
                            optionTextValue="label"
                            itemComponent={(props) => (
                                <SelectItem item={props.item}>
                                    {props.item.rawValue.label}
                                </SelectItem>
                            )}
                        >
                            <SelectTrigger class="sort-select-trigger">
                                <SelectValue<any>>{(s) => s.selectedOption()?.label || "Sort By..."}</SelectValue>
                            </SelectTrigger>
                            <SelectContent />
                        </Select>
                        <Show when={resources.state.activeSource === 'curseforge'}>
                            <button
                                class="sort-direction-btn"
                                onClick={() => {
                                    resources.toggleSortOrder();
                                    resources.setOffset(0);
                                }}
                                title={resources.state.sortOrder === 'asc' ? "Ascending" : "Descending"}
                            >
                                {resources.state.sortOrder === 'asc' ? '↑' : '↓'}
                            </button>
                        </Show>
                    </div>
                </div>

                <div class="resource-results">
                    <Show when={!resources.state.loading} fallback={
                        <div class="loading-state">
                            <div class="spinner" />
                            <span>Searching for resources...</span>
                        </div>
                    }>
                        <Show when={resources.state.results.length > 0} fallback={
                            <div class="empty-state">
                                <h3>No resources found</h3>
                                <p>Try adjusting your search query or filters.</p>
                                <Button onClick={() => resources.resetFilters()}>Clear All Filters</Button>
                            </div>
                        }>
                            <div class={`resource-${resources.state.viewMode}`}>
                                <For each={resources.state.results}>
                                    {(project) => <ResourceCard project={project} viewMode={resources.state.viewMode} />}
                                </For>
                            </div>

                            <Show when={totalPages() > 1}>
                                <div class="resource-browser-pagination">
                                    <Pagination 
                                        count={totalPages()} 
                                        page={currentPage()} 
                                        onPageChange={resources.setPage}
                                        class="pagination"
                                        itemComponent={(props) => (
                                            <PaginationItem page={props.page} class="pagination-item">
                                                {props.page}
                                            </PaginationItem>
                                        )}
                                        ellipsisComponent={() => <PaginationEllipsis class="pagination-ellipsis" />}
                                    >
                                        <PaginationPrevious class="pagination-prev">Prev</PaginationPrevious>
                                        <PaginationItems />
                                        <PaginationNext class="pagination-next">Next</PaginationNext>
                                    </Pagination>
                                </div>
                            </Show>
                        </Show>
                    </Show>
                </div>
            </div>

            <InstanceSelectionDialog 
                isOpen={isInstanceDialogOpen()}
                onClose={() => {
                    setIsInstanceDialogOpen(false);
                    resources.setRequestInstall(null);
                }}
                onSelect={handleSelectInstance}
                onCreateNew={handleCreateNew}
                project={resources.state.requestInstallProject ?? undefined}
                versions={resources.state.requestInstallVersions}
            />
        </div>
    );
};

export default ResourceBrowser;
 