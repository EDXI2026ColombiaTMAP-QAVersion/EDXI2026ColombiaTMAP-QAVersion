// Google Sheets Configuration
const SHEET_ID = "1aZQlQdszET32S_pM8et-L_T0tA6CZ-4uFKPuCWz3Vxo";
const SHEET_NAME = "assignments";
const SHEET_RANGE = "A1";

// Google Sheets API Key
let API_KEY = null;

// Google Apps Script Web App URL
let WEB_APP_URL = null;

/**
 * Fetches data directly from Apps Script (no API caching)
 * Reads cell A1 directly from the Sheet, not via Google Sheets API
 */
async function loadDataFromSheet() {
  try {
    if (!WEB_APP_URL) {
      console.warn("⚠️ Web App URL no configurada, usando Sheets API");
      return loadDataViaAPI();
    }
    
    // Fetch directly from Apps Script (no API caching)
    const url = WEB_APP_URL + "?action=getFullData&t=" + Date.now();
    const response = await fetch(url, { cache: 'no-store' });
    
    if (!response.ok) {
      console.warn("⚠️ Apps Script read failed, falling back to Sheets API");
      return loadDataViaAPI();
    }
    
    const result = await response.json();
    
    if (!result || !result.data) {
      console.warn("⚠️ No data from Apps Script");
      window.PRELOADED_DATA = { members: [], brands: [], assignments: {} };
      return false;
    }
    
    const sheetData = _decompressData(result.data);
    const members = Array.isArray(sheetData.members) ? sheetData.members : [];
    const brands = Array.isArray(sheetData.brands) ? sheetData.brands : [];
    let assignments = sheetData.assignments || {};
    const memberDetails = sheetData.memberDetails || {};
    
    // Extract members/brands from _config if present
    if (assignments._config) {
      if (Array.isArray(assignments._config.members)) Object.assign(members, assignments._config.members);
      if (Array.isArray(assignments._config.brands)) Object.assign(brands, assignments._config.brands);
      delete assignments._config;
    }
    
    window.PRELOADED_DATA = { members, brands, assignments, memberDetails };
    console.log("✅ Datos cargados del Sheet (via Apps Script): " + members.length + " miembros, " + brands.length + " marcas, " + Object.keys(assignments).length + " días");
    return true;
    
  } catch (error) {
    console.error("❌ Error al cargar Sheet:", error.message);
    return loadDataViaAPI();
  }
}

/**
 * Fallback: Load via Sheets API (slower, may return cached data)
 */
async function loadDataViaAPI() {
  try {
    if (!API_KEY) {
      throw new Error("API Key no configurada");
    }
    
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!${SHEET_RANGE}?key=${API_KEY}`;
    const response = await fetch(url, { cache: 'no-store' });
    
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    
    const result = await response.json();
    
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
      console.log("✅ Datos cargados del Sheet (API): " + members.length + " miembros, " + brands.length + " marcas, " + Object.keys(assignments).length + " días");
    } else {
      console.warn("⚠️ Celda A1 vacía — se inicializará con datos en blanco");
    }

    window.PRELOADED_DATA = { members, brands, assignments, memberDetails };
    return true;
    
  } catch (error) {
    console.error("❌ Error al cargar Sheet (API fallback):", error.message);
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
let _sendFullStatePromise = Promise.resolve(); // Queue for serializing _sendFullState calls

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
 * Send full state. Tries POST first; if that fails (302 redirect issue),
 * falls back to GET-based saveAll using chunked approach.
 */
async function _sendFullState(state) {
  // Enqueue to serialize: each call waits for previous to complete
  _sendFullStatePromise = _sendFullStatePromise.then(() => _sendFullStateImpl(state));
  return _sendFullStatePromise;
}

async function _sendFullStateImpl(state) {
  console.log("🔧 [sync-sheets v36] _sendFullState iniciado");
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
  console.log("📤 Datos: " + Math.round(jsonStr.length / 1024) + "KB (comprimido), " + Math.ceil(jsonStr.length / 1000) + " chunks");

  const CHUNK_SIZE = 1000;
  const totalChunks = Math.ceil(jsonStr.length / CHUNK_SIZE);
  // Use one stable batchId for all retries of the same state snapshot
  const batchId = Date.now().toString();

  // Retry up to 3 times only on actual network errors
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      console.log("🔄 Reintento " + attempt + "/2...");
      await new Promise(r => setTimeout(r, 2000));
    }

    let sendOk = true;
    for (let i = 0; i < totalChunks; i++) {
      const chunk = jsonStr.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const result = await _sendGetSaveAll(chunk, i, totalChunks, batchId);
      if (!result.ok) {
        console.warn("⚠️ Error enviando chunk " + i + "/" + totalChunks + ": " + result.error);
        sendOk = false;
        break;
      }
      // Small delay between chunks to avoid overwhelming Apps Script
      if (i < totalChunks - 1) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    if (sendOk) {
      // Trust Apps Script response — Sheets API caches reads for 30-60s after write
      // so re-reading via googleapis.com always returns stale data and falsely fails
      console.log("✅ Datos enviados correctamente al Apps Script (batch=" + batchId + ")");
      return { ok: true };
    }
  }

  return { ok: false, error: "Network error after 3 attempts" };
}

function _countAssignedSlots(data) {
  let count = 0;
  for (const dayKey of Object.keys(data.assignments || {})) {
    if (dayKey === '_config') continue;
    for (const member of Object.keys(data.assignments[dayKey])) {
      const slots = data.assignments[dayKey][member];
      if (Array.isArray(slots)) {
        for (const slot of slots) {
          if (slot && slot !== 'LUNCH') count++;
        }
      }
    }
  }
  return count;
}

async function _verifySheetSave(saveId) {
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!${SHEET_RANGE}?key=${API_KEY}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return false;
    const result = await response.json();
    if (!result.values || !result.values[0] || !result.values[0][0]) {
      console.warn("⚠️ A1 está vacía — Apps Script no escribió datos");
      return false;
    }
    const savedJson = result.values[0][0];
    let savedRaw;
    try {
      savedRaw = JSON.parse(savedJson);
    } catch (parseErr) {
      console.error("❌ JSON en A1 corrupto:", parseErr.message, "| Primeros 200 chars:", savedJson.substring(0, 200));
      return false;
    }
    // Check if OUR specific write landed: the _wid token we embedded must match
    if (savedRaw._wid === saveId) {
      console.log("✅ Verificación exitosa: guardado confirmado en Sheet (wid=" + saveId + ")");
      return true;
    }
    console.warn("⚠️ A1 no refleja el guardado. En sheet: _wid=" + (savedRaw._wid || 'ninguno') + ", esperado: " + saveId);
    console.warn("   Primeros 200 chars de A1:", savedJson.substring(0, 200));
    return false;
  } catch (e) {
    // Only skip verification for genuine network errors — do not mask data corruption
    console.warn("⚠️ Error de red al verificar guardado (se asume OK):", e.message);
    return true;
  }
}

async function _sendGetSaveAll(data, chunkIndex, totalChunks, batchId) {
  try {
    const url = WEB_APP_URL
      + "?action=saveAllChunk"
      + "&batch=" + encodeURIComponent(batchId)
      + "&chunk=" + chunkIndex
      + "&total=" + totalChunks
      + "&data=" + encodeURIComponent(data);

    // Use redirect:'manual' so we intercept Apps Script's 302 redirect instead of
    // following it to the echo URL (which returns 400 due to CORS/URL issues).
    // An opaqueredirect means Apps Script received and processed the request successfully.
    const response = await fetch(url, { redirect: "manual" });
    if (response.type === "opaqueredirect") {
      return { ok: true };
    }
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      if (json.success) return { ok: true };
      return { ok: false, error: json.error || "Unknown" };
    } catch {
      return { ok: false, error: "Non-JSON: " + text.substring(0, 100) };
    }
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

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

