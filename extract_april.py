"""
Extract April schedule from 2026 - Timing_Map_DXI (1).xlsx
Same approach as extract_data.py: uses raw XML for styles + color inference.
Outputs brand NAMES (not IDs) so the app's importFromJson can resolve them.
"""
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from colorsys import rgb_to_hls, hls_to_rgb
from pathlib import Path

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

    # ── Auto-detect week header rows ─────────────────────────────────────────────
    # Scan ALL cells for "FIRST WEEK" / "SECOND WEEK" etc.
    week_header_rows = {}  # label -> row_number
    for ref, val in values.items():
        if not isinstance(val, str):
            continue
        v = val.strip().upper()
        for label in WEEK_LABELS:
            if label in v:
                row_num = int(re.match(r'[A-Z]+(\d+)', ref).group(1))
                if label not in week_header_rows or row_num < week_header_rows[label]:
                    week_header_rows[label] = row_num
    week_starts = sorted(week_header_rows.values())
    print(f'Week header rows: {week_starts}')
    if not week_starts:
        raise ValueError('No week headers (FIRST WEEK etc.) found in sheet')

    # ── Auto-detect day header columns for each week block ──────────────────────
    def find_day_columns(week_row):
        """Returns dict: day_name → (col_num_1based, date_number)"""
        day_cols = {}
        # Scan the week header row itself AND rows below for day names
        for r_off in range(0, 8):
            row_num = week_row + r_off
            found_any = False
            for col_num in range(col_to_num('C'), col_to_num('EZ') + 1):
                ref = f'{num_to_col(col_num)}{row_num}'
                val = values.get(ref)
                if not isinstance(val, str):
                    continue
                v = val.strip().upper()
                for dn in DAY_NAMES:
                    if v.startswith(dn):
                        date_m = re.search(r'\d+', val)
                        if date_m:
                            day_cols[dn] = (col_num, int(date_m.group()))
                            found_any = True
            if found_any:
                break
        return day_cols

    # ── Auto-detect member rows within a week block ───────────────────────────
    def find_member_rows(week_start, week_end):
        members_rows = []
        seen_names = set()
        for row_num in range(week_start + 1, week_end):
            val = values.get(f'B{row_num}')
            if not isinstance(val, str) or not val.strip():
                continue
            v = val.strip()
            # Skip: pure numbers, very short strings
            if re.fullmatch(r'[\d\s.\-/]+', v):
                continue
            if len(v) < 3:
                continue
            # More lenient filtering: skip only obvious headers/labels
            if v.upper() in WEEK_LABELS or v.upper() in DAY_NAMES or 'TITLE' in v.upper() or 'TIMING' in v.upper() or 'MAP' in v.upper():
                continue
            if v not in seen_names:
                members_rows.append((row_num, v))
                seen_names.add(v)
        return members_rows

    # ── Determine canonical member list (from first week) ─────────────────────
    # First, scan ALL cells for likely member names (between week headers)
    potential_members = set()
    for row_num in range(week_starts[0] + 1, week_starts[1] if len(week_starts) > 1 else week_starts[0] + 50):
        for col_num in range(col_to_num('A'), col_to_num('P')):  # Scan A-P
            ref = f'{num_to_col(col_num)}{row_num}'
            val = values.get(ref)
            if not isinstance(val, str) or len(val.strip()) < 3:
                continue
            v = val.strip()
            if re.fullmatch(r'[\d\s.\-/]+', v):
                continue
            if v.upper() in WEEK_LABELS or v.upper() in DAY_NAMES or 'TITLE' in v.upper():
                continue
            potential_members.add(v)
    
    members = sorted(list(potential_members))
    print(f'Found {len(members)} members: {members}')

    # ── First pass: learn style→brand from explicit text in schedule ─────────
    brand_color_hint = {}
    style_brand = {}
    fill_brand = {}

    for wi, ws_row in enumerate(week_starts):
        ws_end = week_starts[wi + 1] if wi + 1 < len(week_starts) else ws_row + 200  # Scan up to 200 rows for last week
        member_rows_this_week = find_member_rows(ws_row, ws_end)
        day_cols_map = find_day_columns(ws_row)
        print(f'  Week {wi+1}: row {ws_row} to {ws_end}, found {len(member_rows_this_week)} members, {len(day_cols_map)} days', flush=True)

        for member_row, _ in member_rows_this_week:
            for _, (day_col_num, _) in day_cols_map.items():
                for slot_off in range(30):
                    col_num = day_col_num + slot_off
                    ref = f'{num_to_col(col_num)}{member_row}'
                    val, sty = get_cell(ref)
                    fill_id = style_to_fill[sty] if sty < len(style_to_fill) else 0
                    if isinstance(val, str) and is_brandish(val):
                        brand = val.strip()
                        if style_is_colored(sty):
                            style_brand[sty] = brand
                            fill_brand[fill_id] = brand
                        c = style_color(sty)
                        if c:
                            brand_color_hint[brand] = c

    # ── Resolve dates: determine month for each day number ────────────────────
    def resolve_date(week_index, day_name, day_num):
        """April 2026 starts on Wed. Week 0 Mon/Tue = March 30/31. Last week Fri = May 1."""
        if week_index == 0 and day_num >= 28:
            return f'2026-03-{day_num:02d}'
        if day_num == 1 and day_name == 'FRIDAY' and week_index >= 3:
            return '2026-05-01'
        return f'2026-04-{day_num:02d}'

    # ── Second pass: extract assignments ──────────────────────────────────────
    assignments_text = {}  # date_str -> member -> [slot_values]
    day_keys = []
    all_brands_seen = {}

    for wi, ws_row in enumerate(week_starts):
        ws_end = week_starts[wi + 1] if wi + 1 < len(week_starts) else ws_row + 200
        day_cols_map = find_day_columns(ws_row)
        if not day_cols_map:
            print(f'  Week {wi+1}: no day headers found, skipping')
            continue

        member_rows_this_week = find_member_rows(ws_row, ws_end)

        for day_name, (day_col_num, day_num) in day_cols_map.items():
            date_str = resolve_date(wi, day_name, day_num)
            if date_str not in assignments_text:
                assignments_text[date_str] = {}
                day_keys.append(date_str)

            for member_row, member_name in member_rows_this_week:
                if member_name not in assignments_text[date_str]:
                    assignments_text[date_str][member_name] = [None] * 20

                # Determine slot count by scanning rightward until we hit another day's column
                other_day_cols = sorted(c for dn, (c, _) in day_cols_map.items() if c != day_col_num)
                max_col = (other_day_cols[0] - 1) if other_day_cols and other_day_cols[0] > day_col_num else (day_col_num + 25)

                # Collect explicit text values
                explicit = {}
                explicit_by_style = {}
                explicit_by_fill = {}
                cell_styles = {}
                cell_fills = {}

                slot_idx = 0
                for col_num in range(day_col_num, max_col + 1):
                    if slot_idx >= 20:
                        break
                    ref = f'{num_to_col(col_num)}{member_row}'
                    val, sty = get_cell(ref)
                    fill_id = style_to_fill[sty] if sty < len(style_to_fill) else 0
                    cell_styles[slot_idx] = sty
                    cell_fills[slot_idx] = fill_id

                    if isinstance(val, str) and is_brandish(val):
                        brand = val.strip()
                        explicit[slot_idx] = brand
                        assignments_text[date_str][member_name][slot_idx] = brand
                        all_brands_seen[brand] = all_brands_seen.get(brand, 0) + 1

                        if style_is_colored(sty):
                            style_brand[sty] = brand
                            fill_brand[fill_id] = brand
                            explicit_by_style[sty] = brand
                            explicit_by_fill[fill_id] = brand
                        c = style_color(sty)
                        if c:
                            brand_color_hint[brand] = c
                    slot_idx += 1

                # Style-based inference for slots without explicit text
                explicit_any = bool(explicit)
                slot_idx2 = 0
                for col_num in range(day_col_num, max_col + 1):
                    if slot_idx2 >= 20:
                        break
                    if assignments_text[date_str][member_name][slot_idx2] is not None:
                        slot_idx2 += 1
                        continue
                    sty = cell_styles.get(slot_idx2, 0)
                    fill_id = cell_fills.get(slot_idx2, 0)
                    if not style_is_colored(sty):
                        slot_idx2 += 1
                        continue
                    b = style_brand.get(sty) or fill_brand.get(fill_id)
                    if not b:
                        slot_idx2 += 1
                        continue
                    if explicit_any:
                        # Only infer if adjacent slot or same style as known explicit
                        left_match = explicit.get(slot_idx2 - 1) == b
                        right_match = explicit.get(slot_idx2 + 1) == b
                        style_match = explicit_by_style.get(sty) == b
                        fill_match = explicit_by_fill.get(fill_id) == b
                        if left_match or right_match or style_match or fill_match:
                            assignments_text[date_str][member_name][slot_idx2] = b
                    else:
                        assignments_text[date_str][member_name][slot_idx2] = b
                    slot_idx2 += 1

        print(f'  Week {wi+1}: {len(day_cols_map)} days found → {list(day_cols_map.keys())}')

    # ── Build brand list with colors ──────────────────────────────────────────
    palette = ['#2D6A4F', '#1D3557', '#8F2D56', '#CA6702', '#6A4C93', '#264653', '#386641', '#9D4EDD', '#1B998B', '#D62828']
    brands = []
    p = 0
    for idx, name in enumerate(sorted(all_brands_seen.keys()), start=1):
        color = brand_color_hint.get(name)
        if not color or color == '#000000':
            color = palette[p % len(palette)]
            p += 1
        brands.append({'id': f'b{idx}', 'name': name, 'color': color})

    # ── Output (brand NAMES in assignments — required by app's importFromJson) ─
    result = {
        'members': members,
        'brands': brands,
        'assignments': assignments_text,   # values are brand names, NOT IDs
        'dayKeys': sorted(day_keys)
    }

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f'\n✓ Written to {OUTPUT_FILE}')
    print(f'  Members : {len(members)}')
    print(f'  Brands  : {len(brands)} → {[b["name"] for b in brands]}')
    print(f'  Days    : {len(day_keys)} → {sorted(day_keys)}')

import json
import re
import zipfile
import xml.etree.ElementTree as ET
from colorsys import rgb_to_hls, hls_to_rgb
from pathlib import Path

EXCEL_FILE = "2026 - Timing_Map_DXI (1).xlsx"
SHEET_INDEX = 2  # "Timing APR" is the 3rd sheet (0-indexed)
OUTPUT_FILE = "april_import.json"

NS = {
    'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'x': 'http://schemas.openxmlformats.org/drawingml/2006/main'
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
    """Check if a cell value looks like a brand name (not noise or time)"""
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

with zipfile.ZipFile(EXCEL_FILE) as z:
    # Extract shared strings
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

    # Extract theme colors
    theme = ET.fromstring(z.read('xl/theme/theme1.xml'))
    clr_scheme = theme.find('.//x:clrScheme', NS)
    theme_colors = []
    for node in list(clr_scheme):
        srgb = node.find('x:srgbClr', NS)
        sysc = node.find('x:sysClr', NS)
        theme_colors.append(srgb.attrib['val'] if srgb is not None else sysc.attrib.get('lastClr', '000000'))

    # Extract styles and fills
    styles = ET.fromstring(z.read('xl/styles.xml'))
    fills = styles.find('a:fills', NS)
    fill_attrs = []
    for fill in fills.findall('a:fill', NS):
        pf = fill.find('a:patternFill', NS)
        fg = pf.find('a:fgColor', NS) if pf is not None else None
        fill_attrs.append(fg.attrib if fg is not None else {})

    xfs = styles.find('a:cellXfs', NS)
    style_to_fill = [int(x.attrib.get('fillId', 0)) for x in xfs.findall('a:xf', NS)]

    # Read the specific sheet (Timing APR = sheet 2, so worksheets/sheet3.xml)
    sheet_path = f'xl/worksheets/sheet{SHEET_INDEX + 1}.xml'
    sheet = ET.fromstring(z.read(sheet_path))

    # Extract cell values and styles
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

    # Extract merged cells
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

    # ─────── Extract members list ───────
    members = []
    for row_idx in range(8, 45):
        name = values.get(f'B{row_idx}')
        if isinstance(name, str) and name.strip():
            members.append(name.strip())

    print(f"Found {len(members)} members")

    # ─────── Day columns and row structure for April ───────
    day_cols = ['D', 'AP', 'CB', 'DN']  # columns for days (adjusted for April layout)
    week_rows = [8, 52, 94, 136, 178]  # week start rows (approximate, adjust if needed)

    # Collect brand color hints + style/fill → brand mapping
    brand_color_hint = {}
    style_brand = {}
    fill_brand = {}

    # Look for legend/brands in the sheet (legend area)
    for row in range(1, 50):
        for col in ['D', 'E', 'F', 'G', 'H', 'I', 'J']:
            ref = f'{col}{row}'
            name = values.get(ref)
            if isinstance(name, str) and is_brandish(name):
                s = style_by_ref.get(ref, 0)
                f = style_to_fill[s] if s < len(style_to_fill) else 0
                if style_is_colored(s):
                    style_brand[s] = name.strip()
                    fill_brand[f] = name.strip()
                c = style_color(s)
                if c:
                    brand_color_hint[name.strip()] = c

    # ─────── Extract assignments ───────
    assignments_text = {}
    day_keys = []
    all_brands_seen = {}

    for member_idx, member in enumerate(members):
        member_row = 8 + member_idx * 2

        # Scan across columns to find assignments
        for day_pos in range(4):  # 4 weeks
            day_col = day_cols[day_pos] if day_pos < len(day_cols) else None
            if not day_col:
                continue

            day_col_num = col_to_num(day_col)

            # Find the week header to determine date
            header_row = 4 + day_pos * 44
            day_header = values.get(f'{day_col}{header_row}')
            if not day_header:
                continue

            # Parse day number from header
            day_match = re.search(r'\d+', str(day_header))
            if not day_match:
                continue

            day_num = int(day_match.group())
            # Adjust for March/May dates if necessary
            if day_pos == 0 and day_num > 20:
                date_str = f'2026-03-{day_num:02d}'
            elif day_num < 5 and day_pos >= 3:
                date_str = f'2026-05-{day_num:02d}'
            else:
                date_str = f'2026-04-{day_num:02d}'

            if date_str not in assignments_text:
                assignments_text[date_str] = {}
                if date_str not in day_keys:
                    day_keys.append(date_str)

            if member not in assignments_text[date_str]:
                assignments_text[date_str][member] = [None] * 20

            # Read slots
            for slot in range(20):
                if slot in (10, 11):  # lunch slots
                    assignments_text[date_str][member][slot] = 'LUNCH'
                    continue

                col_offset = 4 + slot
                col_num = day_col_num + col_offset
                col_letter = num_to_col(col_num)
                ref = f'{col_letter}{member_row}'

                val, sty = get_cell(ref)
                fill_id = style_to_fill[sty] if sty < len(style_to_fill) else 0

                # Check explicit text
                if isinstance(val, str) and is_brandish(val):
                    brand = val.strip()
                    assignments_text[date_str][member][slot] = brand
                    all_brands_seen[brand] = all_brands_seen.get(brand, len(all_brands_seen) + 1)

                    if style_is_colored(sty):
                        style_brand[sty] = brand
                        fill_brand[fill_id] = brand
                    c = style_color(sty)
                    if c:
                        brand_color_hint[brand] = c
                elif style_is_colored(sty):
                    # Infer from style if colored
                    b = style_brand.get(sty) or fill_brand.get(fill_id)
                    if b:
                        assignments_text[date_str][member][slot] = b

    # ─────── Generate brands with IDs and colors ───────
    palette = ['#2D6A4F', '#1D3557', '#8F2D56', '#CA6702', '#6A4C93', '#264653', '#386641', '#9D4EDD', '#1B998B', '#D62828']
    brands = []
    p = 0

    for idx, name in enumerate(sorted(all_brands_seen.keys()), start=1):
        bid = f'b{idx}'
        color = brand_color_hint.get(name)
        if not color or color == '#000000':
            color = palette[p % len(palette)]
            p += 1
        brands.append({'id': bid, 'name': name, 'color': color})

    # ─────── Output (with brand NAMES, not IDs, for importFromJson) ───────
    result = {
        'members': members,
        'brands': brands,
        'assignments': assignments_text,   # Keep brand NAMES for import resolution
        'dayKeys': sorted(day_keys)
    }

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"✓ Extracted to {OUTPUT_FILE}")
    print(f"  Members: {len(members)}")
    print(f"  Brands: {len(brands)}")
    print(f"  Days: {len(day_keys)}")
    if brands:
        print(f"  Brands: {[b['name'] for b in brands[:5]]}..." if len(brands) > 5 else f"  Brands: {[b['name'] for b in brands]}")
