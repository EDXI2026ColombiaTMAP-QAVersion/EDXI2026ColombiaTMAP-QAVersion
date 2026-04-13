import json

with open('april_import.json', encoding='utf-8') as f:
    data = json.load(f)
    
    print("="*70)
    print("VALENTINA ZARATE ASSIGNMENTS")
    print("="*70)
    
    for date in sorted(data['assignments'].keys()):
        if 'Valentina Zarate' in data['assignments'][date]:
            slots = data['assignments'][date]['Valentina Zarate']
            brands_in_date = [b for b in slots if b]
            if brands_in_date:
                print(f"\n{date}:")
                for i, brand in enumerate(slots):
                    if brand:
                        print(f"  Slot {i+1}: {brand}")
