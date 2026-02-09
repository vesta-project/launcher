import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = join(import.meta.dir, "..");

const filesToUpdate = [
    {
        path: join(projectRoot, "Cargo.toml"),
        type: "toml",
        regex: /\[workspace\.package\]\r?\nversion = "[^"]+"/,
        replace: (version: string) => `[workspace.package]\nversion = "${version}"`
    },
    {
        path: join(projectRoot, "vesta-launcher", "package.json"),
        type: "json"
    },
    {
        path: join(projectRoot, "vesta-launcher", "src-tauri", "tauri.conf.json"),
        type: "json"
    }
];

function getVersion(): string {
    const tauriConfPath = join(projectRoot, "vesta-launcher", "src-tauri", "tauri.conf.json");
    const content = readFileSync(tauriConfPath, "utf8");
    return JSON.parse(content).version;
}

function parseVersion(v: string) {
    const match = v.match(/^(\d+)\.(\d+)\.(\d+)(-(alpha|beta)\.(\d+))?$/);
    if (!match) throw new Error(`Invalid version format: ${v}`);
    return {
        major: parseInt(match[1]),
        minor: parseInt(match[2]),
        patch: parseInt(match[3]),
        suffix: match[5] || null,
        preRelease: (match[6] !== undefined && match[6] !== null) ? parseInt(match[6]) : null
    };
}

function formatVersion(v: { major: number, minor: number, patch: number, suffix: string | null, preRelease: number | null }): string {
    let base = `${v.major}.${v.minor}.${v.patch}`;
    if (v.suffix) {
        base += `-${v.suffix}.${v.preRelease ?? 1}`;
    }
    return base;
}

function formatMsiVersion(v: { major: number, minor: number, patch: number, suffix: string | null, preRelease: number | null }): string {
    return `${v.major}.${v.minor}.${v.patch}${v.preRelease !== null ? `.${v.preRelease}` : ""}`;
}

function bumpVersion(newVersion: string) {
    console.log(`Bumping version to: ${newVersion}`);
    const v = parseVersion(newVersion);
    const msiVersion = formatMsiVersion(v);

    for (const file of filesToUpdate) {
        try {
            const content = readFileSync(file.path, "utf8");
            
            if (file.type === "json") {
                const json = JSON.parse(content);
                json.version = newVersion;

                if (file.path.endsWith("tauri.conf.json") && json.bundle?.windows?.wix) {
                    json.bundle.windows.wix.version = msiVersion;
                }

                writeFileSync(file.path, JSON.stringify(json, null, "\t") + "\n");
            } else if (file.type === "toml" && file.regex && file.replace) {
                const newContent = content.replace(file.regex, file.replace(newVersion));
                writeFileSync(file.path, newContent);
            }
            
            console.log(`✓ Updated ${file.path}`);
        } catch (err) {
            console.error(`✗ Failed to update ${file.path}:`, err);
        }
    }
}

const args = process.argv.slice(2);
const currentVersionStr = getVersion();
let nextVersion = "";

if (args.length === 0) {
    console.log(`Current version: ${currentVersionStr}`);
    console.log("Usage: bun scripts/bump-version.ts <version|type>");
    console.log("Types: patch, minor, major, alpha, beta");
    process.exit(1);
}

const action = args[0];

if (["patch", "minor", "major", "alpha", "beta"].includes(action)) {
    const v = parseVersion(currentVersionStr);
    if (action === "major") {
        v.major++; v.minor = 0; v.patch = 0; v.suffix = null; v.preRelease = null;
    } else if (action === "minor") {
        v.minor++; v.patch = 0; v.suffix = null; v.preRelease = null;
    } else if (action === "patch") {
        v.patch++; v.suffix = null; v.preRelease = null;
    } else if (action === "alpha" || action === "beta") {
        if (v.suffix === action) {
            v.preRelease = (v.preRelease ?? 0) + 1;
        } else {
            v.suffix = action;
            v.preRelease = 1;
        }
    }
    nextVersion = formatVersion(v);
} else {
    nextVersion = action;
}

bumpVersion(nextVersion);
