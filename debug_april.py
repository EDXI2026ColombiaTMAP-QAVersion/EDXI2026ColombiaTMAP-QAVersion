"""Debug extract_april.py - see what's in the Excel file"""
import zipfile
import xml.etree.ElementTree as ET
import re

EXCEL_FILE = "2026 - Timing_Map_DXI (1).xlsx"
NS = {
    'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
}

with zipfile.ZipFile(EXCEL_FILE) as z:
    # Load shared strings
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

    # List all sheets
    wb_xml = ET.fromstring(z.read('xl/workbook.xml'))
    sheets = []
    for idx, sh in enumerate(wb_xml.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet')):
        sheets.append((idx, sh.attrib.get('name')))
    print("Available sheets:")
    for idx, name in sheets:
        print(f"  [{idx}] {name}")

    # Find Timing APR sheet
    rels_xml = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rid_to_target = {rel.attrib['Id']: rel.attrib['Target'] for rel in rels_xml}
    sheet_path = None
    for sh in wb_xml.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet'):
        if sh.attrib.get('name') == 'Timing APR':
            rid = sh.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            target = rid_to_target.get(rid, '')
            sheet_path = f'xl/{target}' if not target.startswith('/') else target.lstrip('/')
            break

    print(f"\nTiming APR sheet: {sheet_path}")

    # Load the sheet
    sheet = ET.fromstring(z.read(sheet_path))
    values = {}
    for cell in sheet.findall('.//a:c', NS):
        ref = cell.attrib['r']
        v = cell.find('a:v', NS)
        val = None
        if v is not None:
            val = v.text
            if cell.attrib.get('t') == 's' and val is not None:
                val = shared[int(val)]
        values[ref] = val

    # Show content by rows
    print("\n=== First 50 rows ===")
    for row in range(1, 51):
        row_content = []
        for col_idx in range(1, 15):  # A to N
            col_letter = chr(64 + col_idx)
            val = values.get(f'{col_letter}{row}')
            if val:
                row_content.append(f"{col_letter}:{val}")
        if row_content:
            print(f"Row {row:2d}: {', '.join(row_content)}")

    # Find member names (likely in column A or B)
    print("\n=== Column A & B (members area) ===")
    members = set()
    for row in range(1, 200):
        for col_letter in ['A', 'B', 'C']:
            val = values.get(f'{col_letter}{row}')
            if val and isinstance(val, str) and len(val.strip()) > 5:
                v = val.strip()
                # Filter out obvious headers
                if v.upper() not in ['TIMING APR', 'DXI HUB WEEKLY TIMING MAP', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']:
                    if 'WEEK' not in v.upper() or 'TIMING' not in v.upper():
                        if not re.fullmatch(r'[\d.\-/]+', v):
                            members.add(v)
    
    print(f"Potential members ({len(members)}):")
    for m in sorted(members)[:20]:
        print(f"  - {m}")
