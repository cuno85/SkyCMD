#!/usr/bin/env python3
import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.catalog_repo import CatalogRepository


DEFAULT_INPUTS = {
    "mag4": Path("data/catalogs/stars_mag4.json"),
    "tycho2": Path("data/catalogs/stars_tycho2.json"),
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Import star catalogs JSON into backend SQLite database")
    parser.add_argument("--catalog", choices=["mag4", "tycho2", "all"], default="all")
    parser.add_argument("--db", default="backend/data/catalogs.sqlite3", help="Output SQLite DB path")
    args = parser.parse_args()

    db_path = Path(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    repo = CatalogRepository(str(db_path))
    repo.init_db()

    catalogs = ["mag4", "tycho2"] if args.catalog == "all" else [args.catalog]

    for catalog in catalogs:
        in_path = DEFAULT_INPUTS[catalog]
        if not in_path.exists():
            print(f"[skip] {catalog}: file not found: {in_path}")
            continue
        result = repo.import_stars_from_json(catalog, str(in_path))
        print(f"[ok] imported {result['rows']} rows for {catalog}")

    print(f"[ok] total rows in DB: {repo.count_stars()}")
    for catalog in ["mag4", "tycho2"]:
        print(f"      {catalog}: {repo.count_stars(catalog)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
