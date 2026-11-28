from __future__ import annotations

import io
import importlib.util
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

sys.dont_write_bytecode = True
extractor_path = Path(__file__).with_name("extract-inspector-oci-layout.py")
extractor_spec = importlib.util.spec_from_file_location("extract_inspector_oci_layout", extractor_path)
if extractor_spec is None or extractor_spec.loader is None:
    raise RuntimeError("could not load the OCI layout extractor")
extractor = importlib.util.module_from_spec(extractor_spec)
sys.modules[extractor_spec.name] = extractor
extractor_spec.loader.exec_module(extractor)
extract_oci_layout = extractor.extract_oci_layout


def add_file(archive: tarfile.TarFile, name: str, content: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(content)
    archive.addfile(info, io.BytesIO(content))


class ExtractInspectorOciLayoutTests(unittest.TestCase):
    def make_archive(self, root: Path, entries: list[tuple[str, bytes]]) -> Path:
        path = root / "fixture.oci.tar"
        with tarfile.open(path, "w") as archive:
            for name, content in entries:
                add_file(archive, name, content)
        return path

    @staticmethod
    def valid_entries() -> list[tuple[str, bytes]]:
        return [
            ("oci-layout", b'{"imageLayoutVersion":"1.0.0"}\n'),
            ("index.json", b'{"schemaVersion":2,"manifests":[]}\n'),
            ("blobs/sha256/example", b"synthetic image blob"),
        ]

    def test_extracts_valid_layout_and_preserves_contents(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = self.make_archive(root, self.valid_entries())
            destination = root / "layout"

            count = extract_oci_layout(archive, destination)

            self.assertEqual(count, 3)
            self.assertEqual(
                json.loads((destination / "oci-layout").read_text()),
                {"imageLayoutVersion": "1.0.0"},
            )
            self.assertEqual(
                (destination / "blobs/sha256/example").read_bytes(),
                b"synthetic image blob",
            )

    def test_rejects_traversal_without_partial_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            entries = self.valid_entries() + [("../escaped", b"must not be written")]
            archive = self.make_archive(root, entries)
            destination = root / "layout"

            with self.assertRaisesRegex(ValueError, "unsafe path"):
                extract_oci_layout(archive, destination)

            self.assertFalse(destination.exists())
            self.assertFalse((root / "escaped").exists())

    def test_rejects_symlink_without_partial_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive_path = root / "symlink.oci.tar"
            with tarfile.open(archive_path, "w") as archive:
                for name, content in self.valid_entries():
                    add_file(archive, name, content)
                link = tarfile.TarInfo("blobs/sha256/link")
                link.type = tarfile.SYMTYPE
                link.linkname = "../../outside"
                archive.addfile(link)
            destination = root / "layout"

            with self.assertRaisesRegex(ValueError, "non-regular"):
                extract_oci_layout(archive_path, destination)

            self.assertFalse(destination.exists())

    def test_rejects_invalid_layout_marker_without_partial_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            entries = self.valid_entries()
            entries[0] = ("oci-layout", b'{"imageLayoutVersion":"0.0.0"}\n')
            archive = self.make_archive(root, entries)
            destination = root / "layout"

            with self.assertRaisesRegex(ValueError, "unsupported version"):
                extract_oci_layout(archive, destination)

            self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
