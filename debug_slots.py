"""Debug: Show exact cell values for Daniela Mahecha on 2026-04-01 (Tuesday, week 1)"""
import zipfile
import xml.etree.ElementTree as ET

EXCEL_FILE = "2026 - Timing_Map_DXI (1).xlsx"
NS = {'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

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

    sheet = ET.fromstring(z.read('xl/worksheets/sheet3.xml'))
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

    # Daniela Mahecha is in row 21 (first week) or row 45 (second week), etc.
    # 2026-04-01 is Tuesday, which is column F (for week 1 starting row 18)
    # So we should read row 21, columns D onwards (D=day 1, E=timeslot 1, F=timeslot 2, ..., U=timeslot 20)
    
    print("=== Week 1: Daniela Mahecha (row 21) ===")
    print("\nMonday 2026-03-30 (col D onwards):")
    for col_letter in 'DEFGHIJKLMNOPQRSTU':
        val = values.get(f'{col_letter}21')
        col_num = ord(col_letter) - 64
        print(f"  {col_letter}{21} (col {col_num}): {val}")

    print("\nTuesday 2026-03-31 (col F [day header], E-U shifted by 2?):")
    # Actually, let me check the structure - is it D=Monday, F=Tuesday, H=Wednesday?
    # Or is each day column a header and the 20 slots spread across subsequent columns?
    
    # Let me show row 19 to see the day headers
    print("\n=== Row 19 (Time slots header) ===")
    for col_letter in 'DEFGHIJKLMNOPQRSTU':
        val = values.get(f'{col_letter}19')
        print(f"  {col_letter}19: {val}")
    
    print("\n=== Row 18 (Week header) ===")
    for col_letter in 'DEFGHIJKLMNOPQRSTU':
        val = values.get(f'{col_letter}18')
        print(f"  {col_letter}18: {val}")

    # Now show what's actually in row 21 (Daniela Mahecha week 1)
    print("\n=== Row 21 (Daniela Mahecha, Week 1 - all columns) ===")
    for col_letter in 'ABCDEFGHIJKLMNOPQRSTU':
        val = values.get(f'{col_letter}21')
        if val:
            col_num = ord(col_letter) - 64
            print(f"  {col_letter}21: {val}")
