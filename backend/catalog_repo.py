import json
import os
import sqlite3
from typing import Any


class CatalogRepository:
    def __init__(self, db_path: str | None = None):
        base = os.path.dirname(__file__)
        data_dir = os.path.join(base, "data")
        os.makedirs(data_dir, exist_ok=True)
        self.db_path = db_path or os.path.join(data_dir, "catalogs.sqlite3")

    def init_db(self) -> None:
        with sqlite3.connect(self.db_path) as con:
            existing = con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='stars'"
            ).fetchone()
            if existing:
                cols = [row[1] for row in con.execute("PRAGMA table_info(stars)").fetchall()]
                # Legacy schema used (catalog, star_id) PK and could collapse duplicates.
                if "id" not in cols:
                    con.execute("ALTER TABLE stars RENAME TO stars_legacy")
                    con.execute(
                        """
                        CREATE TABLE stars (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            catalog TEXT NOT NULL,
                            star_id TEXT NOT NULL,
                            name TEXT,
                            ra REAL NOT NULL,
                            dec REAL NOT NULL,
                            mag REAL,
                            bv REAL,
                            star_type TEXT
                        )
                        """
                    )
                    con.execute(
                        """
                        INSERT INTO stars (catalog, star_id, name, ra, dec, mag, bv, star_type)
                        SELECT catalog, star_id, name, ra, dec, mag, bv, star_type
                        FROM stars_legacy
                        """
                    )
                    con.execute("DROP TABLE stars_legacy")

            con.execute(
                """
                CREATE TABLE IF NOT EXISTS stars (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    catalog TEXT NOT NULL,
                    star_id TEXT NOT NULL,
                    name TEXT,
                    ra REAL NOT NULL,
                    dec REAL NOT NULL,
                    mag REAL,
                    bv REAL,
                    star_type TEXT
                )
                """
            )
            con.execute("CREATE INDEX IF NOT EXISTS idx_stars_catalog_mag ON stars(catalog, mag)")
            con.execute("CREATE INDEX IF NOT EXISTS idx_stars_catalog_ra ON stars(catalog, ra)")
            con.execute("CREATE INDEX IF NOT EXISTS idx_stars_catalog_dec ON stars(catalog, dec)")

    def import_stars_from_json(self, catalog: str, json_path: str, batch_size: int = 10000) -> dict[str, int]:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            raise ValueError(f"Catalog JSON must be a list: {json_path}")

        inserted = 0
        with sqlite3.connect(self.db_path) as con:
            con.execute("BEGIN")
            con.execute("DELETE FROM stars WHERE catalog = ?", (catalog,))
            batch: list[tuple[Any, ...]] = []

            for row in data:
                if not isinstance(row, dict):
                    continue
                ra = row.get("ra")
                dec = row.get("dec")
                if not isinstance(ra, (int, float)) or not isinstance(dec, (int, float)):
                    continue

                star_id = str(row.get("id") or row.get("name") or "").strip()
                if not star_id:
                    continue

                mag = row.get("mag")
                bv = row.get("bv")
                batch.append(
                    (
                        catalog,
                        star_id,
                        str(row.get("name") or star_id),
                        float(ra),
                        float(dec),
                        float(mag) if isinstance(mag, (int, float)) else None,
                        float(bv) if isinstance(bv, (int, float)) else None,
                        str(row.get("type") or "star"),
                    )
                )

                if len(batch) >= batch_size:
                    con.executemany(
                        """
                        INSERT INTO stars
                        (catalog, star_id, name, ra, dec, mag, bv, star_type)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        batch,
                    )
                    inserted += len(batch)
                    batch = []

            if batch:
                con.executemany(
                    """
                    INSERT INTO stars
                    (catalog, star_id, name, ra, dec, mag, bv, star_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    batch,
                )
                inserted += len(batch)

            con.commit()

        return {"catalog": catalog, "rows": inserted}

    def count_stars(self, catalog: str | None = None) -> int:
        with sqlite3.connect(self.db_path) as con:
            if catalog:
                row = con.execute("SELECT COUNT(*) FROM stars WHERE catalog = ?", (catalog,)).fetchone()
            else:
                row = con.execute("SELECT COUNT(*) FROM stars").fetchone()
        return int(row[0] if row else 0)

    def query_stars(
        self,
        *,
        catalog: str,
        mag_max: float | None = None,
        ra_min: float | None = None,
        ra_max: float | None = None,
        dec_min: float | None = None,
        dec_max: float | None = None,
        limit: int = 100000,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 2_000_000))
        safe_offset = max(0, int(offset))

        where_clauses = ["catalog = ?"]
        params: list[Any] = [catalog]

        if mag_max is not None:
            where_clauses.append("mag IS NOT NULL AND mag <= ?")
            params.append(float(mag_max))

        if dec_min is not None:
            where_clauses.append("dec >= ?")
            params.append(float(dec_min))

        if dec_max is not None:
            where_clauses.append("dec <= ?")
            params.append(float(dec_max))

        ra_clause = ""
        if ra_min is not None and ra_max is not None:
            ra_min_n = float(ra_min) % 24.0
            ra_max_n = float(ra_max) % 24.0
            if ra_min_n <= ra_max_n:
                ra_clause = "ra >= ? AND ra <= ?"
                params.extend([ra_min_n, ra_max_n])
            else:
                ra_clause = "(ra >= ? OR ra <= ?)"
                params.extend([ra_min_n, ra_max_n])

        where_sql = " AND ".join(where_clauses)
        if ra_clause:
            where_sql = f"{where_sql} AND {ra_clause}"

        sql = f"""
            SELECT star_id, name, ra, dec, mag, bv, star_type
            FROM stars
            WHERE {where_sql}
            ORDER BY mag ASC, star_id ASC
            LIMIT ? OFFSET ?
        """
        params.extend([safe_limit, safe_offset])

        with sqlite3.connect(self.db_path) as con:
            rows = con.execute(sql, params).fetchall()

        return [
            {
                "id": row[0],
                "name": row[1],
                "ra": row[2],
                "dec": row[3],
                "mag": row[4],
                "bv": row[5],
                "type": row[6] or "star",
            }
            for row in rows
        ]
