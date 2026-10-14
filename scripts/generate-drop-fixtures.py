#!/usr/bin/env python3
"""Generate inert, reproducible manual-drop fixtures in a new directory.

Run with Python isolated mode (-I). These synthetic mods/worlds test importing,
not Minecraft execution or provider recognition. Never launch them in a real save.
"""

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import struct
import tempfile
import zipfile


def archive(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as result:
        for name, payload in entries.items():
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            result.writestr(info, payload)
    return output.getvalue()


def metadata(description, pack_format):
    return json.dumps({"pack": {"pack_format": pack_format, "description": description}}).encode()


def nbt_name(name):
    value = name.encode()
    return struct.pack(">H", len(value)) + value


def nbt_string(name, value):
    return b"\x08" + nbt_name(name) + nbt_name(value)


def level(name):
    data = b"\x0a\x00\x00\x0a" + nbt_name("Data")
    data += nbt_string("LevelName", name)
    data += b"\x03" + nbt_name("DataVersion") + struct.pack(">i", 4189)
    data += b"\x04" + nbt_name("LastPlayed") + struct.pack(">q", 0)
    data += b"\x0a" + nbt_name("Version") + nbt_string("Name", "1.21.4") + b"\x00"
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, mode="wb", filename="", mtime=0) as compressed:
        compressed.write(data + b"\x00\x00")
    return output.getvalue()


def mod(identifier):
    return archive({
        "fabric.mod.json": json.dumps({
            "schemaVersion": 1, "id": identifier, "version": "1.0.0",
            "name": "INERT import fixture", "environment": "*",
        }).encode(),
        "META-INF/MANIFEST.MF": b"Manifest-Version: 1.0\n\n",
    })


def fixtures(performance):
    resource = {"pack.mcmeta": metadata("INERT resource pack", 46),
                "assets/fixture/lang/en_us.json": b"{}"}
    datapack = {"pack.mcmeta": metadata("INERT datapack", 61),
                "data/fixture/function/test.mcfunction": b"# No commands\n"}
    shader = {"shaders/composite.fsh": b"#version 150\nvoid main() {}\n"}
    first_mod, second_mod = mod("fixture_a"), mod("fixture_b")
    world = {"level.dat": level("INERT import fixture"),
             "datapacks/opaque.zip": archive(datapack),
             "notes.txt": b"Metadata-only synthetic world. Do not launch.\n"}
    result = {
        "inert-mod-a.jar": first_mod,
        "mod-collection.zip": archive({"mods/a.jar": first_mod, "mods/b.jar": second_mod}),
        "resource-rooted.zip": archive(resource),
        "resource-double-wrapper.zip": archive({"my-pack/my-pack/" + k: v for k, v in resource.items()}),
        "datapack-rooted.zip": archive(datapack),
        "datapack-double-wrapper.zip": archive({"my-pack/my-pack/" + k: v for k, v in datapack.items()}),
        "shader-double-wrapper.zip": archive({"my-pack/my-pack/" + k: v for k, v in shader.items()}),
        "world-double-wrapper.zip": archive({"my-world/my-world/" + k: v for k, v in world.items()}),
        "two-worlds.zip": archive({**{"one/" + k: v for k, v in world.items()},
                                   **{"two/" + k: v for k, v in {**world, "level.dat": level("Second fixture")}.items()}}),
        "ambiguous-pack.zip": archive({**resource, **datapack}),
        "mixed-resources.zip": archive({"mods/a.jar": first_mod,
                                        **{"resource/" + k: v for k, v in resource.items()},
                                        **{"data-pack/" + k: v for k, v in datapack.items()}}),
        "owned-opaque-zip.zip": archive({**resource, "assets/fixture/opaque.zip": archive(datapack)}),
        "unowned-inner-zip.zip": archive({"pack.zip": archive(resource)}),
        "unsupported-layout.zip": archive({"readme.txt": b"Not a supported resource\n"}),
        "modpack-rejected.zip": archive({"modrinth.index.json": json.dumps({
            "formatVersion": 1, "game": "minecraft", "versionId": "fixture",
            "name": "INERT modpack rejection fixture", "files": [],
            "dependencies": {"minecraft": "1.21.4"},
        }).encode()}),
        "unsafe-path-rejected.zip": archive({"../escaped.txt": b"Must never be extracted\n", **resource}),
    }
    if performance:
        result["perf-10000-entries.zip"] = archive({**resource,
            **{f"assets/fixture/entries/{i:05d}.txt": b"fixture\n" for i in range(10000)}})
        # Incompressible deterministic data avoids suspicious compression ratios.
        result["perf-16mib-payload.zip"] = archive({**resource,
            "assets/fixture/payload.bin": hashlib.shake_256(b"vesta-drop-fixture").digest(16 * 1024 * 1024)})
        result["perf-32-worlds.zip"] = archive({
            f"world-{i:02d}/{k}": v for i in range(32)
            for k, v in {**world, "level.dat": level(f"Fixture {i}")}.items()})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parent", type=Path, help="Existing directory for a new private fixture subdirectory")
    parser.add_argument("--performance", action="store_true", help="Also create entry/byte/multi-world performance archives")
    args = parser.parse_args()
    directory = Path(tempfile.mkdtemp(prefix="vesta-drop-fixtures-", dir=args.parent))
    checksums = []
    for name, payload in fixtures(args.performance).items():
        (directory / name).write_bytes(payload)
        checksums.append(f"{hashlib.sha256(payload).hexdigest()}  {name}")
    (directory / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n")
    (directory / "README.txt").write_text(
        "INERT IMPORT FIXTURES: use only a disposable instance; do not launch Minecraft.\n"
        "Synthetic files will normally remain unidentified by providers.\n"
        "unsafe-path-rejected.zip contains a traversal entry intentionally; never extract it yourself.\n"
        "Expected drop outcomes: docs/features/FILE_DROP_TESTING.md in the Vesta repository.\n"
    )
    print(f"Created {len(checksums)} fixtures in {directory}")


if __name__ == "__main__":
    main()
