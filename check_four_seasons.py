import json

with open('april_import.json', encoding='utf-8') as f:
    data = json.load(f)
    
    # Search for FOUR SEASONS assignments
    count_four_seasons = 0
    samples = []
    
    for date, members_dict in data['assignments'].items():
        for member, slots in members_dict.items():
            for slot_idx, brand in enumerate(slots):
                if brand == 'FOUR SEASONS (DAILY)':
                    count_four_seasons += 1
                    if len(samples) < 5:
                        samples.append({
                            'date': date,
                            'member': member,
                            'slot': slot_idx + 1
                        })
    
    print('='*70)
    print('FOUR SEASONS (DAILY) ASSIGNMENTS FOUND')
    print('='*70)
    print(f"Total assignments: {count_four_seasons}")
    print(f"\nFirst 5 examples:")
    for s in samples:
        print(f"  {s['date']} - {s['member']:25s} Slot {s['slot']}")
