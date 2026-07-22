// Supabase direct sync adapter for static hosting (GitHub Pages).
// Keeps the legacy function names used by app.js so the UI code can stay unchanged.

const DEFAULT_MIN_DATE = "2026-01-01";
const DEFAULT_MAX_DATE = "2026-12-31";
const SYNC_OUTBOX_STORAGE_KEY = "dxi-supabase-sync-outbox-v1";
const LEGACY_SLOT_COUNT = 20;
const CURRENT_SLOT_COUNT = 22;

let SUPABASE_URL = null;
let SUPABASE_PUBLISHABLE_KEY = null;

let _syncTimer = null;
let _pendingResolvers = [];
let _flushing = false;
let _pendingState = null;
let _retryDelayMs = 2000;
let _pendingChanges = createEmptyChangeSet();
let _activeChanges = null;
let _activeFlushPromise = null;
let _cachedMembers = [];
let _cachedBrands = [];
let _metadataCacheReady = false;

function createEmptyChangeSet() {
  return {
    assignmentRows: new Map(),
    memberChanges: new Map(),
    brandIds: new Set(),
    removedMemberNames: new Set(),
    removedBrandIds: new Set()
  };
}

function assignmentRowKey(workDate, member) {
  return JSON.stringify([workDate, member]);
}

function normalizeChangeSet(changes = {}) {
  const normalized = createEmptyChangeSet();
  if (!changes || typeof changes !== "object") return normalized;

  for (const row of changes.assignmentRows || []) {
    const workDate = typeof row?.workDate === "string"
      ? row.workDate
      : (typeof row?.dayKey === "string" ? row.dayKey : "");
    const member = typeof row?.member === "string" ? row.member : "";
    if (!workDate || !member) continue;
    const slots = Array.isArray(row?.slots) ? normalizeSlots([...row.slots]) : null;
    const memberId = typeof row?.memberId === "string" && row.memberId ? row.memberId : null;
    normalized.assignmentRows.set(assignmentRowKey(workDate, member), {
      workDate,
      member,
      ...(slots ? { slots } : {}),
      ...(memberId ? { memberId } : {})
    });
  }

  for (const change of changes.memberChanges || []) {
    const name = typeof change === "string" ? change : change?.name;
    const previousName = typeof change === "object" && typeof change?.previousName === "string"
      ? change.previousName
      : null;
    if (typeof name !== "string" || !name.trim()) continue;
    normalized.memberChanges.set(normalizeKey(name), { name, previousName });
  }

  for (const brandId of changes.brandIds || []) {
    if (typeof brandId === "string" && brandId) normalized.brandIds.add(brandId);
  }

  for (const memberName of changes.removedMemberNames || []) {
    if (typeof memberName === "string" && memberName) normalized.removedMemberNames.add(memberName);
  }

  for (const brandId of changes.removedBrandIds || []) {
    if (typeof brandId === "string" && brandId) normalized.removedBrandIds.add(brandId);
  }

  return normalized;
}

function mergeChangeSets(target, source) {
  for (const [key, row] of source.assignmentRows) target.assignmentRows.set(key, row);
  for (const [key, change] of source.memberChanges) target.memberChanges.set(key, change);
  for (const brandId of source.brandIds) target.brandIds.add(brandId);
  for (const memberName of source.removedMemberNames) target.removedMemberNames.add(memberName);
  for (const brandId of source.removedBrandIds) target.removedBrandIds.add(brandId);
  return target;
}

function hasChanges(changes) {
  return changes.assignmentRows.size > 0
    || changes.memberChanges.size > 0
    || changes.brandIds.size > 0
    || changes.removedMemberNames.size > 0
    || changes.removedBrandIds.size > 0;
}

function serializeChangeSet(changes) {
  return {
    assignmentRows: [...changes.assignmentRows.values()],
    memberChanges: [...changes.memberChanges.values()],
    brandIds: [...changes.brandIds],
    removedMemberNames: [...changes.removedMemberNames],
    removedBrandIds: [...changes.removedBrandIds]
  };
}

function readPersistedChangeSet() {
  try {
    const raw = window.localStorage?.getItem(SYNC_OUTBOX_STORAGE_KEY);
    if (!raw) return createEmptyChangeSet();
    return normalizeChangeSet(JSON.parse(raw));
  } catch (error) {
    console.warn("No se pudo leer la cola local de sincronizacion:", error.message);
    return createEmptyChangeSet();
  }
}

function persistOutbox() {
  if (typeof window === "undefined") return;

  const combined = createEmptyChangeSet();
  if (_activeChanges) mergeChangeSets(combined, _activeChanges);
  // Pending changes are newer than the in-flight snapshot and must win when
  // both refer to the same person and date.
  mergeChangeSets(combined, _pendingChanges);

  try {
    const storage = window.localStorage;
    if (!storage) return;

    // Persist schedule rows only: they are self-contained snapshots. Metadata
    // changes depend on additional local form state and are retried in memory.
    if (combined.assignmentRows.size > 0) {
      storage.setItem(
        SYNC_OUTBOX_STORAGE_KEY,
        JSON.stringify({ assignmentRows: [...combined.assignmentRows.values()] })
      );
    } else {
      storage.removeItem(SYNC_OUTBOX_STORAGE_KEY);
    }
  } catch (error) {
    console.warn("No se pudo guardar la cola local de sincronizacion:", error.message);
  }
}

function overlayPendingAssignments(remoteState) {
  const target = normalizeRemoteState(remoteState);
  const combined = createEmptyChangeSet();
  if (_activeChanges) mergeChangeSets(combined, _activeChanges);
  mergeChangeSets(combined, _pendingChanges);

  for (const row of combined.assignmentRows.values()) {
    if (!Array.isArray(row.slots)) continue;
    target.assignments[row.workDate] ||= {};
    target.assignments[row.workDate][row.member] = normalizeSlots([...row.slots]);
  }

  return target;
}

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

  return normalizeSlots(slots);
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

  const normalized = slots.map((value) => {
    if (value === undefined || value === ".") return null;
    return value;
  });

  if (normalized.length === LEGACY_SLOT_COUNT) {
    return [null, ...normalized, null];
  }

  return normalized.length > CURRENT_SLOT_COUNT
    ? normalized.slice(0, CURRENT_SLOT_COUNT)
    : normalized;
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

  _cachedMembers = Array.isArray(members) ? members.map((member) => ({ ...member })) : [];
  _cachedBrands = Array.isArray(brands) ? brands.map((brand) => ({ ...brand })) : [];
  _metadataCacheReady = true;

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

function buildMemberRecords(state, existingMembers, previousNamesByCurrent = new Map()) {
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
    const previousName = previousNamesByCurrent.get(normalizeKey(memberName));
    const existing = (employeeCode && byEmployeeCode.get(employeeCode))
      || byName.get(normalizeKey(memberName))
      || (previousName ? byName.get(normalizeKey(previousName)) : null);

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
        color: normalizePersistedBrandColor(brand.color),
        billing_code: brand.billingCode || null,
        active: true
      };
    });
}

function normalizePersistedBrandColor(color) {
  const normalized = String(color || "").trim();
  if (/^#[0-9a-f]{8}$/i.test(normalized)) return normalized.slice(0, 7);
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized;
  return "#CCCCCC";
}

function includeReferencedBrandsInChanges(state, assignmentSnapshots, existingBrands, changes) {
  const activeBrandIds = new Set(
    (existingBrands || [])
      .filter((brand) => brand?.active !== false)
      .map((brand) => brand.id)
  );
  const localBrandIds = new Set(
    (state.brands || [])
      .filter((brand) => brand && typeof brand.id === "string")
      .map((brand) => brand.id)
  );

  for (const snapshot of assignmentSnapshots) {
    for (const value of snapshot.slots || []) {
      if (!isRealAssignmentValue(value)) continue;
      if (activeBrandIds.has(value) || !localBrandIds.has(value)) continue;
      changes.brandIds.add(value);
    }
  }
}

async function saveDirectState(state, requestedChanges = {}) {
  const safeState = buildFullState(state);
  const changes = normalizeChangeSet(requestedChanges);

  // Capture the requested rows before the first network wait. Edits made while this
  // batch is in flight stay in the pending queue and are sent by the next batch.
  const assignmentSnapshots = [];
  for (const { workDate, member, slots: queuedSlots, memberId } of changes.assignmentRows.values()) {
    const sourceSlots = Array.isArray(queuedSlots)
      ? queuedSlots
      : safeState.assignments?.[workDate]?.[member];
    if (!Array.isArray(sourceSlots)) {
      throw new Error(`No se encontraron horas para "${member}" el ${workDate}.`);
    }
    assignmentSnapshots.push({
      workDate,
      member,
      memberId,
      slots: normalizeSlots([...sourceSlots])
    });
  }

  const metadataChanged = changes.memberChanges.size > 0
    || changes.brandIds.size > 0
    || changes.removedMemberNames.size > 0
    || changes.removedBrandIds.size > 0;

  let existingMembers;
  let existingBrands;
  if (_metadataCacheReady && !metadataChanged) {
    existingMembers = _cachedMembers.map((member) => ({ ...member }));
    existingBrands = _cachedBrands.map((brand) => ({ ...brand }));
  } else {
    [existingMembers, existingBrands] = await Promise.all([
      supabaseRequest("members?select=id,employee_code,name,active"),
      supabaseRequest("brands?select=id,legacy_index,name,color,billing_code,active")
    ]);
    _cachedMembers = (existingMembers || []).map((member) => ({ ...member }));
    _cachedBrands = (existingBrands || []).map((brand) => ({ ...brand }));
    _metadataCacheReady = true;
  }

  // An assignment can reference a locally-created brand before its standalone
  // metadata request finishes. Include that brand in this same batch so it is
  // upserted before the assignment row (notably the built-in Time Off brand).
  includeReferencedBrandsInChanges(safeState, assignmentSnapshots, existingBrands, changes);

  const previousNamesByCurrent = new Map(
    [...changes.memberChanges.values()]
      .filter((change) => change.previousName)
      .map((change) => [normalizeKey(change.name), change.previousName])
  );
  const changedMemberNames = new Set(changes.memberChanges.keys());
  const memberRecords = buildMemberRecords(
    safeState,
    existingMembers || [],
    previousNamesByCurrent
  ).filter((member) => changedMemberNames.has(normalizeKey(member.name)));

  const brandRecords = buildBrandRecords(safeState, existingBrands || [])
    .filter((brand) => changes.brandIds.has(brand.id));

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

  if (savedMembers.length) {
    const savedById = new Map(savedMembers.map((member) => [member.id, member]));
    _cachedMembers = _cachedMembers
      .filter((member) => !savedById.has(member.id))
      .concat(savedMembers.map((member) => ({ ...member })));
  }

  if (savedBrands.length) {
    const savedById = new Map(savedBrands.map((brand) => [brand.id, brand]));
    _cachedBrands = _cachedBrands
      .filter((brand) => !savedById.has(brand.id))
      .concat(savedBrands.map((brand) => ({ ...brand })));
  }

  const removedMemberKeys = new Set(
    [...changes.removedMemberNames].map((name) => normalizeKey(name))
  );
  const removedMemberIds = (existingMembers || [])
    .filter((member) => removedMemberKeys.has(normalizeKey(member.name)))
    .map((member) => member.id);

  if (removedMemberIds.length) {
    await supabaseRequest(`members?id=${buildInFilter(removedMemberIds)}`, {
      method: "PATCH",
      body: JSON.stringify({ active: false })
    });
    await supabaseRequest(`daily_assignments?member_id=${buildInFilter(removedMemberIds)}`, {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal"
      }
    });
    _cachedMembers = _cachedMembers.map((member) => (
      removedMemberIds.includes(member.id) ? { ...member, active: false } : member
    ));
  }

  const removedBrandIds = (existingBrands || [])
    .map((brand) => brand.id)
    .filter((id) => changes.removedBrandIds.has(id));

  if (removedBrandIds.length) {
    await supabaseRequest(`brands?id=${buildInFilter(removedBrandIds)}`, {
      method: "PATCH",
      body: JSON.stringify({ active: false })
    });
    _cachedBrands = _cachedBrands.map((brand) => (
      removedBrandIds.includes(brand.id) ? { ...brand, active: false } : brand
    ));
  }

  const availableMembers = [...(existingMembers || []), ...(savedMembers || [])];
  const availableBrands = [...(existingBrands || []), ...(savedBrands || [])];
  const memberIdByName = new Map(
    availableMembers.map((member) => [normalizeKey(member.name), member.id])
  );
  const brandLegacyById = new Map(
    availableBrands.map((brand) => [brand.id, brand.legacy_index])
  );

  const assignmentRows = [];
  for (const snapshot of assignmentSnapshots) {
    const { workDate, member, slots } = snapshot;
    const resolvedMemberId = snapshot.memberId || memberIdByName.get(normalizeKey(member));
    if (!resolvedMemberId) {
      throw new Error(`No se encontro el miembro "${member}" en Supabase.`);
    }

    const missingBrandId = slots.find(
      (value) => isRealAssignmentValue(value) && !brandLegacyById.has(value)
    );
    if (missingBrandId) {
      throw new Error(`No se encontro la marca "${missingBrandId}" en Supabase.`);
    }

    // Empty rows are intentionally upserted too. Otherwise erasing the final
    // assignment would leave the previous value stored in Supabase.
    assignmentRows.push({
      work_date: workDate,
      member_id: resolvedMemberId,
      assignment_pattern: encodeAssignmentPattern(slots, brandLegacyById),
      slots
    });
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
    assignments: assignmentRows.length,
    removedMembers: removedMemberIds.length,
    removedBrands: removedBrandIds.length
  };
}

async function loadDataFromSheet() {
  const config = getSupabaseConfig();

  if (!config) {
    console.warn("Supabase no configurado; la app usara los datos embebidos.");
    window.PRELOADED_DATA = overlayPendingAssignments(window.PRELOADED_DATA);
    return false;
  }

  try {
    const data = await loadDirectState();
    window.PRELOADED_DATA = overlayPendingAssignments(data);
    console.log(
      `Supabase cargado: ${data.members.length} miembros, ${data.brands.length} marcas, ${Object.keys(data.assignments).length} dias`
    );
    return true;
  } catch (error) {
    console.error("Error cargando Supabase:", error.message);
    window.PRELOADED_DATA = overlayPendingAssignments(window.PRELOADED_DATA);
    return false;
  }
}

function schedulePendingFlush(delayMs) {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    _flushPendingState();
  }, delayMs);
}

function syncDataToSheet(state, requestedChanges = {}) {
  const changes = normalizeChangeSet(requestedChanges);
  if (!hasChanges(changes)) return Promise.resolve(true);

  const cachedMemberIdByName = new Map(
    _cachedMembers.map((member) => [normalizeKey(member.name), member.id])
  );
  for (const [key, row] of changes.assignmentRows) {
    const sourceSlots = state?.assignments?.[row.workDate]?.[row.member];
    const slots = Array.isArray(row.slots)
      ? normalizeSlots([...row.slots])
      : (Array.isArray(sourceSlots) ? normalizeSlots([...sourceSlots]) : null);
    const memberId = row.memberId || cachedMemberIdByName.get(normalizeKey(row.member)) || null;
    changes.assignmentRows.set(key, {
      ...row,
      ...(slots ? { slots } : {}),
      ...(memberId ? { memberId } : {})
    });
  }

  _pendingState = state;
  mergeChangeSets(_pendingChanges, changes);
  persistOutbox();

  const promise = new Promise((resolve) => _pendingResolvers.push(resolve));
  schedulePendingFlush(2000);
  return promise;
}

function _flushPendingState() {
  if (_flushing) {
    if (hasChanges(_pendingChanges)) schedulePendingFlush(250);
    return _activeFlushPromise || Promise.resolve(false);
  }

  if (!hasChanges(_pendingChanges)) return Promise.resolve(true);
  if (!_pendingState) return Promise.resolve(false);

  const stateToSave = _pendingState;
  const changesToSave = _pendingChanges;
  const resolvers = _pendingResolvers.splice(0);
  _pendingChanges = createEmptyChangeSet();
  _activeChanges = changesToSave;
  _flushing = true;
  persistOutbox();

  _activeFlushPromise = (async () => {
    let succeeded = false;
    try {
      const result = await _sendChanges(stateToSave, serializeChangeSet(changesToSave));
      succeeded = result.ok;
      if (!result.ok) {
        // Requeue the failed snapshot first, then overlay changes made while it
        // was in flight so the newest value for a row always wins.
        const requeued = createEmptyChangeSet();
        mergeChangeSets(requeued, changesToSave);
        mergeChangeSets(requeued, _pendingChanges);
        _pendingChanges = requeued;
      }
      resolvers.forEach((resolve) => resolve(result.ok));
      return result.ok;
    } finally {
      _activeChanges = null;
      _flushing = false;
      _activeFlushPromise = null;
      if (succeeded) {
        _retryDelayMs = 2000;
      } else {
        _retryDelayMs = Math.min(_retryDelayMs * 2, 30000);
      }

      persistOutbox();
      if (hasChanges(_pendingChanges)) {
        schedulePendingFlush(succeeded ? 100 : _retryDelayMs);
      }
    }
  })();

  return _activeFlushPromise;
}

async function _sendChanges(state, requestedChanges) {
  try {
    const summary = await saveDirectState(state, requestedChanges);
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
  return flushPendingChangesNow();
}

async function flushPendingChangesNow() {
  clearTimeout(_syncTimer);
  _syncTimer = null;

  if (_flushing) {
    const activeSucceeded = await (_activeFlushPromise || Promise.resolve(false));
    if (!activeSucceeded) return false;
    return flushPendingChangesNow();
  }

  return _flushPendingState();
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

mergeChangeSets(_pendingChanges, readPersistedChangeSet());

function sanitizeResumedAssignmentBrands(stateToResume) {
  if (!stateToResume || !_pendingChanges.assignmentRows.size) return 0;

  const authoritativeBrands = _metadataCacheReady
    ? _cachedBrands
    : (Array.isArray(stateToResume.brands) ? stateToResume.brands : []);
  const validBrandIds = new Set(
    authoritativeBrands
      .filter((brand) => brand && brand.active !== false && typeof brand.id === "string")
      .map((brand) => brand.id)
  );
  const removedBrandIds = new Set();

  for (const [key, row] of _pendingChanges.assignmentRows) {
    const stateSlots = stateToResume.assignments?.[row.workDate]?.[row.member];
    const sourceSlots = Array.isArray(row.slots) ? row.slots : stateSlots;
    if (!Array.isArray(sourceSlots)) continue;

    let changed = false;
    const sanitizedSlots = normalizeSlots([...sourceSlots]).map((value) => {
      if (!isRealAssignmentValue(value) || validBrandIds.has(value)) return value;
      removedBrandIds.add(value);
      changed = true;
      return null;
    });

    if (!changed) continue;
    _pendingChanges.assignmentRows.set(key, { ...row, slots: sanitizedSlots });
    if (stateToResume.assignments?.[row.workDate]) {
      stateToResume.assignments[row.workDate][row.member] = [...sanitizedSlots];
    }
  }

  if (removedBrandIds.size > 0) {
    persistOutbox();
    console.warn(
      "Se limpiaron referencias de marcas antiguas de la cola local de sincronización:",
      [...removedBrandIds]
    );
  }

  return removedBrandIds.size;
}

function resumePendingChanges(stateToResume) {
  if (!stateToResume || !hasChanges(_pendingChanges)) return false;
  sanitizeResumedAssignmentBrands(stateToResume);
  _pendingState = stateToResume;
  schedulePendingFlush(100);
  return true;
}

async function initializeApp() {
  await loadDataFromSheet();

  if (typeof init === "function") {
    init();
  }

  const currentState = typeof state !== "undefined" ? state : null;
  resumePendingChanges(currentState);
}

if (typeof window !== "undefined") {
  window.reloadDataFromSource = loadDataFromSheet;
  window.flushPendingScheduleChanges = flushPendingChangesNow;
  window.addEventListener("pagehide", flushPendingChangesNow);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPendingChangesNow();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeApp);
} else {
  initializeApp();
}
