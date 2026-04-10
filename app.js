// Safe localStorage wrapper (handles Firefox tracking prevention, private mode, etc.)
const safeStorage = {
  getItem: function(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  },
  setItem: function(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // Silent fail - data goes to Sheet, doesn't need local cache
    }
  },
  removeItem: function(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      // Silent fail
    }
  }
};

const STORAGE_KEY = "dxi-timing-map-2026-v13";

const fallbackColors = ["#2D6A4F", "#1D3557", "#8F2D56", "#CA6702", "#6A4C93", "#264653", "#386641", "#9D4EDD"];

function resolveDefaults() {
  const pre = window.PRELOADED_DATA || null;
  const members = pre?.members?.length ? pre.members : ["Open Seat"];
  const brands = 
    (pre?.brands?.length ? pre.brands : [{ id: "b1", name: "General", color: "#2D6A4F" }]).map((brand, idx) => ({
      ...brand,
      color: brand.color === "#000000" ? fallbackColors[idx % fallbackColors.length] : brand.color
    }));
  return { members, brands, pre };
}

// Month configuration: [year, monthIndex (0-based), label]
const MONTHS = [
  { year: 2026, month: 0, label: "Jan 2026" },
  { year: 2026, month: 1, label: "Feb 2026" },
  { year: 2026, month: 2, label: "Mar 2026" },
  { year: 2026, month: 3, label: "Apr 2026" },
  { year: 2026, month: 4, label: "May 2026" },
  { year: 2026, month: 5, label: "Jun 2026" },
  { year: 2026, month: 6, label: "Jul 2026" },
  { year: 2026, month: 7, label: "Aug 2026" },
  { year: 2026, month: 8, label: "Sep 2026" },
  { year: 2026, month: 9, label: "Oct 2026" },
  { year: 2026, month: 10, label: "Nov 2026" },
  { year: 2026, month: 11, label: "Dec 2026" },
];
let currentMonthIdx = 3;

// Colombian holidays 2026 (blocking dates - no editing allowed)
const COLOMBIAN_HOLIDAYS = {
  "2026-03-23": "Día de San José",
  "2026-04-02": "Jueves Santo",
  "2026-04-03": "Viernes Santo",
  "2026-05-01": "Día del Trabajo",
  "2026-05-18": "Ascensión de Jesús",
  "2026-06-08": "Corpus Christi",
  "2026-06-15": "Sagrado Corazón",
  "2026-06-29": "San Pedro y San Pablo",
  "2026-07-20": "Independencia de Colombia",
  "2026-08-07": "Batalla de Boyacá",
  "2026-08-17": "Asunción de la Virgen",
  "2026-10-12": "Día de la Raza",
  "2026-11-02": "Todos los Santos",
  "2026-11-16": "Independencia de Cartagena",
  "2026-12-08": "Inmaculada Concepción",
  "2026-12-25": "Navidad",
};

function isHoliday(dateKey) {
  return COLOMBIAN_HOLIDAYS.hasOwnProperty(dateKey);
}

const slots = buildSlots();
const lunchSlots = new Set(slots.filter((s) => s.isLunch).map((s) => s.index));

// All weekdays across all months (for state initialization)
const allWeekdays = MONTHS.flatMap((m) => buildMonthWeekdays(m.year, m.month));

// Current month's weekdays (recalculated on tab switch)
let weekdays = buildMonthWeekdays(MONTHS[currentMonthIdx].year, MONTHS[currentMonthIdx].month);
let weeks = chunkWeekdays(weekdays, 5);

let state = null;
let selectedBrandId = null;
let paintMode = "brand";
let isMouseDown = false;

// DOM elements - initialized in init()
let layoutMain;
let totalsPanel;
let toggleTotalsBtn;
let scheduleHead;
let scheduleBody;
let brandPalette;
let brandTemplate;
let brandTotals;
let memberTotals;
let eraserBtn;
let clearMonthBtn;
let addMemberBtn;
let removeMemberBtn;
let addBrandBtn;
let exportExcelBtn;
let templateFileInput;
let recurringBtn;
let legendPanel;
let toggleLegendBtn;

// Brand modal refs
let brandModal, brandModalTitle, brandModalName, brandModalColor, brandModalHex, brandModalBillingCode, brandModalSave, brandModalCancel;
let _brandModalResolve = null;

// Member modal refs
let memberModal, memberModalName, memberModalId, memberModalSave, memberModalCancel;
let _memberModalResolve = null;

function init() {
  // Resolve state from Sheet data (now available) + localStorage
  const { members: defaultMembers, brands: defaultBrands, pre: PRELOADED } = resolveDefaults();
  state = loadStateFromStorage(defaultBrands) || createInitialState(defaultMembers, defaultBrands, PRELOADED);
  // Always merge fresh Sheet assignments into state (Sheet is source of truth)
  if (PRELOADED?.assignments) {
    mergeSheetIntoState(state, PRELOADED, defaultMembers);
  }
  selectedBrandId = state.selectedBrandId || state.brands[0]?.id || null;

  // Initialize DOM elements
  layoutMain = document.getElementById("layoutMain");
  totalsPanel = document.getElementById("totalsPanel");
  toggleTotalsBtn = document.getElementById("toggleTotalsBtn");
  scheduleHead = document.getElementById("scheduleHead");
  scheduleBody = document.getElementById("scheduleBody");
  brandPalette = document.getElementById("brandPalette");
  brandTemplate = document.getElementById("brandTemplate");
  brandTotals = document.getElementById("brandTotals");
  memberTotals = document.getElementById("memberTotals");
  eraserBtn = document.getElementById("eraserBtn");
  clearMonthBtn = document.getElementById("clearMonthBtn");
  addMemberBtn = document.getElementById("addMemberBtn");
  removeMemberBtn = document.getElementById("removeMemberBtn");
  addBrandBtn = document.getElementById("addBrandBtn");
  exportExcelBtn = document.getElementById("exportExcelBtn");
  templateFileInput = document.getElementById("templateFileInput");
  recurringBtn = document.getElementById("recurringBtn");
  legendPanel = document.getElementById("legendPanel");
  toggleLegendBtn = document.getElementById("toggleLegendBtn");

  // Brand modal
  brandModal = document.getElementById("brandModal");
  brandModalTitle = document.getElementById("brandModalTitle");
  brandModalName = document.getElementById("brandModalName");
  brandModalColor = document.getElementById("brandModalColor");
  brandModalHex = document.getElementById("brandModalHex");
  brandModalBillingCode = document.getElementById("brandModalBillingCode");
  brandModalSave = document.getElementById("brandModalSave");
  brandModalCancel = document.getElementById("brandModalCancel");
  brandModalColor.addEventListener("input", () => { brandModalHex.textContent = brandModalColor.value.toUpperCase(); });
  brandModalSave.addEventListener("click", () => { if (_brandModalResolve) _brandModalResolve(true); });
  brandModalCancel.addEventListener("click", () => { if (_brandModalResolve) _brandModalResolve(false); });
  brandModal.addEventListener("click", (e) => { if (e.target === brandModal && _brandModalResolve) _brandModalResolve(false); });

  // Member modal
  memberModal = document.getElementById("memberModal");
  memberModalName = document.getElementById("memberModalName");
  memberModalId = document.getElementById("memberModalId");
  memberModalSave = document.getElementById("memberModalSave");
  memberModalCancel = document.getElementById("memberModalCancel");
  memberModalSave.addEventListener("click", () => { if (_memberModalResolve) _memberModalResolve(true); });
  memberModalCancel.addEventListener("click", () => { if (_memberModalResolve) _memberModalResolve(false); });
  memberModal.addEventListener("click", (e) => { if (e.target === memberModal && _memberModalResolve) _memberModalResolve(false); });

  renderMonthTabs();
  updateScheduleTitle();
  applyTotalsCollapse(safeStorage.getItem("dxi-totals-collapsed") === "1");
  applyLegendCollapse(safeStorage.getItem("dxi-legend-collapsed") === "1");
  renderPalette();
  renderTable();
  renderTotals();
  attachEvents();
}

function switchMonth(idx) {
  currentMonthIdx = idx;
  const m = MONTHS[idx];
  weekdays = buildMonthWeekdays(m.year, m.month);
  weeks = chunkWeekdays(weekdays, 5);

  // Ensure all days for this month exist in state
  for (const day of weekdays) {
    state.assignments[day.key] ||= {};
    for (const member of state.members) {
      state.assignments[day.key][member] ||= Array.from({ length: slots.length }, (_, i) => (lunchSlots.has(i) ? "LUNCH" : null));
    }
  }

  renderMonthTabs();
  renderTable();
  renderTotals();
  updateScheduleTitle();
}

function renderMonthTabs() {
  const container = document.getElementById("monthTabs");
  if (!container) return;
  container.innerHTML = "";
  MONTHS.forEach((m, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = m.label;
    btn.className = "month-tab" + (idx === currentMonthIdx ? " active" : "");
    btn.addEventListener("click", () => switchMonth(idx));
    container.appendChild(btn);
  });
}

function updateScheduleTitle() {
  const title = document.querySelector(".scheduler-panel h2");
  if (title) {
    title.textContent = `Timing Map - ${MONTHS[currentMonthIdx].label}`;
  }
}

function buildSlots() {
  const built = [];
  let idx = 0;
  for (let hour = 7; hour <= 17; hour += 1) {
    for (const minute of [0, 30]) {
      // Don't add 17:30 — max should be 17:00
      if (hour === 17 && minute === 30) continue;
      built.push({ index: idx, label: toLabel(hour, minute), hour, minute, isLunch: hour === 13 });
      idx += 1;
    }
  }
  return built;
}

function buildMonthWeekdays(year, month) {
  const out = [];
  const firstOfMonth = new Date(year, month, 1);
  const firstDow = firstOfMonth.getDay(); // 0=Sun, 1=Mon, ...

  // If month doesn't start on Monday, pad with previous month's weekdays
  // so the first displayed week starts on Monday
  if (firstDow !== 1 && firstDow !== 0) {
    // How many weekdays to go back to reach Monday
    const daysBack = firstDow - 1; // e.g. Wed(3) → 2 days back
    for (let i = daysBack; i >= 1; i -= 1) {
      const date = new Date(year, month, 1 - i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      out.push({ key, day: date.getDate(), label: `${date.toLocaleDateString("en-US", { weekday: "short" })} ${date.getDate()}`, foreign: true });
    }
  }

  // Add all weekdays of the actual month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const weekDay = date.getDay();
    if (weekDay === 0 || weekDay === 6) continue;
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    out.push({ key, day, label: `${date.toLocaleDateString("en-US", { weekday: "short" })} ${day}` });
  }

  // If the last day of the month doesn't fall on Friday, pad with next month's weekdays
  const lastDate = new Date(year, month, daysInMonth);
  const lastDow = lastDate.getDay();
  if (lastDow !== 5 && lastDow !== 6 && lastDow !== 0) {
    const daysForward = 5 - lastDow; // e.g. Wed(3) → 2 more days to reach Fri
    for (let i = 1; i <= daysForward; i += 1) {
      const date = new Date(year, month, daysInMonth + i);
      if (date.getDay() === 0 || date.getDay() === 6) continue;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      out.push({ key, day: date.getDate(), label: `${date.toLocaleDateString("en-US", { weekday: "short" })} ${date.getDate()}`, foreign: true });
    }
  }

  return out;
}

function chunkWeekdays(days, size) {
  const out = [];
  for (let i = 0; i < days.length; i += size) out.push(days.slice(i, i + size));
  return out;
}

function createInitialState(defaultMembers, defaultBrands, PRELOADED) {
  const assignments = {};
  for (const day of allWeekdays) {
    assignments[day.key] = {};
    for (const member of defaultMembers) {
      let row = Array.from({ length: slots.length }, (_, i) => (lunchSlots.has(i) ? "LUNCH" : null));
      if (PRELOADED?.assignments?.[day.key]?.[member]) {
        const pre = PRELOADED.assignments[day.key][member];
        row = pre.map((v, i) => (lunchSlots.has(i) ? "LUNCH" : v || null));
      }
      assignments[day.key][member] = row;
    }
  }
  return { members: [...defaultMembers], brands: [...defaultBrands], assignments, selectedBrandId: defaultBrands[0]?.id, memberDetails: {} };
}

function loadStateFromStorage(defaultBrands) {
  try {
    const raw = safeStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.members || !parsed?.brands || !parsed?.assignments) return null;

    for (const day of allWeekdays) {
      parsed.assignments[day.key] ||= {};
      for (const member of parsed.members) {
        parsed.assignments[day.key][member] ||= Array.from({ length: slots.length }, () => null);
        for (const slot of slots) if (slot.isLunch) parsed.assignments[day.key][member][slot.index] = "LUNCH";
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Merge Sheet data into state — Sheet is the source of truth.
 * New members from Sheet are added, assignments from Sheet overwrite localStorage.
 */
function mergeSheetIntoState(state, PRELOADED, defaultMembers) {
  // Merge members: add any from Sheet that aren't already in state
  for (const m of defaultMembers) {
    if (!state.members.includes(m)) {
      state.members.push(m);
    }
  }

  // Merge assignments from Sheet (Sheet wins over localStorage)
  // Only import data for members that exist in state.members (_config is source of truth)
  for (const dayKey of Object.keys(PRELOADED.assignments)) {
    const sheetDay = PRELOADED.assignments[dayKey];
    state.assignments[dayKey] ||= {};
    for (const member of Object.keys(sheetDay)) {
      if (!state.members.includes(member)) continue; // skip deleted members
      const pre = sheetDay[member];
      if (Array.isArray(pre)) {
        state.assignments[dayKey][member] = pre.map((v, i) => (lunchSlots.has(i) ? "LUNCH" : v || null));
      }
    }
  }

  // Merge brands from Sheet if available
  if (PRELOADED.brands?.length) {
    state.brands = 
      PRELOADED.brands.map((brand, idx) => ({
        ...brand,
        color: brand.color === "#000000" ? fallbackColors[idx % fallbackColors.length] : brand.color
      }));
  }

  // Ensure all members have slots for all weekdays
  for (const day of allWeekdays) {
    state.assignments[day.key] ||= {};
    for (const member of state.members) {
      state.assignments[day.key][member] ||= Array.from({ length: slots.length }, (_, i) => (lunchSlots.has(i) ? "LUNCH" : null));
    }
  }
}

function saveState(changedDay) {
  state.selectedBrandId = selectedBrandId;
  safeStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  
  // Sync changes to Google Sheet — returns a Promise
  if (typeof syncDataToSheet === "function") {
    return syncDataToSheet(state, changedDay);
  }
  return Promise.resolve(true);
}

function renderPalette() {
  brandPalette.innerHTML = "";
  for (const brand of state.brands) {
    const node = brandTemplate.content.firstElementChild.cloneNode(true);
    const radio = node.querySelector("input");
    const swatch = node.querySelector(".swatch");
    const name = node.querySelector(".brand-name");
    radio.value = brand.id;
    radio.checked = paintMode === "brand" && selectedBrandId === brand.id;
    swatch.style.background = brand.color;
    name.textContent = brand.name;
    radio.addEventListener("change", () => {
      selectedBrandId = brand.id;
      paintMode = "brand";
      updateEraserVisual();
      saveState();
    });
    node.addEventListener("dblclick", () => editBrand(brand.id));
    node.querySelector(".brand-delete").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteBrand(brand.id);
    });
    brandPalette.appendChild(node);
  }
  updateEraserVisual();
}

function renderTable() {
  scheduleHead.innerHTML = "";
  scheduleBody.innerHTML = "";

  for (let w = 0; w < weeks.length; w += 1) {
    const weekDays = weeks[w];

    const weekRow = document.createElement("tr");
    weekRow.className = "week-title";
    const weekTh = document.createElement("th");
    weekTh.colSpan = 1 + weekDays.length * slots.length + (weekDays.length - 1);
    weekTh.textContent = `Week ${w + 1}`;
    weekRow.appendChild(weekTh);
    scheduleBody.appendChild(weekRow);

    const dayRow = document.createElement("tr");
    dayRow.className = "day-header";
    const dayFirst = document.createElement("th");
    dayFirst.className = "member-head";
    dayFirst.textContent = "Team Member";
    dayRow.appendChild(dayFirst);

    for (let i = 0; i < weekDays.length; i += 1) {
      const day = weekDays[i];
      const th = document.createElement("th");
      th.colSpan = slots.length;
      if (isHoliday(day.key)) {
        th.textContent = `${day.label} (Holiday)`;
        th.classList.add("holiday-day");
        th.style.background = "#fcc4d6";
        th.title = COLOMBIAN_HOLIDAYS[day.key];
      } else {
        th.textContent = day.label;
        if (day.foreign) th.classList.add("foreign-day");
      }
      dayRow.appendChild(th);
      if (i < weekDays.length - 1) {
        const gap = document.createElement("th");
        gap.className = "day-gap";
        dayRow.appendChild(gap);
      }
    }
    scheduleBody.appendChild(dayRow);

    const slotRow = document.createElement("tr");
    slotRow.className = "time-header";
    const slotFirst = document.createElement("th");
    slotFirst.className = "member-head";
    slotRow.appendChild(slotFirst);

    for (let i = 0; i < weekDays.length; i += 1) {
      for (const slot of slots) {
        const th = document.createElement("th");
        th.textContent = compactSlotLabel(slot);
        if (isHoliday(weekDays[i].key)) th.style.background = "#fcc4d6";
        else if (weekDays[i].foreign) th.style.background = "#f0f2f1";
        else if (slot.isLunch) th.style.background = "#e3e8e4";
        slotRow.appendChild(th);
      }
      if (i < weekDays.length - 1) {
        const gap = document.createElement("th");
        gap.className = "day-gap";
        slotRow.appendChild(gap);
      }
    }
    scheduleBody.appendChild(slotRow);

    for (const member of state.members) {
      const tr = document.createElement("tr");
      const memberCell = document.createElement("td");
      memberCell.className = "member-cell";
      memberCell.textContent = `${member} (${memberWeekHours(member, w).toFixed(1)}h)`;
      tr.appendChild(memberCell);

      for (let i = 0; i < weekDays.length; i += 1) {
        const day = weekDays[i];
        for (const slot of slots) {
          const td = document.createElement("td");
          td.className = "slot-cell";
          td.dataset.member = member;
          td.dataset.slot = String(slot.index);
          td.dataset.day = day.key;
          
          const dayIsHoliday = isHoliday(day.key);
          
          if (day.foreign) {
            td.classList.add("foreign");
            td.style.background = "#f0f2f1";
          } else if (dayIsHoliday) {
            td.classList.add("holiday");
            td.style.background = "#fcc4d6";
            td.style.cursor = "not-allowed";
            td.title = `Holiday: ${COLOMBIAN_HOLIDAYS[day.key]}`;
            td.textContent = "";
          } else if (slot.isLunch) {
            td.classList.add("lunch");
            td.textContent = "L";
          } else {
            paintCell(td, state.assignments[day.key][member][slot.index]);
          }
          tr.appendChild(td);
        }
        if (i < weekDays.length - 1) {
          const gap = document.createElement("td");
          gap.className = "day-gap";
          tr.appendChild(gap);
        }
      }

      scheduleBody.appendChild(tr);
    }
  }
}

function compactSlotLabel(slot) {
  return slot.minute === 0 ? String(slot.hour) : `${slot.hour}.5`;
}

function paintCell(cell, value) {
  if (cell.classList.contains("lunch")) return;
  if (!value) {
    cell.style.background = "#ffffff";
    cell.title = "";
    return;
  }
  const brand = state.brands.find((b) => b.id === value);
  cell.style.background = brand?.color || "#ffffff";
  cell.title = brand?.name || "";
}

function renderTotals() {
  const brandMap = new Map();
  const memberMap = new Map();

  for (const member of state.members) {
    let memberHalfHours = 0;
    for (const day of weekdays) {
      if (day.foreign || isHoliday(day.key)) continue;
      const arr = state.assignments[day.key][member];
      for (let i = 0; i < arr.length; i += 1) {
        const value = arr[i];
        if (lunchSlots.has(i) || !value) continue;
        memberHalfHours += 1;
        brandMap.set(value, (brandMap.get(value) || 0) + 1);
      }
    }
    memberMap.set(member, memberHalfHours * 0.5);
  }

  const brandEntries = [...brandMap.entries()]
    .map(([brandId, hh]) => ({ brand: state.brands.find((b) => b.id === brandId)?.name || "Unknown", hours: hh * 0.5 }))
    .sort((a, b) => b.hours - a.hours || a.brand.localeCompare(b.brand));

  const memberEntries = [...memberMap.entries()]
    .map(([member, hours]) => ({ member, hours }))
    .sort((a, b) => b.hours - a.hours || a.member.localeCompare(b.member));

  brandTotals.innerHTML = renderTotalList(brandEntries.map((x) => ({ key: x.brand, value: `${x.hours.toFixed(1)} h` })), "No brand assignments yet");
  memberTotals.innerHTML = renderTotalList(memberEntries.map((x) => ({ key: x.member, value: `${x.hours.toFixed(1)} h` })), "No member totals yet");
}

function renderTotalList(items, emptyText) {
  if (!items.length) return `<p>${emptyText}</p>`;
  return `<ul class="total-list">${items.map((item) => `<li><span>${escapeHtml(item.key)}</span><strong>${item.value}</strong></li>`).join("")}</ul>`;
}

function memberMonthHours(member) {
  let hh = 0;
  for (const day of weekdays) {
    if (day.foreign || isHoliday(day.key)) continue;
    const arr = state.assignments[day.key][member];
    for (let i = 0; i < arr.length; i += 1) {
      if (lunchSlots.has(i)) continue;
      if (arr[i]) hh += 1;
    }
  }
  return hh * 0.5;
}

function memberWeekHours(member, weekIndex) {
  let hh = 0;
  const weekDays = weeks[weekIndex] || [];
  for (const day of weekDays) {
    if (day.foreign || isHoliday(day.key)) continue;
    const arr = state.assignments[day.key][member];
    for (let i = 0; i < arr.length; i += 1) {
      if (lunchSlots.has(i)) continue;
      if (arr[i]) hh += 1;
    }
  }
  return hh * 0.5;
}

let _lastPaintSyncPromise = null;

function applyToCell(member, dayKey, slotIndex) {
  if (lunchSlots.has(slotIndex)) return;
  state.assignments[dayKey][member][slotIndex] = paintMode === "erase" ? null : selectedBrandId;
  _lastPaintSyncPromise = saveState(dayKey);
}

function attachEvents() {
  toggleTotalsBtn.addEventListener("click", () => {
    const collapsed = !totalsPanel.classList.contains("collapsed");
    applyTotalsCollapse(collapsed);
    safeStorage.setItem("dxi-totals-collapsed", collapsed ? "1" : "0");
  });

  toggleLegendBtn.addEventListener("click", () => {
    const collapsed = !legendPanel.classList.contains("collapsed");
    applyLegendCollapse(collapsed);
    safeStorage.setItem("dxi-legend-collapsed", collapsed ? "1" : "0");
  });

  eraserBtn.addEventListener("click", () => {
    paintMode = paintMode === "erase" ? "brand" : "erase";
    updateEraserVisual();
  });

  clearMonthBtn.addEventListener("click", async () => {
    if (!confirm(`Clear all assignments for ${MONTHS[currentMonthIdx].label}?`)) return;
    const clearedDays = [];
    for (const day of weekdays) {
      if (day.foreign || isHoliday(day.key)) continue;
      for (const member of state.members) {
        state.assignments[day.key][member] = slots.map((slot) => (slot.isLunch ? "LUNCH" : null));
      }
      clearedDays.push(day.key);
    }
    renderTable();
    renderTotals();
    const ok = await saveState(clearedDays);
    if (ok) showToast(`All assignments cleared for ${MONTHS[currentMonthIdx].label}`, "success");
  });

  addMemberBtn.addEventListener("click", async () => {
    const result = await openMemberModal();
    if (!result) return;
    const clean = result.name;
    if (state.members.includes(clean)) {
      showToast(`Team member "${clean}" already exists`, "error");
      return;
    }
    if (!state.memberDetails) state.memberDetails = {};
    state.memberDetails[clean] = { memberId: result.memberId };
    state.members.push(clean);
    const addedDays = [];
    for (const day of allWeekdays) {
      state.assignments[day.key][clean] = slots.map((slot) => (slot.isLunch ? "LUNCH" : null));
      addedDays.push(day.key);
    }
    renderTable();
    renderTotals();
    const ok = await saveState(addedDays);
    if (ok) showToast(`Team member "${clean}" added`, "success");
  });

  removeMemberBtn.addEventListener("click", async () => {
    if (state.members.length === 0) {
      alert("No team members to remove.");
      return;
    }
    const list = state.members.map((m, i) => `${i + 1}. ${m}`).join("\n");
    const input = prompt("Enter the number of the member to remove:\n\n" + list);
    if (!input) return;
    const idx = parseInt(input, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= state.members.length) {
      alert("Invalid selection.");
      return;
    }
    const memberName = state.members[idx];
    if (!confirm(`Remove "${memberName}" and all their assignments?`)) return;
    state.members.splice(idx, 1);
    for (const day of allWeekdays) {
      if (state.assignments[day.key][memberName]) {
        delete state.assignments[day.key][memberName];
      }
    }
    renderTable();
    renderTotals();
    const ok = await saveState();
    if (ok) showToast(`Team member "${memberName}" removed`, "success");
  });

  addBrandBtn.addEventListener("click", async () => {
    const result = await openBrandModal("Add Brand", "", "#1D3557");
    if (!result) return;
    const id = `b${Date.now()}`;
    state.brands.push({ id, name: result.name, color: result.color, billingCode: result.billingCode });
    selectedBrandId = id;
    paintMode = "brand";
    renderPalette();
    renderTable();
    const ok = await saveState();
    if (ok) showToast(`Brand "${result.name}" added`, "success");
  });

  exportExcelBtn.addEventListener("click", async () => {
    if (!window.XlsxPopulate) {
      alert("Excel export library did not load. Please check your internet connection and reload.");
      return;
    }
    await exportScheduleToNewExcel();
  });

  recurringBtn.addEventListener("click", openRecurringModal);



  scheduleBody.addEventListener("mousedown", (event) => {
    const cell = event.target.closest(".slot-cell");
    if (!cell || cell.classList.contains("lunch") || cell.classList.contains("foreign") || cell.classList.contains("holiday")) return;
    isMouseDown = true;
    const member = cell.dataset.member;
    const dayKey = cell.dataset.day;
    const slotIndex = Number(cell.dataset.slot);
    applyToCell(member, dayKey, slotIndex);
    paintCell(cell, state.assignments[dayKey][member][slotIndex]);
    renderTotals();
  });

  scheduleBody.addEventListener("mouseover", (event) => {
    if (!isMouseDown) return;
    const cell = event.target.closest(".slot-cell");
    if (!cell || cell.classList.contains("lunch") || cell.classList.contains("foreign") || cell.classList.contains("holiday")) return;
    const member = cell.dataset.member;
    const dayKey = cell.dataset.day;
    const slotIndex = Number(cell.dataset.slot);
    applyToCell(member, dayKey, slotIndex);
    paintCell(cell, state.assignments[dayKey][member][slotIndex]);
  });

  scheduleBody.addEventListener("mouseup", async () => {
    if (!isMouseDown) return;
    isMouseDown = false;
    renderTable();
    renderTotals();
    if (_lastPaintSyncPromise) {
      const ok = await _lastPaintSyncPromise;
      _lastPaintSyncPromise = null;
      showToast(ok ? "Changes synced" : "⚠️ No se pudo guardar, intenta de nuevo", ok ? "success" : "error");
    }
  });

  document.addEventListener("mouseup", async () => {
    if (!isMouseDown) return;
    isMouseDown = false;
    renderTable();
    renderTotals();
    if (_lastPaintSyncPromise) {
      // Resolve silently — mouse was released outside the schedule (e.g. over brand palette)
      await _lastPaintSyncPromise;
      _lastPaintSyncPromise = null;
    }
  });
}

async function exportScheduleToNewExcel() {
  try {
    exportExcelBtn.disabled = true;
    exportExcelBtn.textContent = "Exporting...";

    const workbook = await window.XlsxPopulate.fromBlankAsync();
    const sheet = workbook.sheet(0);
    sheet.name("Summary");

    // Build column headers: Team Member, Client, then "MonthName Hours" for each month
    const monthLabels = MONTHS.map(m => {
      const date = new Date(m.year, m.month, 1);
      const monthName = date.toLocaleDateString("en-US", { month: "short" });
      return monthName;
    });

    sheet.cell("A1").value("Team Member").style("bold", true).style("fill", "D3D3D3");
    sheet.cell("B1").value("Member ID").style("bold", true).style("fill", "D3D3D3");
    sheet.cell("C1").value("Client").style("bold", true).style("fill", "D3D3D3");
    sheet.cell("D1").value("Billing Code").style("bold", true).style("fill", "D3D3D3");
    for (let i = 0; i < monthLabels.length; i++) {
      sheet.cell(1, i + 5).value(`${monthLabels[i]} Hours`).style("bold", true).style("fill", "D3D3D3");
    }

    // Set column widths
    sheet.column("A").width(25);
    sheet.column("B").width(20);
    sheet.column("C").width(35);
    sheet.column("D").width(20);
    for (let i = 0; i < monthLabels.length; i++) {
      sheet.column(i + 5).width(12);
    }

    let rowNum = 2;
    const brandById = new Map(state.brands.map((b) => [b.id, b]));

    // For each team member
    for (const member of state.members) {
      // Collect all brands this member is assigned to
      const memberBrands = new Map(); // brandId -> brand object
      for (const month of MONTHS) {
        const monthDays = buildMonthWeekdays(month.year, month.month);
        for (const day of monthDays) {
          if (day.foreign || isHoliday(day.key)) continue;
          const assignments = state.assignments[day.key]?.[member] || [];
          for (const brandId of assignments) {
            if (brandId && brandId !== "LUNCH") {
              if (!memberBrands.has(brandId)) {
                memberBrands.set(brandId, brandById.get(brandId));
              }
            }
          }
        }
      }

      // For each brand this member has
      for (const [brandId, brand] of memberBrands) {
        sheet.cell(`A${rowNum}`).value(member);
        sheet.cell(`B${rowNum}`).value(state.memberDetails?.[member]?.memberId || "");
        sheet.cell(`C${rowNum}`).value(brand?.name || "");
        sheet.cell(`D${rowNum}`).value(brand?.billingCode || "");

        // Calculate hours for each month
        for (let mIdx = 0; mIdx < MONTHS.length; mIdx++) {
          const month = MONTHS[mIdx];
          const monthDays = buildMonthWeekdays(month.year, month.month);
          let monthHours = 0;

          for (const day of monthDays) {
            if (day.foreign || isHoliday(day.key)) continue;
            const assignments = state.assignments[day.key]?.[member] || [];
            for (let slotIdx = 0; slotIdx < assignments.length; slotIdx++) {
              if (assignments[slotIdx] === brandId) {
                monthHours += 0.5; // Each slot is 30 min = 0.5 hours
              }
            }
          }

          sheet.cell(rowNum, mIdx + 5).value(monthHours > 0 ? monthHours : 0);
        }

        rowNum++;
      }
    }

    // Save and download
    const out = await workbook.outputAsync();
    downloadBlob(out, `DXI_Timing_Map_${todayStamp()}.xlsx`);
    showToast("Excel exported successfully");
  } catch (error) {
    console.error(error);
  } finally {
    exportExcelBtn.disabled = false;
    exportExcelBtn.textContent = "Export Excel";
  }
}

function copyCellStyle(fromCell, toCell) {
  const styleKeys = [
    "fontFamily",
    "fontSize",
    "bold",
    "italic",
    "underline",
    "strikethrough",
    "fontColor",
    "horizontalAlignment",
    "verticalAlignment",
    "wrapText",
    "textDirection",
    "textRotation",
    "indent",
    "shrinkToFit",
    "numberFormat",
    "fill",
    "border"
  ];

  for (const key of styleKeys) {
    try {
      const value = fromCell.style(key);
      if (value !== undefined) toCell.style(key, value);
    } catch {
      // Ignore style keys unsupported by this engine/object.
    }
  }
}

function applyFillColor(cell, hexColor) {
  const color = normalizeHex(hexColor);
  if (!color) return;
  const rgb = color.replace("#", "");
  const argb = `FF${rgb}`;

  try { cell.style("fill", argb); } catch {}
  try { cell.style("fill", rgb); } catch {}
  try { cell.style("fill", { type: "solid", color: argb }); } catch {}
  try { cell.style("fill", { type: "solid", color: rgb }); } catch {}
}

function normalizeHex(value) {
  if (!value) return null;
  let v = String(value).replace("#", "").trim();
  if (v.length === 8) v = v.slice(2);
  if (v.length !== 6) return null;
  return `#${v.toUpperCase()}`;
}

function colToNum(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function numToCol(num) {
  let n = num;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function todayStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function editBrand(brandId) {
  const brand = state.brands.find((b) => b.id === brandId);
  if (!brand) return;

  const result = await openBrandModal("Edit Brand", brand.name, brand.color, brand.billingCode || "");
  if (!result) return;

  brand.name = result.name;
  brand.color = result.color;
  brand.billingCode = result.billingCode;
  renderPalette();
  renderTable();
  renderTotals();
  const ok = await saveState();
  if (ok) showToast(`Brand "${result.name}" updated`, "success");
}

async function deleteBrand(brandId) {
  const brand = state.brands.find((b) => b.id === brandId);
  if (!brand) return;
  if (!confirm(`Delete brand "${brand.name}"? Assignments using this brand will be cleared.`)) return;

  state.brands = state.brands.filter((b) => b.id !== brandId);
  // Remove from assignments
  const affectedDays = [];
  for (const dayKey of Object.keys(state.assignments)) {
    const day = state.assignments[dayKey];
    let changed = false;
    for (const member of Object.keys(day)) {
      const slots = day[member];
      if (Array.isArray(slots)) {
        for (let i = 0; i < slots.length; i++) {
          if (slots[i] === brandId) { slots[i] = null; changed = true; }
        }
      }
    }
    if (changed) affectedDays.push(dayKey);
  }
  if (selectedBrandId === brandId) {
    selectedBrandId = state.brands.length ? state.brands[0].id : null;
  }
  renderPalette();
  renderTable();
  renderTotals();
  const ok = await saveState(affectedDays);
  if (ok) showToast(`Brand "${brand.name}" deleted`, "success");
}

function openBrandModal(title, name, color, billingCode = "") {
  brandModalTitle.textContent = title;
  brandModalName.value = name;
  brandModalColor.value = color;
  brandModalHex.textContent = color.toUpperCase();
  brandModalBillingCode.value = billingCode;
  brandModal.hidden = false;
  brandModalName.focus();
  return new Promise((resolve) => {
    _brandModalResolve = (ok) => {
      _brandModalResolve = null;
      brandModal.hidden = true;
      if (ok) {
        const n = brandModalName.value.trim();
        if (!n) { resolve(null); return; }
        resolve({ name: n, color: brandModalColor.value.toUpperCase(), billingCode: brandModalBillingCode.value.trim() });
      } else {
        resolve(null);
      }
    };
  });
}

function openMemberModal() {
  memberModalName.value = "";
  memberModalId.value = "";
  memberModal.hidden = false;
  memberModalName.focus();
  return new Promise((resolve) => {
    _memberModalResolve = (ok) => {
      _memberModalResolve = null;
      memberModal.hidden = true;
      if (ok) {
        const n = memberModalName.value.trim();
        if (!n) { resolve(null); return; }
        resolve({ name: n, memberId: memberModalId.value.trim() });
      } else {
        resolve(null);
      }
    };
  });
}

function applyTotalsCollapse(collapsed) {
  totalsPanel.classList.toggle("collapsed", collapsed);
  toggleTotalsBtn.textContent = collapsed ? "Expand" : "Collapse";
  toggleTotalsBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function applyLegendCollapse(collapsed) {
  legendPanel.classList.toggle("collapsed", collapsed);
  toggleLegendBtn.textContent = collapsed ? "Expand" : "Collapse";
  toggleLegendBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function updateEraserVisual() {
  eraserBtn.style.borderColor = paintMode === "erase" ? "#0E75FF" : "#E0E0E0";
  eraserBtn.style.background = paintMode === "erase" ? "#EBF3FF" : "#FAFAFA";
}

function toLabel(hour, minute) {
  const min = minute === 0 ? "00" : "30";
  return `${hour}:${min}`;
}

/* ── Recurring Schedule Modal ── */
function openRecurringModal() {
  const modal = document.getElementById("recurringModal");
  const memberSel = document.getElementById("recMember");
  const brandSel = document.getElementById("recBrand");
  const startSel = document.getElementById("recStart");
  const endSel = document.getElementById("recEnd");
  const scopeSel = document.getElementById("recScope");
  const weekPicker = document.getElementById("recWeekPicker");
  const weekSel = document.getElementById("recWeek");
  const dayPicker = document.getElementById("recDayPicker");
  const daysGrid = document.getElementById("recDays");

  // Populate members
  memberSel.innerHTML = state.members.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");

  // Populate brands
  brandSel.innerHTML = state.brands
    .filter((b) => b.name !== "LUNCH")
    .map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`)
    .join("");
  if (selectedBrandId) brandSel.value = selectedBrandId;

  // Populate time slots (all slots including lunch)
  const timeOptions = slots
    .map((s) => `<option value="${s.index}">${s.label}</option>`)
    .join("");
  startSel.innerHTML = timeOptions;
  endSel.innerHTML = timeOptions;
  // Default start to 8:00 (index 2: 7:00=0, 7:30=1, 8:00=2)
  startSel.value = "2";
  // Default end to last slot (17:00)
  if (slots.length) endSel.value = String(slots[slots.length - 1].index);

  // Populate weeks
  weekSel.innerHTML = weeks.map((_, i) => `<option value="${i}">Week ${i + 1}</option>`).join("");

  // Populate day chips
  function renderDayChips() {
    daysGrid.innerHTML = "";
    for (const day of weekdays) {
      if (day.foreign) continue;
      const chip = document.createElement("span");
      chip.className = "rec-day-chip selected";
      chip.textContent = day.label;
      chip.dataset.key = day.key;
      chip.addEventListener("click", () => chip.classList.toggle("selected"));
      daysGrid.appendChild(chip);
    }
  }
  renderDayChips();

  // Scope switching
  function updateScope() {
    weekPicker.hidden = scopeSel.value !== "monToFri";
    dayPicker.hidden = scopeSel.value !== "pick";
  }
  scopeSel.onchange = updateScope;
  updateScope();

  // Cancel
  document.getElementById("recCancel").onclick = () => { modal.hidden = true; };

  // Apply
  document.getElementById("recApply").onclick = async () => {
    const member = memberSel.value;
    const brandId = brandSel.value;
    const startIdx = Number(startSel.value);
    const endIdx = Number(endSel.value);

    if (startIdx > endIdx) {
      alert("Start time must be before or equal to end time.");
      return;
    }

    // Determine which days to apply
    let targetDays;
    if (scopeSel.value === "month") {
      targetDays = weekdays.filter((d) => !d.foreign).map((d) => d.key);
    } else if (scopeSel.value === "monToFri") {
      const wIdx = Number(weekSel.value);
      targetDays = (weeks[wIdx] || []).filter((d) => !d.foreign).map((d) => d.key);
    } else {
      targetDays = [...daysGrid.querySelectorAll(".rec-day-chip.selected")].map((c) => c.dataset.key);
    }

    if (!targetDays.length) {
      alert("No days selected.");
      return;
    }

    // Apply brand to slots in range for each target day
    let count = 0;
    for (const dayKey of targetDays) {
      if (!state.assignments[dayKey]?.[member]) continue;
      for (let i = startIdx; i < endIdx; i += 1) {
        if (lunchSlots.has(i)) continue;
        state.assignments[dayKey][member][i] = brandId;
        count += 1;
      }
    }

    modal.hidden = true;
    renderTable();
    renderTotals();
    const ok = await saveState(targetDays);
    showToast(ok ? `Schedule applied to ${targetDays.length} day(s), ${count} slot(s) updated` : "⚠️ No se pudo guardar, intenta de nuevo", ok ? "success" : "error");
  };

  modal.hidden = false;
}

function escapeHtml(input) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message, type = "success") {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    toast.addEventListener("transitionend", () => toast.remove());
  }, 3000);
}
