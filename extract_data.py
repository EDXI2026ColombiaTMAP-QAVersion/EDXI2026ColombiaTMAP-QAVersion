import json
import re
import zipfile
import xml.etree.ElementTree as ET
from colorsys import rgb_to_hls, hls_to_rgb
from pathlib import Path

XLSX = Path('/Users/e069875/Library/CloudStorage/OneDrive-DanielJ.EdelmanHoldings,Inc/Escritorio/TEST_AI - Timing_Map_DXI.xlsx')
OUT = Path('/Users/e069875/Library/CloudStorage/OneDrive-DanielJ.EdelmanHoldings,Inc/Escritorio/AppTiming/data.js')

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

with zipfile.ZipFile(XLSX) as z:
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

    theme = ET.fromstring(z.read('xl/theme/theme1.xml'))
    clr_scheme = theme.find('.//x:clrScheme', NS)
    theme_colors = []
    for node in list(clr_scheme):
        srgb = node.find('x:srgbClr', NS)
        sysc = node.find('x:sysClr', NS)
        theme_colors.append(srgb.attrib['val'] if srgb is not None else sysc.attrib.get('lastClr', '000000'))

    styles = ET.fromstring(z.read('xl/styles.xml'))
    fills = styles.find('a:fills', NS)
    fill_attrs = []
    for fill in fills.findall('a:fill', NS):
        pf = fill.find('a:patternFill', NS)
        fg = pf.find('a:fgColor', NS) if pf is not None else None
        fill_attrs.append(fg.attrib if fg is not None else {})

    xfs = styles.find('a:cellXfs', NS)
    style_to_fill = [int(x.attrib.get('fillId', 0)) for x in xfs.findall('a:xf', NS)]

    sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
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
            # theme 0/1 are usually default black/white, not assignment colors here
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

    members = []
    for row in range(8, 45, 2):
        name = values.get(f'B{row}')
        if isinstance(name, str) and name.strip():
            members.append(name.strip())
    if len(members) == 19:
        members.append('Open Seat')

    # Collect brand color hints + global style/fill->brand mapping
    brand_color_hint = {}
    style_brand = {}
    fill_brand = {}

    # Legend anchors (brand names)
    legend_cols = ('D', 'AP', 'CB', 'DN')
    for row in range(177, 184):
        for col in legend_cols:
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

    week_rows = [8, 52, 94, 136]
    monday_dates = [2, 9, 16, 23]
    day_cols = ['D', 'AJ', 'BP', 'CV', 'EB']
    start_offset = 4
    slot_count = 18

    # First pass: learn style->brand from explicit text in schedule
    for w, base_row in enumerate(week_rows):
        for d, day_col in enumerate(day_cols):
            day_col_num = col_to_num(day_col)
            for i in range(19):
                row = base_row + i * 2
                for s in range(slot_count):
                    if s in (10, 11):
                        continue
                    cnum = day_col_num + start_offset + s
                    ref = f'{num_to_col(cnum)}{row}'
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

    day_keys = []
    assignments_text = {}

    for w, base_row in enumerate(week_rows):
        for d, day_col in enumerate(day_cols):
            day_num = monday_dates[w] + d
            day_key = f'2026-02-{day_num:02d}'
            day_keys.append(day_key)
            assignments_text[day_key] = {}
            day_col_num = col_to_num(day_col)

            for i, member in enumerate(members[:19]):
                row = base_row + i * 2
                arr = [None] * slot_count
                cell_style = [None] * slot_count
                cell_fill = [None] * slot_count
                explicit = [None] * slot_count
                for s in range(slot_count):
                    if s in (10, 11):
                        arr[s] = 'LUNCH'
                        continue
                    cnum = day_col_num + start_offset + s
                    ref = f'{num_to_col(cnum)}{row}'
                    val, sty = get_cell(ref)
                    fill_id = style_to_fill[sty] if sty < len(style_to_fill) else 0
                    cell_style[s] = sty
                    cell_fill[s] = fill_id
                    if isinstance(val, str) and is_brandish(val):
                        explicit[s] = val.strip()
                        arr[s] = explicit[s]

                # Guarded style-based inference:
                # 1) if this member/day has explicit labels, infer only adjacent same-brand cells
                # 2) if no explicit labels, infer only contiguous runs (>=2) of same-brand style matches
                explicit_any = any(x for x in explicit)
                explicit_by_style = {}
                explicit_by_fill = {}
                for s in range(slot_count):
                    if explicit[s]:
                        explicit_by_style[cell_style[s]] = explicit[s]
                        explicit_by_fill[cell_fill[s]] = explicit[s]

                candidate = [None] * slot_count
                for s in range(slot_count):
                    if s in (10, 11) or arr[s] is not None:
                        continue
                    sty = cell_style[s]
                    fill_id = cell_fill[s]
                    if not style_is_colored(sty):
                        continue
                    b = style_brand.get(sty) or fill_brand.get(fill_id)
                    if b:
                        candidate[s] = b

                if explicit_any:
                    for s in range(slot_count):
                        if candidate[s] is None:
                            continue
                        left = s - 1 >= 0 and explicit[s - 1] == candidate[s]
                        right = s + 1 < slot_count and explicit[s + 1] == candidate[s]
                        style_match = explicit_by_style.get(cell_style[s]) == candidate[s]
                        fill_match = explicit_by_fill.get(cell_fill[s]) == candidate[s]
                        if left or right or style_match or fill_match:
                            arr[s] = candidate[s]
                else:
                    s = 0
                    while s < slot_count:
                        if candidate[s] is None:
                            s += 1
                            continue
                        brand = candidate[s]
                        e = s
                        while e + 1 < slot_count and candidate[e + 1] == brand:
                            e += 1
                        run_len = e - s + 1
                        if run_len >= 2:
                            for k in range(s, e + 1):
                                arr[k] = brand
                        s = e + 1
                assignments_text[day_key][member] = arr

            open_arr = [None] * slot_count
            open_arr[10] = 'LUNCH'
            open_arr[11] = 'LUNCH'
            assignments_text[day_key]['Open Seat'] = open_arr

    all_brands = {}
    for day in assignments_text.values():
        for arr in day.values():
            for v in arr:
                if isinstance(v, str) and v != 'LUNCH':
                    all_brands[v] = all_brands.get(v, len(all_brands) + 1)

    palette = ['#2D6A4F', '#1D3557', '#8F2D56', '#CA6702', '#6A4C93', '#264653', '#386641', '#9D4EDD', '#1B998B', '#D62828']
    brands = []
    name_to_id = {}
    p = 0
    for idx, name in enumerate(sorted(all_brands.keys()), start=1):
        bid = f'b{idx}'
        color = brand_color_hint.get(name)
        if not color or color == '#000000':
            color = palette[p % len(palette)]
            p += 1
        brands.append({'id': bid, 'name': name, 'color': color})
        name_to_id[name] = bid

    assignments = {}
    for day_key in day_keys:
        assignments[day_key] = {}
        for member, arr in assignments_text[day_key].items():
            mapped = []
            for v in arr:
                if v == 'LUNCH':
                    mapped.append('LUNCH')
                elif v is None:
                    mapped.append(None)
                else:
                    mapped.append(name_to_id[v])
            assignments[day_key][member] = mapped

    result = {
        'members': members,
        'brands': brands,
        'assignments': assignments,
        'dayKeys': day_keys
    }

OUT.write_text('window.PRELOADED_DATA = ' + json.dumps(result, ensure_ascii=True, indent=2) + ';\n', encoding='utf-8')
print(f'wrote {OUT} | members={len(members)} brands={len(brands)} days={len(day_keys)}')
