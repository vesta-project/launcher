import { Component, createEffect, For, Show, createSignal, createResource, createMemo, untrack, onMount } from "solid-js";
import { resources, ResourceProject, ResourceVersion, findBestVersion } from "@stores/resources";
import { instancesState } from "@stores/instances";
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
import { getMinecraftVersions } from "@utils/instances";
import { router } from "@components/page-viewer/page-viewer";
import "./resource-browser.css";

const LOADERS = ["Forge", "Fabric", "Quilt", "NeoForge"];

const ResourceCard: Component<{ project: ResourceProject }> = (props) => {
    const [installing, setInstalling] = createSignal(false);

    const isInstalled = createMemo(() => {
        return resources.state.installedResources.some(ir => 
            ir.platform.toLowerCase() === props.project.source.toLowerCase() && 
            ir.remote_id === props.project.id
        );
    });

    const navigateToDetails = () => {
        router()?.navigate("/resource-details", { 
            projectId: props.project.id, 
            platform: props.project.source 
        }, { 
            project: props.project 
        });
    };

    const handleQuickInstall = async (e: MouseEvent) => {
        e.stopPropagation();
        const instanceId = resources.state.selectedInstanceId;
        if (!instanceId) return;

        const instance = instancesState.instances.find(i => i.id === instanceId);
        if (!instance) return;

        setInstalling(true);
        try {
            const versions = await resources.getVersions(props.project.source, props.project.id);
            const best = findBestVersion(versions, instance.minecraftVersion, instance.modloader);
            if (best) {
                // Warning for cross-loader compatibility
                const instLoader = instance.modloader?.toLowerCase() || "";
                const hasDirectLoader = best.loaders.some(l => l.toLowerCase() === instLoader);
                
                if (instLoader === "quilt" && !hasDirectLoader && best.loaders.some(l => l.toLowerCase() === "fabric")) {
                    showToast({
                        title: "Potential Incompatibility",
                        description: `Installing Fabric version of ${props.project.name} on a Quilt instance. Most mods work, but some may have issues.`,
                        severity: "Warning"
                    });
                }

                await resources.install(props.project, best);
            } else {
                console.error("No compatible version found for this instance.");
                showToast({
                    title: "Installation Failed",
                    description: `No compatible version of ${props.project.name} was found for Minecraft ${instance.minecraftVersion} with ${instance.modloader || 'vanilla'}.`,
                    severity: "Error"
                });
            }
        } catch (err) {
            console.error("Quick install failed:", err);
        } finally {
            setInstalling(false);
        }
    };

    return (
        <div class="resource-card" onClick={navigateToDetails} style={{ cursor: 'pointer' }}>
            <div class="resource-card-icon">
                <Show when={props.project.icon_url} fallback={<div class="icon-placeholder" />}>
                    <img src={props.project.icon_url ?? ""} alt={props.project.name} />
                </Show>
            </div>
            <div class="resource-card-content">
                <h3 class="resource-card-title">{props.project.name}</h3>
                <p class="resource-card-summary">{props.project.summary}</p>
                <div class="resource-card-footer">
                    <span class="resource-card-author">By {props.project.author}</span>
                    <span class="resource-card-downloads">{props.project.download_count.toLocaleString()} downloads</span>
                    <Show when={props.project.published_at}>
                        <span class="resource-card-date">• {new Date(props.project.published_at ?? "").toLocaleDateString()}</span>
                    </Show>
                </div>
            </div>
            <div class="resource-card-actions">
                <Button 
                    onClick={handleQuickInstall} 
                    disabled={!resources.state.selectedInstanceId || installing() || isInstalled()}
                    size="sm"
                    variant={isInstalled() ? "outline" : "solid"}
                >
                    <Show when={installing()}>Installing...</Show>
                    <Show when={!installing() && isInstalled()}>Installed</Show>
                    <Show when={!installing() && !isInstalled()}>Install</Show>
                </Button>
            </div>
        </div>
    );
};

const ResourceBrowser: Component = () => {
    let debounceTimer: number | undefined;
    const [mcVersions] = createResource(getMinecraftVersions);

    onMount(() => {
        // Ensure installed resources are loaded for the current instance if one is selected
        if (resources.state.selectedInstanceId) {
            resources.fetchInstalled(resources.state.selectedInstanceId);
        }
    });

    const gameVersions = () => {
        const meta = mcVersions();
        if (!meta || !meta.game_versions) return ["All Versions"];
        // Only show release versions to keep it readable
        const releases = meta.game_versions
            .filter(v => v.version_type === 'release')
            .map(v => v.id);
        return ["All Versions", ...releases];
    };

    const setFilterAndResetPagination = (setter: () => void) => {
        setter();
        resources.setOffset(0);
    };

    const handleSearchInput = (value: string) => {
        resources.setQuery(value);
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => {
            resources.setOffset(0);
            resources.search();
        }, 500);
    };

    // Re-search when filters or pagination change
    createEffect(() => {
        // Access all dependencies to track them
        resources.state.activeSource;
        resources.state.resourceType;
        resources.state.gameVersion;
        resources.state.loader;
        resources.state.offset;
        
        // Use untrack so the internal property accesses of search() 
        // don't create additional dependencies (or loops)
        untrack(() => {
            resources.search();
        });
    });

    const currentPage = () => Math.floor(resources.state.offset / resources.state.limit) + 1;
    const totalPages = () => Math.ceil(resources.state.totalHits / resources.state.limit);

    return (
        <div class="resource-browser">
            <div class="resource-browser-header">
                <div class="search-bar-row">
                    <div class="search-bar">
                        <TextField 
                            placeholder="Search resources..." 
                            value={resources.state.query}
                            onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) => handleSearchInput(e.currentTarget.value)}
                        />
                    </div>
                    <div class="source-toggle">
                        <Button 
                            color={resources.state.activeSource === 'modrinth' ? 'primary' : 'none'}
                            variant={resources.state.activeSource === 'modrinth' ? 'solid' : 'outline'}
                            onClick={() => setFilterAndResetPagination(() => resources.setSource('modrinth'))}
                        >
                            Modrinth
                        </Button>
                        <Button 
                            color={resources.state.activeSource === 'curseforge' ? 'primary' : 'none'}
                            variant={resources.state.activeSource === 'curseforge' ? 'solid' : 'outline'}
                            onClick={() => setFilterAndResetPagination(() => resources.setSource('curseforge'))}
                        >
                            CurseForge
                        </Button>
                    </div>
                </div>

                <div class="filters-row">
                    <div class="type-filters">
                        <For each={['mod', 'resourcepack', 'shader', 'datapack', 'modpack'] as const}>
                            {(type) => (
                                <Button 
                                    color={resources.state.resourceType === type ? 'primary' : 'none'}
                                    variant={resources.state.resourceType === type ? 'solid' : 'ghost'}
                                    size="sm"
                                    onClick={() => setFilterAndResetPagination(() => resources.setType(type))}
                                >
                                    {type.charAt(0).toUpperCase() + type.slice(1)}s
                                </Button>
                            )}
                        </For>
                    </div>

                    <div class="dropdown-filters">
                        <Combobox 
                            options={gameVersions()} 
                            value={resources.state.gameVersion || "All Versions"}
                            onChange={(v) => setFilterAndResetPagination(() => resources.setGameVersion(v === "All Versions" || !v ? null : v))}
                            itemComponent={(props) => (
                                <ComboboxItem item={props.item}>
                                    {props.item.rawValue}
                                </ComboboxItem>
                            )}
                        >
                            <ComboboxControl class="filter-select">
                                <ComboboxInput />
                                <ComboboxTrigger />
                            </ComboboxControl>
                            <ComboboxContent />
                        </Combobox>

                        <Select 
                            options={["All Loaders", ...LOADERS]} 
                            value={LOADERS.find(l => l.toLowerCase() === resources.state.loader) || "All Loaders"}
                            onChange={(v) => setFilterAndResetPagination(() => resources.setLoader(v === "All Loaders" || !v ? null : v.toLowerCase()))}
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
                        
                        <Select
                            options={[{ id: null, name: "No Instance Target" } as any, ...instancesState.instances]}
                            value={instancesState.instances.find(i => i.id === resources.state.selectedInstanceId) || { id: null, name: "No Instance Target" }}
                            onChange={(v) => {
                                const id = v?.id ?? null;
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
                            itemComponent={(props) => (
                                <SelectItem item={props.item}>
                                    {props.item.rawValue.name}
                                </SelectItem>
                            )}
                        >
                            <SelectTrigger class="filter-select instance-select">
                                <SelectValue<any>>{(s) => s.selectedOption()?.name ?? "No Instance Target"}</SelectValue>
                            </SelectTrigger>
                            <SelectContent />
                        </Select>
                    </div>
                </div>
            </div>

            <div class="resource-results">
                <Show when={!resources.state.loading} fallback={<div class="loading-state">Searching...</div>}>
                    <Show when={resources.state.results.length > 0} fallback={<div class="empty-state">No resources found.</div>}>
                        <div class="resource-grid">
                            <For each={resources.state.results}>
                                {(project) => <ResourceCard project={project} />}
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
                </Show>
            </div>
        </div>
    );
};

export default ResourceBrowser;
