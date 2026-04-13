"""
Find what color is actually used for MCKINSEY in the Excel sheet
"""
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from colorsys import rgb_to_hls, hls_to_rgb
from collections import defaultdict

EXCEL_FILE = "2026 - Timing_Map_DXI (1).xlsx"
SHEET_NAME = "Timing APR"

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

def hex_to_rgb(value: str):
    value = value.strip('#')
    if len(value) == 8:
        value = value[2:]
    return tuple(int(value[i:i+2], 16) for i in (0, 2, 4))

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

def rgb_to_hex(rgb):
    return '#%02X%02X%02X' % rgb

with zipfile.ZipFile(EXCEL_FILE) as z:
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

    # Find sheet
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

    # Search for MCKINSEY in the sheet
    mckinsey_color_freq = defaultdict(int)
    mckinsey_found = {}
    
    for ref, val in values.items():
        if isinstance(val, str) and 'MCKINSEY' in val.upper():
            sty = style_by_ref.get(ref, 0)
            c = style_color(sty)
            print(f"Found MCKINSEY text at {ref}: '{val}' with color {c}")
            if c:
                mckinsey_color_freq[c] += 1
    
    print("\n" + "="*70)
    print("MCKINSEY TEXT COLORS")
    print("="*70)
    for color, count in sorted(mckinsey_color_freq.items(), key=lambda x: -x[1]):
        print(f"{color}: {count} instances")
