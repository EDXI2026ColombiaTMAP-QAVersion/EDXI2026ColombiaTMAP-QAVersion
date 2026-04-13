// Google Sheets Configuration
const SHEET_ID = "1aZQlQdszET32S_pM8et-L_T0tA6CZ-4uFKPuCWz3Vxo";
const SHEET_NAME = "assignments";
const SHEET_RANGE = "A1";

// Google Sheets API Key
let API_KEY = null;

// Google Apps Script Web App URL
let WEB_APP_URL = null;

/**
 * Fetches data from Google Sheet using Sheets API
 * All data (members, brands, assignments) comes from the Sheet
 */
async function loadDataFromSheet() {
  try {
    if (!API_KEY) {
      throw new Error("API Key no configurada");
    }
    
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!${SHEET_RANGE}?key=${API_KEY}`;
    console.log("🔵 [loadDataFromSheet] Leyendo desde A1");
    const response = await fetch(url, { cache: 'no-store' });
    
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    
    const result = await response.json();
    console.log("🔵 [loadDataFromSheet] Resultado:", result.values ? ("datos en A1") : "vacío");
    let members = [];
    let brands = [];
    let assignments = {};
    let memberDetails = {};
    
    if (result.values && result.values[0] && result.values[0][0]) {
      const jsonString = result.values[0][0];
      const sheetData = _decompressData(JSON.parse(jsonString));
      members = Array.isArray(sheetData.members) ? sheetData.members : [];
      brands = Array.isArray(sheetData.brands) ? sheetData.brands : [];
      assignments = sheetData.assignments || {};
      memberDetails = sheetData.memberDetails || {};
      // Also check if members/brands were saved inside assignments as _config
      if (assignments._config) {
        if (Array.isArray(assignments._config.members) && assignments._config.members.length) members = assignments._config.members;
        if (Array.isArray(assignments._config.brands) && assignments._config.brands.length) brands = assignments._config.brands;
        delete assignments._config;
      }
      // If _config had no members, fall back to extracting from assignment keys
      if (!members.length && Object.keys(assignments).length) {
        const memberSet = new Set();
        for (const dayKey of Object.keys(assignments)) {
          for (const name of Object.keys(assignments[dayKey])) {
            memberSet.add(name);
          }
        }
        members = [...memberSet];
        console.log("✅ Members extraídos de assignments (fallback): " + members.length);
      }
      console.log("✅ Datos cargados del Sheet: " + members.length + " miembros, " + brands.length + " marcas, " + Object.keys(assignments).length + " días");
    } else {
      console.warn("⚠️ Celda A1 vacía — se inicializará con datos en blanco");
    }

    window.PRELOADED_DATA = { members, brands, assignments, memberDetails };
    return true;
    
  } catch (error) {
    console.error("❌ Error al cargar Sheet:", error.message);
    window.PRELOADED_DATA = { members: [], brands: [], assignments: {} };
    console.warn("⚠️ Sheet no disponible — datos vacíos");
    return false;
  }
}

/**
 * Sends a day to Google Sheet via fetch GET (GET survives 302 redirects)
 */
let _pendingDays = new Set();
let _syncTimer = null;
let _pendingResolvers = [];
let _flushing = false;

/**
 * Compress assignments before saving to Sheets.
 * Skips empty member-days (all null/LUNCH) and encodes slot arrays as compact strings.
 * Reduces size from ~163KB to ~5-10KB, well under the 50,000-char Sheets cell limit.
 *   null → '.'   LUNCH → 'L'   brandId → 'Bn' (e.g., 'B0', 'B1', 'B2')
 */
function _compressData(data) {
  const out = {
    _v: 2,
    members: data.members,
    brands: data.brands,
    memberDetails: data.memberDetails || {},
    assignments: {}
  };

  // Build brand ID → index map
  const brandMap = {};
  if (Array.isArray(data.brands)) {
    for (let i = 0; i < data.brands.length; i++) {
      brandMap[data.brands[i].id] = 'B' + i;
    }
  }

  for (const day of Object.keys(data.assignments)) {
    if (day === '_config') {
      out.assignments._config = data.assignments._config;
      continue;
    }
    const dayObj = data.assignments[day];
    if (!dayObj || typeof dayObj !== 'object') continue;

    const compDay = {};
    for (const member of Object.keys(dayObj)) {
      const slots = dayObj[member];
      if (!Array.isArray(slots)) continue;
      // Skip member-days with no brand assignments (only null/LUNCH)
      if (!slots.some(v => v !== null && v !== undefined && v !== 'LUNCH')) continue;
      compDay[member] = slots.map(v => {
        if (v === null || v === undefined) return '.';
        if (v === 'LUNCH') return 'L';
        return brandMap[v] || '.';
      }).join('');
    }
    if (Object.keys(compDay).length > 0) {
      out.assignments[day] = compDay;
    }
  }
  return out;
}

/**
 * Decompress data saved in v2 compact format back to slot arrays.
 * Days/members missing from compressed data are reconstructed by the app as empty.
 */
function _decompressData(data) {
  if (!data || !data._v || data._v < 2) return data; // already expanded
  const out = {
    members: data.members || [],
    brands: data.brands || [],
    memberDetails: data.memberDetails || {},
    assignments: {}
  };
  
  // Build brand index → ID map
  const brandIds = {};
  if (Array.isArray(data.brands)) {
    for (let i = 0; i < data.brands.length; i++) {
      brandIds['B' + i] = data.brands[i].id;
    }
  }

  for (const day of Object.keys(data.assignments)) {
    if (day === '_config') {
      out.assignments._config = data.assignments._config;
      continue;
    }
    out.assignments[day] = {};
    for (const member of Object.keys(data.assignments[day])) {
      const val = data.assignments[day][member];
      if (typeof val !== 'string') { out.assignments[day][member] = val; continue; }
      // Parse multi-char tokens: '.' → null, 'L' → LUNCH, 'B0'/'B1'/... → brandId
      const slots = [];
      let i = 0;
      while (i < val.length) {
        const c = val[i];
        if (c === '.') { slots.push(null); i++; }
        else if (c === 'L') { slots.push('LUNCH'); i++; }
        else if (c === 'B') {
          let j = i + 1;
          while (j < val.length && val[j] >= '0' && val[j] <= '9') j++;
          slots.push(brandIds[val.substring(i, j)] || null);
          i = j;
        } else {
          slots.push(null); i++;
        }
      }
      out.assignments[day][member] = slots;
    }
  }
  return out;
}

function syncDataToSheet(state, changedDays) {
  if (!WEB_APP_URL) {
    console.warn("⚠️  Web App URL no configurada.");
    return Promise.resolve(false);
  }

  if (changedDays) {
    if (Array.isArray(changedDays)) {
      for (const d of changedDays) _pendingDays.add(d);
    } else {
      _pendingDays.add(changedDays);
    }
  }

  _pendingDays.add("_config");

  const promise = new Promise(resolve => _pendingResolvers.push(resolve));

  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => _flushPendingDays(state), 2000);
  return promise;
}

async function _flushPendingDays(state) {
  if (_flushing) {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => _flushPendingDays(state), 1000);
    return;
  }

  _flushing = true;
  try {
    _pendingDays.clear();
    const resolvers = _pendingResolvers.splice(0);

    // Always send full state — avoids read-modify-write race condition
    console.log("🔄 Sincronizando estado completo al Sheet...");
    const result = await _sendFullState(state);

    if (result.ok) {
      console.log("✅ Estado sincronizado correctamente");
    } else {
      console.error("⚠️ Error sincronizando: " + result.error);
    }
    resolvers.forEach(r => r(result.ok));
  } finally {
    _flushing = false;
    if (_pendingDays.size > 0) {
      clearTimeout(_syncTimer);
      _syncTimer = setTimeout(() => _flushPendingDays(state), 500);
    }
  }
}

/**
 * Send full state in a single GET request (avoids CORS issues)
 */
async function _sendFullState(state) {
  console.log("🔍 [_sendFullState] state.members:", state.members.length);
  console.log("🔍 [_sendFullState] state.brands:", state.brands.length);
  console.log("🔍 [_sendFullState] state.assignments keys:", Object.keys(state.assignments || {}).length);
  
  // Build complete data
  const fullData = {
    members: state.members,
    brands: state.brands,
    memberDetails: state.memberDetails || {},
    assignments: {}
  };
  fullData.assignments._config = { members: state.members, brands: state.brands };
  for (const key of Object.keys(state.assignments)) {
    fullData.assignments[key] = state.assignments[key];
  }
  
  const compressed = _compressData(fullData);
  const jsonStr = JSON.stringify(compressed);
  console.log("📤 Datos: " + Math.round(jsonStr.length / 1024) + "KB (comprimido), " + jsonStr.length + " chars");

  // Send via GET (no CORS issues)
  try {
    const url = WEB_APP_URL + "?action=saveData&data=" + encodeURIComponent(jsonStr);
    
    const response = await fetch(url, { 
      method: "GET",
      cache: 'no-store'
    });

    if (!response.ok) {
      console.error("❌ HTTP error:", response.status);
      return { ok: false, error: "HTTP " + response.status };
    }

    const result = await response.json();
    
    if (result.success) {
      console.log("✅ Guardado exitoso via GET: " + jsonStr.length + " caracteres");
      return { ok: true };
    } else {
      console.error("❌ Respuesta GET negativa:", result.error);
      return { ok: false, error: result.error || "Unknown error" };
    }
  } catch (error) {
    console.error("❌ Error en _sendFullState:", error.message);
    return { ok: false, error: error.message };
  }
}

// DEPRECATED: This verification is no longer used because Sheets API caches reads for 30-60 seconds,
// making post-write verification unreliable. We now trust Apps Script's successful response.
/*
async function _verifySheetSave(expectedJsonStr) {
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!${SHEET_RANGE}?key=${API_KEY}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return false;
    const result = await response.json();
    if (!result.values || !result.values[0] || !result.values[0][0]) return false;
    const savedJson = result.values[0][0];
    const expectedData = _decompressData(JSON.parse(expectedJsonStr));
    const savedData = _decompressData(JSON.parse(savedJson));
    const expectedSlots = _countAssignedSlots(expectedData);
    const savedSlots = _countAssignedSlots(savedData);
    const ok = expectedSlots === savedSlots;
    if (ok) console.log(`✅ Verificación exitosa: ${savedSlots} slots asignados en Sheet`);
    else console.warn(`⚠️ Verificación: esperado ${expectedSlots} slots, Sheet tiene ${savedSlots}`);
    return ok;
  } catch (e) {
    console.warn("⚠️ No se pudo verificar el guardado:", e.message);
    return true; // don't block on network error during verify
  }
}
*/

// Full sync helper
async function fullSyncToSheet() {
  if (!WEB_APP_URL) {
    console.error("❌ Web App URL no configurada");
    return false;
  }
  const currentState = (typeof state !== 'undefined') ? state : null;
  if (!currentState) {
    console.error("❌ No hay datos para sincronizar");
    return false;
  }
  const result = await _sendFullState(currentState);
  return result.ok;
}

/**
 * Configure the API Key and Web App URL
 */
function configureSheetSync(apiKey, webAppUrl) {
  API_KEY = apiKey;
  WEB_APP_URL = webAppUrl;
}

/**
 * Initialize the app - always loads from Sheet first
 */
async function initializeApp() {
  await loadDataFromSheet();
  
  if (typeof init === "function") {
    init();
  }
}

// Auto-load when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeApp);
} else {
  initializeApp();
}

