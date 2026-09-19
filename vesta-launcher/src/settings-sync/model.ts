/** Settings that can be synced independently from the instance files. */
export const categories = [
	"gameOptions",
	"keybinds",
	"servers",
	"resourcePacks",
] as const;
export type Category = (typeof categories)[number];

export const sourceCategories: readonly Category[] = [
	"gameOptions",
	"keybinds",
];

export interface Preferences {
	enabled: boolean;
	sourceInstanceId: number | null;
	instanceIds: number[];
	/** A missing/null list means every value present in the source is selected. */
	selectedKeys?: string[] | null;
}

export type GameOptionKind =
	| "boolean"
	| "integer"
	| "decimal"
	| "number"
	| "enum"
	| "language"
	| "text";

export interface GameOptionChoice {
	value: string;
	labelId?: string | null;
	label?: string | null;
}

/**
 * Metadata and editor encodings come from the Rust catalog.
 * The backend converts editor values to the physical options-file encoding.
 */
export interface GameOptionMetadata {
	id?: string;
	key: string;
	category: string;
	labelId?: string | null;
	kind: GameOptionKind;
	min?: number | null;
	max?: number | null;
	step?: number | null;
	unit?: string | null;
	values?: Array<string | GameOptionChoice>;
}

export const selectedSharedKeys = (
	preferences: Preferences | undefined,
	availableKeys: readonly string[] = [],
) => preferences?.selectedKeys ?? [...availableKeys];

export interface Snapshot {
	pending?: string[];
	initialized?: boolean;
	category: Category;
	revision: number;
	preferences: Preferences;
	/** Editor values for game options; native key names for keybindings. */
	sharedValues?: Record<string, string>;
	/** Present for game options; keybinds use the same sharedValues shape. */
	catalog?: GameOptionMetadata[];
}
