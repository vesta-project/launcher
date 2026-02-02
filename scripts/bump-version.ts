import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = join(import.meta.dir, "..");

const filesToUpdate = [
    {
        path: join(projectRoot, "Cargo.toml"),
        type: "toml",
        regex: /\[workspace\.package\]\nversion = "[^"]+"/,
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

function bumpVersion(newVersion: string) {
    console.log(`Bumping version to: ${newVersion}`);

    for (const file of filesToUpdate) {
        try {
            const content = readFileSync(file.path, "utf8");
            
            if (file.type === "json") {
                const json = JSON.parse(content);
                json.version = newVersion;
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
if (args.length === 0) {
    console.log("Usage: bun scripts/bump-version.ts <new-version>");
    process.exit(1);
}

bumpVersion(args[0]);
