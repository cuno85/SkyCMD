# 🔭 SkyCMD

**Professional Planetarium & Observatory Control Software**

WebGL-basierte Sternkarte im Browser + vollständige Teleskop- und Kamerasteuerung über ein einheitliches Backend.

---

## 🎯 Vision

SkyCMD verbindet eine hochwertige, browserbasierte Planetariumssoftware mit professioneller Observatoriums-Hardware. Die Architektur trennt sauber zwischen:

- **Frontend** — WebGL Sternenkarte, GUI, Live-View (läuft im Browser, plattformunabhängig)
- **Backend** — Teleskop- & Kamerasteuerung via ASCOM (Windows) / INDI (Linux)

---

## 🏗 Architektur

```
┌──────────────────────────────────────────────┐
│              SkyCMD Frontend                 │
│         WebGL · GUI · Live-View              │
└───────────────────┬──────────────────────────┘
                    │ WebSocket + REST API
┌───────────────────▼──────────────────────────┐
│              SkyCMD Backend (FastAPI)         │
│  HAL · Sequencer · Image-Pipeline · API      │
└──────┬──────────────────────┬────────────────┘
       │                      │
┌──────▼──────┐      ┌────────▼────────┐
│  ASCOM      │      │   INDI          │
│  (Windows)  │      │   (Linux)       │
└──────┬──────┘      └────────┬────────┘
       │                      │
┌──────▼──────────────────────▼────────┐
│           HARDWARE                   │
│  Mounts: NexStar · EQ6-R · AZ5000   │
│  Cams:   Moravian · ASI · DMK · FLI  │
└──────────────────────────────────────┘
```

---

## 📁 Projektstruktur

```
SkyCMD/
├── frontend/                  # Browser-App (HTML + CSS + JS)
│   ├── index.html             # Einstiegspunkt
│   ├── css/
│   │   ├── layout.css         # Haupt-Layout (Flexbox/Grid)
│   │   ├── skymap.css         # Sternkarten-Canvas
│   │   ├── panels.css         # Info-Panels (Mond, Sonne, Planeten)
│   │   ├── controls.css       # Linke Steuerleiste
│   │   ├── legend.css         # Legende rechts
│   │   └── theme.css          # Farbschemata (CSS-Variablen)
│   └── src/
│       ├── skymap/
│       │   ├── renderer.js    # WebGL / Three.js Haupt-Renderer
│       │   ├── projection.js  # Koordinaten-Projektionen
│       │   ├── layers/
│       │   │   ├── stars.js
│       │   │   ├── dso.js
│       │   │   ├── planets.js
│       │   │   ├── milkyway.js
│       │   │   ├── constellations.js
│       │   │   └── overlays.js  # Ekliptik, Äquator, Meridian
│       │   └── interaction.js # Zoom, Pan, Hover, Click
│       ├── astronomy/
│       │   ├── ephemeris.js   # Planetenberechnungen
│       │   ├── coordinates.js # Koordinatensysteme
│       │   ├── time.js        # JD, GMST, ΔT
│       │   └── catalogs.js    # Sternkatalog-Manager
│       ├── ui/
│       │   ├── controls.js    # Linke Sidebar
│       │   ├── panels.js      # Mond/Sonne/Planeten-Panels
│       │   ├── legend.js      # Legende
│       │   ├── search.js      # Objekt-Suche
│       │   └── settings.js    # localStorage Settings
│       ├── observatory/
│       │   ├── websocket.js   # Backend-Verbindung
│       │   ├── goto.js        # GoTo-Steuerung
│       │   ├── fov.js         # Okular-FOV-Overlay
│       │   └── liveview.js    # Kamerabild-Overlay
│       └── main.js            # App-Init & Modul-Orchestrierung
├── backend/                   # Python FastAPI Server
│   ├── main.py                # FastAPI App + WebSocket
│   ├── hal/                   # Hardware Abstraction Layer
│   │   ├── __init__.py
│   │   ├── base.py            # Abstrakte Interfaces
│   │   ├── ascom/             # ASCOM-Treiber (Windows)
│   │   │   ├── mount.py
│   │   │   └── camera.py
│   │   └── indi/              # INDI-Treiber (Linux)
│   │       ├── mount.py
│   │       └── camera.py
│   ├── devices/               # Gerätespezifische Wrapper
│   │   ├── mounts/
│   │   │   ├── celestron_nexstar.py
│   │   │   ├── skywatcher_eq6r.py
│   │   │   └── micron_az5000.py
│   │   └── cameras/
│   │       ├── moravian_c1.py
│   │       ├── zwo_asi.py
│   │       ├── tis_dmk.py
│   │       └── fli_kepler.py
│   ├── sequencer/             # Beobachtungs-Sequenzen
│   │   └── sequence.py
│   ├── imaging/               # Bild-Pipeline
│   │   ├── capture.py
│   │   └── platesolve.py
│   └── requirements.txt
├── data/
│   └── catalogs/              # Sternkataloge (aus v1.7.0 übernehmen)
│       ├── stars_hip7.json
│       ├── star_names.json
│       ├── dso_base.json
│       ├── constellations.json
│       └── constellation_boundaries_iau.json
├── docs/
│   ├── architecture.md        # Architektur-Details
│   ├── hardware-setup.md      # Hardware-Einrichtung
│   ├── frontend-dev.md        # Frontend-Entwicklerdoku
│   ├── backend-dev.md         # Backend-Entwicklerdoku
│   └── milestones.md          # Entwicklungs-Meilensteine
└── README.md
```

---

## Sternnamen (IAU)

SkyCMD verwendet fuer Eigennamen von Sternen die Datei `data/catalogs/star_names.json`.
Diese Datei wird aus dem IAU Catalog of Star Names (IAU-CSN) erzeugt.

- Quelle: https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt
- Update-Befehl: `py scripts/update_star_names.py`
- Prioritaetsregel: Wenn mehrere Namenseintraege fuer dieselbe Stern-ID existieren, gewinnt ein Eintrag mit `source = IAU`.
- Aktueller Erwartungswert: 411 Eintraege in `star_names.json`

Hinweise:

- Der Parser ueberspringt Eintraege ohne zuordenbare HIP- oder HD-ID, da diese im Frontend nicht stabil gemappt werden koennen.
- Nicht als Datenzeilen interpretierbare Textfragmente aus der Quelle werden ignoriert.
- Die UI verwendet fuer Such- und Tooltip-Pfade das Format `Propername (ID)`, waehrend kurze Kartenlabels weiterhin knapp bleiben.

---

## Sternbilder / Konstellationen

SkyCMD behandelt `data/catalogs/constellations.json` und
`data/catalogs/constellation_boundaries_iau.json` als kanonische
Frontend-Datensaetze fuer Sternbildlinien, Labels und IAU-Grenzen.

- Pruefbefehl: `py scripts/regenerate_constellations.py --check`
- Reformat-Befehl: `py scripts/regenerate_constellations.py --write`
- Erwartungswerte: `86` Konstellationen und `257` Boundary-Features
- Details zum Format: `docs/data-formats.md`

Hinweise:

- Die Sternbildlinien werden aktuell nicht aus dem Laufzeit-Sternkatalog abgeleitet.
- Die Boundary-Datei wird als GeoJSON geladen und im Frontend nach RA/Dec transformiert.

---

## 🚀 Entwicklungs-Meilensteine

### Phase 1 — Frontend: WebGL Sternenkarte
- [ ] Three.js Grundgerüst + azimutale Projektion
- [ ] Hipparcos-Katalog (19K Sterne, B-V Farben)
- [ ] Zoom & Pan (Maus/Touch)
- [ ] Datum/Zeit/Standort

### Phase 2 — Frontend: Layer & Overlays
- [ ] Sternbilder (Linien + Grenzen + Popup)
- [ ] Deep-Sky-Objekte (Messier/NGC, 9 Typen)
- [ ] Sonnensystem (Planeten, Mond, Sonne)
- [ ] Milchstraße (Textur)
- [ ] Ekliptik · Himmelsäquator · Meridian · Galaktischer Äquator

### Phase 3 — Frontend: Observatory UI
- [ ] Objekt-Suche & Detailansicht
- [ ] GoTo-Button (Frontend-ready, Backend pending)
- [ ] Okular-FOV-Overlay (konfigurierbar)
- [ ] Planetentabelle
- [ ] Beobachtungslog
- [ ] Export (PNG 4K)

### Phase 4 — Backend: HAL & API
- [ ] FastAPI Grundgerüst + WebSocket
- [ ] ASCOM-Wrapper (Windows, Mount + Kamera)
- [ ] INDI-Wrapper (Linux, Mount + Kamera)
- [ ] Gerätespezifische Treiber
- [ ] REST-API Dokumentation (OpenAPI)

### Phase 5 — Integration
- [ ] Live-Positionsanzeige (Mount → Fadenkreuz auf Karte)
- [ ] GoTo-Kommandos (Karte → Mount)
- [ ] Kamera Live-View im Browser
- [ ] Platesolving-Overlay
- [ ] Beobachtungs-Sequencer

---

## 🔧 Unterstützte Hardware

### Mounts
| Gerät | Protokoll | Status |
|---|---|---|
| Celestron NexStar (AZ) | ASCOM + INDI | geplant |
| Skywatcher EQ6-R | ASCOM + INDI (SynScan) | geplant |
| 10micron AZ5000 | ASCOM + LX200/LAN | geplant |

### Kameras
| Gerät | Protokoll | Status |
|---|---|---|
| Moravian C1+ 7000A | ASCOM + Moravian SDK | geplant |
| ZWO ASI 183MM | ASCOM + ZWO SDK | geplant |
| TIS DMK | DirectShow / IC Capture | geplant |
| FLI Kepler KL4040CMT | ASCOM + FLI SDK | geplant |

---

## 🛠 Tech-Stack

| Bereich | Technologie |
|---|---|
| Frontend Rendering | Three.js (WebGL) |
| Frontend UI | Vanilla JS + CSS |
| Backend | Python 3.11+ + FastAPI |
| Teleskop (Windows) | ASCOM Platform 6 |
| Teleskop (Linux) | INDI / PyIndi |
| Kommunikation | WebSocket + REST |
| Datenbank | SQLite (Beobachtungslog) |

---

## 📘 Handbuch (Bedienung)

In der App gibt es ein eigenes Header-Menue **Handbuch** mit Schnellhilfe.

### Schnellstart
- Standort setzen: Panel **Standort**
- Datum/Zeit setzen: Felder links
- Zielobjekt suchen: Panel **Suche**
- Darstellung anpassen: Panel **Layout und Anzeige**

### Navigation
- Schwenken: Maus ziehen oder 1-Finger-Geste
- Zoom: Mausrad oder Pinch
- Objekt-Info: Hover oder Klick
- Zentrieren: Doppelklick auf ein Objekt

---

## 🧭 Projektionsmodell (Stand 2026-04)

SkyCMD verwendet eine kontinuierliche azimutale Perspektiv-Familie anstelle eines harten Wechsels.

- Maximaler FOV: **202.3 deg**
- Bei großem FOV: Verhalten nahe **stereographisch**
- Bei kleinem FOV: Verhalten nahe **gnomonisch**
- Dazwischen: kontinuierlicher Uebergang mit einer Stellarium-aehnlichen Sigmoid-Kurve

### Berechnung im Ueberblick

1. Aus dem FOV wird ein Blendwert `b` berechnet (`0 = stereographisch`, `1 = gnomonisch`).
2. Der Projektionsparameter `d` wird aus `b` bestimmt:
       - `d = 1 - b`
3. Die Projektion eines normierten Richtungsvektors `(x, y, z)` erfolgt mit:
       - `X = ((d + 1) * x) / (d + z)`
       - `Y = ((d + 1) * y) / (d + z)`
4. Die Rueckprojektion (Screen -> Richtung) nutzt die mathematisch konsistente Inverse derselben Familie.

Damit bleibt der Uebergang visuell stabil und vermeidet die harte Verzerrung, die bei linearem Mix zweier verschiedener Projektionsbilder entsteht.

---

## 📄 Lizenz

MIT License — © 2026 cuno85
