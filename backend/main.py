"""
SkyCMD Backend — FastAPI + WebSocket

Starten:
    uvicorn main:app --host 0.0.0.0 --port 8080 --reload
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
import asyncio
import json
import os
import math
from datetime import datetime, timezone
from typing import Any

from .small_bodies import SmallBodyRepository, SmallBodySyncService

from pymeeus.Epoch import Epoch
from pymeeus.Earth import Earth
from pymeeus.Mercury import Mercury
from pymeeus.Venus import Venus
from pymeeus.Mars import Mars
from pymeeus.Jupiter import Jupiter
from pymeeus.Saturn import Saturn
from pymeeus.Uranus import Uranus
from pymeeus.Neptune import Neptune
from pymeeus.Sun import Sun
from pymeeus.Moon import Moon
from skyfield.api import load_constellation_map, position_from_radec

app = FastAPI(title="SkyCMD API", version="0.1.0")

small_body_repo = SmallBodyRepository()
small_body_sync = SmallBodySyncService(
    small_body_repo,
    interval_seconds=int(os.getenv("MPC_SYNC_INTERVAL_SECONDS", 24 * 60 * 60)),
)
constellation_map = load_constellation_map()

PLANET_MODELS = {
    "mercury": ("Merkur", Mercury),
    "venus": ("Venus", Venus),
    "mars": ("Mars", Mars),
    "jupiter": ("Jupiter", Jupiter),
    "saturn": ("Saturn", Saturn),
    "uranus": ("Uranus", Uranus),
    "neptune": ("Neptun", Neptune),
}

GAUSSIAN_K = 0.01720209895  # AU^(3/2) / day
OBLIQUITY_DEG = 23.439291111

# Frontend statisch ausliefern
#
# Hinweis: Der Pfad wird absolut ausgehend vom Speicherort dieser Datei (main.py) aufgelöst.
# Dadurch funktioniert das Mounten unabhängig vom aktuellen Arbeitsverzeichnis.
frontend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend"))
app.mount("/app", StaticFiles(directory=frontend_path, html=True), name="frontend")
data_catalogs_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../data/catalogs"))
app.mount("/data/catalogs", StaticFiles(directory=data_catalogs_path, html=False), name="catalogs")


# ── REST Endpoints ────────────────────────────────────────────────

@app.get("/")
async def root_redirect():
    return RedirectResponse(url="/app", status_code=307)


@app.get("/favicon.ico")
async def favicon_redirect():
    return RedirectResponse(url="/app/", status_code=307)

@app.get("/api/status")
async def get_status():
    """Backend-Status und Daten-Feed-Informationen."""
    all_sync_states = small_body_repo.get_sync_state()
    sync_map = {item["feed"]: item for item in all_sync_states}
    
    feeds = []
    
    # Kometen
    comet_count = small_body_repo.get_table_count("comets")
    comet_sync = sync_map.get("comets")
    feeds.append({
        "feed": "Kometen",
        "count": comet_count,
        "last_success_utc": comet_sync["lastSuccessUtc"] if comet_sync else None,
    })
    
    # Asteroiden (kombinieren von daily und full)
    asteroid_count = small_body_repo.get_table_count("asteroids")
    asteroid_sync_daily = sync_map.get("asteroids_daily")
    asteroid_sync_full = sync_map.get("asteroids_full")
    asteroid_sync = asteroid_sync_daily or asteroid_sync_full
    feeds.append({
        "feed": "Asteroiden",
        "count": asteroid_count,
        "last_success_utc": asteroid_sync["lastSuccessUtc"] if asteroid_sync else None,
    })
    
    # Satelliten (TLE)
    satellite_count = small_body_repo.get_table_count("satellites_tle")
    satellite_sync = sync_map.get("satellites_tle")
    feeds.append({
        "feed": "Satelliten (TLE)",
        "count": satellite_count,
        "last_success_utc": satellite_sync["lastSuccessUtc"] if satellite_sync else None,
    })
    
    return {
        "version": "0.1.0",
        "feeds": feeds,
    }


@app.on_event("startup")
async def startup_small_body_sync():
    small_body_repo.init_db()
    small_body_repo.load_persisted_feed_config()
    small_body_sync.start(asyncio.get_running_loop())


@app.on_event("shutdown")
async def shutdown_small_body_sync():
    await small_body_sync.stop()


@app.get("/api/solar-system/comets")
async def get_comets(limit: int = 2000):
    return {
        "source": "mpc+sqlite-fallback",
        "count": small_body_repo.get_table_count("comets"),
        "items": small_body_repo.list_comets(limit=limit),
    }


@app.get("/api/solar-system/asteroids")
async def get_asteroids(limit: int = 5000):
    return {
        "source": "mpc+sqlite-fallback",
        "count": small_body_repo.get_table_count("asteroids"),
        "items": small_body_repo.list_asteroids(limit=limit),
    }


@app.get("/api/solar-system/satellites-tle")
async def get_satellites_tle(limit: int = 5000):
    return {
        "source": "tle-feed+sqlite-fallback",
        "note": "TLE-Daten werden aus der konfigurierten Feed-URL geladen und lokal zwischengespeichert.",
        "count": small_body_repo.get_table_count("satellites_tle"),
        "items": small_body_repo.list_satellites_tle(limit=limit),
    }


@app.get("/api/solar-system/sync-status")
async def get_small_body_sync_status():
    return {
        "intervalSeconds": small_body_sync.interval_seconds,
        "feeds": small_body_repo.get_sync_state(),
    }


@app.get("/api/solar-system/feed-config")
async def get_small_body_feed_config():
    return small_body_repo.get_feed_config()


@app.post("/api/solar-system/feed-config")
async def set_small_body_feed_config(payload: dict[str, Any] = Body(default={})):
    return small_body_repo.set_feed_config(payload)


@app.post("/api/solar-system/sync-now")
async def sync_small_bodies_now(feed: str | None = None, source_url: str | None = None):
    try:
        if feed:
            result = await small_body_sync.run_feed(feed, source_url=source_url)
            results = [result]
        else:
            results = await small_body_sync.run_once()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "status": "ok",
        "results": [r.__dict__ for r in results],
    }


@app.get("/api/solar-system/search")
async def search_solar_system_objects(
    q: str,
    limit: int = 20,
    datetime_iso: str | None = None,
    include_satellites: bool = False,
):
    query = str(q or "").strip()
    if not query:
        return {
            "query": "",
            "datetimeUtc": None,
            "frame": "geocentric_ra_dec_of_date",
            "items": [],
        }

    dt = _parse_iso_datetime(datetime_iso)
    jd = _jd_from_datetime(dt)
    epoch = _epoch_from_datetime(dt)
    earth_xyz = _earth_heliocentric_xyz(epoch)

    rows = small_body_repo.search_objects(
        query,
        limit=max(1, min(int(limit), 50)),
        include_satellites=bool(include_satellites),
    )
    items: list[dict[str, Any]] = []
    for row in rows:
        kind = str(row.get("kind") or "").strip().lower()
        item: dict[str, Any] = {
            "kind": kind,
            "id": row.get("id"),
            "label": row.get("name") or row.get("id"),
            "name": row.get("name"),
            "score": row.get("score", 0),
            "hasPosition": False,
        }
        payload = row.get("data") if isinstance(row.get("data"), dict) else {}

        if kind == "asteroid":
            pos = _compute_asteroid_position(payload, jd, earth_xyz)
            if pos:
                item.update(
                    {
                        "ra": pos.get("ra"),
                        "dec": pos.get("dec"),
                        "mag": pos.get("mag"),
                        "distanceAu": pos.get("distanceAu"),
                        "hasPosition": True,
                    }
                )
        elif kind == "comet":
            pos = _compute_comet_position(payload, jd, earth_xyz)
            if pos:
                item.update(
                    {
                        "ra": pos.get("ra"),
                        "dec": pos.get("dec"),
                        "mag": pos.get("mag"),
                        "distanceAu": pos.get("distanceAu"),
                        "hasPosition": True,
                    }
                )

        items.append(item)

    return {
        "query": query,
        "datetimeUtc": dt.isoformat().replace("+00:00", "Z"),
        "frame": "geocentric_ra_dec_of_date",
        "items": items,
    }


@app.post("/api/constellations/lookup")
async def lookup_constellations(payload: dict[str, Any] = Body(default={})):
    rows = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        rows = []

    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        item_id = row.get("id")
        ra = row.get("ra")
        dec = row.get("dec")
        if not isinstance(ra, (int, float)) or not isinstance(dec, (int, float)):
            out.append({"id": item_id, "constellation": None})
            continue
        try:
            pos = position_from_radec(ra_hours=float(ra), dec_degrees=float(dec))
            abbr = constellation_map(pos)
        except Exception:
            abbr = None
        out.append({"id": item_id, "constellation": abbr})

    return {
        "items": out,
        "reference": "IAU Delporte boundaries via Skyfield",
    }


def _parse_iso_datetime(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _epoch_from_datetime(dt: datetime) -> Epoch:
    second_fraction = dt.second + dt.microsecond / 1_000_000
    day_fraction = (dt.hour + dt.minute / 60 + second_fraction / 3600) / 24
    return Epoch(dt.year, dt.month, dt.day + day_fraction)


def _to_cartesian(lon_deg: float, lat_deg: float, radius: float) -> tuple[float, float, float]:
    lon = math.radians(lon_deg)
    lat = math.radians(lat_deg)
    cos_lat = math.cos(lat)
    return (
        radius * cos_lat * math.cos(lon),
        radius * cos_lat * math.sin(lon),
        radius * math.sin(lat),
    )


def _phase_angle_deg(r_planet: float, r_earth: float, delta_earth_planet: float) -> float:
    denom = max(2.0 * r_planet * delta_earth_planet, 1e-12)
    cos_i = (r_planet * r_planet + delta_earth_planet * delta_earth_planet - r_earth * r_earth) / denom
    cos_i = max(-1.0, min(1.0, cos_i))
    return math.degrees(math.acos(cos_i))


def _planet_magnitude(planet_id: str, model, sun_dist_au: float, earth_dist_au: float, phase_angle_deg: float) -> float | None:
    try:
        if planet_id in {"mercury", "venus", "mars"}:
            return float(model.magnitude(sun_dist_au, earth_dist_au, phase_angle_deg))
        if planet_id == "saturn":
            return float(model.magnitude(sun_dist_au, earth_dist_au, 0.0, 0.0))
        return float(model.magnitude(sun_dist_au, earth_dist_au))
    except Exception:
        return None


def _angular_separation_deg(ra1_hours: float, dec1_deg: float, ra2_hours: float, dec2_deg: float) -> float:
    ra1 = math.radians(ra1_hours * 15.0)
    ra2 = math.radians(ra2_hours * 15.0)
    dec1 = math.radians(dec1_deg)
    dec2 = math.radians(dec2_deg)
    cos_sep = (
        math.sin(dec1) * math.sin(dec2)
        + math.cos(dec1) * math.cos(dec2) * math.cos(ra1 - ra2)
    )
    cos_sep = max(-1.0, min(1.0, cos_sep))
    return math.degrees(math.acos(cos_sep))


def _jd_from_datetime(dt: datetime) -> float:
    dt_utc = dt.astimezone(timezone.utc)
    epoch = datetime(2000, 1, 1, 12, 0, tzinfo=timezone.utc)
    return 2451545.0 + (dt_utc - epoch).total_seconds() / 86400.0


def _jd_from_calendar_fraction(year: int, month: int, day_fraction: float) -> float:
    y = year
    m = month
    d = float(day_fraction)
    if m <= 2:
        y -= 1
        m += 12
    a = math.floor(y / 100)
    b = 2 - a + math.floor(a / 4)
    return (
        math.floor(365.25 * (y + 4716))
        + math.floor(30.6001 * (m + 1))
        + d
        + b
        - 1524.5
    )


def _normalize_angle_rad(v: float) -> float:
    twopi = 2.0 * math.pi
    x = v % twopi
    if x < 0:
        x += twopi
    return x


def _solve_kepler_elliptic(mean_anomaly_rad: float, e: float) -> float:
    m = (mean_anomaly_rad + math.pi) % (2 * math.pi) - math.pi
    e_anom = m if e < 0.8 else math.pi
    for _ in range(30):
        f = e_anom - e * math.sin(e_anom) - m
        fp = 1.0 - e * math.cos(e_anom)
        if abs(fp) < 1e-12:
            break
        delta = f / fp
        e_anom -= delta
        if abs(delta) < 1e-12:
            break
    return e_anom


def _solve_kepler_hyperbolic(mean_anomaly_rad: float, e: float) -> float:
    h = math.asinh(mean_anomaly_rad / max(e, 1.000001))
    for _ in range(40):
        sh = math.sinh(h)
        ch = math.cosh(h)
        f = e * sh - h - mean_anomaly_rad
        fp = e * ch - 1.0
        if abs(fp) < 1e-12:
            break
        delta = f / fp
        h -= delta
        if abs(delta) < 1e-12:
            break
    return h


def _solve_barker_parabolic(delta_t_days: float, q_au: float) -> float:
    if q_au <= 0:
        return 0.0
    w = 2.0 * GAUSSIAN_K * delta_t_days / (q_au ** 1.5)
    d = w
    for _ in range(40):
        f = d + (d ** 3) / 3.0 - w
        fp = 1.0 + d * d
        if abs(fp) < 1e-12:
            break
        delta = f / fp
        d -= delta
        if abs(delta) < 1e-12:
            break
    return d


def _orbital_to_ecliptic_xyz(r: float, nu_rad: float, arg_peri_deg: float, node_deg: float, inc_deg: float) -> tuple[float, float, float]:
    wv = math.radians(arg_peri_deg) + nu_rad
    om = math.radians(node_deg)
    inc = math.radians(inc_deg)
    cw = math.cos(wv)
    sw = math.sin(wv)
    co = math.cos(om)
    so = math.sin(om)
    ci = math.cos(inc)
    si = math.sin(inc)
    x = r * (co * cw - so * sw * ci)
    y = r * (so * cw + co * sw * ci)
    z = r * (sw * si)
    return x, y, z


def _ecliptic_to_equatorial(x: float, y: float, z: float) -> tuple[float, float, float]:
    eps = math.radians(OBLIQUITY_DEG)
    ce = math.cos(eps)
    se = math.sin(eps)
    xq = x
    yq = y * ce - z * se
    zq = y * se + z * ce
    return xq, yq, zq


def _xyz_to_radec(x: float, y: float, z: float) -> tuple[float, float, float]:
    r = math.sqrt(x * x + y * y + z * z)
    if r <= 0:
        return 0.0, 0.0, 0.0
    ra = math.atan2(y, x)
    if ra < 0:
        ra += 2 * math.pi
    dec = math.asin(max(-1.0, min(1.0, z / r)))
    return math.degrees(ra) / 15.0, math.degrees(dec), r


def _earth_heliocentric_xyz(epoch: Epoch) -> tuple[float, float, float]:
    earth_lon, earth_lat, earth_r = Earth.geometric_heliocentric_position(epoch)
    return _to_cartesian(float(earth_lon()), float(earth_lat()), float(earth_r))


def _compute_asteroid_position(row: dict[str, Any], jd: float, earth_xyz: tuple[float, float, float]) -> dict[str, Any] | None:
    try:
        a = float(row.get("a"))
        e = float(row.get("e"))
        inc = float(row.get("i"))
        node = float(row.get("Node"))
        peri = float(row.get("Peri"))
        epoch_jd = float(row.get("Epoch"))
        mean_anomaly_deg = float(row.get("M"))
    except Exception:
        return None

    if a <= 0 or e < 0 or e >= 1:
        return None

    n_rad_day = float(row.get("n", 0.0)) * math.pi / 180.0
    if n_rad_day <= 0:
        n_rad_day = GAUSSIAN_K / (a ** 1.5)

    m = math.radians(mean_anomaly_deg) + n_rad_day * (jd - epoch_jd)
    m = _normalize_angle_rad(m)
    e_anom = _solve_kepler_elliptic(m, e)
    cos_e = math.cos(e_anom)
    sin_e = math.sin(e_anom)
    r = a * (1.0 - e * cos_e)
    nu = math.atan2(math.sqrt(max(0.0, 1.0 - e * e)) * sin_e, cos_e - e)

    hx, hy, hz = _orbital_to_ecliptic_xyz(r, nu, peri, node, inc)
    gx = hx - earth_xyz[0]
    gy = hy - earth_xyz[1]
    gz = hz - earth_xyz[2]
    qx, qy, qz = _ecliptic_to_equatorial(gx, gy, gz)
    ra_h, dec_deg, delta = _xyz_to_radec(qx, qy, qz)

    h = row.get("H")
    mag = None
    if isinstance(h, (int, float)) and delta > 0 and r > 0:
        mag = float(h) + 5.0 * math.log10(r * delta)

    object_id = str(row.get("Number") or row.get("Principal_desig") or row.get("Name") or "asteroid").strip()
    name = str(row.get("Name") or row.get("Principal_desig") or object_id).strip()
    return {
        "id": f"asteroid:{object_id}",
        "name": name,
        "kind": "asteroid",
        "ra": ra_h,
        "dec": dec_deg,
        "distanceAu": delta,
        "heliocentricDistanceAu": r,
        "mag": mag,
        "source": "MPC Extended Orbit (daily)",
    }


def _compute_comet_position(row: dict[str, Any], jd: float, earth_xyz: tuple[float, float, float]) -> dict[str, Any] | None:
    try:
        q = float(row.get("Perihelion_dist"))
        e = float(row.get("e"))
        inc = float(row.get("i"))
        node = float(row.get("Node"))
        peri = float(row.get("Peri"))
        py = int(row.get("Year_of_perihelion"))
        pm = int(row.get("Month_of_perihelion"))
        pd = float(row.get("Day_of_perihelion"))
    except Exception:
        return None

    if q <= 0 or e < 0:
        return None

    # Filter out clearly non-current perihelion placeholders that explode numerically.
    if py < 1600 or py > 2600:
        return None

    tp_jd = _jd_from_calendar_fraction(py, pm, pd)
    delta_t = jd - tp_jd

    if e < 0.999999:
        a = q / (1.0 - e)
        n = GAUSSIAN_K / (a ** 1.5)
        m = n * delta_t
        e_anom = _solve_kepler_elliptic(m, e)
        cos_e = math.cos(e_anom)
        sin_e = math.sin(e_anom)
        r = a * (1.0 - e * cos_e)
        nu = math.atan2(math.sqrt(max(0.0, 1.0 - e * e)) * sin_e, cos_e - e)
    elif e > 1.000001:
        a = q / (e - 1.0)
        n = GAUSSIAN_K / (a ** 1.5)
        m = n * delta_t
        h_anom = _solve_kepler_hyperbolic(m, e)
        r = a * (e * math.cosh(h_anom) - 1.0)
        nu = 2.0 * math.atan(math.sqrt((e + 1.0) / (e - 1.0)) * math.tanh(h_anom / 2.0))
    else:
        d = _solve_barker_parabolic(delta_t, q)
        nu = 2.0 * math.atan(d)
        r = q * (1.0 + d * d)

    hx, hy, hz = _orbital_to_ecliptic_xyz(r, nu, peri, node, inc)
    gx = hx - earth_xyz[0]
    gy = hy - earth_xyz[1]
    gz = hz - earth_xyz[2]
    qx, qy, qz = _ecliptic_to_equatorial(gx, gy, gz)
    ra_h, dec_deg, delta = _xyz_to_radec(qx, qy, qz)

    h_param = row.get("H")
    g_param = row.get("G")
    mag = None
    if isinstance(h_param, (int, float)) and delta > 0 and r > 0:
        slope = float(g_param) if isinstance(g_param, (int, float)) else 10.0
        mag = float(h_param) + 5.0 * math.log10(delta) + slope * math.log10(r)

    name = str(row.get("Designation_and_name") or row.get("Provisional_packed_desig") or "Comet").strip()
    object_id = str(row.get("Provisional_packed_desig") or name or "comet").strip()
    return {
        "id": f"comet:{object_id}",
        "name": name,
        "kind": "comet",
        "ra": ra_h,
        "dec": dec_deg,
        "distanceAu": delta,
        "heliocentricDistanceAu": r,
        "mag": mag,
        "source": "MPC Comet Elements",
    }


def _select_asteroid_candidates(items: list[dict[str, Any]], max_count: int) -> list[dict[str, Any]]:
    enriched = []
    for item in items:
        data = item.get("data") or {}
        h = data.get("H")
        score = float(h) if isinstance(h, (int, float)) else 99.0
        enriched.append((score, data))
    enriched.sort(key=lambda x: x[0])
    return [row for _, row in enriched[:max_count]]


def _select_comet_candidates(items: list[dict[str, Any]], max_count: int, now_year: int) -> list[dict[str, Any]]:
    enriched = []
    for item in items:
        data = item.get("data") or {}
        py = data.get("Year_of_perihelion")
        if not isinstance(py, (int, float)):
            continue
        if py < now_year - 15 or py > now_year + 15:
            continue
        h = data.get("H")
        score = float(h) if isinstance(h, (int, float)) else 99.0
        enriched.append((score, data))
    enriched.sort(key=lambda x: x[0])
    return [row for _, row in enriched[:max_count]]


@app.get("/api/planets")
async def get_planets(datetime_iso: str | None = None):
    """Geozentrische Positionen fuer Planeten, Sonne und Mond."""
    dt = _parse_iso_datetime(datetime_iso)
    epoch = _epoch_from_datetime(dt)
    earth_lon, earth_lat, earth_radius_au = Earth.geometric_heliocentric_position(epoch)
    earth_xyz = _to_cartesian(float(earth_lon()), float(earth_lat()), float(earth_radius_au))

    planets = []
    for planet_id, (display_name, model) in PLANET_MODELS.items():
        ra, dec, elongation = model.geocentric_position(epoch)
        helio_lon, helio_lat, helio_radius_au = model.geometric_heliocentric_position(epoch)
        planet_xyz = _to_cartesian(float(helio_lon()), float(helio_lat()), float(helio_radius_au))
        dx = planet_xyz[0] - earth_xyz[0]
        dy = planet_xyz[1] - earth_xyz[1]
        dz = planet_xyz[2] - earth_xyz[2]
        earth_dist_au = math.sqrt(dx * dx + dy * dy + dz * dz)
        sun_dist_au = float(helio_radius_au)
        phase_angle_deg = _phase_angle_deg(sun_dist_au, float(earth_radius_au), earth_dist_au)
        magnitude = _planet_magnitude(planet_id, model, sun_dist_au, earth_dist_au, phase_angle_deg)

        planets.append(
            {
                "id": planet_id,
                "name": display_name,
                "kind": "planet",
                "ra": float(ra()) / 15.0,
                "dec": float(dec()),
                "elongationDeg": float(elongation()),
                "distanceAu": earth_dist_au,
                "heliocentricDistanceAu": sun_dist_au,
                "phaseAngleDeg": phase_angle_deg,
                "mag": magnitude,
                "source": "VSOP87 (Bretagnon & Francou, 1988)",
            }
        )

    sun_ra, sun_dec, sun_dist_au = Sun.apparent_rightascension_declination_coarse(epoch)
    sun_ra_hours = float(sun_ra()) / 15.0
    sun_dec_deg = float(sun_dec())
    planets.append(
        {
            "id": "sun",
            "name": "Sonne",
            "kind": "luminary",
            "ra": sun_ra_hours,
            "dec": sun_dec_deg,
            "distanceAu": float(sun_dist_au),
            "mag": -26.74,
            "source": "PyMeeus Sun apparent coordinates",
        }
    )

    moon_ra, moon_dec, moon_distance_km, _moon_parallax = Moon.apparent_equatorial_pos(epoch)
    moon_ra_hours = float(moon_ra()) / 15.0
    moon_dec_deg = float(moon_dec())
    elongation_moon_sun_deg = _angular_separation_deg(moon_ra_hours, moon_dec_deg, sun_ra_hours, sun_dec_deg)
    moon_phase_angle = abs(180.0 - elongation_moon_sun_deg)
    moon_mag = -12.73 + 0.026 * moon_phase_angle + 4e-9 * moon_phase_angle**4
    planets.append(
        {
            "id": "moon",
            "name": "Mond",
            "kind": "luminary",
            "ra": moon_ra_hours,
            "dec": moon_dec_deg,
            "distanceKm": float(moon_distance_km),
            "distanceAu": float(moon_distance_km) / 149597870.7,
            "elongationDeg": elongation_moon_sun_deg,
            "phaseAngleDeg": moon_phase_angle,
            "mag": moon_mag,
            "source": "PyMeeus Moon apparent equatorial position",
        }
    )

    return {
        "datetimeUtc": dt.isoformat().replace("+00:00", "Z"),
        "frame": "geocentric_ra_dec_of_date",
        "planets": planets,
    }


@app.get("/api/solar-system/positions")
async def get_solar_system_positions(
    datetime_iso: str | None = None,
    asteroid_limit: int = 400,
    comet_limit: int = 200,
    mag_limit: float = 18.0,
):
    dt = _parse_iso_datetime(datetime_iso)
    jd = _jd_from_datetime(dt)
    epoch = _epoch_from_datetime(dt)
    earth_xyz = _earth_heliocentric_xyz(epoch)

    asteroid_limit = max(0, min(int(asteroid_limit), 3000))
    comet_limit = max(0, min(int(comet_limit), 1200))

    asteroid_items = small_body_repo.list_asteroids(limit=max(asteroid_limit * 3, asteroid_limit))
    comet_items = small_body_repo.list_comets(limit=max(comet_limit * 3, comet_limit))

    asteroid_rows = _select_asteroid_candidates(asteroid_items, asteroid_limit)
    comet_rows = _select_comet_candidates(comet_items, comet_limit, dt.year)

    asteroids = []
    for row in asteroid_rows:
        pos = _compute_asteroid_position(row, jd, earth_xyz)
        if not pos:
            continue
        if isinstance(pos.get("mag"), (int, float)) and pos["mag"] > mag_limit:
            continue
        asteroids.append(pos)

    comets = []
    for row in comet_rows:
        pos = _compute_comet_position(row, jd, earth_xyz)
        if not pos:
            continue
        if isinstance(pos.get("mag"), (int, float)) and pos["mag"] > mag_limit:
            continue
        comets.append(pos)

    return {
        "datetimeUtc": dt.isoformat().replace("+00:00", "Z"),
        "frame": "geocentric_ra_dec_of_date",
        "asteroids": asteroids,
        "comets": comets,
        "counts": {
            "asteroids": len(asteroids),
            "comets": len(comets),
        },
    }


@app.post("/api/mount/goto")
async def mount_goto(ra: float, dec: float):
    """GoTo-Kommando an den Mount senden."""
    # TODO: HAL-Integration
    return {"status": "not_connected", "ra": ra, "dec": dec}


@app.get("/api/mount/position")
async def mount_position():
    """Aktuelle Mount-Position (RA/Dec)."""
    # TODO: HAL-Integration
    return {"ra": None, "dec": None, "connected": False}


# ── WebSocket ─────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)

    async def broadcast(self, data: dict):
        msg = json.dumps(data)
        for ws in self.active:
            try:
                await ws.send_text(msg)
            except Exception:
                pass


manager = ConnectionManager()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Echtzeit Mount-Position senden (10 Hz)
            await asyncio.sleep(0.1)
            # TODO: echte Position aus HAL
            await manager.broadcast({"type": "mount_position", "ra": None, "dec": None})
    except WebSocketDisconnect:
        manager.disconnect(websocket)
