#!/usr/bin/env python3
"""
Create realistic Tycho-2 star catalog JSON file.
Generates ~500k UV-selected stars down to V~10 mag.
Intended for WebGL stress testing.
"""

import json
import random
from pathlib import Path

# Set seed for reproducibility
random.seed(42)

def generate_tycho2_stars(count=500000):
    """Generate realistic Tycho-2 star data."""
    stars = []
    
    # Tycho-2 magnitude distribution
    # Limit to V~10 for performance (can see ~100k stars, vs 2.5M full catalog)
    def get_random_magnitude():
        # Use exponential-like distribution for more faint stars
        u = random.random()
        # Transform to magnitude range (brightest around 0, faintest around 10)
        mag = -2 + u ** 0.65 * 12  # Skewed towards fainter stars
        return round(max(-2, min(10, mag)), 2)
    
    for i in range(count):
        # Random celestial coordinates
        ra = random.uniform(0, 360)
        dec = random.gauss(0, 45)  # Gaussian distribution, centered at equator
        
        # Get realistic magnitude distribution
        mag = get_random_magnitude()
        
        star = {
            "ra": round(ra, 3),
            "dec": round(max(-90, min(90, dec)), 3),
            "mag": mag,
            "name": f"TYC {i:07d}"
        }
        stars.append(star)
    
    return stars

# Generate stars
print("Generating Tycho-2 catalog with 500k stars...")
stars = generate_tycho2_stars(500000)

# Sort by magnitude (brightest first)
stars.sort(key=lambda s: s['mag'])

# Save to JSON
output_path = Path(__file__).parent.parent / "data" / "catalogs" / "stars_tycho2.json"
output_path.parent.mkdir(parents=True, exist_ok=True)

with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(stars, f, separators=(',', ':'), indent=None)

file_size_mb = output_path.stat().st_size / (1024 * 1024)

# Count by magnitude ranges
mag_ranges = {
    "≤ 3": sum(1 for s in stars if s['mag'] <= 3),
    "3-6": sum(1 for s in stars if 3 < s['mag'] <= 6),
    "6-9": sum(1 for s in stars if 6 < s['mag'] <= 9),
    "9-10": sum(1 for s in stars if 9 < s['mag'] <= 10),
}

print(f"✓ Created Tycho-2 catalog: {output_path}")
print(f"  Total stars: {len(stars):,}")
print(f"  File size: {file_size_mb:.2f} MB")
print(f"  Magnitude range: {stars[0]['mag']:.2f} to {stars[-1]['mag']:.2f}")
print(f"  Distribution:")
for range_label, count in mag_ranges.items():
    pct = count / len(stars) * 100
    print(f"    Mag {range_label:>5}: {count:6,} stars ({pct:5.1f}%)")
