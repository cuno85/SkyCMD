# SkyCMD — Datenformate

## Konstellationen

SkyCMD behandelt die Dateien `data/catalogs/constellations.json` und
`data/catalogs/constellation_boundaries_iau.json` als kanonische
Frontend-Datensaetze fuer Sternbildlinien, Labels und IAU-Grenzen.

Die Laufzeit-Sternkataloge werden davon bewusst getrennt gehalten.
Sternbildlinien werden aktuell nicht aus dem geladenen Sternkatalog
abgeleitet.

### `constellations.json`

Top-Level:
- JSON-Array mit aktuell `86` Eintraegen

Schema pro Eintrag:

```json
{
  "id": "And",
  "name": "Andromeda",
  "lines": [
    [
      { "ra": 0.13981, "dec": 29.0906 },
      { "ra": 0.65547, "dec": 30.8608 }
    ]
  ]
}
```

Feldregeln:
- `id`: 3-stelliges IAU-Kuerzel der Konstellation
- `name`: Klarname der Konstellation
- `lines`: Array von Polylines
- Jede Polyline ist ein Array aus mindestens zwei Punkten
- Jeder Punkt ist ein Objekt mit `ra` und `dec`

Koordinatensystem:
- `ra`: Stunden im Bereich `$0 \le ra < 24$`
- `dec`: Grad im Bereich `$-90 \le dec \le 90$`
- Die Werte werden direkt im Frontend projiziert

Konsum im Frontend:
- Laden: [frontend/src/skymap/catalog.js](frontend/src/skymap/catalog.js#L128)
- Linien: [frontend/src/skymap/layers/constellations.js](frontend/src/skymap/layers/constellations.js#L8)
- Labels: [frontend/src/skymap/layers/constellations.js](frontend/src/skymap/layers/constellations.js#L69)

### `constellation_boundaries_iau.json`

Top-Level:
- GeoJSON `FeatureCollection`
- Aktuell `257` Features

Schema:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "ids": "And,Lac",
      "geometry": {
        "type": "MultiLineString",
        "coordinates": [
          [[-15.5347, 35.1682], [-15.6571, 53.168]]
        ]
      }
    }
  ]
}
```

Feldregeln:
- `type`: muss `FeatureCollection` sein
- `features`: Array von GeoJSON-Features
- `geometry.type`: aktuell unterstuetzt `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon`
- `coordinates`: GeoJSON-Koordinaten in der Form `[lon, lat]`

Koordinatensystem:
- `lon`: Grad, typischerweise im Bereich `$-180$` bis `$180$`
- `lat`: Grad im Bereich `$-90$` bis `$90$`
- Beim Laden wird `lon` in Stunden-RA umgerechnet:

$$
ra = \frac{((lon \bmod 360) + 360) \bmod 360}{15}
$$

Konsum im Frontend:
- Laden und Transformation: [frontend/src/skymap/catalog.js](frontend/src/skymap/catalog.js#L134)
- Canvas-Renderer: [frontend/src/skymap/renderer.js](frontend/src/skymap/renderer.js#L354)
- WebGL-Renderer: [frontend/src/skymap/webgl-renderer.js](frontend/src/skymap/webgl-renderer.js#L942)

## Pflege-Workflow

Das optionale Hilfsscript [scripts/regenerate_constellations.py](scripts/regenerate_constellations.py)
arbeitet in der ersten Ausbaustufe ohne externe Quelle.

Befehle:
- Validierung: `py scripts/regenerate_constellations.py --check`
- Deterministisches Neu-Schreiben: `py scripts/regenerate_constellations.py --write`

Validierungsregeln:
- genau `86` Konstellationen in `constellations.json`
- genau `257` Boundary-Features in `constellation_boundaries_iau.json`
- eindeutige 3-stellige IAU-Kuerzel
- gueltige `ra`-/`dec`-Bereiche
- gueltige GeoJSON-Grundstruktur fuer Grenzen

Ziel:
- stabile JSON-Formatierung
- fruehes Erkennen von Datenregressionen
- klare Trennung zwischen Sternbildgeometrie und Laufzeit-Sternkatalog