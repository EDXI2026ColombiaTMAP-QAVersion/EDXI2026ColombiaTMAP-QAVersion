import zipfile, xml.etree.ElementTree as ET, re, json

NS = {'a': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'x': 'http://schemas.openxmlformats.org/drawingml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
XLSX = '2026 - Timing_Map_DXI (1).xlsx'
WEEK_LABELS = ['FIRST WEEK', 'SECOND WEEK', 'THIRD WEEK', 'FOURTH WEEK', 'FIFTH WEEK']
DAY_NAMES = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']

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

# Check ALL column B rows that match our targets to find proper row identification
print('=== All weeks: Gabriela Pelayo and Camilo Hernandez rows ===')
target_members = ['Gabriela Pelayo', 'Camilo Hernandez']
week_starts = [18, 60, 100, 140, 180]

for m in target_members:
    print(f'\n{m}:')
    for wi, ws in enumerate(week_starts):
        next_ws = week_starts[wi+1] if wi+1 < len(week_starts) else 200
        # Find this member in range [ws+1, next_ws-1]
        for r in range(ws+1, next_ws):
            if values.get(f'B{r}') == m:
                print(f'  Week {wi+1} (row {ws}): found at B{r}')
                # Check first few cells in that row for the day columns
                for col in ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']:
                    v = values.get(f'{col}{r}')
                    if v:
                        print(f'    {col}{r}: {repr(v)}')
                break

# Load extracted and count how items in the JSON
with open('april_import.json', encoding='utf-8') as f:
    data = json.load(f)

print('\n=== JSON data sanity check ===')
print(f'Members in JSON: {len(data["members"])}')
for idx, m in enumerate(data['members']):
    print(f'  {idx:2d}: {m}')
