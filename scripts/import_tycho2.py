#!/usr/bin/env python3
"""
Import the real Tycho-2 catalog from CDS (I/259) and build stars_tycho2.json.

Source:
  https://cdsarc.cds.unistra.fr/ftp/I/259/
  Hog et al. (2000), Tycho-2 Catalogue

This script removes any synthetic generation and only keeps catalog values.
"""

from __future__ import annotations

import argparse
import contextlib
import gzip
import json
import shutil
import tempfile
import time
import urllib.request
from pathlib import Path

BASE_URL = "https://cdsarc.cds.unistra.fr/ftp/I/259"
CHUNK_FILES = [f"tyc2.dat.{i:02d}.gz" for i in range(20)]


def _clean_float(text: str):
    value = text.strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _download_with_retries(url: str, target: Path, retries: int = 5):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_size > 0:
        return

    last_error = None
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=120) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst, length=1024 * 1024)
            if target.stat().st_size > 0:
                return
            raise RuntimeError("downloaded file is empty")
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            wait_s = min(20, 2 * attempt)
            print(f"    download failed ({attempt}/{retries}): {exc}; retry in {wait_s}s")
            time.sleep(wait_s)

    raise RuntimeError(f"failed to download {url}: {last_error}")


def _parse_tycho2_line(line: str):
    # CDS format: 32 fields separated by '|'
    parts = line.split("|")
    if len(parts) < 26:
        return None

    tyc_field = parts[0].strip()
    tyc_chunks = tyc_field.split()
    if len(tyc_chunks) != 3:
        return None

    tyc1, tyc2, tyc3 = tyc_chunks
    tyc_id = f"TYC {tyc1}-{tyc2}-{tyc3}"

    ra_deg = _clean_float(parts[2])
    dec_deg = _clean_float(parts[3])

    # Prefer VT (visual-like); fallback to BT if VT missing.
    bt_mag = _clean_float(parts[17])
    vt_mag = _clean_float(parts[19])
    mag = vt_mag if vt_mag is not None else bt_mag

    if ra_deg is None or dec_deg is None or mag is None:
        return None

    bv = None
    if bt_mag is not None and vt_mag is not None:
        # ReadMe note(7): B-V ~= 0.850 * (BT - VT)
        bv = 0.85 * (bt_mag - vt_mag)

    return {
        "id": tyc_id,
        "name": tyc_id,
        # Renderer expects RA in hours, not degrees.
        "ra": round(ra_deg / 15.0, 8),
        "dec": round(dec_deg, 8),
        "mag": round(mag, 3),
        "bv": round(bv, 3) if bv is not None else None,
        "type": "star",
    }


def import_tycho2(output_path: Path, mag_max: float | None = None, cache_dir: Path | None = None):
    stars = []
    skipped = 0

    if cache_dir is None:
        temp_ctx = tempfile.TemporaryDirectory(prefix="tycho2_")
        tmp_path = Path(temp_ctx.__enter__())
    else:
        temp_ctx = None
        tmp_path = cache_dir
        tmp_path.mkdir(parents=True, exist_ok=True)

    try:
        for idx, filename in enumerate(CHUNK_FILES, start=1):
            url = f"{BASE_URL}/{filename}"
            local_gz = tmp_path / filename
            chunk_done = False
            parse_attempts = 0
            while not chunk_done:
                parse_attempts += 1
                print(f"[{idx:02d}/20] Downloading {filename} ...")
                _download_with_retries(url, local_gz)

                print(f"[{idx:02d}/20] Parsing {filename} ...")
                try:
                    with gzip.open(local_gz, "rt", encoding="ascii", errors="ignore") as fh:
                        for raw in fh:
                            row = _parse_tycho2_line(raw.rstrip("\n"))
                            if row is None:
                                skipped += 1
                                continue
                            if mag_max is not None and row["mag"] > mag_max:
                                continue
                            stars.append(row)
                    chunk_done = True
                except (EOFError, OSError) as exc:
                    if parse_attempts >= 3:
                        raise RuntimeError(f"failed parsing {filename} after {parse_attempts} attempts: {exc}") from exc
                    print(f"    parse failed ({parse_attempts}/3): {exc}; re-downloading chunk")
                    with contextlib.suppress(FileNotFoundError):
                        local_gz.unlink()
    finally:
        if temp_ctx is not None:
            temp_ctx.__exit__(None, None, None)

    stars.sort(key=lambda s: s["mag"])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(stars, f, separators=(",", ":"), ensure_ascii=False)

    return stars, skipped


def main():
    parser = argparse.ArgumentParser(description="Import real Tycho-2 data from CDS.")
    parser.add_argument(
        "--mag-max",
        type=float,
        default=12.0,
        help="Optional faint-end cutoff in apparent magnitude (default: 12.0).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "catalogs" / "stars_tycho2.json",
        help="Output JSON path.",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "catalogs" / ".tycho2_cache",
        help="Directory for cached CDS chunk downloads.",
    )
    args = parser.parse_args()

    mag_max = args.mag_max if args.mag_max is not None else None
    print("Importing real Tycho-2 catalog from CDS...")
    if mag_max is None:
        print("Magnitude cutoff: none (full import)")
    else:
        print(f"Magnitude cutoff: <= {mag_max:.2f}")

    stars, skipped = import_tycho2(args.output, mag_max=mag_max, cache_dir=args.cache_dir)
    size_mb = args.output.stat().st_size / (1024 * 1024)

    print(f"✓ Written: {args.output}")
    print(f"  Stars: {len(stars):,}")
    print(f"  Skipped malformed rows: {skipped:,}")
    print(f"  File size: {size_mb:.2f} MB")
    if stars:
        print(f"  Mag range: {stars[0]['mag']:.3f} .. {stars[-1]['mag']:.3f}")


if __name__ == "__main__":
    main()
