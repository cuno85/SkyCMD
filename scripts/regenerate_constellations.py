#!/usr/bin/env python3
"""
Validate and deterministically rewrite constellation catalog files.

This first version intentionally treats the checked-in JSON files as the
canonical source. It does not download external data; it validates the current
format and can rewrite the files into a stable, normalized JSON layout.

Usage:
  py scripts/regenerate_constellations.py --check
  py scripts/regenerate_constellations.py --write
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CATALOG_DIR = ROOT / "data" / "catalogs"
CONSTELLATIONS_PATH = CATALOG_DIR / "constellations.json"
BOUNDARIES_PATH = CATALOG_DIR / "constellation_boundaries_iau.json"

EXPECTED_CONSTELLATION_COUNT = 86
EXPECTED_BOUNDARY_FEATURE_COUNT = 257


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _normalize_float(value: Any, *, min_value: float, max_value: float, label: str) -> float:
    _require(isinstance(value, (int, float)), f"{label} must be numeric, got {type(value).__name__}")
    normalized = float(value)
    _require(math.isfinite(normalized), f"{label} must be finite")
    _require(min_value <= normalized <= max_value, f"{label} out of range: {normalized}")
    return normalized


def normalize_constellations(payload: Any) -> list[dict[str, Any]]:
    _require(isinstance(payload, list), "constellations.json must be a top-level array")
    normalized: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for index, entry in enumerate(payload):
        _require(isinstance(entry, dict), f"constellation #{index} must be an object")
        constellation_id = str(entry.get("id") or "").strip()
        name = str(entry.get("name") or "").strip()
        lines = entry.get("lines")

        _require(constellation_id, f"constellation #{index} is missing id")
        _require(len(constellation_id) == 3, f"constellation id '{constellation_id}' must be a 3-letter IAU code")
        _require(constellation_id not in seen_ids, f"duplicate constellation id '{constellation_id}'")
        _require(name, f"constellation '{constellation_id}' is missing name")
        _require(isinstance(lines, list) and lines, f"constellation '{constellation_id}' must contain non-empty lines")

        normalized_lines: list[list[dict[str, float]]] = []
        for line_index, line in enumerate(lines):
            _require(isinstance(line, list) and len(line) >= 2, (
                f"constellation '{constellation_id}' line #{line_index} must contain at least two points"
            ))
            normalized_points: list[dict[str, float]] = []
            for point_index, point in enumerate(line):
                _require(isinstance(point, dict), (
                    f"constellation '{constellation_id}' line #{line_index} point #{point_index} must be an object"
                ))
                ra = _normalize_float(
                    point.get("ra"),
                    min_value=0.0,
                    max_value=24.0,
                    label=f"constellation '{constellation_id}' line #{line_index} point #{point_index} ra",
                )
                dec = _normalize_float(
                    point.get("dec"),
                    min_value=-90.0,
                    max_value=90.0,
                    label=f"constellation '{constellation_id}' line #{line_index} point #{point_index} dec",
                )
                _require(ra < 24.0, (
                    f"constellation '{constellation_id}' line #{line_index} point #{point_index} ra must be < 24"
                ))
                normalized_points.append({"ra": ra, "dec": dec})
            normalized_lines.append(normalized_points)

        seen_ids.add(constellation_id)
        normalized.append({
            "id": constellation_id,
            "name": name,
            "lines": normalized_lines,
        })

    _require(
        len(normalized) == EXPECTED_CONSTELLATION_COUNT,
        f"expected {EXPECTED_CONSTELLATION_COUNT} constellations, found {len(normalized)}",
    )
    return normalized


def _normalize_coords(coords: Any, *, feature_label: str) -> Any:
    if isinstance(coords, list) and coords and all(isinstance(item, (int, float)) for item in coords):
        _require(len(coords) >= 2, f"{feature_label} coordinate pair must contain lon/lat")
        lon = _normalize_float(coords[0], min_value=-360.0, max_value=360.0, label=f"{feature_label} lon")
        lat = _normalize_float(coords[1], min_value=-90.0, max_value=90.0, label=f"{feature_label} lat")
        return [lon, lat]

    _require(isinstance(coords, list), f"{feature_label} coordinates must be arrays")
    return [_normalize_coords(item, feature_label=feature_label) for item in coords]


def normalize_boundaries(payload: Any) -> dict[str, Any]:
    _require(isinstance(payload, dict), "constellation_boundaries_iau.json must be an object")
    _require(payload.get("type") == "FeatureCollection", "boundary file must be a GeoJSON FeatureCollection")
    features = payload.get("features")
    _require(isinstance(features, list), "boundary file must contain a features array")

    normalized_features: list[dict[str, Any]] = []
    for index, feature in enumerate(features):
        _require(isinstance(feature, dict), f"boundary feature #{index} must be an object")
        geometry = feature.get("geometry")
        _require(isinstance(geometry, dict), f"boundary feature #{index} must contain geometry")
        geometry_type = str(geometry.get("type") or "").strip()
        _require(
            geometry_type in {"LineString", "MultiLineString", "Polygon", "MultiPolygon"},
            f"boundary feature #{index} has unsupported geometry type '{geometry_type}'",
        )
        coordinates = _normalize_coords(geometry.get("coordinates"), feature_label=f"boundary feature #{index}")

        normalized_feature: dict[str, Any] = {
            "type": "Feature",
            "geometry": {
                "type": geometry_type,
                "coordinates": coordinates,
            },
        }
        if "id" in feature and feature.get("id") not in (None, ""):
            normalized_feature["id"] = feature.get("id")
        if "ids" in feature and feature.get("ids") not in (None, ""):
            normalized_feature["ids"] = feature.get("ids")
        if "properties" in feature and isinstance(feature.get("properties"), dict) and feature.get("properties"):
            normalized_feature["properties"] = feature.get("properties")
        normalized_features.append(normalized_feature)

    _require(
        len(normalized_features) == EXPECTED_BOUNDARY_FEATURE_COUNT,
        f"expected {EXPECTED_BOUNDARY_FEATURE_COUNT} boundary features, found {len(normalized_features)}",
    )
    return {
        "type": "FeatureCollection",
        "features": normalized_features,
    }


def summarize(constellations: list[dict[str, Any]], boundaries: dict[str, Any]) -> None:
    polyline_count = sum(len(item["lines"]) for item in constellations)
    point_count = sum(len(line) for item in constellations for line in item["lines"])
    boundary_count = len(boundaries["features"])

    print(f"Constellations: {len(constellations)}")
    print(f"Polylines: {polyline_count}")
    print(f"Line points: {point_count}")
    print(f"Boundary features: {boundary_count}")


def run(write: bool) -> int:
    constellations = normalize_constellations(_read_json(CONSTELLATIONS_PATH))
    boundaries = normalize_boundaries(_read_json(BOUNDARIES_PATH))

    if write:
        _write_json(CONSTELLATIONS_PATH, constellations)
        _write_json(BOUNDARIES_PATH, boundaries)
        print("Rewrote constellation catalog files in normalized JSON form.")
    else:
        print("Validation succeeded.")

    summarize(constellations, boundaries)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate and normalize constellation catalog files")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="validate current files without rewriting")
    mode.add_argument("--write", action="store_true", help="rewrite current files in normalized JSON form")
    args = parser.parse_args()

    try:
        return run(write=bool(args.write))
    except ValueError as exc:
        print(f"Validation failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())