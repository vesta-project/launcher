import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const embeddedPath = path.join(repoRoot, "crates/piston-lib/src/api/embedded_skins.rs");
const outRoot = path.join(repoRoot, ".skin-packs-cache/source");

const embedded = fs.readFileSync(embeddedPath, "utf8");
fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });

const blockRe =
	/Skin\s*\{[\s\S]*?texture_key:\s*Arc::from\("([^"]+)"\),[\s\S]*?name:\s*Some\(Arc::from\("([^"]*)"\)\),[\s\S]*?source:\s*SkinSource::Default\s*\{([\s\S]*?)\n\s*\},?/g;

function parseDataUri(value: string) {
	const cleaned = value.replace(/\s+/g, "");
	const match = cleaned.match(/^data:([^;]+);base64,(.+)$/);
	if (match) return { mime: match[1], data: match[2] };
	return { mime: "image/png", data: cleaned };
}

function extract(body: string, field: string) {
	const someRe = new RegExp(
		`${field}:\\s*Some\\(Arc::from\\("([\\s\\S]*?)"\\)\\)`,
	);
	const match = body.match(someRe);
	if (!match) return undefined;
	return parseDataUri(match[1]);
}

function extForMime(mime: string) {
	if (mime.includes("webp")) return ".webp";
	if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
	return ".png";
}

let count = 0;
let m: RegExpExecArray | null;
while ((m = blockRe.exec(embedded))) {
	const key = m[1];
	const body = m[3];
	const packIdMatch = body.match(/pack_id:\s*Some\(Arc::from\("([^"]+)"\)\)/);
	const packId = packIdMatch?.[1] ?? "other_events";
	const slim = extract(body, "slim_texture");
	const classic = extract(body, "classic_texture");

	const packDir = path.join(outRoot, packId);
	if (packId === "defaults") {
		if (slim) {
			const dir = path.join(packDir, "slim");
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(
				path.join(dir, key + extForMime(slim.mime)),
				Buffer.from(slim.data, "base64"),
			);
		}
		if (classic) {
			const dir = path.join(packDir, "wide");
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(
				path.join(dir, key + extForMime(classic.mime)),
				Buffer.from(classic.data, "base64"),
			);
		}
	} else {
		fs.mkdirSync(packDir, { recursive: true });
		const tex = classic ?? slim;
		if (!tex) continue;
		// Keep the full texture_key as the filename so re-embed preserves stable keys.
		fs.writeFileSync(
			path.join(packDir, key + extForMime(tex.mime)),
			Buffer.from(tex.data, "base64"),
		);
	}
	count++;
}

console.log(`Extracted ${count} skins into ${path.relative(repoRoot, outRoot)}`);
for (const pack of fs.readdirSync(outRoot).sort()) {
	const p = path.join(outRoot, pack);
	if (!fs.statSync(p).isDirectory()) continue;
	const n = fs
		.readdirSync(p, { recursive: true })
		.filter((f) => /\.(png|webp|jpe?g)$/i.test(String(f))).length;
	console.log(`  ${pack}: ${n}`);
}
