const DEFAULT_MIN_DATE = "2026-01-01";
const DEFAULT_MAX_DATE = "2026-12-31";

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

async function saveState(config, state) {
  const safeState = {
    members: Array.isArray(state?.members) ? state.members : [],
    brands: Array.isArray(state?.brands) ? state.brands : [],
    assignments: state?.assignments && typeof state.assignments === "object" ? state.assignments : {},
    memberDetails: state?.memberDetails && typeof state.memberDetails === "object" ? state.memberDetails : {}
  };

  const [existingMembers, existingBrands] = await Promise.all([
    supabaseRequest(config, "members?select=id,employee_code,name,active"),
    supabaseRequest(config, "brands?select=id,legacy_index,name,color,billing_code,active")
  ]);

  const memberRecords = buildMemberRecords(safeState, existingMembers || []);
  const brandRecords = buildBrandRecords(safeState, existingBrands || []);

  const savedMembers = memberRecords.length
    ? await supabaseRequest(config, "members?on_conflict=id&select=id,employee_code,name,active", {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(memberRecords)
      })
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

  const activeMemberIds = new Set((savedMembers || []).map((member) => member.id));
  const activeBrandIds = new Set((savedBrands || []).map((brand) => brand.id));

  const staleMemberIds = (existingMembers || [])
    .map((member) => member.id)
    .filter((id) => !activeMemberIds.has(id));
  const staleBrandIds = (existingBrands || [])
    .map((brand) => brand.id)
    .filter((id) => !activeBrandIds.has(id));

  if (staleMemberIds.length) {
    await supabaseRequest(config, `members?id=${buildInFilter(staleMemberIds)}`, {
      method: "PATCH",
      body: JSON.stringify({ active: false })
    });
  }

  if (staleBrandIds.length) {
    await supabaseRequest(config, `brands?id=${buildInFilter(staleBrandIds)}`, {
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
    config,
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
    assignments: assignmentRows.length
  };
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    const config = getConfig();

    if (req.method === "GET") {
      if ((req.query.action || "getData") !== "getData") {
        res.status(400).json({ success: false, error: "Unsupported GET action." });
        return;
      }

      const data = await loadState(config);
      res.status(200).json({ success: true, data });
      return;
    }

    if (req.method === "POST") {
      if (req.body?.action !== "saveData") {
        res.status(400).json({ success: false, error: "Unsupported POST action." });
        return;
      }

      const summary = await saveState(config, req.body.data);
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
