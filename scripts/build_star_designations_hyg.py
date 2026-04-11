#!/usr/bin/env python3
"""Build HIP-linked Bayer/Flamsteed designations from HYG database."""

from __future__ import annotations

import csv
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "data" / "catalogs" / "star_designations_hyg.json"
HYG_URLS = [
    "https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv",
    "https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v40.csv.gz",
]

GREEK_MAP = {
    "ALP": "alpha",
    "BET": "beta",
    "GAM": "gamma",
    "DEL": "delta",
    "EPS": "epsilon",
    "ZET": "zeta",
    "ETA": "eta",
    "THE": "theta",
    "IOT": "iota",
    "KAP": "kappa",
    "LAM": "lambda",
    "MU": "mu",
    "NU": "nu",
    "XI": "xi",
    "OMI": "omicron",
    "PI": "pi",
    "RHO": "rho",
    "SIG": "sigma",
    "TAU": "tau",
    "UPS": "upsilon",
    "PHI": "phi",
    "CHI": "chi",
    "PSI": "psi",
    "OME": "omega",
}


def normalize_bayer(raw: str, con: str) -> str:
    token = str(raw or "").strip()
    con_token = str(con or "").strip()
    if not token or not con_token:
        return ""

    m = re.match(r"^([A-Za-z]{2,3})(\d{0,2})$", token)
    if not m:
        return ""

    prefix = m.group(1).upper()
    suffix = m.group(2)
    greek = GREEK_MAP.get(prefix)
    if not greek:
        return ""
    if suffix:
        suffix = str(int(suffix))
    return f"{greek}{suffix} {con_token}"


def normalize_flam(raw: str, con: str) -> str:
    con_token = str(con or "").strip()
    if not con_token:
        return ""
    value = str(raw or "").strip()
    if not value:
        return ""
    if not value.isdigit():
        return ""
    return f"{int(value)} {con_token}"


def build() -> int:
    payload = None
    for url in HYG_URLS:
      try:
        req = urllib.request.Request(url, headers={"User-Agent": "SkyCMD/1.0"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read()
        if url.endswith(".gz"):
            import gzip
            payload = gzip.decompress(raw).decode("utf-8", errors="replace")
        else:
            payload = raw.decode("utf-8", errors="replace")
        break
      except Exception:
        continue

    if payload is None:
        raise RuntimeError("Failed to download HYG dataset from known URLs")

    reader = csv.DictReader(payload.splitlines())
    by_id: dict[str, dict] = {}

    for row in reader:
        hip_raw = str(row.get("hip") or "").strip()
        if not hip_raw.isdigit():
            continue

        hip = int(hip_raw)
        if hip <= 0:
            continue

        star_id = f"HIP {hip}"
        con = str(row.get("con") or "").strip()
        bayer = normalize_bayer(row.get("bayer") or "", con)
        flamsteed = normalize_flam(row.get("flam") or "", con)

        if not bayer and not flamsteed:
            continue

        current = by_id.get(star_id, {"id": star_id, "source": "HYG"})
        if bayer and not current.get("bayer"):
            current["bayer"] = bayer
        if flamsteed and not current.get("flamsteed"):
            current["flamsteed"] = flamsteed
        by_id[star_id] = current

    def sort_key(item: dict) -> int:
        return int(str(item.get("id", "HIP 999999999")).split()[-1])

    out = sorted(by_id.values(), key=sort_key)
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(out)} designation rows to {OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(build())
