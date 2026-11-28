#!/usr/bin/env python3
"""Safely extract a Buildx OCI archive for tools that require an OCI layout directory."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile
import tempfile

MAX_ARCHIVE_MEMBERS = 100_000
MAX_UNCOMPRESSED_BYTES = 8 * 1024 * 1024 * 1024


def extract_oci_layout(archive_path: Path, destination: Path) -> int:
    archive_path = archive_path.resolve(strict=True)
    destination = destination.absolute()
    if destination.exists():
        raise ValueError("OCI layout destination must not already exist")
    destination.parent.mkdir(parents=True, exist_ok=True)

    extracted_count = 0
    total_size = 0
    with tempfile.TemporaryDirectory(
        prefix=f".{destination.name}.extract-", dir=destination.parent
    ) as temporary_directory:
        staging = Path(temporary_directory) / "layout"
        staging.mkdir()
        seen: set[str] = set()

        with tarfile.open(archive_path, mode="r:*") as archive:
            for member in archive:
                extracted_count += 1
                if extracted_count > MAX_ARCHIVE_MEMBERS:
                    raise ValueError("OCI archive exceeds the member-count limit")

                raw_name = member.name
                if not raw_name or raw_name.startswith("/") or "\\" in raw_name:
                    raise ValueError("OCI archive contains an unsafe path")
                parts = raw_name.split("/")
                if member.isdir() and parts[-1] == "":
                    parts.pop()
                if (
                    not parts
                    or any(part in ("", ".", "..") for part in parts)
                    or ":" in parts[0]
                ):
                    raise ValueError("OCI archive contains an unsafe path")

                relative = PurePosixPath(*parts)
                normalized_name = relative.as_posix()
                if normalized_name in seen:
                    raise ValueError("OCI archive contains duplicate paths")
                seen.add(normalized_name)

                target = staging.joinpath(*parts)
                try:
                    target.resolve().relative_to(staging.resolve())
                except ValueError as error:
                    raise ValueError("OCI archive path escapes the destination") from error

                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                if not member.isfile():
                    raise ValueError("OCI archive contains a non-regular entry")

                total_size += member.size
                if member.size < 0 or total_size > MAX_UNCOMPRESSED_BYTES:
                    raise ValueError("OCI archive exceeds the uncompressed-size limit")

                target.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(member)
                if source is None:
                    raise ValueError("OCI archive contains an unreadable file")
                with source, target.open("xb") as output:
                    shutil.copyfileobj(source, output)
                if target.stat().st_size != member.size:
                    raise ValueError("OCI archive file size does not match its header")

        layout_marker = json.loads((staging / "oci-layout").read_text(encoding="utf-8"))
        index = json.loads((staging / "index.json").read_text(encoding="utf-8"))
        if not isinstance(layout_marker, dict) or layout_marker.get("imageLayoutVersion") != "1.0.0":
            raise ValueError("OCI layout marker has an unsupported version")
        if not isinstance(index, dict) or index.get("schemaVersion") != 2 or not isinstance(index.get("manifests"), list):
            raise ValueError("OCI layout index is invalid")

        os.replace(staging, destination)
    return extracted_count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    try:
        count = extract_oci_layout(args.archive, args.destination)
    except (OSError, tarfile.TarError, ValueError, json.JSONDecodeError) as error:
        print(f"OCI layout extraction failed: {error}", file=sys.stderr)
        return 2
    print(f"Validated OCI layout extracted ({count} archive entries).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
