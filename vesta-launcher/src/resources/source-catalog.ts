import CurseForgeIcon from "@assets/branding/sources/curseforge.svg";
import ModrinthIcon from "@assets/branding/sources/modrinth.svg";
import SmithedIcon from "@assets/branding/sources/smithed.svg";
import type { Component } from "solid-js";
import type { ResourceType, SourcePlatform } from "@stores/resources";

export type SourceSortOption = {
	label: string;
	value: string;
};

export type SourceDescriptor = {
	id: SourcePlatform;
	label: string;
	Icon: Component<{ width?: string; height?: string; class?: string }>;
	supportedResourceTypes: ResourceType[];
	defaultSort: string;
	sortOptions: SourceSortOption[];
	supportsHashLookup: boolean;
	peerPlatforms: SourcePlatform[];
	multiArtifactVersions: boolean;
};

/**
 * Frontend source catalog. Keep in sync with Rust `SourceCapabilities`.
 * Toolbar/details iterate this instead of hardcoding platform buttons.
 */
export const RESOURCE_SOURCES: SourceDescriptor[] = [
	{
		id: "modrinth",
		label: "Modrinth",
		Icon: ModrinthIcon,
		supportedResourceTypes: [
			"mod",
			"resourcepack",
			"shader",
			"datapack",
			"modpack",
			"world",
		],
		defaultSort: "relevance",
		sortOptions: [
			{ label: "Relevance", value: "relevance" },
			{ label: "Downloads", value: "downloads" },
			{ label: "Followers", value: "follows" },
			{ label: "Newest", value: "newest" },
			{ label: "Updated", value: "updated" },
		],
		supportsHashLookup: true,
		peerPlatforms: ["curseforge"],
		multiArtifactVersions: false,
	},
	{
		id: "curseforge",
		label: "CurseForge",
		Icon: CurseForgeIcon,
		supportedResourceTypes: [
			"mod",
			"resourcepack",
			"shader",
			"datapack",
			"modpack",
			"world",
		],
		defaultSort: "featured",
		sortOptions: [
			{ label: "Featured", value: "featured" },
			{ label: "Popularity", value: "popularity" },
			{ label: "Last Updated", value: "updated" },
			{ label: "Newest", value: "newest" },
			{ label: "Rating", value: "rating" },
			{ label: "Name", value: "name" },
			{ label: "Author", value: "author" },
			{ label: "Total Downloads", value: "total_downloads" },
		],
		supportsHashLookup: true,
		peerPlatforms: ["modrinth"],
		multiArtifactVersions: false,
	},
	{
		id: "smithed",
		label: "Smithed",
		Icon: SmithedIcon,
		supportedResourceTypes: ["datapack"],
		defaultSort: "trending",
		sortOptions: [
			{ label: "Trending", value: "trending" },
			{ label: "Downloads", value: "downloads" },
			{ label: "Name", value: "alphabetically" },
			{ label: "Newest", value: "newest" },
		],
		supportsHashLookup: false,
		peerPlatforms: [],
		multiArtifactVersions: true,
	},
];

export function getSourceDescriptor(
	id: SourcePlatform,
): SourceDescriptor | undefined {
	return RESOURCE_SOURCES.find((source) => source.id === id);
}

export function sourcesForResourceType(
	resourceType: ResourceType,
): SourceDescriptor[] {
	return RESOURCE_SOURCES.filter((source) =>
		source.supportedResourceTypes.includes(resourceType),
	);
}

export function firstSourceForResourceType(
	resourceType: ResourceType,
): SourceDescriptor {
	return (
		sourcesForResourceType(resourceType)[0] ?? RESOURCE_SOURCES[0]
	);
}

export function isContentSourcePlatform(value: string): value is SourcePlatform {
	return RESOURCE_SOURCES.some((source) => source.id === value);
}
