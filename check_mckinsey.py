import json
with open('april_import.json', encoding='utf-8') as f:
    data = json.load(f)
    brand_counts = {}
    for date, members_dict in data['assignments'].items():
        for member, slots in members_dict.items():
            for brand in slots:
                if brand:
                    brand_counts[brand] = brand_counts.get(brand, 0) + 1
    
    if 'MCKINSEY (WEEKLY)' in brand_counts:
        print(f"MCKINSEY (WEEKLY): {brand_counts['MCKINSEY (WEEKLY)']} slots")
    else:
        print('MCKINSEY (WEEKLY): NOT FOUND (0 slots)')
    
    print(f'\nTotal assignments: {sum(brand_counts.values())}')
    print(f'Total brands: {len(brand_counts)}')
