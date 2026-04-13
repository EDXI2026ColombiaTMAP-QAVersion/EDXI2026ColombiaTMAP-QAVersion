import zipfile, xml.etree.ElementTree as ET, re

NS = {'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'x': 'http://schemas.openxmlformats.org/drawingml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
XLSX = '2026 - Timing_Map_DXI (1).xlsx'
WEEK_LABELS = ['FIRST WEEK', 'SECOND WEEK', 'THIRD WEEK', 'FOURTH WEEK', 'FIFTH WEEK']
DAY_NAMES = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']

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

with zipfile.ZipFile(XLSX) as z:
    sst = ET.fromstring(z.read('xl/sharedStrings.xml'))
    shared = []
    for si in sst.findall('a:si', NS):
        t = si.find('a:t', NS)
        shared.append(t.text if t is not None and t.text else ''.join(r.find('a:t',NS).text or '' for r in si.findall('a:r',NS) if r.find('a:t',NS) is not None))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rid_map = {r.attrib['Id']: r.attrib['Target'] for r in rels}
    path = None
    for sh in wb.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet'):
        if sh.attrib.get('name') == 'Timing APR':
            rid = sh.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            path = 'xl/' + rid_map[rid]
    sheet = ET.fromstring(z.read(path))
    values = {}
    for cell in sheet.findall('.//a:c', NS):
        ref = cell.attrib['r']
        v = cell.find('a:v', NS)
        if v is not None:
            val = v.text
            if cell.attrib.get('t') == 's' and val is not None:
                val = shared[int(val)]
            values[ref] = val

# Check what day headers are found for each week
week_starts = [18, 60, 100, 140, 180]

print('=== Day headers by week ===')
for wi, ws_row in enumerate(week_starts):
    print(f'\nWeek {wi+1} starting at row {ws_row}:')
    # Scan rows ws_row to ws_row+10 for day names
    found_days = {}
    for r_off in range(0, 10):
        row_num = ws_row + r_off
        for col_num in range(col_to_num('C'), col_to_num('EZ') + 1):
            ref = f'{num_to_col(col_num)}{row_num}'
            val = values.get(ref)
            if val and isinstance(val, str):
                v = val.strip().upper()
                for dn in DAY_NAMES:
                    if v.startswith(dn):
                        date_m = re.search(r'\d+', val)
                        if date_m:
                            col_letter = num_to_col(col_num)
                            date_num = int(date_m.group())
                            print(f'  Row {row_num}: {col_letter}{row_num} = {repr(val)} (day={dn}, date={date_num})')
                            found_days[dn] = (col_num, date_num)
    
    # Show what columns C onward have for row ws_row
    print(f'  Row {ws_row} (header row):')
    for col_num in range(col_to_num('C'), col_to_num('H') + 1):
        ref = f'{num_to_col(col_num)}{ws_row}'
        val = values.get(ref)
        print(f'    {num_to_col(col_num)}{ws_row}: {repr(val)}')
