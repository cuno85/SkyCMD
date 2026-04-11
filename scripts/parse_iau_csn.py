"""
Parse IAU Catalog of Star Names (IAU-CSN) and update star_names.json.

Source: https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt

The file has a notional fixed-width layout but column 5 (Bayer/UTF-8)
contains multi-byte Unicode characters (Greek letters), so character-
position slicing is unreliable.  Instead:
    - A trailing regex extracts the numerical fields from the right.
    - A constellation regex finds the IAU 3-letter abbreviation in the prefix.
    - The name is read from the first 18 ASCII characters of the line.

Stars without a HIP or HD number (pulsars, some exoplanet hosts) are
skipped — the frontend cannot match them.
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

IAU_CSN_URL = "https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt"
OUT_PATH = Path(__file__).parent.parent / "data" / "catalogs" / "star_names.json"

# All 88 IAU constellation 3-letter abbreviations (case-sensitive).
IAU_CONSTELLATIONS = {
    "And","Ant","Aps","Aqr","Aql","Ara","Ari","Aur","Boo","Cae",
    "Cam","Cnc","CVn","CMa","CMi","Cap","Car","Cas","Cen","Cep",
    "Cet","Cha","Cir","Col","Com","CrA","CrB","Crv","Crt","Cru",
    "Cyg","Del","Dor","Dra","Equ","Eri","For","Gem","Gru","Her",
    "Hor","Hya","Hyi","Ind","Lac","Leo","LMi","Lep","Lib","Lup",
    "Lyn","Lyr","Men","Mic","Mon","Mus","Nor","Oct","Oph","Ori",
    "Pav","Peg","Per","Phe","Pic","PsA","Psc","Pup","Pyx","Ret",
    "Sge","Sgr","Sco","Scl","Sct","Ser","Sex","Tau","Tel","TrA",
    "Tri","Tuc","UMa","UMi","Vel","Vir","Vol","Vul",
}

# Regex: constellation abbreviation surrounded by word boundaries / spaces.
# Placed after the designation block (HR/HD/GJ/HIP/discovery-ID).
CON_RE = re.compile(
    r"(?<!\w)("
    + "|".join(sorted(IAU_CONSTELLATIONS, key=len, reverse=True))
    + r")(?!\w)"
)

# Regex to extract the numerical tail of each data line:
#   mag  band  HIP-or-_  HD-or-_  RA  Dec  Date
TAIL_RE = re.compile(
    r"\s+(-?\d+\.?\d*)"       # magnitude
    r"\s+([VG])"               # photometric band
    r"\s+(\d+|_)"              # HIP number or "_"
    r"\s+(\d+|_)"              # HD number or "_"
    r"\s+([\d.]+)"             # RA
    r"\s+(-?[\d.]+)"           # Dec
    r"\s+(\d{4}-\d{2}-\d{2})" # Date
)

GREEK_ABBR_TO_NAME = {
    "alf": "alpha",
    "bet": "beta",
    "gam": "gamma",
    "del": "delta",
    "eps": "epsilon",
    "zet": "zeta",
    "eta": "eta",
    "the": "theta",
    "iot": "iota",
    "kap": "kappa",
    "lam": "lambda",
    "mu": "mu",
    "nu": "nu",
    "ksi": "xi",
    "omi": "omicron",
    "pi": "pi",
    "rho": "rho",
    "sig": "sigma",
    "tau": "tau",
    "ups": "upsilon",
    "phi": "phi",
    "chi": "chi",
    "psi": "psi",
    "ome": "omega",
}


def _normalize_bayer_token(token: str) -> str:
    value = str(token or "").strip().lower()
    if not value or value == "_":
        return ""

    # Preserve suffixes like pi03, but normalize canonical abbreviation prefix.
    m = re.match(r"^([a-z]{2,3})(\d{0,2})$", value)
    if not m:
        return value

    prefix, suffix = m.groups()
    greek = GREEK_ABBR_TO_NAME.get(prefix, prefix)
    if suffix:
        suffix = str(int(suffix))
    return f"{greek}{suffix}"


def _extract_designations(prefix: str, constellation: str) -> tuple[str, str]:
    if not constellation:
        return "", ""

    parts = prefix.split()
    try:
        ci = parts.index(constellation)
    except ValueError:
        return "", ""

    if ci < 2:
        return "", ""

    latin_token = parts[ci - 2]
    utf_token = parts[ci - 1]

    flamsteed_num = ""
    for tok in (utf_token, latin_token):
        cleaned = str(tok or "").strip()
        if cleaned.isdigit():
            flamsteed_num = str(int(cleaned))
            break

    flamsteed = f"{flamsteed_num} {constellation}" if flamsteed_num else ""

    bayer_token = _normalize_bayer_token(latin_token)
    bayer = ""
    if bayer_token and not bayer_token.isdigit():
        bayer = f"{bayer_token} {constellation}"

    return bayer, flamsteed


def download_iau_csn() -> list[str]:
    print(f"Downloading IAU-CSN from {IAU_CSN_URL} …")
    req = urllib.request.Request(
        IAU_CSN_URL,
        headers={"User-Agent": "SkyCMD/1.0 star-name-importer"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
    # The file is UTF-8 (with BOM possible)
    text = raw.decode("utf-8-sig", errors="replace")
    print(f"  Downloaded {len(text):,} characters.")
    return text.splitlines()


def parse_lines(lines: list[str]) -> list[dict]:
    entries: list[dict] = []
    by_id: dict[str, dict] = {}
    skipped_no_hip = 0
    skipped_no_match = 0
    skipped_non_data = 0

    for raw_line in lines:
        # Skip blank lines and comment lines
        line = raw_line.rstrip()
        if not line or line.startswith("#"):
            continue

        # The source file contains wrapped explanatory lines and URL fragments
        # that are not catalog rows. Ignore those quietly.
        if not re.match(r"^[A-Za-z0-9]", line):
            skipped_non_data += 1
            continue

        m = TAIL_RE.search(line)
        if not m:
            skipped_no_match += 1
            print(f"  [WARN] no tail match: {line[:70]!r}", file=sys.stderr)
            continue

        mag_str, band, hip_str, hd_str, ra_str, dec_str, date_str = m.groups()

        # Extract name from first 18 characters (fixed ASCII column, strip whitespace)
        name_ascii = line[:18].strip()
        if not name_ascii:
            continue

        # Build the id key (must match what the star catalog stores)
        if hip_str != "_":
            star_id = f"HIP {int(hip_str)}"
        elif hd_str != "_":
            star_id = f"HD {int(hd_str)}"
        else:
            # Some entries only have discovery-survey designations (WASP-x, HAT-P-x …)
            # These are exoplanet hosts invisible to the naked eye; skip them.
            skipped_no_hip += 1
            continue

        # Constellation: find the first IAU abbreviation in the prefix (before the mag/HIP block).
        # Using the regex is robust against UTF-8 multi-byte offsets in column 5.
        prefix = line[: m.start()]
        con_match = CON_RE.search(prefix)
        constellation = con_match.group(1) if con_match else ""
        bayer, flamsteed = _extract_designations(prefix, constellation)

        try:
            magnitude = round(float(mag_str), 2)
        except ValueError:
            magnitude = None

        candidate = {
            "id": star_id,
            "propername": name_ascii,
            "bayer": bayer,
            "flamsteed": flamsteed,
            "magnitude": magnitude,
            "constellation": constellation,
            "source": "IAU",
        }

        # Keep exactly one entry per star id. If duplicates exist,
        # keep the brighter one (smaller magnitude value).
        current = by_id.get(star_id)
        if current is None:
            by_id[star_id] = candidate
        else:
            c_mag = current.get("magnitude")
            n_mag = candidate.get("magnitude")
            if c_mag is None or (n_mag is not None and n_mag < c_mag):
                merged = {**current, **candidate}
            else:
                merged = {**candidate, **current}

            # Keep designation metadata if present on either duplicate row.
            merged["bayer"] = current.get("bayer") or candidate.get("bayer") or ""
            merged["flamsteed"] = current.get("flamsteed") or candidate.get("flamsteed") or ""
            by_id[star_id] = merged

    entries = list(by_id.values())
    print(
        f"  Parsed {len(entries)} entries "
        f"(skipped {skipped_no_hip} without HIP/HD, {skipped_no_match} unmatched, {skipped_non_data} non-data lines)."
    )
    return entries


def main():
    lines = download_iau_csn()
    entries = parse_lines(lines)

    # Sort by magnitude (brightest first), then by name for ties
    def sort_key(e):
        mag = e.get("magnitude")
        return (mag if mag is not None else 99.0, e["propername"])

    entries.sort(key=sort_key)

    OUT_PATH.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote {len(entries)} entries to {OUT_PATH}")

    # Quick sanity-check: print the 10 brightest
    print("\nTop 10 brightest named stars:")
    for e in entries[:10]:
        print(f"  {e['propername']:<25} {e['id']:<12}  mag={e['magnitude']}  {e['constellation']}")


if __name__ == "__main__":
    main()
