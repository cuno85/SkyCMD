# SkyCMD — Hardware-Setup

## Unterstützte Mounts

### Celestron NexStar (AZ)
- **Verbindung:** USB → Serial (CP210x Treiber)
- **Protokoll:** NexStar Hand Controller Serial Protocol
- **ASCOM-Treiber:** POTH / NexStar ASCOM
- **INDI-Treiber:** `indi_celestron_gps`
- **Besonderheit:** Azimutalmount, kein Tracking für EQ-Fotografie

### Skywatcher EQ6-R
- **Verbindung:** USB direkt oder EQMOD
- **Protokoll:** SynScan / EQMOD
- **ASCOM-Treiber:** EQMOD ASCOM (empfohlen)
- **INDI-Treiber:** `indi_eqmod`
- **Besonderheit:** Beliebteste EQ-Montierung, exzellente Softwareunterstützung

### 10micron AZ5000
- **Verbindung:** RS232 oder Ethernet (LAN)
- **Protokoll:** LX200-kompatibel + proprietäre Erweiterungen
- **ASCOM-Treiber:** 10micron ASCOM
- **INDI-Treiber:** `indi_lx200_10micron`
- **Besonderheit:** High-End, Star-Alignment-Modell, besondere Präzision

---

## Unterstützte Kameras

### Moravian C1+ 7000A
- **Sensor:** Sony IMX455, 47.1 MP (8288×5692)
- **Verbindung:** USB 3.0
- **Kühlung:** Zweistufig TEC
- **ASCOM-Treiber:** Moravian Instruments ASCOM
- **INDI-Treiber:** `indi_moravian`

### ZWO ASI 183MM
- **Sensor:** Sony IMX183, 20 MP (5496×3672), Mono
- **Verbindung:** USB 3.0
- **ASCOM-Treiber:** ZWO ASCOM
- **INDI-Treiber:** `indi_asi`
- **SDK:** ZWO ASI SDK

### TIS DMK
- **Verbindung:** USB 2.0 / GigE
- **Treiber:** IC Capture / DirectShow (Windows)
- **INDI-Treiber:** `indi_tis` (experimentell)
- **Besonderheit:** Planetary Imaging, hohe Framerate

### FLI Kepler KL4040CMT
- **Sensor:** 16 MP (4096×4096), Farbe
- **Verbindung:** USB 3.0 / GigE
- **ASCOM-Treiber:** FLI ASCOM
- **INDI-Treiber:** `indi_fli`
- **Besonderheit:** Wissenschaftliche Kamera, Back-illuminated CMOS

---

## Installation Backend (Windows)

```bash
# 1. ASCOM Platform 6.6 installieren
#    https://ascom-standards.org/

# 2. Python 3.11+ installieren

# 3. Dependencies
pip install -r backend/requirements.txt

# 4. Gerätespezifische ASCOM-Treiber installieren
#    (je nach Hardware)

# 5. Backend starten
python backend/main.py
```

## Installation Backend (Linux)

```bash
# 1. INDI installieren
sudo apt install indi-full

# 2. PyIndi
pip install pyindi-client

# 3. Dependencies
pip install -r backend/requirements.txt

# 4. INDI Server starten
indiserver indi_eqmod indi_asi

# 5. Backend starten
python backend/main.py
```
