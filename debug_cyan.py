"""
Debug: Check color similarity between #00FDFF and known brand colors
"""

def hex_to_rgb(value: str):
    value = value.strip('#')
    if len(value) == 8:
        value = value[2:]
    return tuple(int(value[i:i+2], 16) for i in (0, 2, 4))

def color_distance(rgb1, rgb2):
    """Euclidean distance between two RGB colors."""
    if rgb1 is None or rgb2 is None:
        return float('inf')
    r1, g1, b1 = rgb1
    r2, g2, b2 = rgb2
    return ((r1 - r2)**2 + (g1 - g2)**2 + (b1 - b2)**2) ** 0.5

MANUAL_COLOR_MAP = {
    'FOUR SEASONS (DAILY)': '#FFE082',
    'DOVE (MONTHLY)': '#FF8A80',
    'MSFT PARTNER': '#FF40FF',
    'IHOP (DAILY)': '#F8BBD0',
    'PEPSICO': '#002060',
    'META': '#50FA24',
    'WARNER': '#A02B93',
    'ELIMINI': '#92D050',
    'TJX Marshalls TAGGING': '#00B0F0',
    'MSFT LG2C': '#0070C0',
    'FEDEX': '#002060',
    'AstraZeneca': '#FFBF00',
    'TJX Influencer Vetting': '#FF0000',
    'Monthly HomeGoods': '#00B050',
    'Eli Lilly WA USA': '#AB0D5C',
    'DOVE DECK': '#E49EDD',
    'Marshalls Weekly wins': '#C00000',
    'Eli Lilly Immunology': '#7E350E',
    'Progresso Soup Drops': '#1F45EF',
    'Strava LinkedIn Audit': '#FC4C02',
    'Ebay': '#CA029A',
    'Citadel': '#00C2A8',
    'Apollo (University of Phoenix)': '#68D68A',
    'Astranis': '#A1455F',
    'Iran Crisis Report': '#7030A0',
    'White House Easter Egg': '#E3CF91',
    'Celsius Crisis Report': '#644EC2',
    'MC and Yougov Research Case': '#80676E',
    'Xbox': '#107C11',
    'AMERICAN EGG BOARD (WEEKLY)': '#A02B93',
    'MCKINSEY (WEEKLY)': '#644EC2',
    'TENCENT (DAILY)': '#50FA24',
}

problematic_color = '#00FDFF'
problematic_rgb = hex_to_rgb(problematic_color)

print("="*70)
print(f"Testing color similarity for {problematic_color}")
print("="*70)

distances = []
for brand, color in MANUAL_COLOR_MAP.items():
    brand_rgb = hex_to_rgb(color)
    dist = color_distance(problematic_rgb, brand_rgb)
    distances.append((brand, color, dist))

# Sort by distance
distances.sort(key=lambda x: x[2])

print(f"\nClosest 10 brands to {problematic_color}:")
print("-" * 70)
for brand, color, dist in distances[:10]:
    marker = "*** MATCH***" if dist <= 100 else ""
    print(f"{brand:40s} {color:8s}  distance: {dist:7.1f}  {marker}")
