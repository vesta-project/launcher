export interface CommandDefinition {
	commandId: string;
	handlerId: string;
	label: string;
	description: string;
	category: string;
	defaultChord: string | null;
	sortOrder: number;
	canExecute?: () => boolean;
	execute: () => void | Promise<void>;
}

export interface PersistedCommand {
	commandId: string;
	handlerId: string;
	label: string;
	description: string;
	category: string;
	defaultChord: string | null;
	currentChord: string | null;
	customized: boolean;
	available: boolean;
	sortOrder: number;
}

export interface BindingMutationResult {
	command: PersistedCommand;
	conflict: PersistedCommand | null;
	applied: boolean;
}
