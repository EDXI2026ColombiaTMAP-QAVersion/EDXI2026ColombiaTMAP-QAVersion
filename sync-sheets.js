// Supabase direct sync adapter for static hosting (GitHub Pages).
// Keeps the legacy function names used by app.js so the UI code can stay unchanged.

const DEFAULT_MIN_DATE = "2026-01-01";
const DEFAULT_MAX_DATE = "2026-12-31";

let SUPABASE_URL = null;
let SUPABASE_PUBLISHABLE_KEY = null;

let _syncTimer = null;
let _pendingResolvers = [];
let _flushing = false;

function createEmptyPreloadedData() {
  return {
    members: [],
    brands: [],
    assignments: {},
    memberDetails: {}
  };
}

function normalizeRemoteState(data) {
  const normalized = createEmptyPreloadedData();
  if (!data || typeof data !== "object") return normalized;

  normalized.members = Array.isArray(data.members)
    ? data.members.filter((member) => typeof member === "string" && member.trim())
    : [];

  normalized.brands = Array.isArray(data.brands)
    ? data.brands
        .filter((brand) => brand && typeof brand === "object" && typeof brand.id === "string")
        .map((brand) => ({
          id: brand.id,
          name: typeof brand.name === "string" ? brand.name : "",
          color: typeof brand.color === "string" ? brand.color : "#CCCCCC",
          billingCode: typeof brand.billingCode === "string"
            ? brand.billingCode
            : (typeof brand.billing_code === "string" ? brand.billing_code : "")
        }))
    : [];

  normalized.assignments = data.assignments && typeof data.assignments === "object"
    ? data.assignments
    : {};

  normalized.memberDetails = data.memberDetails && typeof data.memberDetails === "object"
    ? data.memberDetails
    : {};

  return normalized;
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function buildInFilter(values) {
  return `in.(${values.join(",")})`;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isRealAssignmentValue(value) {
  return value !== null && value !== undefined && value !== "" && value !== "." && value !== "LUNCH";
}

function decodeAssignmentPattern(pattern, brandsByLegacyIndex) {
  if (typeof pattern !== "string" || !pattern) return [];

  const slots = [];
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];

    if (char === ".") {
      slots.push(null);
      index += 1;
      continue;
    }

    if (char === "L") {
      slots.push("LUNCH");
      index += 1;
      continue;
    }

    if (char === "B") {
      let nextIndex = index + 1;
      while (nextIndex < pattern.length && /[0-9]/.test(pattern[nextIndex])) {
        nextIndex += 1;
      }

      const legacyKey = pattern.slice(index + 1, nextIndex);
      const brand = brandsByLegacyIndex.get(Number(legacyKey));
      slots.push(brand ? brand.id : null);
      index = nextIndex;
      continue;
    }

    slots.push(null);
    index += 1;
  }

  return slots;
}

function encodeAssignmentPattern(slots, brandLegacyById) {
  if (!Array.isArray(slots)) return "";

  return slots
    .map((value) => {
      if (value === null || value === undefined || value === ".") return ".";
      if (value === "LUNCH") return "L";

      const legacyIndex = brandLegacyById.get(value);
      return Number.isInteger(legacyIndex) ? `B${legacyIndex}` : ".";
    })
    .join("");
}

function normalizeSlots(slots) {
  if (!Array.isArray(slots)) return [];

  return slots.map((value) => {
    if (value === undefined || value === ".") return null;
    return value;
  });
}

function buildFullState(state) {
  return {
    members: Array.isArray(state?.members) ? [...state.members] : [],
    brands: Array.isArray(state?.brands)
      ? state.brands.map((brand) => ({
          id: brand.id,
          name: brand.name,
          color: brand.color,
          billingCode: brand.billingCode || ""
        }))
      : [],
    memberDetails: state?.memberDetails && typeof state.memberDetails === "object"
      ? { ...state.memberDetails }
      : {},
    assignments: state?.assignments && typeof state.assignments === "object"
      ? state.assignments
      : {}
  };
}

function getSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;

  return {
    url: SUPABASE_URL.replace(/\/$/, ""),
    key: SUPABASE_PUBLISHABLE_KEY
  };
}

async function supabaseRequest(path, init = {}) {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error("Supabase no esta configurado.");
  }

  const headers = {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    "Content-Type": "application/json",
    ...init.headers
  };

  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase ${response.status}: ${errorText}`);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function loadDirectState() {
  const [members, brands, assignments] = await Promise.all([
    supabaseRequest(
      "members?select=id,employee_code,name,active&active=eq.true&order=created_at.asc"
    ),
    supabaseRequest(
      "brands?select=id,legacy_index,name,color,billing_code,active&active=eq.true&order=legacy_index.asc"
    ),
    supabaseRequest(
      `daily_assignments?select=work_date,member_id,assignment_pattern,slots&work_date=gte.${DEFAULT_MIN_DATE}&work_date=lte.${DEFAULT_MAX_DATE}&order=work_date.asc`
    )
  ]);

  const brandsByLegacyIndex = new Map();
  const membersById = new Map();

  const normalizedMembers = Array.isArray(members)
    ? members.map((member) => {
        membersById.set(member.id, member);
        return member.name;
      })
    : [];

  const memberDetails = {};
  for (const member of members || []) {
    memberDetails[member.name] = {
      memberId: member.employee_code || ""
    };
  }

  const normalizedBrands = Array.isArray(brands)
    ? brands.map((brand) => {
        brandsByLegacyIndex.set(brand.legacy_index, brand);
        return {
          id: brand.id,
          name: brand.name,
          color: brand.color,
          billingCode: brand.billing_code || ""
        };
      })
    : [];

  const normalizedAssignments = {};
  for (const row of assignments || []) {
    const member = membersById.get(row.member_id);
    if (!member) continue;

    normalizedAssignments[row.work_date] ||= {};
    normalizedAssignments[row.work_date][member.name] = Array.isArray(row.slots)
      ? normalizeSlots(row.slots)
      : decodeAssignmentPattern(row.assignment_pattern, brandsByLegacyIndex);
  }

  return {
    members: normalizedMembers,
    brands: normalizedBrands,
    assignments: normalizedAssignments,
    memberDetails
  };
}

function buildMemberRecords(state, existingMembers) {
  const byEmployeeCode = new Map();
  const byName = new Map();

  for (const member of existingMembers) {
    if (member.employee_code) byEmployeeCode.set(member.employee_code, member);
    byName.set(normalizeKey(member.name), member);
  }

  const records = [];
  for (const memberName of state.members || []) {
    if (typeof memberName !== "string" || !memberName.trim()) continue;

    const employeeCode = String(state.memberDetails?.[memberName]?.memberId || "").trim() || null;
    const existing = (employeeCode && byEmployeeCode.get(employeeCode)) || byName.get(normalizeKey(memberName));

    records.push({
      ...(existing?.id ? { id: existing.id } : {}),
      employee_code: employeeCode,
      name: memberName,
      active: true
    });
  }

  return records;
}

async function saveMembers(memberRecords) {
  const savedMembers = [];

  const recordsWithId = memberRecords
    .filter((record) => record.id)
    .map((record) => ({
      id: record.id,
      employee_code: record.employee_code,
      name: record.name,
      active: record.active
    }));

  const recordsWithEmployeeCode = memberRecords
    .filter((record) => !record.id && record.employee_code)
    .map((record) => ({
      employee_code: record.employee_code,
      name: record.name,
      active: record.active
    }));

  const recordsWithoutIdOrEmployeeCode = memberRecords
    .filter((record) => !record.id && !record.employee_code)
    .map((record) => ({
      name: record.name,
      active: record.active
    }));

  for (const batch of chunkArray(recordsWithId, 250)) {
    const result = await supabaseRequest(
      "members?on_conflict=id&select=id,employee_code,name,active",
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(batch)
      }
    );
    savedMembers.push(...(result || []));
  }

  for (const batch of chunkArray(recordsWithEmployeeCode, 250)) {
    const result = await supabaseRequest(
      "members?on_conflict=employee_code&select=id,employee_code,name,active",
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(batch)
      }
    );
    savedMembers.push(...(result || []));
  }

  for (const batch of chunkArray(recordsWithoutIdOrEmployeeCode, 250)) {
    const result = await supabaseRequest(
      "members?select=id,employee_code,name,active",
      {
        method: "POST",
        headers: {
          Prefer: "return=representation"
        },
        body: JSON.stringify(batch)
      }
    );
    savedMembers.push(...(result || []));
  }

  return savedMembers;
}

function buildBrandRecords(state, existingBrands) {
  const byId = new Map(existingBrands.map((brand) => [brand.id, brand]));
  const usedLegacyIndexes = new Set(existingBrands.map((brand) => brand.legacy_index));
  let nextLegacyIndex = existingBrands.reduce(
    (max, brand) => Math.max(max, Number.isInteger(brand.legacy_index) ? brand.legacy_index : -1),
    -1
  ) + 1;

  return (state.brands || [])
    .filter((brand) => brand && typeof brand.id === "string")
    .map((brand) => {
      const existing = byId.get(brand.id);
      let legacyIndex = existing?.legacy_index;

      if (!Number.isInteger(legacyIndex)) {
        while (usedLegacyIndexes.has(nextLegacyIndex)) {
          nextLegacyIndex += 1;
        }
        legacyIndex = nextLegacyIndex;
        usedLegacyIndexes.add(legacyIndex);
        nextLegacyIndex += 1;
      }

      return {
        id: brand.id,
        legacy_index: legacyIndex,
        name: brand.name || "",
        color: brand.color || "#CCCCCC",
        billing_code: brand.billingCode || null,
        active: true
      };
    });
}

async function saveDirectState(state) {
  const safeState = buildFullState(state);

  const [existingMembers, existingBrands] = await Promise.all([
    supabaseRequest("members?select=id,employee_code,name,active"),
    supabaseRequest("brands?select=id,legacy_index,name,color,billing_code,active")
  ]);

  const memberRecords = buildMemberRecords(safeState, existingMembers || []);
  const brandRecords = buildBrandRecords(safeState, existingBrands || []);

  const savedMembers = memberRecords.length
    ? await saveMembers(memberRecords)
    : [];

  const savedBrands = brandRecords.length
    ? await supabaseRequest("brands?on_conflict=id&select=id,legacy_index,name,color,billing_code,active", {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(brandRecords)
      })
    : [];

  const activeMemberIds = new Set((savedMembers || []).map((member) => member.id));
  const activeBrandIds = new Set((savedBrands || []).map((brand) => brand.id));

  const staleMemberIds = (existingMembers || [])
    .map((member) => member.id)
    .filter((id) => !activeMemberIds.has(id));
  const staleBrandIds = (existingBrands || [])
    .map((brand) => brand.id)
    .filter((id) => !activeBrandIds.has(id));

  if (staleMemberIds.length) {
    await supabaseRequest(`members?id=${buildInFilter(staleMemberIds)}`, {
      method: "PATCH",
      body: JSON.stringify({ active: false })
    });
  }

  if (staleBrandIds.length) {
    await supabaseRequest(`brands?id=${buildInFilter(staleBrandIds)}`, {
      method: "PATCH",
      body: JSON.stringify({ active: false })
    });
  }

  const memberIdByName = new Map((savedMembers || []).map((member) => [member.name, member.id]));
  const brandLegacyById = new Map((savedBrands || []).map((brand) => [brand.id, brand.legacy_index]));
  const assignmentDates = Object.keys(safeState.assignments || {}).sort();
  const minDate = assignmentDates[0] || DEFAULT_MIN_DATE;
  const maxDate = assignmentDates[assignmentDates.length - 1] || DEFAULT_MAX_DATE;

  await supabaseRequest(
    `daily_assignments?work_date=gte.${minDate}&work_date=lte.${maxDate}`,
    {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal"
      }
    }
  );

  const assignmentRows = [];
  for (const [workDate, dayAssignments] of Object.entries(safeState.assignments || {})) {
    if (!dayAssignments || typeof dayAssignments !== "object") continue;

    for (const memberName of safeState.members) {
      const memberId = memberIdByName.get(memberName);
      const slots = normalizeSlots(dayAssignments[memberName]);
      if (!memberId || !slots.some(isRealAssignmentValue)) continue;

      assignmentRows.push({
        work_date: workDate,
        member_id: memberId,
        assignment_pattern: encodeAssignmentPattern(slots, brandLegacyById),
        slots
      });
    }
  }

  for (const batch of chunkArray(assignmentRows, 250)) {
    await supabaseRequest(
      "daily_assignments?on_conflict=work_date,member_id",
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(batch)
      }
    );
  }

  return {
    members: (savedMembers || []).length,
    brands: (savedBrands || []).length,
    assignments: assignmentRows.length
  };
}

async function loadDataFromSheet() {
  const config = getSupabaseConfig();

  if (!config) {
    console.warn("Supabase no configurado; la app usara los datos embebidos.");
    window.PRELOADED_DATA = normalizeRemoteState(window.PRELOADED_DATA);
    return false;
  }

  try {
    const data = await loadDirectState();
    window.PRELOADED_DATA = normalizeRemoteState(data);
    console.log(
      `Supabase cargado: ${data.members.length} miembros, ${data.brands.length} marcas, ${Object.keys(data.assignments).length} dias`
    );
    return true;
  } catch (error) {
    console.error("Error cargando Supabase:", error.message);
    window.PRELOADED_DATA = normalizeRemoteState(window.PRELOADED_DATA);
    return false;
  }
}

function syncDataToSheet(state) {
  const promise = new Promise((resolve) => _pendingResolvers.push(resolve));

  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _flushPendingState(state);
  }, 2000);

  return promise;
}

async function _flushPendingState(state) {
  if (_flushing) {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => {
      _flushPendingState(state);
    }, 800);
    return;
  }

  _flushing = true;
  try {
    const resolvers = _pendingResolvers.splice(0);
    const result = await _sendFullState(state);
    resolvers.forEach((resolve) => resolve(result.ok));
  } finally {
    _flushing = false;
  }
}

async function _sendFullState(state) {
  try {
    const summary = await saveDirectState(state);
    console.log(
      `Supabase sincronizado correctamente: ${summary.members} miembros, ${summary.brands} marcas, ${summary.assignments} asignaciones`
    );
    return { ok: true };
  } catch (error) {
    console.error("Error sincronizando Supabase:", error.message);
    return {
      ok: false,
      error: error.message
    };
  }
}

async function fullSyncToSheet() {
  const currentState = typeof state !== "undefined" ? state : null;
  if (!currentState) return false;

  const result = await _sendFullState(currentState);
  return result.ok;
}

function configureSupabaseSync(options = {}) {
  if (typeof options === "string") {
    SUPABASE_URL = options;
    return;
  }

  SUPABASE_URL = typeof options.url === "string" ? options.url : null;
  SUPABASE_PUBLISHABLE_KEY = typeof options.publishableKey === "string"
    ? options.publishableKey
    : null;
}

function configureSheetSync(arg1, arg2) {
  if (typeof arg1 === "object" && arg1 !== null) {
    configureSupabaseSync(arg1);
    return;
  }

  configureSupabaseSync({
    url: typeof arg1 === "string" ? arg1 : null,
    publishableKey: typeof arg2 === "string" ? arg2 : null
  });
}

async function initializeApp() {
  await loadDataFromSheet();

  if (typeof init === "function") {
    init();
  }
}

if (typeof window !== "undefined") {
  window.reloadDataFromSource = loadDataFromSheet;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeApp);
} else {
  initializeApp();
}
