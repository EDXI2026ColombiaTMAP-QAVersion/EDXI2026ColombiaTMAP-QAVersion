#!/usr/bin/env python3
"""
Diagnóstico del estado actual del Sheet y comparación con april_import.json
"""

import json
import os

SHEET_ID = "1aZQlQdszET32S_pM8et-L_T0tA6CZ-4uFKPuCWz3Vxo"

print(f"📊 Diagnóstico del Sheet: {SHEET_ID}\n")

# Verificar april_import.json
april_file = "april_import.json"
if os.path.exists(april_file):
    with open(april_file, 'r', encoding='utf-8') as f:
        april_data = json.load(f)
    
    print(f"✅ april_import.json encontrado:")
    print(f"   - Members: {len(april_data.get('members', []))} ({', '.join(april_data.get('members', [])[:3])}...)")
    print(f"   - Brands: {len(april_data.get('brands', []))} ({', '.join(april_data.get('brands', [])[:3])}...)")
    print(f"   - Days: {len(april_data.get('assignments', {}))} ({list(april_data.get('assignments', {}).keys())[:3]}...)")
    
    # Contar slots
    total_slots = 0
    for dayKey in april_data.get('assignments', {}):
        for member in april_data['assignments'][dayKey]:
            for slot in april_data['assignments'][dayKey][member]:
                if slot and slot != 'LUNCH':
                    total_slots += 1
    
    print(f"   - Total slots asignados: {total_slots}")
    print(f"\n💾 Pasos para re-importar:")
    print(f"   1. Abre la interfaz web")
    print(f"   2. Copia todo el contenido de {april_file}")
    print(f"   3. Pega en 'Importar JSON' y presiona 'Importar'")
    print(f"   4. Verifica en el navegador que aparezca: '✅ Datos cargados del Sheet: {len(april_data.get('members', []))} miembros'")
else:
    print(f"❌ No encontré {april_file}")

print(f"\n🔍 Estado actual del navegador:")
print(f"   - Accede a la aplicación web")
print(f"   - Abre Developer Tools (F12)")
print(f"   - Ve a Console")
print(f"   - Verifica que diga cuántos miembros y días se cargaron")
print(f"   - Si dice '0 días', entonces el Sheet está vacío")
