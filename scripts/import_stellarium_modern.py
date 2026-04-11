#!/usr/bin/env python3
"""Convert Stellarium v25.1 modern constellation lines into SkyCMD format."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOGS = ROOT / "data" / "catalogs"
STELLARIUM_INDEX = CATALOGS / "stellarium_modern_index_v25_1.json"
HIP7 = CATALOGS / "stars_hip7.json"
OUT_FULL = CATALOGS / "constellations_modern_stellarium_v25_1.json"
OUT_CORE = CATALOGS / "constellations_modern_stellarium_v25_1_core.json"


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _hip_from_id(star_id: str) -> int | None:
    m = re.search(r"(\d+)", str(star_id))
    if not m:
        return None
    return int(m.group(1))


def _build_hip_map(stars_payload: list[dict]) -> dict[int, dict[str, float]]:
    out: dict[int, dict[str, float]] = {}
    for star in stars_payload:
        hip = _hip_from_id(star.get("id", ""))
        if hip is None:
            continue
        ra = star.get("ra")
        dec = star.get("dec")
        if not isinstance(ra, (int, float)) or not isinstance(dec, (int, float)):
            continue
        out[hip] = {"ra": float(ra), "dec": float(dec)}
    return out


def _point_from_token(token, hip_map: dict[int, dict[str, float]]):
    if isinstance(token, int):
        return hip_map.get(token)
    if isinstance(token, list) and len(token) >= 2 and isinstance(token[0], (int, float)) and isinstance(token[1], (int, float)):
        # Some Stellarium entries (mostly non-constellation asterisms) use direct coordinates.
        return {"ra": float(token[0]), "dec": float(token[1])}
    return None


def convert() -> None:
    stellarium = _read_json(STELLARIUM_INDEX)
    hip_map = _build_hip_map(_read_json(HIP7))

    constellations = stellarium.get("constellations") or []
    out_full: list[dict] = []
    missing_refs = 0

    for entry in constellations:
        cid = str(entry.get("id") or "").strip()
        if not cid:
            continue
        parts = cid.split()
        abbr = parts[-1] if parts else cid
        common = entry.get("common_name") or {}
        name = str(common.get("english") or common.get("native") or abbr).strip()

        lines_out: list[list[dict[str, float]]] = []
        for line in entry.get("lines") or []:
            if not isinstance(line, list):
                continue
            pts: list[dict[str, float]] = []
            for token in line:
                p = _point_from_token(token, hip_map)
                if p is None:
                    missing_refs += 1
                    continue
                pts.append({"ra": p["ra"], "dec": p["dec"]})
            if len(pts) >= 2:
                lines_out.append(pts)

        if not lines_out:
            continue

        out_full.append({
            "id": abbr,
            "name": name,
            "lines": lines_out,
        })

    # Core variant: keep only the longest polyline per constellation.
    out_core = []
    for c in out_full:
        longest = max(c["lines"], key=len)
        out_core.append({"id": c["id"], "name": c["name"], "lines": [longest]})

    _write_json(OUT_FULL, out_full)
    _write_json(OUT_CORE, out_core)

    print(f"Stellarium modern constellations converted: {len(out_full)}")
    print(f"Core constellations converted: {len(out_core)}")
    print(f"Unresolved line references skipped: {missing_refs}")


if __name__ == "__main__":
    convert()
