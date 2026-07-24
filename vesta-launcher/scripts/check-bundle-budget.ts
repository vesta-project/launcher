import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

interface ManifestChunk {
	file: string;
	name?: string;
	src?: string;
	isEntry?: boolean;
	isDynamicEntry?: boolean;
	imports?: string[];
	css?: string[];
}

interface Budget {
	name: string;
	entry: (key: string, chunk: ManifestChunk) => boolean;
	gzipKiB: number;
	exclude?: Set<string>;
}

const DIST = join(import.meta.dir, "..", "dist");
const manifest = JSON.parse(
	readFileSync(join(DIST, ".vite", "manifest.json"), "utf8"),
) as Record<string, ManifestChunk>;

function findEntry(
	predicate: (key: string, chunk: ManifestChunk) => boolean,
): string {
	const match = Object.entries(manifest).find(([key, chunk]) =>
		predicate(key, chunk),
	);
	if (!match) throw new Error("Could not locate a bundle-budget entry");
	return match[0];
}

function collectStaticFiles(
	entryKey: string,
	files = new Set<string>(),
): Set<string> {
	const chunk = manifest[entryKey];
	if (!chunk || files.has(chunk.file)) return files;
	files.add(chunk.file);
	for (const css of chunk.css ?? []) files.add(css);
	for (const dependency of chunk.imports ?? []) {
		collectStaticFiles(dependency, files);
	}
	return files;
}

function gzipBytes(files: Set<string>, exclude = new Set<string>()): number {
	let total = 0;
	for (const file of files) {
		if (exclude.has(file)) continue;
		total += gzipSync(readFileSync(join(DIST, file))).byteLength;
	}
	return total;
}

const mainEntry = findEntry(
	(key, chunk) => chunk.isEntry === true && (chunk.name === "main" || key === "index.html"),
);
const mainFiles = collectStaticFiles(mainEntry);

const budgets: Budget[] = [
	{
		name: "main startup",
		entry: (key, chunk) =>
			chunk.isEntry === true && (chunk.name === "main" || key === "index.html"),
		gzipKiB: 400,
	},
	{
		name: "standalone startup",
		entry: (key, chunk) =>
			chunk.isEntry === true &&
			(chunk.name === "standalone" || key === "standalone.html"),
		gzipKiB: 160,
	},
	{
		name: "settings route after startup",
		entry: (key, chunk) =>
			(chunk.isDynamicEntry === true && chunk.name === "settings-page") ||
			key.endsWith("components/pages/mini-pages/settings/settings-page.tsx") ||
			chunk.src?.endsWith(
				"components/pages/mini-pages/settings/settings-page.tsx",
			) === true,
		gzipKiB: 45,
		exclude: mainFiles,
	},
	{
		name: "instance route after startup",
		entry: (key, chunk) =>
			(chunk.isDynamicEntry === true && chunk.name === "instance-details") ||
			key.endsWith(
				"components/pages/mini-pages/instance-details/instance-details.tsx",
			) ||
			chunk.src?.endsWith(
				"components/pages/mini-pages/instance-details/instance-details.tsx",
			) === true,
		gzipKiB: 60,
		exclude: mainFiles,
	},
	{
		name: "browse route after startup",
		entry: (key, chunk) =>
			(chunk.isDynamicEntry === true && chunk.name === "resource-browser") ||
			key.endsWith(
				"components/pages/mini-pages/resources/resource-browser.tsx",
			) ||
			chunk.src?.endsWith(
				"components/pages/mini-pages/resources/resource-browser.tsx",
			) === true,
		gzipKiB: 45,
		exclude: mainFiles,
	},
	{
		name: "install route after startup",
		entry: (key, chunk) =>
			(chunk.isDynamicEntry === true && chunk.name === "install-page") ||
			key.endsWith("components/pages/mini-pages/install/install-page.tsx") ||
			chunk.src?.endsWith(
				"components/pages/mini-pages/install/install-page.tsx",
			) === true,
		gzipKiB: 45,
		exclude: mainFiles,
	},
];

let failed = false;
for (const budget of budgets) {
	const entryKey = findEntry(budget.entry);
	const files = collectStaticFiles(entryKey);
	const bytes = gzipBytes(files, budget.exclude);
	const actualKiB = bytes / 1024;
	const status = actualKiB <= budget.gzipKiB ? "PASS" : "FAIL";
	console.log(
		`${status} ${budget.name}: ${actualKiB.toFixed(1)} KiB gzip (budget ${budget.gzipKiB} KiB)`,
	);
	failed ||= actualKiB > budget.gzipKiB;
}

const assetBytes = [...mainFiles].reduce(
	(total, file) => total + statSync(join(DIST, file)).size,
	0,
);
console.log(`Main startup transfer set: ${(assetBytes / 1024).toFixed(1)} KiB raw`);

if (failed) process.exit(1);
