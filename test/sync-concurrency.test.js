const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ADAPTER_PATH = path.join(__dirname, "..", "sync-sheets.js");
const APP_PATH = path.join(__dirname, "..", "app.js");
const RAW_ADAPTER_SOURCE = fs.readFileSync(ADAPTER_PATH, "utf8");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");
const ADAPTER_SOURCE = `${RAW_ADAPTER_SOURCE}
;globalThis.__adapterForTests = {
  configureSupabaseSync,
  saveDirectState,
  syncDataToSheet,
  flushPendingChangesNow,
  resumePendingChanges,
  normalizeSlots
};`;

test("browser scripts can load together without redeclaring global constants", () => {
  assert.doesNotThrow(() => {
    new vm.Script(`${RAW_ADAPTER_SOURCE}\n${APP_SOURCE}`, {
      filename: "browser-scripts.js"
    });
  });
});

test("07:00, 07:30, 17:00 and 17:30 share the fringe treatment", () => {
  const storage = createMemoryStorage();
  const context = vm.createContext({
    localStorage: storage,
    window: { localStorage: storage }
  });

  vm.runInContext(
    `${APP_SOURCE}\n;globalThis.__slotsForTests = slots.map(({ label, isFringe }) => ({ label, isFringe }));`,
    context,
    { filename: APP_PATH }
  );

  const slotFlags = Object.fromEntries(
    JSON.parse(JSON.stringify(context.__slotsForTests))
      .map((slot) => [slot.label, slot.isFringe])
  );

  assert.equal(slotFlags["7:00"], true);
  assert.equal(slotFlags["7:30"], true);
  assert.equal(slotFlags["8:00"], false);
  assert.equal(slotFlags["16:30"], false);
  assert.equal(slotFlags["17:00"], true);
  assert.equal(slotFlags["17:30"], true);
});

test("the Lunch menu position compensates for page zoom and viewport edges", () => {
  const storage = createMemoryStorage();
  const context = vm.createContext({
    localStorage: storage,
    window: { localStorage: storage }
  });

  vm.runInContext(
    `${APP_SOURCE}\n;globalThis.__menuPositionForTests = calculateContextMenuPosition;`,
    context,
    { filename: APP_PATH }
  );

  const centered = context.__menuPositionForTests({
    clientX: 425,
    clientY: 255,
    menuWidth: 160,
    menuHeight: 40,
    viewportWidth: 1200,
    viewportHeight: 800,
    zoom: 0.85
  });
  assert.equal(centered.left, 500);
  assert.equal(centered.top, 300);

  const atBottomRight = context.__menuPositionForTests({
    clientX: 1195,
    clientY: 795,
    menuWidth: 160,
    menuHeight: 40,
    viewportWidth: 1200,
    viewportHeight: 800,
    zoom: 0.85
  });
  assert.ok(atBottomRight.left < 1200 / 0.85);
  assert.ok(atBottomRight.top < 800 / 0.85);
});

test("availability rows are ordered from highest to lowest Grand Total", () => {
  const storage = createMemoryStorage();
  const context = vm.createContext({
    localStorage: storage,
    window: { localStorage: storage }
  });

  vm.runInContext(
    `${APP_SOURCE}\n;globalThis.__availabilityComparatorForTests = compareAvailabilityRows;`,
    context,
    { filename: APP_PATH }
  );

  const rows = [
    { member: "Daniela Mahecha", total: 4.5 },
    { member: "Ana Piraquive", total: 15 },
    { member: "Nicolas Lopez", total: 13 },
    { member: "David Bautista", total: 6 }
  ];
  rows.sort(context.__availabilityComparatorForTests);

  assert.deepEqual(
    rows.map((row) => row.total),
    [15, 13, 6, 4.5]
  );
});

test("Time Off always uses the configured translucent gray", () => {
  const storage = createMemoryStorage();
  const context = vm.createContext({
    localStorage: storage,
    window: { localStorage: storage }
  });

  vm.runInContext(
    `${APP_SOURCE}\n;globalThis.__normalizeBrandForTests = normalizeBrandVisual;`,
    context,
    { filename: APP_PATH }
  );

  assert.equal(
    context.__normalizeBrandForTests({
      id: "time-off",
      name: "TIME OFF",
      color: "#F0F2F1",
      billingCode: "000000"
    }).color,
    "#d9d9d996"
  );
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return data === null || data === undefined ? "" : JSON.stringify(data);
    }
  };
}

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function createFakeSupabase() {
  const database = {
    members: [
      { id: "member-ana", employee_code: "001", name: "Ana", active: true },
      { id: "member-camilo", employee_code: "002", name: "Camilo", active: true }
    ],
    brands: [
      { id: "brand-1", legacy_index: 1, name: "Cliente", color: "#123456", billing_code: "100", active: true }
    ],
    assignments: new Map()
  };
  const operations = [];
  let remainingAssignmentFailures = 0;

  async function fetchImpl(input, init = {}) {
    const url = new URL(input);
    const resource = url.pathname.split("/rest/v1/")[1];
    const method = String(init.method || "GET").toUpperCase();
    operations.push({
      resource,
      method,
      url: url.toString(),
      body: init.body || null,
      keepalive: init.keepalive
    });

    if (resource === "members" && method === "GET") {
      return jsonResponse(clone(database.members));
    }

    if (resource === "brands" && method === "GET") {
      return jsonResponse(clone(database.brands));
    }

    if (resource === "daily_assignments" && method === "POST") {
      if (remainingAssignmentFailures > 0) {
        remainingAssignmentFailures -= 1;
        return jsonResponse({ message: "temporary failure" }, 500);
      }
      const rows = JSON.parse(init.body || "[]");
      for (const row of rows) {
        database.assignments.set(`${row.work_date}|${row.member_id}`, clone(row));
      }
      return jsonResponse(null, 204);
    }

    throw new Error(`Unexpected fake Supabase request: ${method} ${url}`);
  }

  return {
    database,
    operations,
    fetchImpl,
    failNextAssignmentWrite() {
      remainingAssignmentFailures += 1;
    }
  };
}

function loadAdapter(fetchImpl, localStorage = createMemoryStorage(), storageBlocked = false) {
  const window = {
    PRELOADED_DATA: null,
    addEventListener() {}
  };
  if (storageBlocked) {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("storage blocked");
      }
    });
  } else {
    window.localStorage = localStorage;
  }
  const document = {
    readyState: "loading",
    visibilityState: "visible",
    addEventListener() {}
  };
  const context = vm.createContext({
    URL,
    clearTimeout() {},
    console: { log() {}, warn() {}, error() {} },
    document,
    fetch: fetchImpl,
    setTimeout() { return 1; },
    window
  });

  vm.runInContext(ADAPTER_SOURCE, context, { filename: ADAPTER_PATH });
  context.__adapterForTests.configureSupabaseSync({
    url: "https://example.supabase.co",
    publishableKey: "test-key"
  });
  return context.__adapterForTests;
}

function initialState() {
  return {
    members: ["Ana", "Camilo"],
    memberDetails: {
      Ana: { memberId: "001" },
      Camilo: { memberId: "002" }
    },
    brands: [
      { id: "brand-1", name: "Cliente", color: "#123456", billingCode: "100" }
    ],
    assignments: {
      "2026-07-16": {
        Ana: [null, "LUNCH", null],
        Camilo: [null, "LUNCH", null]
      }
    }
  };
}

test("two stale clients preserve changes for different people on the same date", async () => {
  const fake = createFakeSupabase();
  const anaClient = loadAdapter(fake.fetchImpl);
  const camiloClient = loadAdapter(fake.fetchImpl);
  const anaState = initialState();
  const camiloState = initialState();

  anaState.assignments["2026-07-16"].Ana[0] = "brand-1";
  camiloState.assignments["2026-07-16"].Camilo[2] = "brand-1";

  await Promise.all([
    anaClient.saveDirectState(anaState, {
      assignmentRows: [{ workDate: "2026-07-16", member: "Ana" }]
    }),
    camiloClient.saveDirectState(camiloState, {
      assignmentRows: [{ workDate: "2026-07-16", member: "Camilo" }]
    })
  ]);

  assert.deepEqual(
    fake.database.assignments.get("2026-07-16|member-ana").slots,
    ["brand-1", "LUNCH", null]
  );
  assert.deepEqual(
    fake.database.assignments.get("2026-07-16|member-camilo").slots,
    [null, "LUNCH", "brand-1"]
  );
  assert.equal(
    fake.operations.some((operation) => operation.method === "DELETE"),
    false,
    "ordinary assignment saves must never delete a date range"
  );
});

test("18 simultaneous clients can save their own rows", async () => {
  const fake = createFakeSupabase();
  const memberNames = Array.from({ length: 18 }, (_, index) => `Person ${index + 1}`);
  fake.database.members = memberNames.map((name, index) => ({
    id: `member-${index + 1}`,
    employee_code: String(index + 1).padStart(3, "0"),
    name,
    active: true
  }));

  const sharedState = {
    members: memberNames,
    memberDetails: Object.fromEntries(memberNames.map((name, index) => [
      name,
      { memberId: String(index + 1).padStart(3, "0") }
    ])),
    brands: [
      { id: "brand-1", name: "Cliente", color: "#123456", billingCode: "100" }
    ],
    assignments: {
      "2026-07-16": Object.fromEntries(
        memberNames.map((name) => [name, [null, "LUNCH", null]])
      )
    }
  };

  await Promise.all(memberNames.map((member, index) => {
    const adapter = loadAdapter(fake.fetchImpl);
    const clientState = clone(sharedState);
    clientState.assignments["2026-07-16"][member][index % 2 === 0 ? 0 : 2] = "brand-1";
    return adapter.saveDirectState(clientState, {
      assignmentRows: [{ workDate: "2026-07-16", member }]
    });
  }));

  assert.equal(fake.database.assignments.size, 18);
  for (let index = 0; index < memberNames.length; index += 1) {
    const row = fake.database.assignments.get(`2026-07-16|member-${index + 1}`);
    assert.ok(row, `missing saved row for ${memberNames[index]}`);
    assert.equal(row.slots[index % 2 === 0 ? 0 : 2], "brand-1");
  }
});

test("erasing the final assignment upserts an empty row", async () => {
  const fake = createFakeSupabase();
  const adapter = loadAdapter(fake.fetchImpl);
  const state = initialState();
  fake.database.assignments.set("2026-07-16|member-ana", {
    work_date: "2026-07-16",
    member_id: "member-ana",
    assignment_pattern: "B1L.",
    slots: ["brand-1", "LUNCH", null]
  });

  await adapter.saveDirectState(state, {
    assignmentRows: [{ workDate: "2026-07-16", member: "Ana" }]
  });

  assert.deepEqual(
    fake.database.assignments.get("2026-07-16|member-ana").slots,
    [null, "LUNCH", null]
  );
});

test("legacy 07:30-17:30 rows migrate to 07:00-18:00 without shifting hours", () => {
  const fake = createFakeSupabase();
  const adapter = loadAdapter(fake.fetchImpl);
  const legacySlots = Array(20).fill(null);
  legacySlots[0] = "brand-1";
  legacySlots[11] = "LUNCH";
  legacySlots[12] = "LUNCH";
  legacySlots[19] = "brand-1";

  const migrated = clone(adapter.normalizeSlots(legacySlots));
  assert.equal(migrated.length, 22);
  assert.equal(migrated[0], null);
  assert.equal(migrated[1], "brand-1");
  assert.equal(migrated[12], "LUNCH");
  assert.equal(migrated[13], "LUNCH");
  assert.equal(migrated[20], "brand-1");
  assert.equal(migrated[21], null);
});

test("the debounce queue keeps every dirty person-date row", async () => {
  const fake = createFakeSupabase();
  const adapter = loadAdapter(fake.fetchImpl);
  const state = initialState();

  state.assignments["2026-07-16"].Ana[0] = "brand-1";
  const anaPromise = adapter.syncDataToSheet(state, {
    assignmentRows: [{ workDate: "2026-07-16", member: "Ana" }]
  });

  state.assignments["2026-07-16"].Camilo[2] = "brand-1";
  const camiloPromise = adapter.syncDataToSheet(state, {
    assignmentRows: [{ workDate: "2026-07-16", member: "Camilo" }]
  });

  await adapter.flushPendingChangesNow();
  assert.equal(await anaPromise, true);
  assert.equal(await camiloPromise, true);
  assert.equal(fake.database.assignments.size, 2);

  const assignmentWrites = fake.operations.filter(
    (operation) => operation.resource === "daily_assignments" && operation.method === "POST"
  );
  assert.equal(assignmentWrites.length, 1);
  assert.equal(JSON.parse(assignmentWrites[0].body).length, 2);
});

test("rapid consecutive flushes resolve successfully without keepalive requests", async () => {
  const fake = createFakeSupabase();
  const adapter = loadAdapter(fake.fetchImpl);
  const state = initialState();
  const savePromises = [];
  const flushPromises = [];

  for (let index = 0; index < 40; index += 1) {
    state.assignments["2026-07-16"].Ana = index % 2 === 0
      ? ["brand-1", "LUNCH", null]
      : [null, "LUNCH", "brand-1"];
    savePromises.push(adapter.syncDataToSheet(state, {
      assignmentRows: [{ workDate: "2026-07-16", member: "Ana" }]
    }));
    flushPromises.push(adapter.flushPendingChangesNow());
  }

  assert.deepEqual(await Promise.all(savePromises), Array(40).fill(true));
  assert.deepEqual(await Promise.all(flushPromises), Array(40).fill(true));
  assert.deepEqual(
    fake.database.assignments.get("2026-07-16|member-ana").slots,
    [null, "LUNCH", "brand-1"]
  );

  const assignmentWrites = fake.operations.filter(
    (operation) => operation.resource === "daily_assignments" && operation.method === "POST"
  );
  assert.ok(assignmentWrites.length >= 1);
  assert.equal(assignmentWrites.some((operation) => operation.keepalive === true), false);
});

test("a queued row keeps its snapshot if the UI state is replaced before flush", async () => {
  const fake = createFakeSupabase();
  const adapter = loadAdapter(fake.fetchImpl);
  const state = initialState();
  state.assignments["2026-07-16"].Ana[0] = "brand-1";

  const savePromise = adapter.syncDataToSheet(state, {
    assignmentRows: [{ workDate: "2026-07-16", member: "Ana" }]
  });
  state.assignments["2026-07-16"].Ana = [null, "LUNCH", null];

  await adapter.flushPendingChangesNow();
  assert.equal(await savePromise, true);
  assert.deepEqual(
    fake.database.assignments.get("2026-07-16|member-ana").slots,
    ["brand-1", "LUNCH", null]
  );
});

test("an assignment edit does not rewrite members or brands", async () => {
  const fake = createFakeSupabase();
  const adapter = loadAdapter(fake.fetchImpl);
  const state = initialState();
  state.assignments["2026-07-16"].Ana[0] = "brand-1";

  await adapter.saveDirectState(state, {
    assignmentRows: [{ workDate: "2026-07-16", member: "Ana" }]
  });

  const metadataWrites = fake.operations.filter(
    (operation) => ["members", "brands"].includes(operation.resource)
      && operation.method !== "GET"
  );
  assert.deepEqual(metadataWrites, []);
});

test("blocked localStorage does not block the network save", async () => {
  const fake = createFakeSupabase();
  const adapter = loadAdapter(fake.fetchImpl, null, true);
  const state = initialState();
  state.assignments["2026-07-16"].Ana[0] = "brand-1";

  const savePromise = adapter.syncDataToSheet(state, {
    assignmentRows: [{ workDate: "2026-07-16", member: "Ana" }]
  });
  await adapter.flushPendingChangesNow();

  assert.equal(await savePromise, true);
  assert.deepEqual(
    fake.database.assignments.get("2026-07-16|member-ana").slots,
    ["brand-1", "LUNCH", null]
  );
});

test("a transient failure leaves the dirty row queued for retry", async () => {
  const fake = createFakeSupabase();
  const adapter = loadAdapter(fake.fetchImpl);
  const state = initialState();
  state.assignments["2026-07-16"].Ana[0] = "brand-1";
  fake.failNextAssignmentWrite();

  const firstAttempt = adapter.syncDataToSheet(state, {
    assignmentRows: [{ workDate: "2026-07-16", member: "Ana" }]
  });
  await adapter.flushPendingChangesNow();

  assert.equal(await firstAttempt, false);
  assert.equal(fake.database.assignments.has("2026-07-16|member-ana"), false);

  await adapter.flushPendingChangesNow();
  assert.deepEqual(
    fake.database.assignments.get("2026-07-16|member-ana").slots,
    ["brand-1", "LUNCH", null]
  );
});

test("a newer edit wins when an older in-flight write fails", async () => {
  const fake = createFakeSupabase();
  const adapter = loadAdapter(fake.fetchImpl);
  const state = initialState();
  fake.failNextAssignmentWrite();

  state.assignments["2026-07-16"].Ana = ["brand-1", "LUNCH", null];
  const firstAttempt = adapter.syncDataToSheet(state, {
    assignmentRows: [{ workDate: "2026-07-16", member: "Ana" }]
  });
  const firstFlush = adapter.flushPendingChangesNow();

  state.assignments["2026-07-16"].Ana = [null, "LUNCH", "brand-1"];
  const newerAttempt = adapter.syncDataToSheet(state, {
    assignmentRows: [{ workDate: "2026-07-16", member: "Ana" }]
  });

  assert.equal(await firstFlush, false);
  assert.equal(await firstAttempt, false);
  await adapter.flushPendingChangesNow();
  assert.equal(await newerAttempt, true);
  assert.deepEqual(
    fake.database.assignments.get("2026-07-16|member-ana").slots,
    [null, "LUNCH", "brand-1"]
  );
});

test("a pending schedule row survives a browser reload through the outbox", async () => {
  const fake = createFakeSupabase();
  const localStorage = createMemoryStorage();
  const firstPage = loadAdapter(fake.fetchImpl, localStorage);
  const firstState = initialState();
  firstState.assignments["2026-07-16"].Ana[0] = "brand-1";

  firstPage.syncDataToSheet(firstState, {
    assignmentRows: [{ workDate: "2026-07-16", member: "Ana" }]
  });

  const reloadedPage = loadAdapter(fake.fetchImpl, localStorage);
  const staleRemoteState = initialState();
  assert.equal(reloadedPage.resumePendingChanges(staleRemoteState), true);
  assert.equal(await reloadedPage.flushPendingChangesNow(), true);

  assert.deepEqual(
    fake.database.assignments.get("2026-07-16|member-ana").slots,
    ["brand-1", "LUNCH", null]
  );
  assert.equal(localStorage.getItem("dxi-supabase-sync-outbox-v1"), null);
});

test("a stale brand reference is removed from the persisted outbox on reload", async () => {
  const fake = createFakeSupabase();
  const localStorage = createMemoryStorage();
  localStorage.setItem(
    "dxi-supabase-sync-outbox-v1",
    JSON.stringify({
      assignmentRows: [{
        workDate: "2026-07-16",
        member: "Ana",
        memberId: "member-ana",
        slots: ["brand-that-no-longer-exists", "LUNCH", "brand-1"]
      }]
    })
  );

  const adapter = loadAdapter(fake.fetchImpl, localStorage);
  const restoredState = initialState();
  restoredState.assignments["2026-07-16"].Ana = [
    "brand-that-no-longer-exists",
    "LUNCH",
    "brand-1"
  ];

  assert.equal(adapter.resumePendingChanges(restoredState), true);
  assert.equal(await adapter.flushPendingChangesNow(), true);
  assert.deepEqual(
    fake.database.assignments.get("2026-07-16|member-ana").slots,
    [null, "LUNCH", "brand-1"]
  );
  assert.equal(localStorage.getItem("dxi-supabase-sync-outbox-v1"), null);
});
