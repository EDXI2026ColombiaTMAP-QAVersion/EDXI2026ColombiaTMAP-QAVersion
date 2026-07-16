const DEFAULT_MIN_DATE = "2026-01-01";
const DEFAULT_MAX_DATE = "2026-12-31";
const LEGACY_SLOT_COUNT = 20;
const CURRENT_SLOT_COUNT = 22;

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function getConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/$/, ""),
    serviceRoleKey
  };
}

async function supabaseRequest(config, path, init = {}) {
  const headers = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    "Content-Type": "application/json",
    ...init.headers
  };

  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
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

function normalizeChangeSet(changes) {
  const normalized = createEmptyChangeSet();

  for (const row of Array.isArray(changes?.assignmentRows) ? changes.assignmentRows : []) {
    const workDate = typeof row?.workDate === "string"
      ? row.workDate
      : (typeof row?.dayKey === "string" ? row.dayKey : "");
    const member = typeof row?.member === "string" ? row.member : "";
    if (!workDate || !member) continue;
    normalized.assignmentRows.set(assignmentRowKey(workDate, member), { workDate, member });
  }

  for (const change of Array.isArray(changes?.memberChanges) ? changes.memberChanges : []) {
    const name = typeof change === "string" ? change : change?.name;
    const previousName = typeof change === "object" && typeof change?.previousName === "string"
      ? change.previousName
      : null;
    if (typeof name !== "string" || !name.trim()) continue;
    normalized.memberChanges.set(normalizeKey(name), { name, previousName });
  }

  for (const brandId of Array.isArray(changes?.brandIds) ? changes.brandIds : []) {
    if (typeof brandId === "string" && brandId) normalized.brandIds.add(brandId);
  }

  for (const memberName of Array.isArray(changes?.removedMemberNames) ? changes.removedMemberNames : []) {
    if (typeof memberName === "string" && memberName) {
      normalized.removedMemberNames.add(memberName);
    }
  }

  for (const brandId of Array.isArray(changes?.removedBrandIds) ? changes.removedBrandIds : []) {
    if (typeof brandId === "string" && brandId) normalized.removedBrandIds.add(brandId);
  }

  return normalized;
}

function hasChanges(changes) {
  return changes.assignmentRows.size > 0
    || changes.memberChanges.size > 0
    || changes.brandIds.size > 0
    || changes.removedMemberNames.size > 0
    || changes.removedBrandIds.size > 0;
}

async function loadState(config) {
  const [members, brands, assignments] = await Promise.all([
    supabaseRequest(
      config,
      "members?select=id,employee_code,name,active&active=eq.true&order=created_at.asc"
    ),
    supabaseRequest(
      config,
      "brands?select=id,legacy_index,name,color,billing_code,active&active=eq.true&order=legacy_index.asc"
    ),
    supabaseRequest(
      config,
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

async function saveMembers(config, memberRecords) {
  const savedMembers = [];
  const groups = [
    {
      records: memberRecords.filter((record) => record.id),
      path: "members?on_conflict=id&select=id,employee_code,name,active"
    },
    {
      records: memberRecords.filter((record) => !record.id && record.employee_code),
      path: "members?on_conflict=employee_code&select=id,employee_code,name,active"
    },
    {
      records: memberRecords.filter((record) => !record.id && !record.employee_code),
      path: "members?select=id,employee_code,name,active"
    }
  ];

  for (const group of groups) {
    for (const batch of chunkArray(group.records, 250)) {
      const result = await supabaseRequest(config, group.path, {
        method: "POST",
        headers: {
          Prefer: group.path.includes("on_conflict")
            ? "resolution=merge-duplicates,return=representation"
            : "return=representation"
        },
        body: JSON.stringify(batch)
      });
      savedMembers.push(...(result || []));
    }
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

async function saveState(config, state, requestedChanges) {
  const safeState = {
    members: Array.isArray(state?.members) ? state.members : [],
    brands: Array.isArray(state?.brands) ? state.brands : [],
    assignments: state?.assignments && typeof state.assignments === "object" ? state.assignments : {},
    memberDetails: state?.memberDetails && typeof state.memberDetails === "object" ? state.memberDetails : {}
  };
  const changes = normalizeChangeSet(requestedChanges);

  if (!hasChanges(changes)) {
    return {
      members: 0,
      brands: 0,
      assignments: 0,
      removedMembers: 0,
      removedBrands: 0
    };
  }

  const assignmentSnapshots = [];
  for (const { workDate, member } of changes.assignmentRows.values()) {
    const sourceSlots = safeState.assignments?.[workDate]?.[member];
    if (!Array.isArray(sourceSlots)) {
      throw new Error(`No se encontraron horas para "${member}" el ${workDate}.`);
    }
    assignmentSnapshots.push({
      workDate,
      member,
      slots: normalizeSlots([...sourceSlots])
    });
  }

  const [existingMembers, existingBrands] = await Promise.all([
    supabaseRequest(config, "members?select=id,employee_code,name,active"),
    supabaseRequest(config, "brands?select=id,legacy_index,name,color,billing_code,active")
  ]);

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
    ? await saveMembers(config, memberRecords)
    : [];

  const savedBrands = brandRecords.length
    ? await supabaseRequest(config, "brands?on_conflict=id&select=id,legacy_index,name,color,billing_code,active", {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(brandRecords)
      })
    : [];

  const removedMemberKeys = new Set(
    [...changes.removedMemberNames].map((name) => normalizeKey(name))
  );
  const removedMemberIds = (existingMembers || [])
    .filter((member) => removedMemberKeys.has(normalizeKey(member.name)))
    .map((member) => member.id);

  if (removedMemberIds.length) {
    await supabaseRequest(config, `members?id=${buildInFilter(removedMemberIds)}`, {
      method: "PATCH",
      body: JSON.stringify({ active: false })
    });
    await supabaseRequest(config, `daily_assignments?member_id=${buildInFilter(removedMemberIds)}`, {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal"
      }
    });
  }

  const removedBrandIds = (existingBrands || [])
    .map((brand) => brand.id)
    .filter((id) => changes.removedBrandIds.has(id));

  if (removedBrandIds.length) {
    await supabaseRequest(config, `brands?id=${buildInFilter(removedBrandIds)}`, {
      method: "PATCH",
      body: JSON.stringify({ active: false })
    });
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
  for (const { workDate, member, slots } of assignmentSnapshots) {
    const memberId = memberIdByName.get(normalizeKey(member));
    if (!memberId) {
      throw new Error(`No se encontro el miembro "${member}" en Supabase.`);
    }

    const missingBrandId = slots.find(
      (value) => isRealAssignmentValue(value) && !brandLegacyById.has(value)
    );
    if (missingBrandId) {
      throw new Error(`No se encontro la marca "${missingBrandId}" en Supabase.`);
    }

    assignmentRows.push({
      work_date: workDate,
      member_id: memberId,
      assignment_pattern: encodeAssignmentPattern(slots, brandLegacyById),
      slots
    });
  }

  for (const batch of chunkArray(assignmentRows, 250)) {
    await supabaseRequest(
      config,
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

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    if (req.method === "GET") {
      if ((req.query.action || "getData") !== "getData") {
        res.status(400).json({ success: false, error: "Unsupported GET action." });
        return;
      }

      const config = getConfig();
      const data = await loadState(config);
      res.status(200).json({ success: true, data });
      return;
    }

    if (req.method === "POST") {
      if (req.body?.action !== "saveData") {
        res.status(400).json({ success: false, error: "Unsupported POST action." });
        return;
      }

      const changes = req.body?.changes;
      if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
        res.status(400).json({
          success: false,
          error: "saveData requires an explicit changes object."
        });
        return;
      }

      const config = getConfig();
      const summary = await saveState(config, req.body.data, changes);
      res.status(200).json({
        success: true,
        message: "Supabase synchronized successfully.",
        ...summary
      });
      return;
    }

    res.status(405).json({ success: false, error: "Method not allowed." });
  } catch (error) {
    console.error("Supabase proxy error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
