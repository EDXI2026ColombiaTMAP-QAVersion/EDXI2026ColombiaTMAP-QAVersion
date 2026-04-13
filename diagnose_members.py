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

# Find column B rows for these members
target_members = ['Gabriela Pelayo', 'Camilo Hernandez']
print('=== Finding target members in column B ===')
target_rows = {}
for r in range(1, 200):
    v = values.get(f'B{r}')
    if v in target_members:
        print(f'  B{r}: {repr(v)}')
        target_rows[v] = r

with open('april_import.json', encoding='utf-8') as f:
    data = json.load(f)

print('\n=== Checking extracted members ===')
for m in target_members:
    if m in data['members']:
        print(f'  YES: {m} in members list at index {data["members"].index(m)}')
    else:
        print(f'  NO: {m} NOT in members list')

print('\n=== Checking slot counts per day ===')
for m in target_members:
    total = 0
    dates_with_slots = 0
    for d in data['dayKeys']:
        asgn = data['assignments'].get(d, {}).get(m, [])
        slots = sum(1 for s in asgn if s)
        if slots > 0:
            total += slots
            dates_with_slots += 1
    print(f'  {m}: {total} total slots across {dates_with_slots} days')

# Now check column B rows for all members in first week
print('\n=== Column B rows 18-56 (First week members) ===')
for r in range(18, 57):
    v = values.get(f'B{r}')
    if v and not v.startswith('WEEK'):
        print(f'  B{r}: {repr(v)}')
