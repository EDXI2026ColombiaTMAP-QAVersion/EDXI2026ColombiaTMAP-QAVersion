"""
Extract April schedule from 2026 - Timing_Map_DXI (1).xlsx
Structure:
  - Brands: E2:E13
  - Member rows: 21, 23, 25, 27, ... (every other row)
  - Day columns: D, F, H, J, L, N (every other column = 20 slots per day)
  - Week headers: Row 18 (FIRST WEEK), then rows 52, 94, 136, 178
  - Dates: Row 19 (6, 7, 8, 9, 10, 11), then patterns for other weeks
"""
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from colorsys import rgb_to_hls, hls_to_rgb

EXCEL_FILE = "2026 - Timing_Map_DXI (1).xlsx"
SHEET_NAME = "Timing APR"
OUTPUT_FILE = "april_import.json"

NS = {
    'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'x': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}

INDEXED = [
    '000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF',
    '800000','008000','000080','808000','800080','008080','C0C0C0','808080','9999FF','993366','FFFFCC','CCFFFF','660066','FF8080','0066CC','CCCCFF',
    '000080','FF00FF','FFFF00','00FFFF','800080','800000','008080','0000FF','00CCFF','CCFFFF','CCFFCC','FFFF99','99CCFF','FF99CC','CC99FF','FFCC99',
    '3366FF','33CCCC','99CC00','FFCC00','FF9900','FF6600','666699','969696','003366','339966','003300','333300','993300','993366','333399','333333'
]

def col_to_num(col: str) -> int:
    out = 0
    for ch in col:
        out = out * 26 + ord(ch) - 64
    return out

def num_to_col(num: int) -> str:
    chars = []
    while num:
        num, rem = divmod(num - 1, 26)
        chars.append(chr(65 + rem))
    return ''.join(reversed(chars))

def hex_to_rgb(value: str):
    value = value.strip('#')
    if len(value) == 8:
        value = value[2:]
    return tuple(int(value[i:i+2], 16) for i in (0, 2, 4))

def rgb_to_hex(rgb):
    return '#%02X%02X%02X' % rgb

def apply_tint(rgb, tint):
    if tint is None:
        return rgb
    r, g, b = [x / 255.0 for x in rgb]
    h, l, s = rgb_to_hls(r, g, b)
    if tint < 0:
        l = l * (1 + tint)
    else:
        l = l * (1 - tint) + (1 - (1 - tint))
    r, g, b = hls_to_rgb(h, l, s)
    return (round(r * 255), round(g * 255), round(b * 255))

def is_brandish(value: str) -> bool:
    if not value:
        return False
    t = value.strip()
    if not t:
        return False
    if t.upper() in {'DAY', 'LUNCH'}:
        return False
    if re.fullmatch(r'\d+(\.\d+)?', t):
        return False
    if ':' in t and len(t) <= 10:
        return False
    return True

DAY_NAMES = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
WEEK_LABELS = ['FIRST WEEK', 'SECOND WEEK', 'THIRD WEEK', 'FOURTH WEEK', 'FIFTH WEEK']
SKIP_NAME_KEYWORDS = ['WEEK', 'TIMING', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES',
                       'MAP', 'DXI', 'HUB', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']


with zipfile.ZipFile(EXCEL_FILE) as z:
    # ── Shared strings ──────────────────────────────────────────────────────────
    sst = ET.fromstring(z.read('xl/sharedStrings.xml'))
    shared = []
    for si in sst.findall('a:si', NS):
        t = si.find('a:t', NS)
        if t is not None and t.text is not None:
            shared.append(t.text)
        else:
            parts = []
            for run in si.findall('a:r', NS):
                rt = run.find('a:t', NS)
                if rt is not None and rt.text:
                    parts.append(rt.text)
            shared.append(''.join(parts))

    # ── Theme colors ────────────────────────────────────────────────────────────
    theme = ET.fromstring(z.read('xl/theme/theme1.xml'))
    clr_scheme = theme.find('.//x:clrScheme', NS)
    theme_colors = []
    for node in list(clr_scheme):
        srgb = node.find('x:srgbClr', NS)
        sysc = node.find('x:sysClr', NS)
        theme_colors.append(srgb.attrib['val'] if srgb is not None else sysc.attrib.get('lastClr', '000000'))

    # ── Styles ──────────────────────────────────────────────────────────────────
    styles = ET.fromstring(z.read('xl/styles.xml'))
    fills = styles.find('a:fills', NS)
    fill_attrs = []
    for fill in fills.findall('a:fill', NS):
        pf = fill.find('a:patternFill', NS)
        fg = pf.find('a:fgColor', NS) if pf is not None else None
        fill_attrs.append(fg.attrib if fg is not None else {})
    xfs = styles.find('a:cellXfs', NS)
    style_to_fill = [int(x.attrib.get('fillId', 0)) for x in xfs.findall('a:xf', NS)]

    # ── Find the "Timing APR" sheet XML path via workbook rels ─────────────────
    wb_xml = ET.fromstring(z.read('xl/workbook.xml'))
    rels_xml = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rid_to_target = {rel.attrib['Id']: rel.attrib['Target'] for rel in rels_xml}
    sheet_path = None
    for sh in wb_xml.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet'):
        if sh.attrib.get('name') == SHEET_NAME:
            rid = sh.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            target = rid_to_target.get(rid, '')
            sheet_path = f'xl/{target}' if not target.startswith('/') else target.lstrip('/')
            break
    if sheet_path is None:
        raise FileNotFoundError(f'Sheet "{SHEET_NAME}" not found in workbook')
    print(f'Reading sheet: {sheet_path}')

    # ── Sheet values and styles ──────────────────────────────────────────────────
    sheet = ET.fromstring(z.read(sheet_path))
    values = {}
    style_by_ref = {}
    for cell in sheet.findall('.//a:c', NS):
        ref = cell.attrib['r']
        style_by_ref[ref] = int(cell.attrib.get('s', 0))
        v = cell.find('a:v', NS)
        val = None
        if v is not None:
            val = v.text
            if cell.attrib.get('t') == 's' and val is not None:
                val = shared[int(val)]
        values[ref] = val

    # ── Merged cells ────────────────────────────────────────────────────────────
    merge_ranges = []
    merge_root = sheet.find('a:mergeCells', NS)
    if merge_root is not None:
        for m in merge_root.findall('a:mergeCell', NS):
            ref = m.attrib['ref']
            a, b = ref.split(':')
            ca, ra = re.match(r'([A-Z]+)(\d+)', a).groups()
            cb, rb = re.match(r'([A-Z]+)(\d+)', b).groups()
            c1, c2 = col_to_num(ca), col_to_num(cb)
            r1, r2 = int(ra), int(rb)
            merge_ranges.append((r1, r2, c1, c2, values.get(a), style_by_ref.get(a, 0)))

    # ── Helper functions ─────────────────────────────────────────────────────────
    def style_color(style_idx):
        fill_id = style_to_fill[style_idx] if style_idx < len(style_to_fill) else 0
        fg = fill_attrs[fill_id] if fill_id < len(fill_attrs) else {}
        if not fg:
            return None
        if 'rgb' in fg:
            return '#' + fg['rgb'][-6:]
        if 'theme' in fg:
            idx = int(fg['theme'])
            base = theme_colors[idx] if idx < len(theme_colors) else '000000'
            tint = float(fg.get('tint')) if 'tint' in fg else None
            return rgb_to_hex(apply_tint(hex_to_rgb(base), tint))
        if 'indexed' in fg:
            idx = int(fg['indexed'])
            if idx < len(INDEXED):
                return '#' + INDEXED[idx]
        return None

    def style_is_colored(style_idx):
        fill_id = style_to_fill[style_idx] if style_idx < len(style_to_fill) else 0
        fg = fill_attrs[fill_id] if fill_id < len(fill_attrs) else {}
        if not fg:
            return False
        if 'rgb' in fg:
            return True
        if 'theme' in fg:
            theme_idx = int(fg['theme'])
            return theme_idx not in (0, 1) or 'tint' in fg
        if 'indexed' in fg:
            idx = int(fg['indexed'])
            return idx not in (0, 1, 64)
        return False

    def get_cell(ref):
        val = values.get(ref)
        sty = style_by_ref.get(ref, 0)
        if val not in (None, ''):
            return val, sty
        m = re.match(r'([A-Z]+)(\d+)', ref)
        col = col_to_num(m.group(1))
        row = int(m.group(2))
        for r1, r2, c1, c2, mval, msty in merge_ranges:
            if r1 <= row <= r2 and c1 <= col <= c2:
                if mval not in (None, ''):
                    return mval, msty
                break
        return val, sty

    # ──────────────────────────────────────────────────────────────────────────
    # EXTRACT DATA - SIMPLE AND DIRECT
    # ──────────────────────────────────────────────────────────────────────────
    
    # 1. Brand list from rows 2-13, column E
    brands_set = set()
    for row in range(2, 14):
        brand = values.get(f'E{row}')
        if brand and isinstance(brand, str):
            brand = brand.strip()
            if brand and len(brand) > 2 and '{' not in brand and '|' not in brand and '}' not in brand:
                brands_set.add(brand)
    
    print(f"✓ Brands found: {sorted(brands_set)}")

    # 2. Member list - unique from rows 21 onwards (column B), every 2 rows
    members = []
    seen = set()
    row = 21
    while row < 200:
        name = values.get(f'B{row}')
        if name and isinstance(name, str):
            name = name.strip()
            if name and len(name) > 2 and name not in seen and name.upper() not in ['DAY', 'LUNCH']:
                members.append(name)
                seen.add(name)
        row += 2
    
    print(f"✓ Members found: {len(members)} → {members}")

    # 3. Assignments - read from columns D-U, rows 21+ (every 2)
    # Week 1: rows 21..43 (11 members), columns D-U, dates March 30 - April 3
    # Week 2: rows 45+ (11 members), columns D-U, dates April 6-10
    # etc.
    
    assignments = {}
    day_keys = []
    brands_found = set()

    # Define week structure: (start_member_row, [Mon, Tue, Wed, Thu, Fri dates])
    weeks = [
        (21, ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03']),
        (45, ['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10']),  # Adjust row as needed
        (69, ['2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17']),  # Adjust row as needed
        (93, ['2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24']),  # Adjust row as needed
        (117, ['2026-04-27', '2026-04-28', '2026-04-29', '2026-04-30', '2026-05-01']), # Adjust row as needed
    ]

    for week_start_row, dates in weeks:
        # For each member (starting every 2 rows from week start)
        member_row = week_start_row
        while member_row < week_start_row + 40:
            member_name = values.get(f'B{member_row}')
            if not member_name or not isinstance(member_name, str) or member_name.strip() not in members:
                member_row += 2
                continue

            member_name = member_name.strip()

            # For each day (5 days), read data from columns
            # Day columns: D=day0, F=day1, H=day2, J=day3, L=day4
            day_cols = ['D', 'F', 'H', 'J', 'L']

            for day_idx, date_str in enumerate(dates):
                if date_str not in assignments:
                    assignments[date_str] = {}
                    day_keys.append(date_str)

                assignments[date_str][member_name] = []

                # Read 20 slots for this day
                # Columns per day span 10 columns (D-M, then skip 2 for LUNCH headers, then N-U)
                # Actually it's: D(0-1), E(2-3), F(4-5), G(6-7), H(8-9), [I(10-11)=LUNCH], J(12-13), K(14-15), L(16-17), M(18-19)
                # But we need to map to the single day column structure
                
                day_col = day_cols[day_idx]
                day_col_num = ord(day_col) - 64  # D=4, F=6, H=8, etc.

                # Read slots 0-19 (columns from day_col position)
                for slot in range(20):
                    if slot in (10, 11):
                        assignments[date_str][member_name].append('LUNCH')
                        continue

                    # Map slot to column: column = day_col + (slot // 2)
                    col_num = day_col_num + (slot // 2)
                    col_letter = chr(64 + col_num)
                    
                    ref = f'{col_letter}{member_row}'
                    val = values.get(ref)

                    if val and isinstance(val, str):
                        brand = val.strip()
                        # Filter out garbage
                        if brand and len(brand) > 1 and brand not in ['{', '|', '}', '']:
                            assignments[date_str][member_name].append(brand)
                            brands_found.add(brand)
                        else:
                            assignments[date_str][member_name].append(None)
                    else:
                        assignments[date_str][member_name].append(None)

            member_row += 2

    # 4. Build brands with colors
    palette = ['#2D6A4F', '#1D3557', '#8F2D56', '#CA6702', '#6A4C93', '#264653', '#386641', '#9D4EDD', '#1B998B', '#D62828']
    brands = []
    for idx, name in enumerate(sorted(brands_found), start=1):
        color = palette[(idx - 1) % len(palette)]
        brands.append({'id': f'b{idx}', 'name': name, 'color': color})

    # 5. Output
    result = {
        'members': members,
        'brands': brands,
        'assignments': assignments,
        'dayKeys': sorted(day_keys)
    }

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Written to {OUTPUT_FILE}")
    print(f"   Members: {len(members)}")
    print(f"   Brands: {len(brands)} → {[b['name'] for b in brands]}")
    print(f"   Days: {len(sorted(day_keys))} → {sorted(day_keys)}")
    
    if members and assignments:
        first_day = sorted(day_keys)[0] if day_keys else None
        if first_day and members[0] in assignments.get(first_day, {}):
            sample = assignments[first_day][members[0]]
            assigned = sum(1 for s in sample if s and s != 'LUNCH')
            print(f"   Sample: {members[0]} on {first_day}: {assigned} slots assigned")
