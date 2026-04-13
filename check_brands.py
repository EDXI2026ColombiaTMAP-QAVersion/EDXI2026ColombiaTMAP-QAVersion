import json
with open('april_import.json', encoding='utf-8') as f:
    data = json.load(f)
    print('='*70)
    print('BRANDS WITH COLORS')
    print('='*70)
    for b in sorted(data['brands'], key=lambda x: x['name']):
        print(f"{b['name']:45s} : {b['color']}")
    
    print('\n' + '='*70)
    print("SAMPLE ASSIGNMENTS (2026-04-01)")
    print('='*70)
    date_sample = '2026-04-01'
    if date_sample in data['assignments']:
        count = 0
        for member, slots in list(data['assignments'][date_sample].items())[:3]:
            print(f"\n{member}:")
            for i, brand in enumerate(slots[:10]):
                if brand:
                    print(f"  Slot {i+1}: {brand}")
                    count += 1
                if count >= 5:
                    break
