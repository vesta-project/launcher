"""Checks for the portable, inert drop fixture generator. Run with python3 -I."""

import gzip
import io
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
import zipfile


SCRIPT = Path(__file__).with_name("generate-drop-fixtures.py")
GENERATOR = runpy.run_path(str(SCRIPT), run_name="fixture_generator")


class DropFixtureTests(unittest.TestCase):
    def test_archives_are_reproducible(self):
        self.assertEqual(GENERATOR["fixtures"](False), GENERATOR["fixtures"](False))

    def test_owned_inner_archives_are_opaque_and_world_metadata_is_gzipped(self):
        fixtures = GENERATOR["fixtures"](False)
        with zipfile.ZipFile(io.BytesIO(fixtures["owned-opaque-zip.zip"])) as outer:
            with zipfile.ZipFile(io.BytesIO(outer.read("assets/fixture/opaque.zip"))) as inner:
                self.assertIn("pack.mcmeta", inner.namelist())
                self.assertIn("data/fixture/function/test.mcfunction", inner.namelist())
        with zipfile.ZipFile(io.BytesIO(fixtures["world-double-wrapper.zip"])) as world:
            level = gzip.decompress(world.read("my-world/my-world/level.dat"))
            self.assertTrue(level.startswith(b"\x0a\x00\x00"))
            self.assertIn(b"LevelName", level)
            self.assertIn("my-world/my-world/datapacks/opaque.zip", world.namelist())

    def test_rejection_fixture_is_never_extracted(self):
        fixtures = GENERATOR["fixtures"](False)
        with zipfile.ZipFile(io.BytesIO(fixtures["unsafe-path-rejected.zip"])) as archive:
            self.assertIn("../escaped.txt", archive.namelist())

    def test_performance_dimensions(self):
        fixtures = GENERATOR["fixtures"](True)
        with zipfile.ZipFile(io.BytesIO(fixtures["perf-10000-entries.zip"])) as archive:
            self.assertEqual(len(archive.infolist()), 10002)
        with zipfile.ZipFile(io.BytesIO(fixtures["perf-16mib-payload.zip"])) as archive:
            self.assertEqual(archive.getinfo("assets/fixture/payload.bin").file_size, 16 * 1024 * 1024)
        with zipfile.ZipFile(io.BytesIO(fixtures["perf-32-worlds.zip"])) as archive:
            self.assertEqual(sum(name.endswith("/level.dat") for name in archive.namelist()), 32)

    def test_cli_uses_new_directory_and_preserves_parent_files(self):
        with tempfile.TemporaryDirectory(prefix="vesta-fixture-generator-test-") as parent:
            sentinel = Path(parent) / "existing.txt"
            sentinel.write_text("keep")
            subprocess.run([sys.executable, "-I", str(SCRIPT), "--parent", parent],
                           check=True, capture_output=True, text=True)
            self.assertEqual(sentinel.read_text(), "keep")
            generated = [path for path in Path(parent).iterdir() if path.is_dir()]
            self.assertEqual(len(generated), 1)
            self.assertTrue((generated[0] / "SHA256SUMS.txt").is_file())
            self.assertFalse((Path(parent) / "escaped.txt").exists())


if __name__ == "__main__":
    unittest.main()
