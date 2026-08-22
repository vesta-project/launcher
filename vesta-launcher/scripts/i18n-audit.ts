#!/usr/bin/env tsx
/**
 * Audits the frontend for hardcoded user-facing strings that may need i18n.
 *
 * Usage (from vesta-launcher/):
 *   bun run i18n:audit
 *   bun run i18n:audit -- src/components/pages
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const launcherRoot = path.resolve(scriptDir, "..");
const defaultScanRoot = path.join(launcherRoot, "src");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const IGNORED_DIRS = new Set([
	"node_modules",
	"dist",
	"__tests__",
	"__mocks__",
]);

const PATTERNS: { name: string; regex: RegExp }[] = [
	{ name: "showToast.title", regex: /showToast\(\{[^}]*title:\s*"([^"]+)"/g },
	{
		name: "showToast.description",
		regex: /showToast\(\{[^}]*description:\s*"([^"]+)"/g,
	},
	{ name: "SettingsCard.header", regex: /header="([^"]+)"/g },
	{ name: "SettingsCard.subHeader", regex: /subHeader="([^"]+)"/g },
	{ name: "SettingsField.label", regex: /label="([^"]+)"/g },
	{
		name: "SettingsField.description",
		regex: /description="([^"]+)"/g,
	},
	{ name: "placeholder", regex: /placeholder="([^"]+)"/g },
	{ name: "dialogStore", regex: /dialogStore\.\w+\(\s*"([^"]+)"/g },
];

function isIgnoredPath(relativePath: string): boolean {
	return relativePath.endsWith(".test.ts") || relativePath.endsWith(".test.tsx");
}

async function walk(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		if (IGNORED_DIRS.has(entry.name)) continue;
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walk(fullPath)));
			continue;
		}
		if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
		const relative = path.relative(launcherRoot, fullPath);
		if (isIgnoredPath(relative)) continue;
		files.push(fullPath);
	}

	return files;
}

async function countTCalls(filePath: string): Promise<number> {
	const source = await readFile(filePath, "utf8");
	return (source.match(/\bt\(/g) ?? []).length;
}

async function scanFile(filePath: string) {
	const source = await readFile(filePath, "utf8");
	const relative = path.relative(launcherRoot, filePath);
	const findings: { kind: string; text: string; line: number }[] = [];
	const lines = source.split("\n");

	for (const { name, regex } of PATTERNS) {
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index];
			if (line.includes('t("') || line.includes("t('")) continue;
			regex.lastIndex = 0;
			let match = regex.exec(line);
			while (match) {
				findings.push({ kind: name, text: match[1], line: index + 1 });
				match = regex.exec(line);
			}
		}
	}

	return { relative, findings, tCalls: await countTCalls(filePath) };
}

async function main() {
	const scanRoot = process.argv[2]
		? path.resolve(process.cwd(), process.argv[2])
		: defaultScanRoot;
	const rootStat = await stat(scanRoot);
	if (!rootStat.isDirectory()) {
		console.error(`Not a directory: ${scanRoot}`);
		process.exit(1);
	}

	const files = await walk(scanRoot);
	const reports = await Promise.all(files.map(scanFile));
	const withFindings = reports
		.filter((report) => report.findings.length > 0)
		.sort((left, right) => right.findings.length - left.findings.length);

	let totalFindings = 0;
	let totalTCalls = 0;

	for (const report of reports) {
		totalTCalls += report.tCalls;
	}

	console.log(`i18n audit — scanned ${files.length} files under ${scanRoot}`);
	console.log(`Existing t() calls in scope: ${totalTCalls}`);
	console.log("");

	for (const report of withFindings) {
		totalFindings += report.findings.length;
		console.log(`${report.relative} (${report.findings.length} candidates, ${report.tCalls} t()`);
		for (const finding of report.findings.slice(0, 12)) {
			console.log(`  L${finding.line} [${finding.kind}] ${finding.text}`);
		}
		if (report.findings.length > 12) {
			console.log(`  … ${report.findings.length - 12} more`);
		}
		console.log("");
	}

	console.log(
		`Summary: ${totalFindings} hardcoded string candidates across ${withFindings.length} files`,
	);
	console.log("Tip: extract to locales/en/<domain>.ftl and replace with t(\"message-id\").");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
