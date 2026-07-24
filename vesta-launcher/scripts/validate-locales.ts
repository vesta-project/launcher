import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	FluentParser,
	type Junk,
	type Message,
	type Resource,
} from "@fluent/syntax";

type TextDirection = "ltr" | "rtl";

interface LocaleDefinition {
	code: string;
	name: string;
	nativeName: string;
	direction: TextDirection;
	enabled: boolean;
}

interface LocaleManifest {
	sourceLocale: string;
	locales: LocaleDefinition[];
}

interface MessageShape {
	file: string;
	variables: Set<string>;
}

interface LocaleReadResult {
	exists: boolean;
	messages: Map<string, MessageShape>;
}

export interface LocaleValidationResult {
	failures: string[];
	summaries: string[];
	localeCount: number;
	sourceMessageCount: number;
}

const parser = new FluentParser({ withSpans: true });

function collectVariables(
	node: unknown,
	variables = new Set<string>(),
): Set<string> {
	if (!node || typeof node !== "object") return variables;

	const record = node as Record<string, unknown>;
	if (record.type === "VariableReference") {
		const identifier = record.id as { name?: unknown } | undefined;
		if (typeof identifier?.name === "string") variables.add(identifier.name);
	}

	for (const [key, value] of Object.entries(record)) {
		if (key !== "span") collectVariables(value, variables);
	}
	return variables;
}

function describeJunk(file: string, junk: Junk, failures: string[]): void {
	const annotations = junk.annotations
		.map((annotation) => annotation.message)
		.join("; ");
	failures.push(
		`${file}: invalid Fluent syntax${annotations ? ` (${annotations})` : ""}`,
	);
}

function collectMessages(
	resource: Resource,
	file: string,
	messages: Map<string, MessageShape>,
	failures: string[],
): void {
	for (const entry of resource.body) {
		if (entry.type === "Junk") {
			describeJunk(file, entry, failures);
			continue;
		}
		if (entry.type !== "Message") continue;

		const message = entry as Message;
		const id = message.id.name;
		const previous = messages.get(id);
		if (previous) {
			failures.push(
				`${file}: duplicate message "${id}" (first declared in ${previous.file})`,
			);
			continue;
		}
		if (message.value === null) {
			failures.push(
				`${file}: message "${id}" has no value; Vesta does not consume Fluent attributes directly`,
			);
		}
		messages.set(id, {
			file,
			variables: collectVariables(message),
		});
	}
}

async function readLocale(
	localesDirectory: string,
	code: string,
	required: boolean,
	failures: string[],
): Promise<LocaleReadResult> {
	const directory = path.join(localesDirectory, code);
	let files: string[];
	try {
		files = (await readdir(directory))
			.filter((file) => file.endsWith(".ftl"))
			.sort();
	} catch (error) {
		const isMissing =
			error instanceof Error &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code === "ENOENT";
		if (!isMissing || required) {
			failures.push(
				isMissing
					? `${code}: locale directory is missing`
					: `${code}: locale directory could not be read (${String(error)})`,
			);
		}
		return { exists: false, messages: new Map() };
	}

	if (files.length === 0) {
		failures.push(`${code}: locale directory contains no .ftl catalogs`);
		return { exists: true, messages: new Map() };
	}

	const messages = new Map<string, MessageShape>();
	for (const file of files) {
		const source = await readFile(path.join(directory, file), "utf8");
		collectMessages(
			parser.parse(source),
			`${code}/${file}`,
			messages,
			failures,
		);
	}
	return { exists: true, messages };
}

function setsMatch(left: Set<string>, right: Set<string>): boolean {
	return (
		left.size === right.size && [...left].every((value) => right.has(value))
	);
}

function validateManifest(
	manifest: LocaleManifest,
	failures: string[],
): Map<string, LocaleDefinition> {
	const locales = new Map<string, LocaleDefinition>();

	if (!Array.isArray(manifest.locales)) {
		failures.push("manifest: locales must be an array");
		return locales;
	}

	for (const locale of manifest.locales) {
		if (!locale || typeof locale !== "object") {
			failures.push("manifest: every locale must be an object");
			continue;
		}

		const code = typeof locale.code === "string" ? locale.code : "";
		const normalizedCode = code.toLowerCase();
		if (!code) {
			failures.push("manifest: every locale must have a code");
			continue;
		}
		if (locales.has(normalizedCode)) {
			failures.push(`manifest: duplicate locale code "${code}"`);
			continue;
		}

		try {
			const [canonicalCode] = Intl.getCanonicalLocales(code);
			if (canonicalCode !== code) {
				failures.push(
					`manifest: locale code "${code}" must use canonical BCP 47 casing "${canonicalCode}"`,
				);
			}
		} catch {
			failures.push(`manifest: locale code "${code}" is not valid BCP 47`);
		}

		if (typeof locale.name !== "string" || !locale.name.trim()) {
			failures.push(`manifest: locale "${code}" must have an English name`);
		}
		if (typeof locale.nativeName !== "string" || !locale.nativeName.trim()) {
			failures.push(`manifest: locale "${code}" must have a native name`);
		}
		if (locale.direction !== "ltr" && locale.direction !== "rtl") {
			failures.push(
				`manifest: locale "${code}" direction must be "ltr" or "rtl"`,
			);
		}
		if (typeof locale.enabled !== "boolean") {
			failures.push(`manifest: locale "${code}" enabled must be boolean`);
		}

		locales.set(normalizedCode, locale);
	}

	if (typeof manifest.sourceLocale !== "string" || !manifest.sourceLocale) {
		failures.push("manifest: sourceLocale must be a locale code");
		return locales;
	}

	const source = locales.get(manifest.sourceLocale.toLowerCase());
	if (!source) {
		failures.push(
			`manifest: source locale "${manifest.sourceLocale}" is not declared`,
		);
	} else if (!source.enabled) {
		failures.push(
			`manifest: source locale "${manifest.sourceLocale}" must be enabled`,
		);
	}

	return locales;
}

export async function validateLocaleDirectory(
	localesDirectory: string,
): Promise<LocaleValidationResult> {
	const failures: string[] = [];
	const summaries: string[] = [];
	const manifestPath = path.join(localesDirectory, "manifest.json");

	let manifest: LocaleManifest;
	try {
		const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new TypeError("manifest root must be an object");
		}
		manifest = parsed as LocaleManifest;
	} catch (error) {
		return {
			failures: [`manifest.json: could not be parsed (${String(error)})`],
			summaries,
			localeCount: 0,
			sourceMessageCount: 0,
		};
	}

	const localeMap = validateManifest(manifest, failures);
	for (const entry of await readdir(localesDirectory, {
		withFileTypes: true,
	})) {
		if (
			entry.isDirectory() &&
			!entry.name.startsWith(".") &&
			!localeMap.has(entry.name.toLowerCase())
		) {
			failures.push(
				`${entry.name}: locale directory is not declared in manifest.json`,
			);
		}
	}

	const sourceLocale =
		typeof manifest.sourceLocale === "string" && manifest.sourceLocale
			? manifest.sourceLocale
			: "";
	const source = sourceLocale
		? await readLocale(localesDirectory, sourceLocale, true, failures)
		: { exists: false, messages: new Map<string, MessageShape>() };
	const sourceMessages = source.messages;
	if (sourceLocale && sourceMessages.size === 0) {
		failures.push(`${sourceLocale}: source locale contains no valid messages`);
	}

	for (const locale of localeMap.values()) {
		if (locale.code === sourceLocale) continue;

		const translated = await readLocale(
			localesDirectory,
			locale.code,
			locale.enabled,
			failures,
		);
		if (!translated.exists && !locale.enabled) {
			summaries.push(
				`${locale.code}: awaiting first Crowdin export [disabled]`,
			);
			continue;
		}

		let translatedSourceMessages = 0;
		for (const [id, translatedMessage] of translated.messages) {
			const sourceMessage = sourceMessages.get(id);
			if (!sourceMessage) {
				failures.push(
					`${translatedMessage.file}: message "${id}" does not exist in the source locale`,
				);
				continue;
			}
			translatedSourceMessages += 1;
			if (!setsMatch(sourceMessage.variables, translatedMessage.variables)) {
				failures.push(
					`${translatedMessage.file}: message "${id}" must preserve variables { ${[
						...sourceMessage.variables,
					].join(", ")} }`,
				);
			}
		}

		const coverage =
			sourceMessages.size === 0
				? 0
				: Math.round((translatedSourceMessages / sourceMessages.size) * 100);
		summaries.push(
			`${locale.code}: ${translatedSourceMessages}/${sourceMessages.size} messages (${coverage}% catalog coverage)${locale.enabled ? "" : " [disabled]"}`,
		);
	}

	return {
		failures,
		summaries,
		localeCount: localeMap.size,
		sourceMessageCount: sourceMessages.size,
	};
}

if (import.meta.main) {
	const result = await validateLocaleDirectory(
		fileURLToPath(new URL("../locales/", import.meta.url)),
	);
	for (const summary of result.summaries) console.log(summary);
	if (result.failures.length > 0) {
		for (const failure of result.failures) console.error(`- ${failure}`);
		process.exit(1);
	}
	console.log(
		`Validated ${result.localeCount} locale(s) and ${result.sourceMessageCount} source messages.`,
	);
}
