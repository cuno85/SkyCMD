# SkyCMD — Architektur

## Überblick

SkyCMD ist in zwei klar getrennte Schichten aufgeteilt:

1. **Frontend** — Läuft vollständig im Browser, plattformunabhängig
2. **Backend** — Python-Server, läuft lokal auf dem Observatoriums-PC

Die Kommunikation erfolgt über:
- **REST API** — Einzel-Kommandos (GoTo, Belichtung starten etc.)
- **WebSocket** — Echtzeit-Daten (Mount-Position, Kamerastatus, Live-View)

---

## Frontend

### Rendering
- **Three.js** als WebGL-Abstraktionsschicht
- Sternenkarte als 2D-Overlay auf einem WebGL-Canvas
- Separate SVG-Schicht für UI-Elemente (Labels, Hover-Popups)

### Koordinatensysteme
- Intern: **Äquatorial (J2000)** — RA/Dec
- Projektion: **Azimutale äquidistante** (Standard), Equatorial, Galaktisch
- Transformation: Equatorial → Horizontal über GMST + ΔT (Espenak & Meeus)

### Modul-Struktur
Siehe `README.md` → Projektstruktur.

---

## Backend

### Ephemeriden und Sichtbarkeit

- Die astronomischen Basispositionen (RA/Dec für Planeten, Sonne, Mond) werden **im Backend** berechnet.
- Quelle in der Implementierung: REST-Endpunkt `/api/planets` in `backend/main.py`.
- Das Backend liefert aktuell den Frame `geocentric_ra_dec_of_date`.
- Das Frontend übernimmt diese RA/Dec-Werte und rechnet sie mit Beobachter-Breite/Länge + Zeit in Alt/Az um.
- Damit ist die Darstellung standortabhängig (lokale Horizontalprojektion), während die Ephemeriden-Quelle zentral serverseitig bleibt.
- Topozentrische Parallaxenkorrektur wird im Frontend auf Projektionsebene angewendet, sofern Distanzdaten verfügbar sind (`distanceAu` oder `distanceKm`).
- Diese Korrektur greift generisch für Sonnensystem-Objekte (`planet`, `luminary`, `comet`, `asteroid`, `satellite`, `tle`) und ist damit auch für zukünftige Objektquellen vorbereitet.
- Ergebnis: Geozentrische Ephemeriden aus dem Backend + topozentrische Beobachterkorrektur im Frontend.

### Kleine Körper (MPC/TLE) — Import, Datenbank, Fallback

- Kometen und Asteroiden werden über MPC-Datenfeeds importiert und in einer lokalen SQLite-Datenbank abgelegt (`backend/data/solar_system_objects.sqlite3`).
- Standardfeeds:
    - Kometen: `allcometels.json.gz`
    - Asteroiden (inkrementell): `daily_extended.json.gz`
- Optionaler Vollbootstrap für Asteroiden ist per `MPC_BOOTSTRAP_FULL=1` aktivierbar (`mpcorb_extended.json.gz`).
- TLE-Satelliten werden über eine konfigurierbare Feed-URL importiert (`MPC_TLE_URL`) und ebenfalls lokal gespeichert.
- Fallback-Verhalten: Falls externe Feeds temporär nicht erreichbar sind, liefert das Backend weiter die zuletzt erfolgreich gespeicherten Daten aus SQLite.
- Synchronisation läuft automatisch alle 24h (konfigurierbar über `MPC_SYNC_INTERVAL_SECONDS`) und fügt neue Objekte per Upsert in die Datenbank ein.

### Hardware Abstraction Layer (HAL)

```
Abstraktes Interface (base.py)
    │
    ├── ASCOM-Implementierung (Windows)
    │       └── Win32COM → ASCOM Treiber
    │
    └── INDI-Implementierung (Linux)
            └── PyIndi → INDI Server → Treiber
```

### Mount-Interface (abstrakt)
```python
class MountBase:
    def connect(host, port) -> bool
    def disconnect()
    def goto(ra: float, dec: float)  # J2000, Stunden/Grad
    def sync(ra: float, dec: float)
    def get_position() -> (ra, dec)
    def set_tracking(enabled: bool)
    def park()
    def unpark()
    def is_slewing() -> bool
```

### Camera-Interface (abstrakt)
```python
class CameraBase:
    def connect() -> bool
    def disconnect()
    def expose(duration: float, gain: int) -> Image
    def abort()
    def get_temperature() -> float
    def set_temperature(target: float)
    def set_binning(x: int, y: int)
    def get_status() -> dict
```

---

## Datenfluss GoTo

```
User klickt Objekt auf Karte
    → frontend/observatory/goto.js
    → POST /api/mount/goto {ra, dec}
    → backend/hal/mount.goto(ra, dec)
    → ASCOM/INDI Treiber
    → Teleskop bewegt sich
    → WebSocket sendet Position-Updates
    → Fadenkreuz auf Karte bewegt sich live
```

---

## Datenfluss Live-View

```
Kamera nimmt Bild
    → backend/imaging/capture.py
    → JPEG-Komprimierung
    → WebSocket binary frame
    → frontend/observatory/liveview.js
    → Canvas-Overlay über Sternenkarte
```
