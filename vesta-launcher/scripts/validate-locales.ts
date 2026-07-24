import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	FluentParser,
	type Junk,
	type Message,
	type Resource,
} from "@fluent/syntax";

interface LocaleDefinition {
	code: string;
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

const localesDirectory = fileURLToPath(new URL("../locales/", import.meta.url));
const manifestPath = path.join(localesDirectory, "manifest.json");
const parser = new FluentParser({ withSpans: true });
const failures: string[] = [];

function collectVariables(node: unknown, variables = new Set<string>()): Set<string> {
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

function describeJunk(file: string, junk: Junk): void {
	const annotations = junk.annotations
		.map((annotation) => annotation.message)
		.join("; ");
	failures.push(`${file}: invalid Fluent syntax${annotations ? ` (${annotations})` : ""}`);
}

function collectMessages(
	resource: Resource,
	file: string,
	messages: Map<string, MessageShape>,
): void {
	for (const entry of resource.body) {
		if (entry.type === "Junk") {
			describeJunk(file, entry);
			continue;
		}
		if (entry.type !== "Message") continue;

		const message = entry as Message;
		const id = message.id.name;
		const previous = messages.get(id);
		if (previous) {
			failures.push(`${file}: duplicate message "${id}" (first declared in ${previous.file})`);
			continue;
		}
		messages.set(id, {
			file,
			variables: collectVariables(message),
		});
	}
}

async function readLocale(code: string): Promise<Map<string, MessageShape>> {
	const directory = path.join(localesDirectory, code);
	let files: string[];
	try {
		files = (await readdir(directory))
			.filter((file) => file.endsWith(".ftl"))
			.sort();
	} catch {
		failures.push(`${code}: locale directory is missing`);
		return new Map();
	}

	if (files.length === 0) {
		failures.push(`${code}: locale directory contains no .ftl catalogs`);
		return new Map();
	}

	const messages = new Map<string, MessageShape>();
	for (const file of files) {
		const source = await readFile(path.join(directory, file), "utf8");
		collectMessages(parser.parse(source), `${code}/${file}`, messages);
	}
	return messages;
}

function setsMatch(left: Set<string>, right: Set<string>): boolean {
	return (
		left.size === right.size && [...left].every((value) => right.has(value))
	);
}

const manifest = JSON.parse(
	await readFile(manifestPath, "utf8"),
) as LocaleManifest;
const localeCodes = new Set(manifest.locales.map((locale) => locale.code));

if (!localeCodes.has(manifest.sourceLocale)) {
	failures.push(`manifest: source locale "${manifest.sourceLocale}" is not declared`);
}
if (
	!manifest.locales.some(
		(locale) => locale.code === manifest.sourceLocale && locale.enabled,
	)
) {
	failures.push(`manifest: source locale "${manifest.sourceLocale}" must be enabled`);
}

for (const entry of await readdir(localesDirectory, { withFileTypes: true })) {
	if (
		entry.isDirectory() &&
		!entry.name.startsWith(".") &&
		!localeCodes.has(entry.name)
	) {
		failures.push(
			`${entry.name}: locale directory is not declared in manifest.json`,
		);
	}
}

const sourceMessages = await readLocale(manifest.sourceLocale);
for (const locale of manifest.locales) {
	if (locale.code === manifest.sourceLocale) continue;

	const translatedMessages = await readLocale(locale.code);
	for (const [id, translated] of translatedMessages) {
		const source = sourceMessages.get(id);
		if (!source) {
			failures.push(
				`${translated.file}: message "${id}" does not exist in the source locale`,
			);
			continue;
		}
		if (!setsMatch(source.variables, translated.variables)) {
			failures.push(
				`${translated.file}: message "${id}" must preserve variables { ${[
					...source.variables,
				].join(", ")} }`,
			);
		}
	}

	const coverage =
		sourceMessages.size === 0
			? 0
			: Math.round((translatedMessages.size / sourceMessages.size) * 100);
	console.log(
		`${locale.code}: ${translatedMessages.size}/${sourceMessages.size} messages (${coverage}% catalog coverage)${locale.enabled ? "" : " [disabled]"}`,
	);
}

if (failures.length > 0) {
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

console.log(
	`Validated ${manifest.locales.length} locale(s) and ${sourceMessages.size} source messages.`,
);
