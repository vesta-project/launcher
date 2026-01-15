import { Component, createEffect, For, Show, createSignal, createResource, createMemo, untrack, onMount, onCleanup, JSX } from "solid-js";
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

// Common categories across platforms
const MOD_CATEGORIES = {
    curseforge: [
        "World Gen", "Technology", "Magic", "Storage", "Food",
        "Mobs", "Armor, Tools, and Weapons", "Adventure and RPG",
        "Map and Information", "Cosmetic", "Addons", "Thermal Expansion",
        "Tinkers Construct", "Industrial Craft", "Thaumcraft", "Buildcraft",
        "Forestry", "Blood Magic", "Lucky Blocks", "Applied Energistics 2",
        "CraftTweaker", "Miscellaneous"
    ]
};

type ModrinthCategory = {
    icon: string;
    name: string;
    project_type: string;
};

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
            value={selectedInstance() || { id: null, name: "No Instance" }}
            onChange={(v) => {
                const id = v?.id ?? null;
                resources.setInstance(id);
                if (id) {
                    const inst = instancesState.instances.find(i => i.id === id);
                    if (inst) {
                        resources.setGameVersion(inst.minecraftVersion);
                        
                        // Only set loader filter if we are currently looking at mods
                        if (resources.state.resourceType === 'mod') {
                            // Don't set "vanilla" or empty as a loader filter
                            const loader = inst.modloader?.toLowerCase();
                            if (loader && loader !== "vanilla") {
                                resources.setLoader(inst.modloader);
                            } else {
                                resources.setLoader(null);
                            }
                        } else {
                            resources.setLoader(null);
                        }
                    }
                } else {
                    // Reset versions/loaders when going back to Global
                    resources.setGameVersion(null);
                    resources.setLoader(null);
                }
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
                        <SelectValue<any>>{(s) => s.selectedOption()?.name ?? "Global"}</SelectValue>
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
        if (resources.state.selectedProject?.id === props.project.id) {
            return resources.state.installingVersionIds.length > 0;
        }
        return false;
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
                            {(tag) => (
                                <span 
                                    class="resource-tag"
                                    classList={{ active: resources.state.categories.includes(tag.toLowerCase()) }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        // Normalize tag to lowercase for filtering
                                        resources.toggleCategory(tag.toLowerCase());
                                        resources.setOffset(0);
                                    }}
                                >
                                    {tag}
                                </span>
                            )}
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
    const [mrCategories] = createResource<ModrinthCategory[]>(async () => {
        try {
            const res = await fetch("https://api.modrinth.com/v2/tag/category");
            return res.json();
        } catch (e) {
            console.error("Failed to fetch Modrinth categories:", e);
            return [];
        }
    });

    const gameVersions = createMemo(() => {
        const meta = mcVersions();
        const current = resources.state.gameVersion;
        const base = ["All versions"];

        if (!meta || !meta.game_versions) {
            return current ? [...base, current] : base;
        }

        const releases = meta.game_versions
            .filter(v => v.version_type === 'release')
            .map(v => v.id);
        
        const list = [...base, ...releases];
        if (current && !list.includes(current)) {
            // Keep current selection in list even if not a release or still loading
            list.push(current);
        }
        return list;
    });

    const availableCategories = createMemo(() => {
        const type = resources.state.resourceType;
        const source = resources.state.activeSource;

        if (source === 'modrinth') {
            const cats = mrCategories();
            if (!cats) return [];
            return cats
                .filter(c => c.project_type === type)
                .map(c => ({ 
                    id: c.name.toLowerCase(), 
                    name: c.name, 
                    icon: c.icon 
                }));
        } else {
            // CurseForge: Just names for now, filter based on type if possible
            if (type !== 'mod') return [];
            return MOD_CATEGORIES.curseforge.map(name => ({ 
                id: name.toLowerCase(), 
                name: name, 
                icon: null 
            }));
        }
    });

    const shouldShowLoader = () => resources.state.resourceType === 'mod';
    const shouldShowGameVersion = () => resources.state.resourceType !== 'modpack';

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
                    <For each={['mod', 'resourcepack', 'shader', 'datapack', 'modpack'] as const}>
                        {(type) => (
                            <button
                                class="filter-option"
                                classList={{ active: resources.state.resourceType === type }}
                                onClick={() => {
                                    resources.setType(type);
                                    resources.setOffset(0);
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
                            resources.setGameVersion(v === "All versions" || !v ? null : v);
                            resources.setOffset(0);
                        }}
                        itemComponent={(props) => (
                            <ComboboxItem item={props.item}>
                                {props.item.rawValue}
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
                        onChange={(v) => {
                            resources.setLoader(v === "All Loaders" || !v ? null : v.toLowerCase());
                            resources.setOffset(0);
                        }}
                        itemComponent={(props) => (
                            <SelectItem item={props.item}>
                                {props.item.rawValue}
                            </SelectItem>
                        )}
                    >
                        <SelectTrigger class="filter-select">
                            <SelectValue<string>>{(s) => s.selectedOption() || "All Loaders"}</SelectValue>
                        </SelectTrigger>
                        <SelectContent />
                    </Select>
                </div>
            </Show>

            <Show when={availableCategories().length > 0}>
                <div class="filter-section">
                    <label class="filter-label">Categories</label>
                    <div class="category-grid">
                        <For each={availableCategories()}>
                            {(cat) => (
                                <button
                                    class="category-tag"
                                    classList={{ active: resources.state.categories.includes(cat.id) }}
                                    onClick={() => {
                                        resources.toggleCategory(cat.id);
                                        resources.setOffset(0);
                                    }}
                                >
                                    <Show when={cat.icon}>
                                        <div class="category-tag-icon" innerHTML={cat.icon ?? ""} />
                                    </Show>
                                    <span class="category-tag-text">{cat.name}</span>
                                </button>
                            )}
                        </For>
                    </div>
                </div>
            </Show>
        </div>
    );
};

const ResourceBrowser: Component<{ setRefetch?: (fn: () => Promise<void>) => void }> = (props) => {
    let debounceTimer: number | undefined;
    const [isSearchExpanded, setIsSearchExpanded] = createSignal(false);
    const [isInstanceDialogOpen, setIsInstanceDialogOpen] = createSignal(false);
    let lastWidth = window.innerWidth;

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
            projectName: project.name,
            projectIcon: project.icon_url || "",
            resourceType: project.resource_type
        });
    };

    onMount(() => {
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
        debounceTimer = window.setTimeout(() => {
            resources.setOffset(0);
            resources.search();
        }, 500);
    };

    let hasInitializedFilters = false;

    createEffect(() => {
        const instances = instancesState.instances;
        const selectedId = resources.state.selectedInstanceId;
        const currentVersion = resources.state.gameVersion;

        // Sync filters with selected instance if they are currently null
        // We only do this once on mount/initial load to avoid fighting user manual changes
        if (!hasInitializedFilters && instances.length > 0 && selectedId && !currentVersion) {
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
                                    resources.setSource('modrinth');
                                    resources.setOffset(0);
                                }}
                            >
                                Modrinth
                            </button>
                            <button
                                class="source-btn"
                                classList={{ active: resources.state.activeSource === 'curseforge' }}
                                onClick={() => {
                                    resources.setSource('curseforge');
                                    resources.setOffset(0);
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
                        </Show>
                        <Show when={resources.state.categories.length > 0}>
                            <span class="active-categories-info"> • {resources.state.categories.join(", ")}</span>
                        </Show>
                    </div>
                    <div class="results-sort">
                        <div class="limit-selector">
                            <span class="sort-label">Per Page:</span>
                            <Select 
                                options={[20, 50, 100]} 
                                value={resources.state.limit}
                                onChange={(v) => resources.setLimit(v || 20)}
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
                            value={currentSortOptions().find(o => o.value === resources.state.sortBy) || currentSortOptions()[0]}
                            onChange={(v) => {
                                resources.setSortBy(v?.value || 'relevance');
                                resources.setOffset(0);
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
 