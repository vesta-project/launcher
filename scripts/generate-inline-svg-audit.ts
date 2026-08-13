import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const sourceRoots = [
	path.join(repositoryRoot, "vesta-launcher", "src"),
	path.join(repositoryRoot, "vesta-launcher", "ui"),
];
const outputPath = path.join(
	repositoryRoot,
	"docs",
	"architecture",
	"inline-svg-audit.html",
);
const annotationPath = path.join(
	repositoryRoot,
	"docs",
	"architecture",
	"inline-svg-annotations.json",
);

type AuditEntry = {
	id: string;
	file: string;
	line: number;
	priority: number;
	area: string;
	dynamic: boolean;
	source: string;
	preview: string | null;
};

async function findTsxFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) return findTsxFiles(entryPath);
			return entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
				? [entryPath]
				: [];
		}),
	);
	return files.flat();
}

function classify(file: string): Pick<AuditEntry, "priority" | "area"> {
	if (file.startsWith("vesta-launcher/ui/")) {
		return { priority: 1, area: "Core UI primitive" };
	}
	if (
		file.startsWith("vesta-launcher/src/components/page-root/") ||
		file.startsWith("vesta-launcher/src/components/page-sidebar/") ||
		file.startsWith("vesta-launcher/src/components/page-viewer/")
	) {
		return { priority: 2, area: "Application shell" };
	}
	if (
		file.startsWith("vesta-launcher/src/components/auth/") ||
		file.startsWith("vesta-launcher/src/components/instances/") ||
		file.startsWith("vesta-launcher/src/components/worlds/")
	) {
		return { priority: 3, area: "Shared application component" };
	}
	if (file.startsWith("vesta-launcher/src/components/pages/init/")) {
		return { priority: 4, area: "Onboarding page" };
	}
	return { priority: 5, area: "Feature page" };
}

function makePreview(source: string): string | null {
	const body = source.slice(source.indexOf(">") + 1, source.lastIndexOf("</svg>"));
	if (/\{[\s\S]*\}|\.map\(|Array\.from\(/.test(body)) return null;

	return source
		.replace(/\sclass(?:List)?=\{[^}]*\}/g, "")
		.replace(/\s(?:width|height)=\{[^}]*\}/g, "")
		.replace(/\saria-hidden=\{[^}]*\}/g, "")
		.replace(/\sstyle=\{\{[^}]*\}\}/g, "")
		.replace(/<svg\b/, '<svg class="svg-preview" aria-hidden="true"');
}

function extractEntries(file: string, content: string): AuditEntry[] {
	const relativeFile = path.relative(repositoryRoot, file);
	const matches = content.matchAll(/<svg\b[\s\S]*?<\/svg>/g);
	return [...matches].map((match, index) => {
		const source = match[0];
		const line = content.slice(0, match.index).split("\n").length;
		const preview = makePreview(source);
		const classification = classify(relativeFile);
		return {
			id: `${relativeFile}:${createHash("sha256").update(source).digest("hex").slice(0, 12)}:${index}`,
			file: relativeFile,
			line,
			...classification,
			dynamic: preview === null,
			source,
			preview,
		};
	});
}

async function migrateAnnotations(entries: AuditEntry[]): Promise<void> {
	let document: { version?: number; annotations?: Record<string, unknown> };
	try {
		document = JSON.parse(await readFile(annotationPath, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}

	const annotations = document.annotations ?? document;
	let migrated = 0;
	for (const entry of entries) {
		const legacyId = `${entry.file}:${entry.line}:${entry.id.split(":").at(-1)}`;
		if (!(legacyId in annotations) || entry.id in annotations) continue;
		annotations[entry.id] = annotations[legacyId];
		delete annotations[legacyId];
		migrated++;
	}
	if (migrated === 0) return;
	await writeFile(
		annotationPath,
		JSON.stringify(
			{ version: 2, migratedAt: new Date().toISOString(), annotations },
			null,
			2,
		) + "\n",
	);
	console.log(`Migrated ${migrated} annotation IDs to source-stable keys.`);
}

function renderHtml(entries: AuditEntry[]): string {
	const serializedEntries = JSON.stringify(entries).replace(/<\//g, "<\\/");
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Vesta inline SVG audit</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #101116; color: #f5f7fb; }
      * { box-sizing: border-box; }
      body { margin: 0; }
      header { position: sticky; top: 0; z-index: 1; padding: 24px clamp(20px, 4vw, 64px); border-bottom: 1px solid #2d313b; background: rgb(16 17 22 / 96%); backdrop-filter: blur(12px); }
      h1 { margin: 0; font-size: clamp(24px, 3vw, 36px); }
      header p { color: #abb4c4; margin: 8px 0 18px; max-width: 900px; }
      .controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      input, select, textarea, button { color: inherit; background: #191c24; border: 1px solid #3b4150; border-radius: 8px; padding: 9px 11px; font: inherit; }
      button { cursor: pointer; }
      button:hover { border-color: #7d9fed; background: #222838; }
      input { min-width: min(100%, 360px); }
      main { padding: 28px clamp(20px, 4vw, 64px) 64px; }
      .summary { color: #abb4c4; margin: 0 0 22px; }
      section { margin: 32px 0; }
      h2 { font-size: 17px; margin: 0 0 12px; color: #d8e2ff; }
      .grid { display: grid; gap: 12px; }
      article { display: grid; grid-template-columns: 118px minmax(0, 1fr); border: 1px solid #2d313b; border-radius: 12px; background: #171920; overflow: hidden; }
      .preview { min-height: 118px; display: grid; place-items: center; background: radial-gradient(circle at 50% 50%, #2a3143, #14161d); border-right: 1px solid #2d313b; color: #9ab8ff; }
      .svg-preview { width: 52px; height: 52px; max-width: 82px; max-height: 82px; }
      .dynamic { color: #f5c976; font-size: 12px; text-align: center; padding: 14px; }
      .entry { padding: 13px 16px 14px; min-width: 0; }
      .meta { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin-bottom: 8px; }
      code { font-family: "SFMono-Regular", Consolas, monospace; }
      .path { color: #e6ecfa; overflow-wrap: anywhere; }
      .badge { font-size: 11px; padding: 3px 7px; border: 1px solid #43506b; border-radius: 999px; color: #b7c8ee; }
      .badge.dynamic { padding: 3px 7px; color: #f5c976; border-color: #775e2c; }
      details { margin-top: 8px; }
      summary { cursor: pointer; color: #abb4c4; font-size: 13px; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 9px 0 0; padding: 12px; border-radius: 7px; background: #101116; color: #bdc8dc; font-size: 11px; line-height: 1.5; }
      .annotation { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 8px; margin-top: 12px; }
      textarea { min-height: 72px; resize: vertical; width: 100%; }
      .annotation-help { color: #abb4c4; font-size: 12px; margin: 12px 0 0; }
      .empty { color: #abb4c4; padding: 24px 0; }
      @media (max-width: 600px) { article { grid-template-columns: 84px minmax(0, 1fr); } .preview { min-height: 84px; } }
    </style>
  </head>
  <body>
    <header>
      <h1>Inline SVG audit</h1>
      <p>Production TSX only. Entries are sorted by architectural locality: core UI primitives first, then shell/shared components, onboarding, and feature pages. Static SVGs receive a visual preview; programmatic SVGs are flagged for source review.</p>
      <div class="controls">
        <input id="query" type="search" placeholder="Filter by path or source" autofocus />
        <select id="mode"><option value="all">All SVGs</option><option value="static">Static previews</option><option value="dynamic">Programmatic only</option></select>
        <button id="save-workspace" type="button">Save annotations…</button>
        <button id="export" type="button">Export JSON</button>
        <button id="import" type="button">Import JSON</button>
        <input id="import-file" type="file" accept="application/json" hidden />
      </div>
    </header>
    <main><p class="summary" id="summary"></p><p class="annotation-help">Notes are saved in this browser while you work. Use <strong>Save annotations…</strong> and save as <code>docs/architecture/inline-svg-annotations.json</code> in this repository, then tell Codex that file is ready to read.</p><div id="results"></div></main>
    <script id="entries" type="application/json">${serializedEntries}</script>
    <script>
      const entries = JSON.parse(document.querySelector('#entries').textContent);
      const results = document.querySelector('#results');
      const summary = document.querySelector('#summary');
      const query = document.querySelector('#query');
      const mode = document.querySelector('#mode');
      const saveWorkspace = document.querySelector('#save-workspace');
      const exportButton = document.querySelector('#export');
      const importButton = document.querySelector('#import');
      const importFile = document.querySelector('#import-file');
      const annotationStorageKey = 'vesta:inline-svg-audit:annotations:v1';
      let annotations = JSON.parse(localStorage.getItem(annotationStorageKey) || '{}');
      const escape = (value) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
      const persistAnnotations = () => localStorage.setItem(annotationStorageKey, JSON.stringify(annotations));
      const annotationDocument = () => JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), annotations }, null, 2);
      const download = () => { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([annotationDocument()], { type: 'application/json' })); link.download = 'inline-svg-annotations.json'; link.click(); URL.revokeObjectURL(link.href); };
      const render = () => {
        const term = query.value.trim().toLowerCase();
        const visible = entries.filter((entry) => (mode.value === 'all' || (mode.value === 'static') === !entry.dynamic) && (!term || (entry.file + entry.source).toLowerCase().includes(term)));
        summary.textContent = 'Showing ' + visible.length + ' of ' + entries.length + ' production inline SVGs.';
        const groups = new Map();
        for (const entry of visible) { const key = entry.priority + '. ' + entry.area; groups.set(key, [...(groups.get(key) || []), entry]); }
        results.innerHTML = [...groups].map(([area, group]) => '<section><h2>' + escape(area) + ' · ' + group.length + '</h2><div class="grid">' + group.map((entry) => { const annotation = annotations[entry.id] || {}; return '<article data-id="' + escape(entry.id) + '"><div class="preview">' + (entry.preview || '<div class="dynamic">Programmatic SVG<br>source review required</div>') + '</div><div class="entry"><div class="meta"><code class="path">' + escape(entry.file) + ':' + entry.line + '</code><span class="badge">priority ' + entry.priority + '</span>' + (entry.dynamic ? '<span class="badge dynamic">programmatic</span>' : '<span class="badge">static</span>') + '</div><div class="annotation"><select data-field="status"><option value="">Unreviewed</option><option value="extract">Extract to asset</option><option value="keep">Keep inline</option><option value="duplicate">Existing asset candidate</option><option value="remove">Remove</option></select><textarea data-field="note" placeholder="Your note for Codex…"></textarea></div><details><summary>Show raw SVG source</summary><pre>' + escape(entry.source) + '</pre></details></div></article>'; }).join('') + '</div></section>').join('') || '<p class="empty">No matching inline SVGs.</p>';
        for (const article of results.querySelectorAll('article[data-id]')) { const annotation = annotations[article.dataset.id] || {}; article.querySelector('[data-field="status"]').value = annotation.status || ''; article.querySelector('[data-field="note"]').value = annotation.note || ''; }
      };
      results.addEventListener('input', (event) => { const field = event.target.dataset.field; if (!field) return; const article = event.target.closest('article[data-id]'); annotations[article.dataset.id] = { ...(annotations[article.dataset.id] || {}), [field]: event.target.value, updatedAt: new Date().toISOString() }; persistAnnotations(); });
      results.addEventListener('change', (event) => { const field = event.target.dataset.field; if (!field) return; const article = event.target.closest('article[data-id]'); annotations[article.dataset.id] = { ...(annotations[article.dataset.id] || {}), [field]: event.target.value, updatedAt: new Date().toISOString() }; persistAnnotations(); });
      saveWorkspace.addEventListener('click', async () => { if (!window.showSaveFilePicker) return download(); try { const handle = await window.showSaveFilePicker({ suggestedName: 'inline-svg-annotations.json', types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] }); const writable = await handle.createWritable(); await writable.write(annotationDocument()); await writable.close(); } catch (error) { if (error.name !== 'AbortError') console.error(error); } });
      exportButton.addEventListener('click', download);
      importButton.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', async () => { const [file] = importFile.files; if (!file) return; const imported = JSON.parse(await file.text()); annotations = imported.annotations || imported; persistAnnotations(); render(); });
      query.addEventListener('input', render); mode.addEventListener('change', render); render();
    </script>
  </body>
</html>`;
}

const files = (await Promise.all(sourceRoots.map(findTsxFiles))).flat().sort();
const entries = (
	await Promise.all(
		files.map(async (file) => extractEntries(file, await readFile(file, "utf8"))),
	)
)
	.flat()
	.sort((left, right) =>
		left.priority - right.priority ||
		left.file.localeCompare(right.file) ||
		left.line - right.line,
	);

await migrateAnnotations(entries);
await writeFile(outputPath, renderHtml(entries));
console.log(`Wrote ${entries.length} inline SVG entries to ${path.relative(repositoryRoot, outputPath)}.`);
import { createHash } from "node:crypto";
