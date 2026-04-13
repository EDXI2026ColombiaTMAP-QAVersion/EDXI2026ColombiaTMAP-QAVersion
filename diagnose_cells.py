import zipfile, xml.etree.ElementTree as ET, re

NS = {'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'x': 'http://schemas.openxmlformats.org/drawingml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
XLSX = '2026 - Timing_Map_DXI (1).xlsx'

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

# Check assignment cells for Gabriela and Camilo in week 1
print('=== Week 1: Gabriela Pelayo (B41) and Camilo Hernandez (B55) ===')

for name, row in [('Gabriela Pelayo', 41), ('Camilo Hernandez', 55)]:
    print(f'\n{name} (Row {row}):')
    # Check columns D through CV (where assignments should be)
    # D col = 4, AJ = 36, BP = 68, CV = 100, EB = 136
    for col_num in [4, 5, 6, 7, 8, 9, 10, 36, 37, 38, 39, 40]:
        col_letter = num_to_col(col_num)
        val = values.get(f'{col_letter}{row}')
        if val is not None:
            print(f'  {col_letter}{row}: {repr(val)}')

# Count total non-null values in assignment range
print('\n=== Total non-null assignment cells ===')
for name, row in [('Gabriela Pelayo', 41), ('Camilo Hernandez', 55)]:
    count = 0
    for col_num in range(col_to_num('C'), col_to_num('EZ') + 1):
        val = values.get(f'{num_to_col(col_num)}{row}')
        if val is not None:
            count += 1
    print(f'{name} (row {row}): {count} non-null cells')
