# SkyCMD — Entwicklungs-Meilensteine

## Phase 1 — WebGL Sternenkarte (Basis)

**Ziel:** Funktionsfähige WebGL-Sternenkarte im Browser, alle Kernfunktionen aus v1.7.0 neu implementiert.

### Aufgaben
- [ ] Three.js Projektsetup + Canvas-Grundgerüst
- [ ] Azimutale äquidistante Projektion (WebGL)
- [ ] Hipparcos-Katalog laden + Sterne rendern (B-V Farben)
- [ ] Zoom & Pan (Maus + Touch)
- [ ] Datum / Zeit / Standort-Eingabe
- [ ] Farbschemata (CSS-Variablen basiert)

**Akzeptanzkriterium:** Sternenkarte zeigt Himmel für Halle (51.49°N, 11.97°E) korrekt an.

---

## Phase 2 — Layer & Overlays

- [ ] Milchstraße (Stellarium-Textur)
- [ ] Sternbilder: Linien + IAU-Grenzen + Hover-Info + Popup
- [ ] DSOs: Messier + NGC, 9 Typen, korrekte Symbole
- [ ] Sonnensystem: Sonne, Mond, Planeten (Kepler-Ephemeriden)
- [ ] Ekliptik · Himmelsäquator · Galaktischer Äquator · Meridian
- [ ] Kometen (MPC-API) + Asteroiden (JPL-API)

**Akzeptanzkriterium:** Alle Layer einzeln togglebar, korrekte Positionen verifiziert gegen Stellarium.

---

## Phase 3 — Observatory UI

- [ ] Objekt-Suche (Sterne, DSO, Planeten, Kometen)
- [ ] Objekt-Detailkarte (Koordinaten, Auf-/Untergang, Helligkeit)
- [ ] GoTo-Button (Frontend: markiert Ziel, Backend: pending)
- [ ] Okular-FOV-Overlay (Brennweite + Sensor konfigurierbar)
- [ ] Planetentabelle (sortierbar)
- [ ] Mond/Sonne-Info-Panel
- [ ] PNG-Export 4K
- [ ] Beobachtungslog (localStorage + Export als CSV)

---

## Phase 4 — Backend HAL

- [ ] FastAPI + WebSocket Grundgerüst
- [ ] Abstraktes Mount-Interface (connect, goto, sync, park, track)
- [ ] Abstraktes Camera-Interface (expose, abort, settemp, getimage)
- [ ] ASCOM-Implementierung (Windows)
- [ ] INDI-Implementierung (Linux)
- [ ] Gerätespezifische Treiber (NexStar, EQ6-R, AZ5000, ASI, Moravian, FLI, DMK)
- [ ] OpenAPI Dokumentation

---

## Phase 5 — Integration

- [ ] Live Mount-Position → Fadenkreuz auf Karte
- [ ] GoTo von Karte → Mount
- [ ] Kamera Live-View Stream → Browser
- [ ] Platesolving (astrometry.net oder ASTAP)
- [ ] Platesolving-Overlay auf Karte
- [ ] Beobachtungs-Sequencer (Autofokus, Guiding, Bilderserie)
