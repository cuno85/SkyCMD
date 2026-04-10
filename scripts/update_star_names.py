#!/usr/bin/env python3
"""
Refresh star_names.json from IAU-CSN and print a compact summary.

Usage:
  py scripts/update_star_names.py
"""

import json
from pathlib import Path

from parse_iau_csn import main as parse_main


def run() -> int:
    parse_main()
    out_path = Path(__file__).resolve().parents[1] / "data" / "catalogs" / "star_names.json"
    data = json.loads(out_path.read_text(encoding="utf-8"))
    total = len(data) if isinstance(data, list) else 0
    print(f"\nFinal count: {total} star names")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
