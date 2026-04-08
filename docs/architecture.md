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
