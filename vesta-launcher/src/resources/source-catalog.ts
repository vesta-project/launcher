import CurseForgeIcon from "@assets/branding/sources/curseforge.svg";
import ModrinthIcon from "@assets/branding/sources/modrinth.svg";
import SmithedIcon from "@assets/branding/sources/smithed.svg";
import type { Component } from "solid-js";
import type { ResourceType, SourcePlatform } from "@stores/resources";
import { t } from "~/localization";

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
		get label() {
			return t("resources-source-modrinth");
		},
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
			{
				get label() {
					return t("resources-source-sort-relevance");
				},
				value: "relevance",
			},
			{
				get label() {
					return t("resources-source-sort-downloads");
				},
				value: "downloads",
			},
			{
				get label() {
					return t("resources-source-sort-followers");
				},
				value: "follows",
			},
			{
				get label() {
					return t("resources-source-sort-newest");
				},
				value: "newest",
			},
			{
				get label() {
					return t("resources-details-updated");
				},
				value: "updated",
			},
		],
		supportsHashLookup: true,
		peerPlatforms: ["curseforge"],
		multiArtifactVersions: false,
	},
	{
		id: "curseforge",
		get label() {
			return t("resources-source-curseforge");
		},
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
			{
				get label() {
					return t("resources-source-sort-featured");
				},
				value: "featured",
			},
			{
				get label() {
					return t("resources-source-sort-popularity");
				},
				value: "popularity",
			},
			{
				get label() {
					return t("resources-source-sort-last-updated");
				},
				value: "updated",
			},
			{
				get label() {
					return t("resources-source-sort-newest");
				},
				value: "newest",
			},
			{
				get label() {
					return t("resources-source-sort-rating");
				},
				value: "rating",
			},
			{
				get label() {
					return t("instances-worlds-sort-name");
				},
				value: "name",
			},
			{
				get label() {
					return t("shared-ui-author");
				},
				value: "author",
			},
			{
				get label() {
					return t("resources-source-sort-total-downloads");
				},
				value: "total_downloads",
			},
		],
		supportsHashLookup: true,
		peerPlatforms: ["modrinth"],
		multiArtifactVersions: false,
	},
	{
		id: "smithed",
		get label() {
			return t("resources-source-smithed");
		},
		Icon: SmithedIcon,
		supportedResourceTypes: ["datapack"],
		defaultSort: "trending",
		sortOptions: [
			{
				get label() {
					return t("resources-source-sort-trending");
				},
				value: "trending",
			},
			{
				get label() {
					return t("resources-source-sort-downloads");
				},
				value: "downloads",
			},
			{
				get label() {
					return t("instances-worlds-sort-name");
				},
				value: "alphabetically",
			},
			{
				get label() {
					return t("resources-source-sort-newest");
				},
				value: "newest",
			},
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
