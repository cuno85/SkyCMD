import gzip
import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen

DEFAULT_COMETS_URL = "https://www.minorplanetcenter.net/Extended_Files/allcometels.json.gz"
DEFAULT_ASTEROIDS_DAILY_URL = "https://www.minorplanetcenter.net/Extended_Files/daily_extended.json.gz"
DEFAULT_ASTEROIDS_FULL_URL = "https://www.minorplanetcenter.net/Extended_Files/mpcorb_extended.json.gz"
DEFAULT_TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle"
DEFAULT_SYNC_INTERVAL_SECONDS = 24 * 60 * 60


@dataclass
class FeedSyncResult:
    feed: str
    url: str
    status: str
    message: str
    inserted: int = 0
    updated: int = 0
    total_rows: int = 0


class SmallBodyRepository:
    def __init__(self, db_path: str | None = None):
        base = os.path.dirname(__file__)
        data_dir = os.path.join(base, "data")
        os.makedirs(data_dir, exist_ok=True)
        self.db_path = db_path or os.path.join(data_dir, "solar_system_objects.sqlite3")

        self.comets_url = os.getenv("MPC_COMETS_URL", DEFAULT_COMETS_URL)
        self.asteroids_daily_url = os.getenv("MPC_ASTEROIDS_DAILY_URL", DEFAULT_ASTEROIDS_DAILY_URL)
        self.asteroids_full_url = os.getenv("MPC_ASTEROIDS_FULL_URL", DEFAULT_ASTEROIDS_FULL_URL)
        self.tle_url = os.getenv("MPC_TLE_URL", DEFAULT_TLE_URL)
        self.bootstrap_full_asteroids = os.getenv("MPC_BOOTSTRAP_FULL", "0").strip().lower() in {"1", "true", "yes"}

    def get_feed_config(self) -> dict[str, Any]:
        return {
            "cometsUrl": self.comets_url,
            "asteroidsDailyUrl": self.asteroids_daily_url,
            "asteroidsFullUrl": self.asteroids_full_url,
            "tleUrl": self.tle_url,
            "bootstrapFullAsteroids": self.bootstrap_full_asteroids,
        }

    def set_feed_config(self, payload: dict[str, Any], persist: bool = True) -> dict[str, Any]:
        if not isinstance(payload, dict):
            return self.get_feed_config()
        if isinstance(payload.get("cometsUrl"), str) and payload["cometsUrl"].strip():
            self.comets_url = payload["cometsUrl"].strip()
        if isinstance(payload.get("asteroidsDailyUrl"), str) and payload["asteroidsDailyUrl"].strip():
            self.asteroids_daily_url = payload["asteroidsDailyUrl"].strip()
        if isinstance(payload.get("asteroidsFullUrl"), str) and payload["asteroidsFullUrl"].strip():
            self.asteroids_full_url = payload["asteroidsFullUrl"].strip()
        if isinstance(payload.get("tleUrl"), str):
            self.tle_url = payload["tleUrl"].strip()
        if "bootstrapFullAsteroids" in payload:
            self.bootstrap_full_asteroids = bool(payload.get("bootstrapFullAsteroids"))
        config = self.get_feed_config()
        if persist:
            self.init_db()
            self._set_setting("feed_config", config)
        return config

    def load_persisted_feed_config(self) -> dict[str, Any]:
        self.init_db()
        cfg = self._get_setting("feed_config")
        if isinstance(cfg, dict):
            self.set_feed_config(cfg, persist=False)
        return self.get_feed_config()

    def init_db(self) -> None:
        with sqlite3.connect(self.db_path) as con:
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS comets (
                    object_id TEXT PRIMARY KEY,
                    display_name TEXT,
                    source_url TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    first_seen_utc TEXT NOT NULL,
                    updated_utc TEXT NOT NULL
                )
                """
            )
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS asteroids (
                    object_id TEXT PRIMARY KEY,
                    display_name TEXT,
                    source_url TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    first_seen_utc TEXT NOT NULL,
                    updated_utc TEXT NOT NULL
                )
                """
            )
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS satellites_tle (
                    object_id TEXT PRIMARY KEY,
                    display_name TEXT,
                    source_url TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    first_seen_utc TEXT NOT NULL,
                    updated_utc TEXT NOT NULL
                )
                """
            )
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS sync_state (
                    feed TEXT PRIMARY KEY,
                    source_url TEXT NOT NULL,
                    last_attempt_utc TEXT,
                    last_success_utc TEXT,
                    status TEXT,
                    message TEXT,
                    inserted INTEGER NOT NULL DEFAULT 0,
                    updated INTEGER NOT NULL DEFAULT 0,
                    total_rows INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_utc TEXT NOT NULL
                )
                """
            )

    def _get_setting(self, key: str) -> Any:
        with sqlite3.connect(self.db_path) as con:
            row = con.execute(
                "SELECT value_json FROM app_settings WHERE key = ?",
                (key,),
            ).fetchone()
        if not row:
            return None
        try:
            return json.loads(row[0])
        except Exception:
            return None

    def _set_setting(self, key: str, value: Any) -> None:
        now_utc = _utc_now_iso()
        payload = json.dumps(value, ensure_ascii=True, separators=(",", ":"))
        with sqlite3.connect(self.db_path) as con:
            con.execute(
                """
                INSERT INTO app_settings (key, value_json, updated_utc)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value_json = excluded.value_json,
                    updated_utc = excluded.updated_utc
                """,
                (key, payload, now_utc),
            )

    def get_table_count(self, table: str) -> int:
        with sqlite3.connect(self.db_path) as con:
            row = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
            return int(row[0] if row else 0)

    def list_comets(self, limit: int = 2000) -> list[dict[str, Any]]:
        return self._list_table("comets", limit)

    def list_asteroids(self, limit: int = 5000) -> list[dict[str, Any]]:
        return self._list_table("asteroids", limit)

    def list_satellites_tle(self, limit: int = 5000) -> list[dict[str, Any]]:
        return self._list_table("satellites_tle", limit)

    def search_objects(self, query: str, limit: int = 20, include_satellites: bool = False) -> list[dict[str, Any]]:
        q = str(query or "").strip().lower()
        if not q:
            return []
        max_limit = max(1, min(int(limit), 200))
        q_exact = q
        q_prefix = f"{q}%"
        q_like = f"%{q}%"

        sql_parts = [
            """
            SELECT
                'comet' AS kind,
                object_id,
                COALESCE(display_name, object_id) AS label,
                payload_json,
                updated_utc,
                CASE
                    WHEN lower(COALESCE(display_name, '')) = ? OR lower(object_id) = ? THEN 100
                    WHEN lower(COALESCE(display_name, '')) LIKE ? OR lower(object_id) LIKE ? THEN 70
                    ELSE 40
                END AS score
            FROM comets
            WHERE lower(COALESCE(display_name, '')) LIKE ? OR lower(object_id) LIKE ?
            """,
            """
            SELECT
                'asteroid' AS kind,
                object_id,
                COALESCE(display_name, object_id) AS label,
                payload_json,
                updated_utc,
                CASE
                    WHEN lower(COALESCE(display_name, '')) = ? OR lower(object_id) = ? THEN 100
                    WHEN lower(COALESCE(display_name, '')) LIKE ? OR lower(object_id) LIKE ? THEN 70
                    ELSE 40
                END AS score
            FROM asteroids
            WHERE lower(COALESCE(display_name, '')) LIKE ? OR lower(object_id) LIKE ?
            """,
        ]
        params: list[Any] = [
            q_exact,
            q_exact,
            q_prefix,
            q_prefix,
            q_like,
            q_like,
            q_exact,
            q_exact,
            q_prefix,
            q_prefix,
            q_like,
            q_like,
        ]

        if include_satellites:
            sql_parts.append(
                """
                SELECT
                    'satellite' AS kind,
                    object_id,
                    COALESCE(display_name, object_id) AS label,
                    payload_json,
                    updated_utc,
                    CASE
                        WHEN lower(COALESCE(display_name, '')) = ? OR lower(object_id) = ? THEN 100
                        WHEN lower(COALESCE(display_name, '')) LIKE ? OR lower(object_id) LIKE ? THEN 70
                        ELSE 40
                    END AS score
                FROM satellites_tle
                WHERE lower(COALESCE(display_name, '')) LIKE ? OR lower(object_id) LIKE ?
                """
            )
            params.extend([q_exact, q_exact, q_prefix, q_prefix, q_like, q_like])

        sql = "\nUNION ALL\n".join(sql_parts) + "\nORDER BY score DESC, updated_utc DESC\nLIMIT ?"
        params.append(max_limit)

        with sqlite3.connect(self.db_path) as con:
            rows = con.execute(sql, tuple(params)).fetchall()

        out: list[dict[str, Any]] = []
        for row in rows:
            payload = json.loads(row[3]) if row[3] else {}
            out.append(
                {
                    "kind": row[0],
                    "id": row[1],
                    "name": row[2],
                    "score": int(row[5] if row[5] is not None else 0),
                    "updatedUtc": row[4],
                    "data": payload,
                }
            )
        return out

    def _list_table(self, table: str, limit: int) -> list[dict[str, Any]]:
        max_limit = max(1, min(int(limit), 20000))
        with sqlite3.connect(self.db_path) as con:
            rows = con.execute(
                f"""
                SELECT object_id, display_name, payload_json, source_url, first_seen_utc, updated_utc
                FROM {table}
                ORDER BY updated_utc DESC
                LIMIT ?
                """,
                (max_limit,),
            ).fetchall()
        out: list[dict[str, Any]] = []
        for row in rows:
            payload = json.loads(row[2])
            out.append(
                {
                    "id": row[0],
                    "name": row[1],
                    "sourceUrl": row[3],
                    "firstSeenUtc": row[4],
                    "updatedUtc": row[5],
                    "data": payload,
                }
            )
        return out

    def get_sync_state(self) -> list[dict[str, Any]]:
        with sqlite3.connect(self.db_path) as con:
            rows = con.execute(
                """
                SELECT feed, source_url, last_attempt_utc, last_success_utc, status, message, inserted, updated, total_rows
                FROM sync_state
                ORDER BY feed ASC
                """
            ).fetchall()
        return [
            {
                "feed": r[0],
                "sourceUrl": r[1],
                "lastAttemptUtc": r[2],
                "lastSuccessUtc": r[3],
                "status": r[4],
                "message": r[5],
                "inserted": r[6],
                "updated": r[7],
                "totalRows": r[8],
            }
            for r in rows
        ]

    def sync_from_mpc(self) -> list[FeedSyncResult]:
        self.init_db()
        results: list[FeedSyncResult] = []

        # Comets: full list is small enough for regular sync.
        results.append(self._sync_feed_comets(self.comets_url))

        # Asteroids: run daily feed every sync. If DB is empty, additionally bootstrap full catalog.
        asteroid_daily = self._sync_feed_asteroids(self.asteroids_daily_url, feed_name="asteroids_daily")
        results.append(asteroid_daily)

        if self.bootstrap_full_asteroids and self.get_table_count("asteroids") == 0:
            results.append(self._sync_feed_asteroids(self.asteroids_full_url, feed_name="asteroids_full"))

        if self.tle_url:
            results.append(self._sync_feed_satellites_tle(self.tle_url))

        return results

    def sync_feed(self, feed: str, source_url: str | None = None) -> FeedSyncResult:
        self.init_db()
        key = str(feed or "").strip().lower()
        if key == "comets":
            return self._sync_feed_comets(source_url or self.comets_url)
        if key in {"asteroids", "asteroids_daily"}:
            return self._sync_feed_asteroids(source_url or self.asteroids_daily_url, feed_name="asteroids_daily")
        if key == "asteroids_full":
            return self._sync_feed_asteroids(source_url or self.asteroids_full_url, feed_name="asteroids_full")
        if key in {"tle", "satellites", "satellites_tle"}:
            target_url = source_url or self.tle_url
            if not target_url:
                raise ValueError("TLE feed URL ist nicht konfiguriert")
            return self._sync_feed_satellites_tle(target_url)
        raise ValueError(f"Unbekannter Feed: {feed}")

    def _sync_feed_comets(self, url: str) -> FeedSyncResult:
        feed = "comets"
        attempted_at = _utc_now_iso()
        try:
            payload = _fetch_json_payload(url)
            if not isinstance(payload, list):
                raise ValueError("Unexpected comet payload format")
            inserted, updated = self._upsert_rows(
                table="comets",
                source_url=url,
                rows=payload,
                id_factory=_comet_object_id,
                name_factory=_comet_display_name,
            )
            result = FeedSyncResult(
                feed=feed,
                url=url,
                status="ok",
                message="Comet sync finished",
                inserted=inserted,
                updated=updated,
                total_rows=len(payload),
            )
            self._save_sync_state(result, attempted_at, success=True)
            return result
        except (HTTPError, URLError, TimeoutError, ValueError, OSError, json.JSONDecodeError) as exc:
            result = FeedSyncResult(feed=feed, url=url, status="error", message=str(exc))
            self._save_sync_state(result, attempted_at, success=False)
            return result

    def _sync_feed_asteroids(self, url: str, feed_name: str) -> FeedSyncResult:
        attempted_at = _utc_now_iso()
        try:
            payload = _fetch_json_payload(url)
            if not isinstance(payload, list):
                raise ValueError("Unexpected asteroid payload format")
            inserted, updated = self._upsert_rows(
                table="asteroids",
                source_url=url,
                rows=payload,
                id_factory=_asteroid_object_id,
                name_factory=_asteroid_display_name,
            )
            result = FeedSyncResult(
                feed=feed_name,
                url=url,
                status="ok",
                message="Asteroid sync finished",
                inserted=inserted,
                updated=updated,
                total_rows=len(payload),
            )
            self._save_sync_state(result, attempted_at, success=True)
            return result
        except (HTTPError, URLError, TimeoutError, ValueError, OSError, json.JSONDecodeError) as exc:
            result = FeedSyncResult(feed=feed_name, url=url, status="error", message=str(exc))
            self._save_sync_state(result, attempted_at, success=False)
            return result

    def _sync_feed_satellites_tle(self, url: str) -> FeedSyncResult:
        feed = "satellites_tle"
        attempted_at = _utc_now_iso()
        try:
            rows = _fetch_tle_payload(url)
            inserted, updated = self._upsert_rows(
                table="satellites_tle",
                source_url=url,
                rows=rows,
                id_factory=_tle_object_id,
                name_factory=_tle_display_name,
            )
            result = FeedSyncResult(
                feed=feed,
                url=url,
                status="ok",
                message="TLE sync finished",
                inserted=inserted,
                updated=updated,
                total_rows=len(rows),
            )
            self._save_sync_state(result, attempted_at, success=True)
            return result
        except (HTTPError, URLError, TimeoutError, ValueError, OSError, json.JSONDecodeError) as exc:
            result = FeedSyncResult(feed=feed, url=url, status="error", message=str(exc))
            self._save_sync_state(result, attempted_at, success=False)
            return result

    def _upsert_rows(
        self,
        table: str,
        source_url: str,
        rows: list[dict[str, Any]],
        id_factory,
        name_factory,
    ) -> tuple[int, int]:
        inserted = 0
        updated = 0
        now_utc = _utc_now_iso()

        with sqlite3.connect(self.db_path) as con:
            for row in rows:
                object_id = id_factory(row)
                if not object_id:
                    continue
                display_name = name_factory(row)
                payload_json = json.dumps(row, ensure_ascii=True, separators=(",", ":"))
                existing = con.execute(
                    f"SELECT payload_json FROM {table} WHERE object_id = ?",
                    (object_id,),
                ).fetchone()

                if existing is None:
                    con.execute(
                        f"""
                        INSERT INTO {table} (object_id, display_name, source_url, payload_json, first_seen_utc, updated_utc)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (object_id, display_name, source_url, payload_json, now_utc, now_utc),
                    )
                    inserted += 1
                elif existing[0] != payload_json:
                    con.execute(
                        f"""
                        UPDATE {table}
                        SET display_name = ?, source_url = ?, payload_json = ?, updated_utc = ?
                        WHERE object_id = ?
                        """,
                        (display_name, source_url, payload_json, now_utc, object_id),
                    )
                    updated += 1
        return inserted, updated

    def _save_sync_state(self, result: FeedSyncResult, attempted_at: str, success: bool) -> None:
        with sqlite3.connect(self.db_path) as con:
            current_success = con.execute(
                "SELECT last_success_utc FROM sync_state WHERE feed = ?",
                (result.feed,),
            ).fetchone()
            last_success = attempted_at if success else (current_success[0] if current_success else None)
            con.execute(
                """
                INSERT INTO sync_state (
                    feed, source_url, last_attempt_utc, last_success_utc, status, message, inserted, updated, total_rows
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(feed) DO UPDATE SET
                    source_url = excluded.source_url,
                    last_attempt_utc = excluded.last_attempt_utc,
                    last_success_utc = excluded.last_success_utc,
                    status = excluded.status,
                    message = excluded.message,
                    inserted = excluded.inserted,
                    updated = excluded.updated,
                    total_rows = excluded.total_rows
                """,
                (
                    result.feed,
                    result.url,
                    attempted_at,
                    last_success,
                    result.status,
                    result.message,
                    result.inserted,
                    result.updated,
                    result.total_rows,
                ),
            )


class SmallBodySyncService:
    def __init__(self, repo: SmallBodyRepository, interval_seconds: int = DEFAULT_SYNC_INTERVAL_SECONDS):
        self.repo = repo
        self.interval_seconds = int(interval_seconds)
        self._task = None
        self._running = False

    def start(self, loop) -> None:
        if self._task is not None:
            return
        self._running = True
        self._task = loop.create_task(self._run())

    async def stop(self) -> None:
        import asyncio

        self._running = False
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        except Exception:
            pass
        self._task = None

    async def run_once(self) -> list[FeedSyncResult]:
        return await _run_blocking(self.repo.sync_from_mpc)

    async def run_feed(self, feed: str, source_url: str | None = None) -> FeedSyncResult:
        return await _run_blocking(lambda: self.repo.sync_feed(feed, source_url=source_url))

    async def _run(self) -> None:
        while self._running:
            try:
                await self.run_once()
            except Exception:
                # Keep service alive and rely on persisted status for diagnostics.
                pass
            # Fixed cadence: every 24h by default.
            await _sleep_no_throw(self.interval_seconds)


async def _run_blocking(fn):
    import asyncio

    return await asyncio.to_thread(fn)


async def _sleep_no_throw(seconds: int) -> None:
    import asyncio

    try:
        await asyncio.sleep(max(1, int(seconds)))
    except Exception:
        pass


def _fetch_json_payload(url: str) -> Any:
    req = Request(url, headers={"User-Agent": "SkyCMD/0.1.1 (+https://localhost)"})
    with urlopen(req, timeout=120) as res:
        raw = res.read()

    if url.lower().endswith(".gz"):
        decoded = gzip.decompress(raw).decode("utf-8")
    else:
        decoded = raw.decode("utf-8")
    return json.loads(decoded)


def _fetch_tle_payload(url: str) -> list[dict[str, Any]]:
    req = Request(url, headers={"User-Agent": "SkyCMD/0.1.1 (+https://localhost)"})
    with urlopen(req, timeout=120) as res:
        text = res.read().decode("utf-8", "ignore")

    lines = [ln.rstrip("\r") for ln in text.splitlines() if ln.strip()]
    rows: list[dict[str, Any]] = []
    i = 0
    while i < len(lines):
        if i + 2 < len(lines) and lines[i + 1].startswith("1 ") and lines[i + 2].startswith("2 "):
            name = lines[i].strip()
            line1 = lines[i + 1].strip()
            line2 = lines[i + 2].strip()
            satnum = line1[2:7].strip() if len(line1) >= 7 else ""
            rows.append(
                {
                    "name": name,
                    "satnum": satnum,
                    "tle_line1": line1,
                    "tle_line2": line2,
                }
            )
            i += 3
            continue

        # 2-line format without explicit name; fallback to satnum as display name.
        if i + 1 < len(lines) and lines[i].startswith("1 ") and lines[i + 1].startswith("2 "):
            line1 = lines[i].strip()
            line2 = lines[i + 1].strip()
            satnum = line1[2:7].strip() if len(line1) >= 7 else ""
            rows.append(
                {
                    "name": satnum or "TLE Object",
                    "satnum": satnum,
                    "tle_line1": line1,
                    "tle_line2": line2,
                }
            )
            i += 2
            continue

        i += 1

    return rows


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _comet_object_id(row: dict[str, Any]) -> str | None:
    packed = str(row.get("Provisional_packed_desig") or "").strip()
    if packed:
        return f"comet:{packed}"
    name = str(row.get("Designation_and_name") or "").strip()
    if name:
        return f"comet:{name.lower()}"
    return None


def _comet_display_name(row: dict[str, Any]) -> str:
    name = str(row.get("Designation_and_name") or "").strip()
    if name:
        return name
    return str(row.get("Provisional_packed_desig") or "Unbenannter Komet")


def _asteroid_object_id(row: dict[str, Any]) -> str | None:
    number = str(row.get("Number") or "").strip()
    if number:
        return f"asteroid:number:{number}"
    principal = str(row.get("Principal_desig") or "").strip()
    if principal:
        return f"asteroid:desig:{principal}"
    name = str(row.get("Name") or "").strip()
    if name:
        return f"asteroid:name:{name.lower()}"
    return None


def _asteroid_display_name(row: dict[str, Any]) -> str:
    number = str(row.get("Number") or "").strip()
    name = str(row.get("Name") or "").strip()
    principal = str(row.get("Principal_desig") or "").strip()
    if number and name:
        return f"({number}) {name}"
    if name:
        return name
    if principal:
        return principal
    return "Unbenannter Asteroid"


def _tle_object_id(row: dict[str, Any]) -> str | None:
    satnum = str(row.get("satnum") or "").strip()
    if satnum:
        return f"tle:{satnum}"
    name = str(row.get("name") or "").strip()
    if name:
        return f"tle:{name.lower()}"
    return None


def _tle_display_name(row: dict[str, Any]) -> str:
    name = str(row.get("name") or "").strip()
    satnum = str(row.get("satnum") or "").strip()
    if name:
        return name
    if satnum:
        return f"NORAD {satnum}"
    return "Unbenannter Satellit"
