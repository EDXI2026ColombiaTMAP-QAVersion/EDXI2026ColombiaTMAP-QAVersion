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
const THEME_STORAGE_KEY = "dxi-theme";
const GRID_STORAGE_KEY = "dxi-grid-lines";
const MEMBER_TOTALS_EXPANDED_KEY = "dxi-member-totals-expanded";
const SLOT_START_HOUR = 7;
const SLOT_START_MINUTE = 0;
const SLOT_END_HOUR = 17;
const SLOT_END_MINUTE = 30;
const SLOT_DURATION_MINUTES = 30;
const CORE_DAY_START_MINUTES = 8 * 60;
const CORE_DAY_END_MINUTES = 17 * 60;
const APP_LEGACY_SLOT_COUNT = 20;
const TIME_OFF_COLOR = "#d9d9d996";
const TIME_OFF_BRAND_ID = "time-off";
const UNDO_HISTORY_LIMIT = 50;

const fallbackColors = ["#2D6A4F", "#1D3557", "#8F2D56", "#CA6702", "#6A4C93", "#264653", "#386641", "#9D4EDD"];
const expandedMemberTotals = new Set(readStoredStringArray(MEMBER_TOTALS_EXPANDED_KEY));

function normalizeBrandVisual(brand, index = 0) {
  const isTimeOff = isTimeOffBrand(brand);
  const color = isTimeOff
    ? TIME_OFF_COLOR
    : (brand?.color === "#000000" ? fallbackColors[index % fallbackColors.length] : brand?.color);
  return { ...brand, color };
}

function isTimeOffBrand(brand) {
  const normalizedName = String(brand?.name || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  const rawBillingCode = brand?.billingCode ?? brand?.billing_code;
  const normalizedBillingCode = rawBillingCode === null || rawBillingCode === undefined || rawBillingCode === ""
    ? ""
    : String(rawBillingCode).trim().padStart(6, "0");

  return normalizedName === "time off" || normalizedBillingCode === "000000";
}

function ensureTimeOffBrand(brands) {
  if (!Array.isArray(brands)) return null;

  const existing = brands.find(isTimeOffBrand);
  if (existing) {
    existing.color = TIME_OFF_COLOR;
    return existing;
  }

  const timeOffBrand = {
    id: TIME_OFF_BRAND_ID,
    name: "Time Off",
    color: TIME_OFF_COLOR,
    billingCode: "000000"
  };
  brands.push(timeOffBrand);
  return timeOffBrand;
}

function readStoredStringArray(key) {
  const raw = safeStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch (e) {
    return [];
  }
}

function resolveDefaults() {
  const pre = window.PRELOADED_DATA || null;
  const members = pre?.members?.length ? pre.members : ["Open Seat"];
  const brands = 
    (pre?.brands?.length ? pre.brands : [{ id: "b1", name: "General", color: "#2D6A4F" }])
      .map(normalizeBrandVisual);
  return { members, brands, pre };
}

// Month configuration: [year, monthIndex (0-based), label]
const MONTHS = [
  // { year: 2026, month: 0, label: "Jan 2026" },
  // { year: 2026, month: 1, label: "Feb 2026" },
  // { year: 2026, month: 2, label: "Mar 2026" },
  // { year: 2026, month: 3, label: "Apr 2026" },
  // { year: 2026, month: 4, label: "May 2026" },
  // { year: 2026, month: 5, label: "Jun 2026" },
  // { year: 2026, month: 6, label: "Jul 2026" },
  { year: 2026, month: 7, label: "Aug 2026" },
  { year: 2026, month: 8, label: "Sep 2026" },
  { year: 2026, month: 9, label: "Oct 2026" },
  { year: 2026, month: 10, label: "Nov 2026" },
  { year: 2026, month: 11, label: "Dec 2026" },
];

function getDefaultMonthIndex() {
  const augustIndex = MONTHS.findIndex((entry) => entry.year === 2026 && entry.month === 7);
  return augustIndex !== -1 ? augustIndex : 0;
}

let currentMonthIdx = getDefaultMonthIndex();

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
  "2026-07-13": "Virgen de Chiquinquirá",
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

function isLastFridayOfMonth(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  if (!year || !month || !day) return false;

  const date = new Date(year, month - 1, day);
  return date.getDay() === 5 && new Date(year, month - 1, day + 7).getMonth() !== month - 1;
}

function isMonthlyTimeOffSlot(dateKey, slotIndex) {
  const slot = slots?.[slotIndex];
  return isLastFridayOfMonth(dateKey) && Boolean(slot) && slot.hour >= 14;
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
let activePaintMember = null;
let activePaintUndoAction = null;
let tableResizeObserver = null;
let activeHoverGuides = { row: null };
const undoHistory = [];

// DOM elements - initialized in init()
let layoutMain;
let totalsPanel;
let toggleTotalsBtn;
let themeToggleBtn;
let gridToggleBtn;
let tableWrap;
let scheduleTable;
let scheduleHead;
let scheduleBody;
let brandPalette;
let brandTemplate;
let brandTotals;
let memberTotals;
let eraserBtn;
let timeOffBtn;
let clearMonthBtn;
let addMemberBtn;
let removeMemberBtn;
let addBrandBtn;
let exportExcelBtn;
let exportAvailabilityBtn;
let refreshDataBtn;
let templateFileInput;
let recurringBtn;
let legendPanel;
let toggleLegendBtn;
let brandSearchInput;
let brandSearchQuery = "";
let importJsonBtn;
let importJsonFileInput;
let hoverRowGuide = null;

// Brand modal refs
let brandModal, brandModalTitle, brandModalName, brandModalColor, brandModalHex, brandModalBillingCode, brandModalSave, brandModalCancel;
let _brandModalResolve = null;

// Import brands modal refs
let importBrandsModal, importBrandsInput, importBrandsOk, importBrandsCancel, importBrandsBtn;
const DISABLED_FEATURES = {
  clearMonth: true,
  importBrands: true,
  importExcel: true
};
const HIDDEN_FEATURES = {
  addMember: true,
  removeMember: true
};
const AVAILABILITY_MEMBER_ORDER = [
  "Daniela Mahecha",
  "Daniela Oliva",
  "Laura Álvarez",
  "Natalia Bolaño",
  "Hernan Torres",
  "Ana Piraquive",
  "David Bautista",
  "Nicolas Lopez",
  "Natalia Sanchez",
  "David Guzman",
  "Gabriela Pelayo",
  "Valentina Zarate",
  "Felipe Mendez",
  "Camila Martinez",
  "William Franco",
  "Kimberly Velasquez",
  "Laura Gordillo",
  "Camilo Hernandez"
];
const availabilityOrderIndex = new Map(
  AVAILABILITY_MEMBER_ORDER.map((member, index) => [normalizeMemberName(member), index])
);

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
  state.brands = (state.brands || []).map(normalizeBrandVisual);
  ensureTimeOffBrand(state.brands);
  // Ensure memberDetails always exists
  if (!state.memberDetails) {
    state.memberDetails = {};
  }
  selectedBrandId = state.selectedBrandId || state.brands[0]?.id || null;

  // Initialize DOM elements
  layoutMain = document.getElementById("layoutMain");
  totalsPanel = document.getElementById("totalsPanel");
  toggleTotalsBtn = document.getElementById("toggleTotalsBtn");
  themeToggleBtn = document.getElementById("themeToggleBtn");
  gridToggleBtn = document.getElementById("gridToggleBtn");
  tableWrap = document.querySelector(".table-wrap");
  scheduleTable = document.getElementById("scheduleTable");
  scheduleHead = document.getElementById("scheduleHead");
  scheduleBody = document.getElementById("scheduleBody");
  brandPalette = document.getElementById("brandPalette");
  brandTemplate = document.getElementById("brandTemplate");
  brandTotals = document.getElementById("brandTotals");
  memberTotals = document.getElementById("memberTotals");
  eraserBtn = document.getElementById("eraserBtn");
  timeOffBtn = document.getElementById("timeOffBtn");
  clearMonthBtn = document.getElementById("clearMonthBtn");
  addMemberBtn = document.getElementById("addMemberBtn");
  removeMemberBtn = document.getElementById("removeMemberBtn");
  addBrandBtn = document.getElementById("addBrandBtn");
  exportExcelBtn = document.getElementById("exportExcelBtn");
  exportAvailabilityBtn = document.getElementById("exportAvailabilityBtn");
  refreshDataBtn = document.getElementById("refreshDataBtn");
  importJsonBtn = document.getElementById("importJsonBtn");
  importJsonFileInput = document.getElementById("importJsonFileInput");
  templateFileInput = document.getElementById("templateFileInput");
  recurringBtn = document.getElementById("recurringBtn");
  legendPanel = document.getElementById("legendPanel");
  toggleLegendBtn = document.getElementById("toggleLegendBtn");
  brandSearchInput = document.getElementById("brandSearchInput");
  ensureHoverGuide();

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

  // Import brands modal
  importBrandsModal = document.getElementById("importBrandsModal");
  importBrandsInput = document.getElementById("importBrandsInput");
  importBrandsOk = document.getElementById("importBrandsOk");
  importBrandsCancel = document.getElementById("importBrandsCancel");
  importBrandsBtn = document.getElementById("importBrandsBtn");
  importBrandsCancel.addEventListener("click", () => { importBrandsModal.hidden = true; });
  importBrandsModal.addEventListener("click", (e) => { if (e.target === importBrandsModal) importBrandsModal.hidden = true; });

  applyFeatureLocks();

  applyTheme(safeStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light", false);
  applyGridLines(safeStorage.getItem(GRID_STORAGE_KEY) === "on", false);
  renderMonthTabs();
  updateScheduleTitle();
  applyTotalsCollapse(safeStorage.getItem("dxi-totals-collapsed") === "1");
  applyLegendCollapse(safeStorage.getItem("dxi-legend-collapsed") === "1");
  renderPalette();
  renderTable();
  renderTotals();
  attachEvents();

  if (window.ResizeObserver && tableWrap && !tableResizeObserver) {
    tableResizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(updateTableSizing);
    });
    tableResizeObserver.observe(tableWrap);
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      window.requestAnimationFrame(updateTableSizing);
    });
  }
}

function lockButton(button, message) {
  if (!button) return;
  button.disabled = true;
  button.setAttribute("aria-disabled", "true");
  button.title = message;
}

function hideButton(button) {
  if (!button) return;
  button.hidden = true;
  button.disabled = true;
  button.setAttribute("aria-hidden", "true");
}

function normalizeMemberName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function compareAvailabilityMemberOrder(a, b) {
  const aIndex = availabilityOrderIndex.get(normalizeMemberName(a));
  const bIndex = availabilityOrderIndex.get(normalizeMemberName(b));
  const aKnown = aIndex !== undefined;
  const bKnown = bIndex !== undefined;

  if (aKnown && bKnown) return aIndex - bIndex;
  if (aKnown) return -1;
  if (bKnown) return 1;
  return a.localeCompare(b);
}

function compareAvailabilityRows(a, b) {
  const totalDifference = b.total - a.total;
  if (totalDifference !== 0) return totalDifference;
  return compareAvailabilityMemberOrder(a.member, b.member);
}

function applyFeatureLocks() {
  if (DISABLED_FEATURES.clearMonth) {
    lockButton(clearMonthBtn, "Clear Full Month is currently disabled");
  }

  if (DISABLED_FEATURES.importBrands) {
    lockButton(importBrandsBtn, "Import Brands is currently disabled");
  }

  if (DISABLED_FEATURES.importExcel) {
    lockButton(importJsonBtn, "Import Excel is currently disabled");
  }

  if (HIDDEN_FEATURES.addMember) {
    hideButton(addMemberBtn);
  }

  if (HIDDEN_FEATURES.removeMember) {
    hideButton(removeMemberBtn);
  }
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
      state.assignments[day.key][member] = normalizeAssignmentSlots(
        state.assignments[day.key][member]
      );
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

function getMonthExportSnapshot(monthIndex = currentMonthIdx) {
  const selectedMonth = MONTHS[monthIndex];
  const monthWeekdays = buildMonthWeekdays(selectedMonth.year, selectedMonth.month);

  return {
    year: selectedMonth.year,
    month: selectedMonth.month,
    label: selectedMonth.label,
    weeks: chunkWeekdays(monthWeekdays, 5)
  };
}

function getAssignmentDaysForMonth(assignments, selectedMonth) {
  return Object.keys(assignments || {})
    .filter((dateKey) => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
      return Boolean(match)
        && Number(match[1]) === selectedMonth.year
        && Number(match[2]) === selectedMonth.month + 1;
    })
    .sort();
}

function buildSlots() {
  const built = [];
  const startMinutes = SLOT_START_HOUR * 60 + SLOT_START_MINUTE;
  const endMinutes = SLOT_END_HOUR * 60 + SLOT_END_MINUTE;
  const lunchStartMinutes = 13 * 60;
  const lunchEndMinutes = 14 * 60;

  for (let totalMinutes = startMinutes, idx = 0; totalMinutes <= endMinutes; totalMinutes += SLOT_DURATION_MINUTES, idx += 1) {
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    built.push({
      index: idx,
      label: toLabel(hour, minute),
      hour,
      minute,
      isLunch: totalMinutes >= lunchStartMinutes && totalMinutes < lunchEndMinutes,
      // Keep the original 07:30 and 17:00 fringe treatment while extending
      // the visible schedule with the new 07:00 and 17:30 half-hours.
      isFringe:
        totalMinutes < CORE_DAY_START_MINUTES ||
        totalMinutes >= CORE_DAY_END_MINUTES,
    });
  }
  return built;
}

function createEmptyAssignmentRow() {
  return Array.from(
    { length: slots.length },
    (_, index) => (lunchSlots.has(index) ? "LUNCH" : null)
  );
}

function getSlotStartMinutes(slotIndex) {
  const slot = slots[slotIndex];
  return slot ? slot.hour * 60 + slot.minute : null;
}

function isEarlyArrivalSlot(slotIndex) {
  const slotMinutes = getSlotStartMinutes(slotIndex);
  return slotMinutes !== null && slotMinutes < CORE_DAY_START_MINUTES;
}

function isAutomaticShiftWorkValue(value, timeOffBrandId) {
  return Boolean(value) && value !== "LUNCH" && value !== timeOffBrandId;
}

function reconcileAutomaticTimeOff(memberSlots, timeOffBrandId, dayKey = "") {
  if (!Array.isArray(memberSlots) || !timeOffBrandId) return [];

  const earliestArrivalIndex = memberSlots.findIndex((value, index) => (
    isEarlyArrivalSlot(index)
    && isAutomaticShiftWorkValue(value, timeOffBrandId)
  ));
  const earliestAutomaticExitMinutes =
    CORE_DAY_END_MINUTES - (CORE_DAY_START_MINUTES - (SLOT_START_HOUR * 60 + SLOT_START_MINUTE));
  const changedSlotIndexes = [];

  // Remove the previous automatic result first so changing or deleting the
  // early arrival also moves (or removes) the Time Off block.
  for (let index = 0; index < memberSlots.length; index += 1) {
    const slotMinutes = getSlotStartMinutes(index);
    if (
      slotMinutes !== null
      && slotMinutes >= earliestAutomaticExitMinutes
      && memberSlots[index] === timeOffBrandId
      && !isMonthlyTimeOffSlot(dayKey, index)
    ) {
      memberSlots[index] = null;
      changedSlotIndexes.push(index);
    }
  }

  if (earliestArrivalIndex === -1) return changedSlotIndexes;

  const arrivalMinutes = getSlotStartMinutes(earliestArrivalIndex);
  const exitMinutes = CORE_DAY_END_MINUTES - (CORE_DAY_START_MINUTES - arrivalMinutes);

  for (let index = 0; index < memberSlots.length; index += 1) {
    const slotMinutes = getSlotStartMinutes(index);
    if (
      slotMinutes === null
      || slotMinutes < exitMinutes
      || memberSlots[index] === "LUNCH"
      || isMonthlyTimeOffSlot(dayKey, index)
    ) {
      continue;
    }
    if (memberSlots[index] !== timeOffBrandId) {
      memberSlots[index] = timeOffBrandId;
      changedSlotIndexes.push(index);
    }
  }

  return [...new Set(changedSlotIndexes)];
}

function normalizeAssignmentSlots(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return createEmptyAssignmentRow();
  }

  let normalized = values.map((value) => (
    value === undefined || value === "." ? null : value
  ));

  // The previous table covered 07:30-17:30 with 20 half-hour blocks.
  // Preserve every existing time by adding 07:00 at the beginning and
  // 17:30 at the end instead of shifting the stored assignments.
  if (
    normalized.length === APP_LEGACY_SLOT_COUNT &&
    slots.length === APP_LEGACY_SLOT_COUNT + 2
  ) {
    normalized = [null, ...normalized, null];
  }

  return Array.from(
    { length: slots.length },
    (_, index) => normalized[index] ?? null
  );
}

function buildMonthWeekdays(year, month) {
  const out = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let firstWeekdayDate = null;
  let lastWeekdayDate = null;

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const weekDay = date.getDay();
    if (weekDay === 0 || weekDay === 6) continue;
    if (!firstWeekdayDate) firstWeekdayDate = new Date(date);
    lastWeekdayDate = new Date(date);
  }

  if (firstWeekdayDate) {
    const daysBack = firstWeekdayDate.getDay() - 1; // Tue=1 backfill, Wed=2, ... Fri=4
    for (let i = daysBack; i >= 1; i -= 1) {
      const date = new Date(firstWeekdayDate);
      date.setDate(firstWeekdayDate.getDate() - i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      out.push({ key, day: date.getDate(), label: `${date.toLocaleDateString("en-US", { weekday: "short" })} ${date.getDate()}`, foreign: true });
    }
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const weekDay = date.getDay();
    if (weekDay === 0 || weekDay === 6) continue;
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    out.push({ key, day, label: `${date.toLocaleDateString("en-US", { weekday: "short" })} ${day}` });
  }

  if (lastWeekdayDate) {
    const daysForward = 5 - lastWeekdayDate.getDay(); // Mon=4 forward fill ... Thu=1
    for (let i = 1; i <= daysForward; i += 1) {
      const date = new Date(lastWeekdayDate);
      date.setDate(lastWeekdayDate.getDate() + i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      out.push({ key, day: date.getDate(), label: `${date.toLocaleDateString("en-US", { weekday: "short" })} ${date.getDate()}`, foreign: true });
    }
  }

  return out;
}

function chunkWeekdays(days, size) {
  const out = [];
  let currentWeek = [];

  for (const day of days) {
    const date = new Date(`${day.key}T00:00:00`);
    const dayOfWeek = date.getDay();

    if (currentWeek.length && dayOfWeek === 1) {
      out.push(currentWeek);
      currentWeek = [];
    }

    currentWeek.push(day);
  }

  if (currentWeek.length) out.push(currentWeek);
  return out;
}

function createInitialState(defaultMembers, defaultBrands, PRELOADED) {
  const assignments = {};
  for (const day of allWeekdays) {
    assignments[day.key] = {};
    for (const member of defaultMembers) {
      let row = createEmptyAssignmentRow();
      if (PRELOADED?.assignments?.[day.key]?.[member]) {
        const pre = PRELOADED.assignments[day.key][member];
        row = normalizeAssignmentSlots(pre);
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

    // Ensure memberDetails exists
    if (!parsed.memberDetails) {
      parsed.memberDetails = {};
    }

    for (const day of allWeekdays) {
      parsed.assignments[day.key] ||= {};
      for (const member of parsed.members) {
        parsed.assignments[day.key][member] = normalizeAssignmentSlots(
          parsed.assignments[day.key][member]
        );
        // lunch position is stored in the data — do not force override
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
  // Ensure memberDetails exists
  if (!state.memberDetails) {
    state.memberDetails = {};
  }

  // Merge memberDetails from Sheet (Sheet wins — it has the latest saved IDs)
  if (PRELOADED.memberDetails) {
    for (const [member, details] of Object.entries(PRELOADED.memberDetails)) {
      state.memberDetails[member] = { ...(state.memberDetails[member] || {}), ...details };
    }
  }

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
        state.assignments[dayKey][member] = normalizeAssignmentSlots(pre);
      }
    }
  }

  // Merge brands from Sheet if available
  if (PRELOADED.brands?.length) {
    state.brands = PRELOADED.brands.map(normalizeBrandVisual);
  }

  // Ensure all members have slots for all weekdays
  for (const day of allWeekdays) {
    state.assignments[day.key] ||= {};
    for (const member of state.members) {
      state.assignments[day.key][member] = normalizeAssignmentSlots(
        state.assignments[day.key][member]
      );
    }
  }

  ensureTimeOffBrand(state.brands);
}

function assignmentRowsFor(days, members) {
  const normalizedDays = Array.isArray(days) ? days : [days];
  const normalizedMembers = Array.isArray(members) ? members : [members];
  const rows = [];

  for (const workDate of normalizedDays) {
    if (typeof workDate !== "string" || !workDate) continue;
    for (const member of normalizedMembers) {
      if (typeof member !== "string" || !member) continue;
      rows.push({ workDate, member });
    }
  }

  return rows;
}

function createAssignmentUndoAction(label) {
  return {
    label,
    rows: new Map()
  };
}

function assignmentUndoRowKey(dayKey, member) {
  return JSON.stringify([dayKey, member]);
}

function captureAssignmentUndoRow(action, dayKey, member) {
  if (!action || !dayKey || !member) return;

  const row = state?.assignments?.[dayKey]?.[member];
  if (!Array.isArray(row)) return;

  const key = assignmentUndoRowKey(dayKey, member);
  if (!action.rows.has(key)) {
    action.rows.set(key, {
      dayKey,
      member,
      slots: [...row]
    });
  }
}

function assignmentRowsAreEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function commitAssignmentUndoAction(action) {
  if (!action) return false;

  for (const [key, row] of action.rows) {
    const currentRow = state?.assignments?.[row.dayKey]?.[row.member];
    if (assignmentRowsAreEqual(row.slots, currentRow)) {
      action.rows.delete(key);
    }
  }

  if (action.rows.size === 0) return false;

  undoHistory.push(action);
  if (undoHistory.length > UNDO_HISTORY_LIMIT) {
    undoHistory.splice(0, undoHistory.length - UNDO_HISTORY_LIMIT);
  }
  return true;
}

function restoreAssignmentUndoAction(action) {
  const changedRows = [];
  if (!action) return changedRows;

  for (const row of action.rows.values()) {
    if (!state.assignments[row.dayKey]) {
      state.assignments[row.dayKey] = {};
    }
    state.assignments[row.dayKey][row.member] = [...row.slots];
    changedRows.push(...assignmentRowsFor(row.dayKey, row.member));
  }

  return changedRows;
}

function clearUndoHistory() {
  undoHistory.length = 0;
  activePaintUndoAction = null;
}

function isEditableUndoTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}

function undoLatestChange() {
  const action = undoHistory.pop();
  if (!action) return false;

  const changedRows = restoreAssignmentUndoAction(action);
  renderTable();
  renderTotals();
  const syncPromise = saveState({ assignmentRows: changedRows });

  showToast(`Change undone: ${action.label}`, "success");
  Promise.resolve(syncPromise)
    .then((ok) => {
      if (!ok) console.warn("El cambio se deshizo localmente y su sincronización se reintentará automáticamente.");
    })
    .catch((error) => console.error("Error sincronizando el cambio deshecho:", error));

  return true;
}

function handleUndoShortcut(event) {
  const isUndo = (event.ctrlKey || event.metaKey)
    && !event.altKey
    && !event.shiftKey
    && String(event.key).toLowerCase() === "z";

  if (!isUndo || isEditableUndoTarget(event.target) || undoHistory.length === 0) return;

  event.preventDefault();
  undoLatestChange();
}

function saveState(changes = {}) {
  state.selectedBrandId = selectedBrandId;
  safeStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  
  // Sync only the explicitly changed Supabase rows. UI-only preferences have
  // an empty change set and remain local, so they cannot overwrite shared data.
  if (typeof syncDataToSheet === "function") {
    return syncDataToSheet(state, changes);
  }
  return Promise.resolve(true);
}

function rebuildStateFromPreloadedData() {
  const { members: defaultMembers, brands: defaultBrands, pre: PRELOADED } = resolveDefaults();
  state = createInitialState(defaultMembers, defaultBrands, PRELOADED);

  if (PRELOADED?.assignments) {
    mergeSheetIntoState(state, PRELOADED, defaultMembers);
  }

  ensureTimeOffBrand(state.brands);

  if (!state.memberDetails) {
    state.memberDetails = {};
  }

  if (!state.brands.find((brand) => brand.id === selectedBrandId)) {
    selectedBrandId = state.brands[0]?.id || null;
  }
  state.selectedBrandId = selectedBrandId;
  safeStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  clearUndoHistory();
}

async function refreshFromCloud() {
  if (!refreshDataBtn) return;

  refreshDataBtn.disabled = true;
  refreshDataBtn.textContent = "Refreshing...";

  try {
    if (typeof window.flushPendingScheduleChanges === "function") {
      const pendingSaved = await window.flushPendingScheduleChanges();
      if (!pendingSaved) {
        throw new Error("Hay cambios pendientes. Se reintentaran antes de actualizar.");
      }
    }

    const reloadFromSource = window.reloadDataFromSource || window.loadDataFromSheet;
    if (typeof reloadFromSource !== "function") {
      throw new Error("Cloud refresh is not available.");
    }

    const ok = await reloadFromSource();
    if (!ok) {
      throw new Error("No se pudieron cargar los datos remotos.");
    }

    rebuildStateFromPreloadedData();
    renderPalette();
    renderTable();
    renderTotals();
    showToast("Data refreshed from cloud", "success");
  } catch (error) {
    console.error("Cloud refresh failed:", error);
  } finally {
    refreshDataBtn.disabled = false;
    refreshDataBtn.textContent = "Refresh";
  }
}

function applyTheme(theme, persist = true) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = nextTheme;

  if (themeToggleBtn) {
    const darkEnabled = nextTheme === "dark";
    themeToggleBtn.setAttribute("aria-pressed", darkEnabled ? "true" : "false");
    themeToggleBtn.setAttribute("aria-label", darkEnabled ? "Disable dark theme" : "Enable dark theme");
    themeToggleBtn.title = darkEnabled ? "Disable dark theme" : "Enable dark theme";
  }

  if (persist) {
    safeStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  }

  if (scheduleBody?.children?.length) {
    renderTable();
  }
}

function toggleTheme() {
  applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
}

function applyGridLines(enabled, persist = true) {
  const gridEnabled = Boolean(enabled);
  document.body.dataset.grid = gridEnabled ? "on" : "off";

  if (gridToggleBtn) {
    gridToggleBtn.setAttribute("aria-pressed", gridEnabled ? "true" : "false");
    gridToggleBtn.setAttribute("aria-label", gridEnabled ? "Disable dark grid lines" : "Enable dark grid lines");
    gridToggleBtn.title = gridEnabled ? "Disable dark grid lines" : "Enable dark grid lines";
  }

  if (persist) {
    safeStorage.setItem(GRID_STORAGE_KEY, gridEnabled ? "on" : "off");
  }
}

function toggleGridLines() {
  applyGridLines(document.body.dataset.grid !== "on");
}

function getTimeOffBrand() {
  return state?.brands?.find(isTimeOffBrand) || null;
}

function getAssignedBrandIds() {
  const assignedBrandIds = new Set();

  for (const dayAssignments of Object.values(state.assignments || {})) {
    if (!dayAssignments || typeof dayAssignments !== "object") continue;

    for (const memberSlots of Object.values(dayAssignments)) {
      if (!Array.isArray(memberSlots)) continue;

      for (const brandId of memberSlots) {
        if (brandId) assignedBrandIds.add(brandId);
      }
    }
  }

  return assignedBrandIds;
}

function renderPalette() {
  brandPalette.innerHTML = "";
  const timeOffBrand = getTimeOffBrand();
  const assignedBrandIds = getAssignedBrandIds();
  for (const brand of state.brands) {
    if (timeOffBrand && brand.id === timeOffBrand.id) continue;

    // Filter by search query
    if (brandSearchQuery) {
      const brandName = brand.name.toLowerCase();
      const brandCode = (brand.billingCode || "").toLowerCase();
      if (!brandName.includes(brandSearchQuery) && !brandCode.includes(brandSearchQuery)) {
        continue;
      }
    }
    
    const node = brandTemplate.content.firstElementChild.cloneNode(true);
    const radio = node.querySelector("input");
    const swatch = node.querySelector(".swatch");
    const name = node.querySelector(".brand-name");
    radio.value = brand.id;
    radio.checked = paintMode === "brand" && selectedBrandId === brand.id;
    swatch.style.background = brand.color;
    name.textContent = brand.name;
    if (!assignedBrandIds.has(brand.id)) {
      node.classList.add("brand-item-unassigned");
    }
    radio.addEventListener("change", () => {
      selectedBrandId = brand.id;
      paintMode = "brand";
      updateEraserVisual();
      saveState();
    });
    node.addEventListener("dblclick", () => editBrand(brand.id));
    node.querySelector(".brand-edit").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      editBrand(brand.id);
    });
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
  clearHoverGuides();
  renderScheduleColGroup();
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
      th.dataset.weekIndex = String(w);
      th.dataset.dayIndex = String(i);
      if (isHoliday(day.key)) {
        th.textContent = `${day.label} (Holiday)`;
        th.classList.add("holiday-day");
        th.style.background = "var(--holiday-bg)";
        th.title = COLOMBIAN_HOLIDAYS[day.key];
      } else {
        const hasMonthlyTimeOff = !day.foreign && isLastFridayOfMonth(day.key);
        th.textContent = hasMonthlyTimeOff ? `${day.label} (PM Time Off)` : day.label;
        if (hasMonthlyTimeOff) th.title = "Monthly Time Off from 14:00";
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
        th.dataset.weekIndex = String(w);
        th.dataset.columnIndex = String(i * slots.length + slot.index);
        th.textContent = compactSlotLabel(slot);
        if (isHoliday(weekDays[i].key)) {
          th.classList.add("holiday-slot");
          th.style.background = "var(--holiday-bg)";
        }
        else if (weekDays[i].foreign) th.style.background = "var(--foreign-bg)";
        else if (isMonthlyTimeOffSlot(weekDays[i].key, slot.index)) {
          th.classList.add("monthly-time-off");
          th.style.background = TIME_OFF_COLOR;
          th.title = "Monthly Time Off";
        }
        else if (slot.isLunch) th.style.background = "var(--lunch-header-bg)";
        else if (slot.isFringe) th.style.background = "var(--foreign-bg)";
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
      tr.className = "member-row";
      tr.dataset.weekIndex = String(w);
      tr.dataset.member = member;
      const memberCell = document.createElement("td");
      memberCell.className = "member-cell";
      const boldNames = ["Daniela Mahecha", "Hernan Torres", "David Guzman", "William Franco"];
      if (boldNames.includes(member)) {
        memberCell.style.fontWeight = "700";
      }
      const memberId = state.memberDetails?.[member]?.memberId || "";
      const memberLabel = document.createElement("span");
      memberLabel.textContent = `${member} (${memberWeekHours(member, w).toFixed(1)}h)`;
      if (memberId) memberLabel.title = `ID: ${memberId}`;
      const memberEditBtn = document.createElement("button");
      memberEditBtn.type = "button";
      memberEditBtn.className = "member-edit-btn";
      memberEditBtn.title = memberId ? `Edit — ID: ${memberId}` : "Set Member ID";
      memberEditBtn.textContent = "✏️";
      memberEditBtn.addEventListener("click", (e) => { e.stopPropagation(); editMember(member); });
      memberCell.appendChild(memberLabel);
      memberCell.appendChild(memberEditBtn);
      tr.appendChild(memberCell);

      for (let i = 0; i < weekDays.length; i += 1) {
        const day = weekDays[i];
        for (const slot of slots) {
          const td = document.createElement("td");
          td.className = "slot-cell";
          td.dataset.member = member;
          td.dataset.slot = String(slot.index);
          td.dataset.day = day.key;
          td.dataset.weekIndex = String(w);
          td.dataset.columnIndex = String(i * slots.length + slot.index);
          
          const dayIsHoliday = isHoliday(day.key);
          
          if (day.foreign) {
            td.classList.add("foreign");
            td.style.background = "var(--foreign-bg)";
          } else if (dayIsHoliday) {
            td.classList.add("holiday");
            td.style.background = "var(--holiday-bg)";
            td.style.cursor = "not-allowed";
            td.title = `Holiday: ${COLOMBIAN_HOLIDAYS[day.key]}`;
            td.textContent = "";
          } else if (isMonthlyTimeOffSlot(day.key, slot.index)) {
            td.classList.add("monthly-time-off");
            td.style.background = TIME_OFF_COLOR;
            td.style.cursor = "not-allowed";
            td.title = `Time Off (${slot.label}-${getSlotEndLabel(slot.index)})`;
            td.setAttribute("aria-label", "Monthly Time Off");
          } else if (state.assignments[day.key][member][slot.index] === "LUNCH") {
            td.classList.add("lunch");
            td.textContent = "";
            td.title = "Lunch";
            td.setAttribute("aria-label", "Lunch");
          } else {
            paintCell(td, state.assignments[day.key][member][slot.index], slot.index);
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

  updateTableSizing();
}

function renderScheduleColGroup() {
  if (!scheduleTable) return;

  scheduleTable.querySelector("colgroup")?.remove();

  const maxWeekDays = weeks.reduce((max, week) => Math.max(max, week.length), 0);
  if (!maxWeekDays) return;

  const colGroup = document.createElement("colgroup");
  const memberCol = document.createElement("col");
  memberCol.style.width = "var(--member-col-width)";
  colGroup.appendChild(memberCol);

  for (let i = 0; i < maxWeekDays; i += 1) {
    for (let j = 0; j < slots.length; j += 1) {
      const slotCol = document.createElement("col");
      slotCol.style.width = "var(--slot-width)";
      colGroup.appendChild(slotCol);
    }

    if (i < maxWeekDays - 1) {
      const gapCol = document.createElement("col");
      gapCol.style.width = "var(--day-gap-width)";
      colGroup.appendChild(gapCol);
    }
  }

  scheduleTable.insertBefore(colGroup, scheduleTable.firstChild);
}

function compactSlotLabel(slot) {
  return slot.minute === 0 ? String(slot.hour) : `${slot.hour}.5`;
}

function clearHoverGuides() {
  if (activeHoverGuides.row) {
    activeHoverGuides.row.classList.remove("is-hover-row");
  }
  if (hoverRowGuide) {
    hoverRowGuide.hidden = true;
  }
  activeHoverGuides = { row: null };
}

function ensureHoverGuide() {
  if (!tableWrap || hoverRowGuide) return;
  hoverRowGuide = document.createElement("div");
  hoverRowGuide.className = "hover-row-guide";
  hoverRowGuide.hidden = true;
  tableWrap.appendChild(hoverRowGuide);
}

function positionHoverRowGuide(row) {
  if (!hoverRowGuide || !scheduleTable) return;
  hoverRowGuide.style.top = `${row.offsetTop}px`;
  hoverRowGuide.style.left = "0";
  hoverRowGuide.style.width = `${scheduleTable.scrollWidth}px`;
  hoverRowGuide.style.height = `${row.offsetHeight}px`;
  hoverRowGuide.hidden = false;
}

function updateHoverGuides(cell) {
  if (!cell) {
    clearHoverGuides();
    return;
  }

  const row = cell.closest(".member-row");
  const weekIndex = cell.dataset.weekIndex;
  const columnIndex = cell.dataset.columnIndex;
  if (!row || weekIndex == null || columnIndex == null) {
    clearHoverGuides();
    return;
  }

  const sameRow = activeHoverGuides.row === row;
  if (sameRow) return;

  clearHoverGuides();

  row.classList.add("is-hover-row");
  positionHoverRowGuide(row);
  activeHoverGuides = { row };
}

function paintCell(cell, value, slotIndex) {
  if (cell.classList.contains("lunch")) return;
  const startLabel = slots[slotIndex]?.label || "";
  const endLabel = getSlotEndLabel(slotIndex);
  const slotLabel = startLabel && endLabel ? `${startLabel}-${endLabel}` : startLabel;
  if (!value) {
    const bgColor = slots[slotIndex]?.isFringe
      ? "var(--foreign-bg)"
      : "var(--table-bg)";
    cell.style.background = bgColor;
    cell.title = slotLabel;
    return;
  }
  const brand = state.brands.find((b) => b.id === value);
  cell.style.background = brand?.color || "var(--table-bg)";
  cell.title = brand?.name ? `${brand.name} (${slotLabel})` : slotLabel;
}

function shouldCountBrandHours(brandId) {
  const brand = state.brands.find((b) => b.id === brandId);
  return brand && brand.billingCode !== "000000";
}

function renderTotals() {
  const brandMap = new Map();
  const memberMap = new Map();

  for (const member of state.members) {
    let memberHalfHours = 0;
    for (const day of weekdays) {
      if (day.foreign || isHoliday(day.key)) continue;
      const arr = state.assignments[day.key]?.[member];
      if (!arr) continue;
      for (let i = 0; i < arr.length; i += 1) {
        if (isMonthlyTimeOffSlot(day.key, i)) continue;
        const value = arr[i];
        if (value === "LUNCH" || !value) continue;
        if (!shouldCountBrandHours(value)) continue; // Skip brands with billing code 000000
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
  memberTotals.innerHTML = renderMemberTotals(memberEntries);
}

function renderTotalList(items, emptyText) {
  if (!items.length) return `<p>${emptyText}</p>`;
  return `<ul class="total-list">${items.map((item) => `<li><span>${escapeHtml(item.key)}</span><strong>${item.value}</strong></li>`).join("")}</ul>`;
}

function renderMemberTotals(items) {
  if (!items.length) return "<p>No member totals yet</p>";
  return `<div class="member-total-list">${items.map((item) => renderMemberTotalCard(item)).join("")}</div>`;
}

function renderMemberTotalCard(item) {
  const schedule = getMemberWorkSchedule(item.member);
  const isExpanded = expandedMemberTotals.has(item.member);
  const bodyMarkup = schedule.length
    ? `<ul class="member-total-schedule">${schedule.map((day) => `
        <li class="member-total-shift">
          <span class="member-total-day">${escapeHtml(day.label)}</span>
          <span class="member-total-ranges">${day.blocks.map((block) => `
            <span class="member-total-pill">
              <span class="member-total-pill-time">${escapeHtml(block.range)}</span>
              <span class="member-total-pill-brand">${escapeHtml(block.brand)}</span>
            </span>`).join("")}</span>
        </li>`).join("")}
      </ul>`
    : `<p class="member-total-empty">No scheduled work blocks in this month.</p>`;

  return `
    <div class="member-total-card${isExpanded ? " expanded" : ""}">
      <button
        type="button"
        class="member-total-toggle"
        data-member="${escapeHtml(item.member)}"
        aria-expanded="${isExpanded ? "true" : "false"}"
      >
        <span class="member-total-summary">
          <span class="member-total-arrow" aria-hidden="true"></span>
          <span class="member-total-name">${escapeHtml(item.member)}</span>
        </span>
        <strong class="member-total-hours">${item.hours.toFixed(1)} h</strong>
      </button>
      <div class="member-total-body"${isExpanded ? "" : " hidden"}>
        ${bodyMarkup}
      </div>
    </div>`;
}

function getMemberWorkSchedule(member) {
  const schedule = [];

  for (const day of weekdays) {
    if (day.foreign || isHoliday(day.key)) continue;
    const slotsForDay = state.assignments[day.key]?.[member];
    if (!slotsForDay) continue;

    const blocks = [];
    for (let i = 0; i < slotsForDay.length; i += 1) {
      if (isMonthlyTimeOffSlot(day.key, i)) continue;
      const value = slotsForDay[i];
      if (value === "LUNCH" || !value || !shouldCountBrandHours(value)) continue;

      const startIdx = i;
      let endIdx = i;
      while (endIdx + 1 < slotsForDay.length) {
        const nextValue = slotsForDay[endIdx + 1];
        if (isMonthlyTimeOffSlot(day.key, endIdx + 1) || nextValue !== value || nextValue === "LUNCH" || !nextValue || !shouldCountBrandHours(nextValue)) break;
        endIdx += 1;
      }

      const startLabel = slots[startIdx]?.label || "";
      const endLabel = getSlotEndLabel(endIdx);
      const brandName = state.brands.find((brand) => brand.id === value)?.name || "Unknown";
      const rangeLabel = startLabel && endLabel ? `${startLabel}-${endLabel}` : startLabel;
      if (rangeLabel) {
        blocks.push({
          range: rangeLabel,
          brand: brandName,
        });
      }

      i = endIdx;
    }

    if (blocks.length) {
      schedule.push({
        label: day.label,
        blocks,
      });
    }
  }

  return schedule;
}

function memberMonthHours(member) {
  let hh = 0;
  for (const day of weekdays) {
    if (day.foreign || isHoliday(day.key)) continue;
    const arr = state.assignments[day.key]?.[member];
    if (!arr) continue;
    for (let i = 0; i < arr.length; i += 1) {
      if (isMonthlyTimeOffSlot(day.key, i)) continue;
      if (arr[i] === "LUNCH" || !arr[i]) continue;
      if (!shouldCountBrandHours(arr[i])) continue; // Skip brands with billing code 000000
      hh += 1;
    }
  }
  return hh * 0.5;
}

function memberWeekHours(member, weekIndex) {
  let hh = 0;
  const weekDays = weeks[weekIndex] || [];
  for (const day of weekDays) {
    if (day.foreign || isHoliday(day.key)) continue;
    const arr = state.assignments[day.key]?.[member];
    if (!arr) continue;
    for (let i = 0; i < arr.length; i += 1) {
      if (isMonthlyTimeOffSlot(day.key, i)) continue;
      if (arr[i] === "LUNCH" || !arr[i]) continue;
      if (!shouldCountBrandHours(arr[i])) continue; // Skip brands with billing code 000000
      hh += 1;
    }
  }
  return hh * 0.5;
}

let _lastPaintSyncPromise = null;

function applyToCell(member, dayKey, slotIndex) {
  if (isMonthlyTimeOffSlot(dayKey, slotIndex)) return [];
  if (state.assignments[dayKey][member][slotIndex] === "LUNCH") return [];
  captureAssignmentUndoRow(activePaintUndoAction, dayKey, member);
  const memberSlots = state.assignments[dayKey][member];
  const previousValue = memberSlots[slotIndex];
  memberSlots[slotIndex] = paintMode === "erase" ? null : selectedBrandId;
  const changedSlotIndexes = [slotIndex];

  if (isEarlyArrivalSlot(slotIndex)) {
    const timeOffBrand = getTimeOffBrand() || ensureTimeOffBrand(state.brands);
    if (
      isAutomaticShiftWorkValue(previousValue, timeOffBrand?.id)
      || isAutomaticShiftWorkValue(memberSlots[slotIndex], timeOffBrand?.id)
    ) {
      changedSlotIndexes.push(
        ...reconcileAutomaticTimeOff(memberSlots, timeOffBrand?.id, dayKey)
      );
    }
  }

  _lastPaintSyncPromise = saveState({
    assignmentRows: assignmentRowsFor(dayKey, member)
  });
  return [...new Set(changedSlotIndexes)];
}

function paintChangedAssignmentCells(sourceCell, dayKey, changedSlotIndexes) {
  const memberRow = sourceCell?.closest(".member-row");
  if (!memberRow || !changedSlotIndexes?.length) return;

  const changedSlots = new Set(changedSlotIndexes);
  for (const cell of memberRow.querySelectorAll(".slot-cell")) {
    const slotIndex = Number(cell.dataset.slot);
    if (
      cell.dataset.day === dayKey
      && changedSlots.has(slotIndex)
      && !cell.classList.contains("lunch")
      && !cell.classList.contains("monthly-time-off")
    ) {
      paintCell(cell, state.assignments[dayKey][cell.dataset.member][slotIndex], slotIndex);
    }
  }
}

function finishLastPaintSync() {
  const paintSyncPromise = _lastPaintSyncPromise;
  if (!paintSyncPromise) return;

  // Release the UI immediately. The persistent outbox and debounce queue own
  // the network work, so another gesture can start while this one is syncing.
  _lastPaintSyncPromise = null;
  Promise.resolve(paintSyncPromise)
    .then((ok) => {
      if (!ok) console.warn("Guardado pendiente; se reintentará automáticamente.");
    })
    .catch((error) => console.error("Error sincronizando el trazo:", error));
}

function updateRenderedMemberHours(member) {
  if (!member || !scheduleBody) return;
  const memberRows = scheduleBody.querySelectorAll(".member-row");

  for (const row of memberRows) {
    if (row.dataset.member !== member) continue;
    const weekIndex = Number(row.dataset.weekIndex);
    const label = row.querySelector(".member-cell span");
    if (label) {
      label.textContent = `${member} (${memberWeekHours(member, weekIndex).toFixed(1)}h)`;
    }
  }
}

function attachEvents() {
  // Register the primary scheduling action first so optional toolbar controls
  // cannot prevent the modal from being connected.
  recurringBtn?.addEventListener("click", openRecurringModal);

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

  themeToggleBtn.addEventListener("click", toggleTheme);
  gridToggleBtn.addEventListener("click", toggleGridLines);

  memberTotals.addEventListener("click", (event) => {
    const toggle = event.target.closest(".member-total-toggle");
    if (!toggle) return;

    const card = toggle.closest(".member-total-card");
    const body = card?.querySelector(".member-total-body");
    const member = toggle.dataset.member;
    if (!card || !body || !member) return;

    const expanded = !card.classList.contains("expanded");
    card.classList.toggle("expanded", expanded);
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    body.hidden = !expanded;

    if (expanded) expandedMemberTotals.add(member);
    else expandedMemberTotals.delete(member);
    safeStorage.setItem(MEMBER_TOTALS_EXPANDED_KEY, JSON.stringify([...expandedMemberTotals]));
  });

  eraserBtn.addEventListener("click", () => {
    paintMode = paintMode === "erase" ? "brand" : "erase";
    updateEraserVisual();
  });

  timeOffBtn.addEventListener("click", () => {
    const timeOffBrand = getTimeOffBrand() || ensureTimeOffBrand(state.brands);

    selectedBrandId = timeOffBrand.id;
    paintMode = "brand";
    renderPalette();
    updateEraserVisual();
    saveState({ brandIds: [timeOffBrand.id] });
  });

  clearMonthBtn?.addEventListener("click", async () => {
    if (!confirm(`Clear all assignments for ${MONTHS[currentMonthIdx].label}?`)) return;
    const undoAction = createAssignmentUndoAction(`Clear ${MONTHS[currentMonthIdx].label}`);
    const clearedDays = [];
    for (const day of weekdays) {
      if (day.foreign || isHoliday(day.key)) continue;
      for (const member of state.members) {
        captureAssignmentUndoRow(undoAction, day.key, member);
        state.assignments[day.key][member] = createEmptyAssignmentRow();
      }
      clearedDays.push(day.key);
    }
    commitAssignmentUndoAction(undoAction);
    renderTable();
    renderTotals();
    const ok = await saveState({
      assignmentRows: assignmentRowsFor(clearedDays, state.members)
    });
    if (ok) showToast(`All assignments cleared for ${MONTHS[currentMonthIdx].label}`, "success");
  });

  addMemberBtn?.addEventListener("click", async () => {
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
    for (const day of allWeekdays) {
      state.assignments[day.key][clean] = createEmptyAssignmentRow();
    }
    renderTable();
    renderTotals();
    const ok = await saveState({
      memberChanges: [{ name: clean }]
    });
    if (ok) showToast(`Team member "${clean}" added`, "success");
  });

  removeMemberBtn?.addEventListener("click", async () => {
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
    if (typeof window.flushPendingScheduleChanges === "function") {
      const pendingSaved = await window.flushPendingScheduleChanges();
      if (!pendingSaved) {
        console.warn("No se puede eliminar el miembro mientras haya cambios pendientes.");
        return;
      }
    }
    state.members.splice(idx, 1);
    for (const day of allWeekdays) {
      if (state.assignments[day.key][memberName]) {
        delete state.assignments[day.key][memberName];
      }
    }
    renderTable();
    renderTotals();
    const ok = await saveState({
      removedMemberNames: [memberName]
    });
    if (ok) showToast(`Team member "${memberName}" removed`, "success");
  });

  addBrandBtn.addEventListener("click", async () => {
    const result = await openBrandModal("Add Brand", "", "#1D3557");
    if (!result) return;
    const id = `b${Date.now()}`;
    state.brands.push(normalizeBrandVisual({
      id,
      name: result.name,
      color: result.color,
      billingCode: result.billingCode
    }, state.brands.length));
    selectedBrandId = id;
    paintMode = "brand";
    renderPalette();
    renderTable();
    const ok = await saveState({
      brandIds: [id]
    });
    if (ok) showToast(`Brand "${result.name}" added`, "success");
  });

  importBrandsBtn?.addEventListener("click", () => {
    importBrandsInput.value = "";
    importBrandsModal.hidden = false;
    importBrandsInput.focus();
  });

  importBrandsOk.addEventListener("click", () => {
    const text = importBrandsInput.value.trim();
    if (!text) {
      showToast("Paste brand data first", "error");
      return;
    }
    const imported = parseBrandList(text);
    if (imported.length === 0) {
      showToast("No 'SI USAR' brands found in pasted data", "error");
      return;
    }
    // Add brands to state
    let added = 0;
    const addedBrandIds = [];
    for (const brand of imported) {
      if (!state.brands.find(b => b.name === brand.name)) {
        const id = `b${Date.now()}_${added}`;
        state.brands.push(normalizeBrandVisual({
          id,
          name: brand.name,
          color: brand.color,
          billingCode: brand.billingCode
        }, state.brands.length));
        addedBrandIds.push(id);
        added++;
      }
    }
    importBrandsModal.hidden = true;
    renderPalette();
    saveState({ brandIds: addedBrandIds });
    showToast(`Imported ${added} brand(s)`, "success");
  });

  brandSearchInput.addEventListener("input", () => {
    brandSearchQuery = brandSearchInput.value.toLowerCase().trim();
    renderPalette();
  });

  exportExcelBtn.addEventListener("click", async () => {
    if (!window.XlsxPopulate) {
      alert("Excel export library did not load. Please check your internet connection and reload.");
      return;
    }
    await exportScheduleToNewExcel();
  });

  exportAvailabilityBtn.addEventListener("click", async () => {
    if (!window.XlsxPopulate) {
      alert("Excel export library did not load. Please check your internet connection and reload.");
      return;
    }
    await exportAvailabilityToExcel();
  });

  refreshDataBtn.addEventListener("click", async () => {
    await refreshFromCloud();
  });

  importJsonBtn?.addEventListener("click", () => {
    importJsonFileInput.value = "";
    importJsonFileInput.click();
  });

  importJsonFileInput.addEventListener("change", async () => {
    const file = importJsonFileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importFromJson(data);
    } catch (e) {
      showToast("Error reading file: " + e.message, "error");
    }
  });

  scheduleBody.addEventListener("mousedown", (event) => {
    // Painting is exclusive to the primary (left) mouse button. A secondary
    // click is reserved for the Lunch context menu below.
    if (event.button !== 0 || event.ctrlKey) return;
    const cell = event.target.closest(".slot-cell");
    updateHoverGuides(cell);
    if (!cell || cell.classList.contains("lunch") || cell.classList.contains("foreign") || cell.classList.contains("holiday") || cell.classList.contains("monthly-time-off")) return;
    isMouseDown = true;
    activePaintUndoAction = createAssignmentUndoAction(
      paintMode === "erase" ? "Erase schedule" : "Paint schedule"
    );
    const member = cell.dataset.member;
    activePaintMember = member;
    const dayKey = cell.dataset.day;
    const slotIndex = Number(cell.dataset.slot);
    const changedSlotIndexes = applyToCell(member, dayKey, slotIndex);
    paintChangedAssignmentCells(cell, dayKey, changedSlotIndexes);
    renderTotals();
  });

  scheduleBody.addEventListener("mouseover", (event) => {
    const cell = event.target.closest(".slot-cell");
    updateHoverGuides(cell);
    if (!isMouseDown) return;
    if (!cell || cell.classList.contains("lunch") || cell.classList.contains("foreign") || cell.classList.contains("holiday") || cell.classList.contains("monthly-time-off")) return;
    const member = cell.dataset.member;
    if (member !== activePaintMember) return;
    const dayKey = cell.dataset.day;
    const slotIndex = Number(cell.dataset.slot);
    const changedSlotIndexes = applyToCell(member, dayKey, slotIndex);
    paintChangedAssignmentCells(cell, dayKey, changedSlotIndexes);
  });

  scheduleBody.addEventListener("mouseup", () => {
    if (!isMouseDown) return;
    const finishedMember = activePaintMember;
    isMouseDown = false;
    activePaintMember = null;
    commitAssignmentUndoAction(activePaintUndoAction);
    activePaintUndoAction = null;
    updateRenderedMemberHours(finishedMember);
    renderTotals();
    finishLastPaintSync();
  });

  document.addEventListener("mouseup", () => {
    if (!isMouseDown) return;
    const finishedMember = activePaintMember;
    isMouseDown = false;
    activePaintMember = null;
    commitAssignmentUndoAction(activePaintUndoAction);
    activePaintUndoAction = null;
    updateRenderedMemberHours(finishedMember);
    renderTotals();
    finishLastPaintSync();
  });

  scheduleBody.addEventListener("mouseleave", () => {
    clearHoverGuides();
  });

  // ── Right-click to toggle Lunch per member per slot ──────────────────────
  const lunchMenu = document.getElementById("lunchContextMenu");
  const lunchToggle = document.getElementById("lunchContextToggle");
  let _lunchCtx = null; // { member, dayKey, slotIndex, cell }

  scheduleBody.addEventListener("contextmenu", (event) => {
    const cell = event.target.closest(".slot-cell");
    if (!cell || cell.classList.contains("foreign") || cell.classList.contains("holiday") || cell.classList.contains("monthly-time-off")) return;
    event.preventDefault();
    const member = cell.dataset.member;
    const dayKey = cell.dataset.day;
    const slotIndex = Number(cell.dataset.slot);
    const isLunchNow = state.assignments[dayKey][member][slotIndex] === "LUNCH";
    lunchToggle.textContent = isLunchNow ? "Remove Lunch (work here)" : "Set as Lunch";
    _lunchCtx = { member, dayKey, slotIndex, cell };
    lunchMenu.style.display = "block";
    const bodyZoom = parseFloat(getComputedStyle(document.body).zoom) || 1;
    const menuPosition = calculateContextMenuPosition({
      clientX: event.clientX,
      clientY: event.clientY,
      menuWidth: lunchMenu.offsetWidth,
      menuHeight: lunchMenu.offsetHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      zoom: bodyZoom
    });
    lunchMenu.style.left = `${menuPosition.left}px`;
    lunchMenu.style.top = `${menuPosition.top}px`;
  });

  lunchToggle.addEventListener("click", async () => {
    lunchMenu.style.display = "none";
    if (!_lunchCtx) return;
    const { member, dayKey, slotIndex } = _lunchCtx;
    _lunchCtx = null;
    const undoAction = createAssignmentUndoAction("Update Lunch");
    captureAssignmentUndoRow(undoAction, dayKey, member);
    const isLunchNow = state.assignments[dayKey][member][slotIndex] === "LUNCH";
    state.assignments[dayKey][member][slotIndex] = isLunchNow ? null : "LUNCH";
    commitAssignmentUndoAction(undoAction);
    renderTable();
    renderTotals();
    const ok = await saveState({
      assignmentRows: assignmentRowsFor(dayKey, member)
    });
    if (ok) showToast("Changes synced", "success");
    else console.warn("No se pudo guardar el cambio de Lunch; se reintentará automáticamente.");
  });

  document.addEventListener("click", () => { lunchMenu.style.display = "none"; _lunchCtx = null; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { lunchMenu.style.display = "none"; _lunchCtx = null; } });
  document.addEventListener("keydown", handleUndoShortcut);
  window.addEventListener("resize", () => {
    window.requestAnimationFrame(updateTableSizing);
  });
}

function calculateContextMenuPosition({
  clientX,
  clientY,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
  zoom = 1
}) {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const margin = 8;
  const logicalViewportWidth = viewportWidth / safeZoom;
  const logicalViewportHeight = viewportHeight / safeZoom;
  const requestedLeft = clientX / safeZoom;
  const requestedTop = clientY / safeZoom;
  const maxLeft = Math.max(margin, logicalViewportWidth - menuWidth - margin);
  const maxTop = Math.max(margin, logicalViewportHeight - menuHeight - margin);

  return {
    left: Math.min(Math.max(margin, requestedLeft), maxLeft),
    top: Math.min(Math.max(margin, requestedTop), maxTop)
  };
}

function updateTableSizing() {
  if (!tableWrap || !weeks.length) return;

  const maxWeekDays = weeks.reduce((max, week) => Math.max(max, week.length), 0);
  if (!maxWeekDays) return;

  const root = document.documentElement;
  const rootStyles = getComputedStyle(root);
  const memberTrailingSpace =
    parseInt(rootStyles.getPropertyValue("--member-label-trailing-space"), 10) || 7;
  const widestMemberLabel = Array.from(
    scheduleBody?.querySelectorAll(".member-cell span") || []
  ).reduce((widest, label) => {
    const range = document.createRange();
    range.selectNodeContents(label);
    const textWidth = range.getBoundingClientRect().width;
    range.detach?.();
    return Math.max(widest, textWidth);
  }, 0);
  // Border (4px) + left padding (5px) + the requested trailing space.
  const memberWidth = Math.max(
    110,
    Math.min(210, Math.ceil(widestMemberLabel + 9 + memberTrailingSpace))
  );
  root.style.setProperty("--member-col-width", `${memberWidth}px`);
  const dayGapWidth = parseInt(rootStyles.getPropertyValue("--day-gap-width"), 10) || 8;
  const totalSlotColumns = maxWeekDays * slots.length;
  const availableWidth = tableWrap.clientWidth - memberWidth - (Math.max(0, maxWeekDays - 1) * dayGapWidth) - 8;
  const computedSlotWidth = Math.floor(availableWidth / totalSlotColumns);
  const slotWidth = Math.max(12, Math.min(22, computedSlotWidth));

  root.style.setProperty("--slot-width", `${slotWidth}px`);
}

async function importFromJson(data) {
  if (!data || !data.members || !data.assignments) {
    showToast("Invalid import file format", "error");
    return;
  }

  // Normalize a string: remove accents, trim, lowercase
  function normalize(str) {
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  // Build a resolver: JSON brand string → existing app brand ID
  // Strategy: 1) exact match  2) normalized match  3) strip suffix then contains
  function resolveJsonBrand(jsonName) {
    const normJson = normalize(jsonName);
    // 1. Exact (case-insensitive, accent-insensitive)
    const exact = state.brands.find((b) => normalize(b.name) === normJson);
    if (exact) return exact.id;
    // 2. Strip suffix like " (DAILY)", " (MONTHLY)", " (WEEKLY)" etc.
    const base = normJson.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (!base) return null;
    // 3. First app brand whose normalized name contains the base string
    const fuzzy = state.brands.find((b) => normalize(b.name).includes(base));
    return fuzzy ? fuzzy.id : null;
  }

  // Build a resolver: JSON member name → app member name (exact string used in state)
  // Handles accent/encoding differences between Excel and the app
  function resolveJsonMember(jsonName) {
    const normJson = normalize(jsonName);
    return state.members.find((m) => normalize(m) === normJson) || null;
  }

  // Import assignments — only for existing members, only for existing brands
  const undoAction = createAssignmentUndoAction("Import assignments");
  const importedDays = new Set();
  const changedAssignmentRows = [];
  for (const [dateKey, memberMap] of Object.entries(data.assignments)) {
    if (!state.assignments[dateKey]) continue; // date not in current year range, skip
    for (const [memberName, slotsArr] of Object.entries(memberMap)) {
      const appMember = resolveJsonMember(memberName);
      if (!appMember) continue; // skip unknown members
      state.assignments[dateKey][appMember] ||= slots.map(() => null);
      let memberChanged = false;
      for (let i = 0; i < slotsArr.length && i < slots.length; i++) {
        const val = slotsArr[i];
        if (!val) continue;
        const brandId = resolveJsonBrand(val);
        if (!brandId) continue; // no matching brand in app — skip
        if (state.assignments[dateKey][appMember][i] !== brandId) {
          captureAssignmentUndoRow(undoAction, dateKey, appMember);
          state.assignments[dateKey][appMember][i] = brandId;
          memberChanged = true;
        }
      }
      if (memberChanged) {
        changedAssignmentRows.push(...assignmentRowsFor(dateKey, appMember));
        importedDays.add(dateKey);
      }
    }
  }

  commitAssignmentUndoAction(undoAction);
  renderPalette();
  renderTable();
  renderTotals();
  const ok = await saveState({ assignmentRows: changedAssignmentRows });
  showToast(
    ok
      ? `Imported ${importedDays.size} days of assignments`
      : "⚠️ Import done locally but sync failed — try saving again",
    ok ? "success" : "error"
  );
}

async function exportScheduleToNewExcel() {
  try {
    exportExcelBtn.disabled = true;
    exportExcelBtn.textContent = "Exporting...";

    // Capture the visible month before the first await so changing tabs while
    // the workbook is being generated cannot change the export midway through.
    const exportMonth = getMonthExportSnapshot();

    const workbook = await window.XlsxPopulate.fromBlankAsync();
    const sheet = workbook.sheet(0);
    sheet.name("Schedule");

    // Headers
    sheet.cell("A1").value("Team Member").style("bold", true).style("fill", "D3D3D3");
    sheet.cell("B1").value("Member ID").style("bold", true).style("fill", "D3D3D3");
    sheet.cell("C1").value("Date").style("bold", true).style("fill", "D3D3D3");
    sheet.cell("D1").value("Client").style("bold", true).style("fill", "D3D3D3");
    sheet.cell("E1").value("Brand ID").style("bold", true).style("fill", "D3D3D3");
    sheet.cell("F1").value("Start time").style("bold", true).style("fill", "D3D3D3");
    sheet.cell("G1").value("End time").style("bold", true).style("fill", "D3D3D3");
    sheet.cell("H1").value("Hours").style("bold", true).style("fill", "D3D3D3");

    // Set column widths
    sheet.column("A").width(25);
    sheet.column("B").width(15);
    sheet.column("C").width(12);
    sheet.column("D").width(20);
    sheet.column("E").width(15);
    sheet.column("F").width(12);
    sheet.column("G").width(12);
    sheet.column("H").width(10);

    let rowNum = 2;
    const brandById = new Map(state.brands.map((b) => [b.id, b]));

    // Helper function to convert slot index to time
    const getSlotTime = (slotIndex) => {
      let totalMinutes = SLOT_START_HOUR * 60 + SLOT_START_MINUTE + (slotIndex * SLOT_DURATION_MINUTES);
      const startHour = Math.floor(totalMinutes / 60);
      const startMin = totalMinutes % 60;
      
      const endMinutes = totalMinutes + SLOT_DURATION_MINUTES;
      const endHour = Math.floor(endMinutes / 60);
      const endMin = endMinutes % 60;
      
      const pad = (n) => String(n).padStart(2, '0');
      return {
        start: `${pad(startHour)}:${pad(startMin)}`,
        end: `${pad(endHour)}:${pad(endMin)}`
      };
    };

    // Format date as M/D/YYYY
    const formatDate = (dateStr) => {
      const [year, month, day] = dateStr.split('-');
      return `${parseInt(month)}/${parseInt(day)}/${year}`;
    };

    // Export only assignments from the month currently visible to the user.
    const sortedDays = getAssignmentDaysForMonth(state.assignments, exportMonth);

    // Iterate through members (sorted)
    for (const member of state.members) {
      // Then iterate through all days for this member
      for (const dayKey of sortedDays) {
        // Skip holidays
        if (isHoliday(dayKey)) continue;
        
        const dayAssignments = state.assignments[dayKey];
        
        if (!dayAssignments[member]) continue;
        
        const memberSlots = dayAssignments[member];
        
        // Group consecutive slots by brand
        let i = 0;
        while (i < memberSlots.length) {
          const brandId = memberSlots[i];

          if (isMonthlyTimeOffSlot(dayKey, i)) {
            i++;
            continue;
          }
          
          // Skip empty slots and lunch
          if (!brandId || brandId === "LUNCH" || brandId === ".") {
            i++;
            continue;
          }
          
          const brand = brandById.get(brandId);
          if (!brand) {
            i++;
            continue;
          }
          
          // Skip brands with billing code 000000
          if (brand.billingCode === "000000") {
            i++;
            continue;
          }
          
          // Find consecutive slots with same brand
          let startSlot = i;
          let endSlot = i;
          
          while (endSlot + 1 < memberSlots.length && !isMonthlyTimeOffSlot(dayKey, endSlot + 1) && memberSlots[endSlot + 1] === brandId) {
            endSlot++;
          }
          
          // Get start time of first slot and end time of last slot
          const startTime = getSlotTime(startSlot).start;
          const endTime = getSlotTime(endSlot).end;
          const hours = (endSlot - startSlot + 1) * 0.5;
          
          // Add row
          sheet.cell(`A${rowNum}`).value(member);
          sheet.cell(`B${rowNum}`).value(state.memberDetails?.[member]?.memberId || "");
          sheet.cell(`C${rowNum}`).value(formatDate(dayKey));
          sheet.cell(`D${rowNum}`).value(brand.name || "");
          sheet.cell(`E${rowNum}`).value(brand.billingCode || "");
          sheet.cell(`F${rowNum}`).value(startTime);
          sheet.cell(`G${rowNum}`).value(endTime);
          sheet.cell(`H${rowNum}`).value(hours);
          
          rowNum++;
          i = endSlot + 1;
        }
      }
    }

    // Save and download
    const out = await workbook.outputAsync();
    const fileMonthLabel = exportMonth.label.replace(/\s+/g, "_");
    downloadBlob(out, `DXI_Timing_Map_${fileMonthLabel}_${todayStamp()}.xlsx`);
    showToast("Excel exported successfully");
  } catch (error) {
    console.error(error);
  } finally {
    exportExcelBtn.disabled = false;
    exportExcelBtn.textContent = "Export Excel";
  }
}

function getAvailabilityShift(slotIndex) {
  const slot = slots[slotIndex];
  if (!slot || slot.isLunch || slot.isFringe) return null;
  if (slot.hour < 13) return "AM";
  if (slot.hour >= 14) return "PM";
  return null;
}

function getAvailableHoursForMemberDay(member, day) {
  if (!day || day.foreign || isHoliday(day.key)) {
    return { am: 0, pm: 0, total: 0 };
  }

  const memberSlots = state.assignments[day.key]?.[member];
  if (!Array.isArray(memberSlots)) {
    return { am: 0, pm: 0, total: 0 };
  }

  let am = 0;
  let pm = 0;

  for (let i = 0; i < memberSlots.length; i += 1) {
    if (isMonthlyTimeOffSlot(day.key, i)) continue;
    const value = memberSlots[i];
    if (!(value === null || value === undefined || value === ".")) continue;

    const shift = getAvailabilityShift(i);
    if (shift === "AM") am += 0.5;
    else if (shift === "PM") pm += 0.5;
  }

  return { am, pm, total: am + pm };
}

async function exportAvailabilityToExcel() {
  try {
    exportAvailabilityBtn.disabled = true;
    exportAvailabilityBtn.textContent = "Exporting...";

    // Use one snapshot for the full report, even if the user switches tabs
    // while the asynchronous workbook generation is still running.
    const exportMonth = getMonthExportSnapshot();

    const workbook = await window.XlsxPopulate.fromBlankAsync();
    const sheet = workbook.sheet(0);
    const monthLabel = exportMonth.label;
    const sheetName = `Summary ${monthLabel} By Person`;
    sheet.name(sheetName.slice(0, 31));

    const title = `${monthLabel.toUpperCase()} - Available Hours by Person`;
    const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    const headerRowDay = 4;
    const headerRowShift = 5;
    let rowNum = 6;
    const monthTotals = Array.from({ length: 10 }, () => 0);
    let monthGrandTotal = 0;

    sheet.cell("A1").value(title).style("bold", true).style("fontSize", 14).style("fontColor", "FFFFFF").style("fill", "020028");
    sheet.cell("A2").value("");

    sheet.cell(`A${headerRowDay}`).value("Week").style("bold", true).style("fill", "D3D3D3");
    sheet.cell(`B${headerRowDay}`).value("Employee").style("bold", true).style("fill", "D3D3D3");
    sheet.cell(`M${headerRowDay}`).value("Grand Total").style("bold", true).style("fill", "D3D3D3");

    for (let dayIndex = 0; dayIndex < dayLabels.length; dayIndex += 1) {
      const dayCol = String.fromCharCode(67 + (dayIndex * 2));
      const pmCol = String.fromCharCode(68 + (dayIndex * 2));
      sheet.cell(`${dayCol}${headerRowDay}`).value(dayLabels[dayIndex]).style("bold", true).style("fill", "D3D3D3");
      sheet.cell(`${pmCol}${headerRowDay}`).value(dayLabels[dayIndex]).style("bold", true).style("fill", "D3D3D3");
      sheet.cell(`${dayCol}${headerRowShift}`).value("AM").style("bold", true).style("fill", "ECECEC");
      sheet.cell(`${pmCol}${headerRowShift}`).value("PM").style("bold", true).style("fill", "ECECEC");
    }

    sheet.cell(`A${headerRowShift}`).style("fill", "ECECEC");
    sheet.cell(`B${headerRowShift}`).style("fill", "ECECEC");
    sheet.cell(`M${headerRowShift}`).style("fill", "ECECEC");

    sheet.column("A").width(14);
    sheet.column("B").width(28);
    for (const col of ["C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]) {
      sheet.column(col).width(8);
    }
    sheet.column("M").width(12);

    for (let weekIndex = 0; weekIndex < exportMonth.weeks.length; weekIndex += 1) {
      const weekDays = exportMonth.weeks[weekIndex];
      const weekLabel = `Week ${weekIndex + 1}`;
      const weekRows = [...state.members]
        .sort(compareAvailabilityMemberOrder)
        .map((member) => {
          const dailyValues = weekDays.map((day) => getAvailableHoursForMemberDay(member, day));
          const total = dailyValues.reduce((sum, dayValue) => sum + dayValue.total, 0);
          return { member, dailyValues, total };
        })
        .sort(compareAvailabilityRows);

      const weekTotals = Array.from({ length: 10 }, () => 0);
      let weekGrandTotal = 0;

      for (let memberIndex = 0; memberIndex < weekRows.length; memberIndex += 1) {
        const weekRow = weekRows[memberIndex];
        sheet.cell(`A${rowNum}`).value(memberIndex === 0 ? weekLabel : "");
        sheet.cell(`B${rowNum}`).value(weekRow.member);

        let colIndex = 0;
        for (const dayValue of weekRow.dailyValues) {
          const values = [dayValue.am, dayValue.pm];
          for (const value of values) {
            const col = String.fromCharCode(67 + colIndex);
            sheet.cell(`${col}${rowNum}`).value(value).style("numberFormat", "0.0");
            weekTotals[colIndex] += value;
            monthTotals[colIndex] += value;
            colIndex += 1;
          }
        }

        sheet.cell(`M${rowNum}`).value(weekRow.total).style("numberFormat", "0.0");
        weekGrandTotal += weekRow.total;
        monthGrandTotal += weekRow.total;
        rowNum += 1;
      }

      sheet.cell(`A${rowNum}`).value(`${weekLabel} Total`).style("bold", true).style("fill", "DCE6F1");
      sheet.cell(`B${rowNum}`).style("fill", "DCE6F1");
      for (let i = 0; i < weekTotals.length; i += 1) {
        const col = String.fromCharCode(67 + i);
        sheet.cell(`${col}${rowNum}`).value(weekTotals[i]).style("bold", true).style("fill", "DCE6F1").style("numberFormat", "0.0");
      }
      sheet.cell(`M${rowNum}`).value(weekGrandTotal).style("bold", true).style("fill", "DCE6F1").style("numberFormat", "0.0");
      rowNum += 1;
    }

    sheet.cell(`A${rowNum}`).value("Month Total").style("bold", true).style("fill", "C6E0B4");
    sheet.cell(`B${rowNum}`).style("fill", "C6E0B4");
    for (let i = 0; i < monthTotals.length; i += 1) {
      const col = String.fromCharCode(67 + i);
      sheet.cell(`${col}${rowNum}`).value(monthTotals[i]).style("bold", true).style("fill", "C6E0B4").style("numberFormat", "0.0");
    }
    sheet.cell(`M${rowNum}`).value(monthGrandTotal).style("bold", true).style("fill", "C6E0B4").style("numberFormat", "0.0");

    const out = await workbook.outputAsync();
    const fileMonthLabel = monthLabel.replace(/\s+/g, "_");
    downloadBlob(out, `DXI_Availability_${fileMonthLabel}_${todayStamp()}.xlsx`);
    showToast("Availability exported successfully");
  } catch (error) {
    console.error(error);
  } finally {
    exportAvailabilityBtn.disabled = false;
    exportAvailabilityBtn.textContent = "Export Availability";
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

  Object.assign(brand, normalizeBrandVisual({
    ...brand,
    name: result.name,
    color: result.color,
    billingCode: result.billingCode
  }, state.brands.indexOf(brand)));
  renderPalette();
  renderTable();
  renderTotals();
  const ok = await saveState({ brandIds: [brandId] });
  if (ok) showToast(`Brand "${result.name}" updated`, "success");
}

async function deleteBrand(brandId) {
  const brand = state.brands.find((b) => b.id === brandId);
  if (!brand) return;
  if (!confirm(`Delete brand "${brand.name}"? Assignments using this brand will be cleared.`)) return;
  if (typeof window.flushPendingScheduleChanges === "function") {
    const pendingSaved = await window.flushPendingScheduleChanges();
    if (!pendingSaved) {
      console.warn("No se puede eliminar la marca mientras haya cambios pendientes.");
      return;
    }
  }

  state.brands = state.brands.filter((b) => b.id !== brandId);
  // Remove from assignments
  const affectedAssignmentRows = [];
  for (const dayKey of Object.keys(state.assignments)) {
    const day = state.assignments[dayKey];
    for (const member of Object.keys(day)) {
      const memberSlots = day[member];
      let memberChanged = false;
      if (Array.isArray(memberSlots)) {
        for (let i = 0; i < memberSlots.length; i++) {
          if (memberSlots[i] === brandId) {
            memberSlots[i] = null;
            memberChanged = true;
          }
        }
      }
      if (memberChanged) {
        affectedAssignmentRows.push(...assignmentRowsFor(dayKey, member));
      }
    }
  }
  if (selectedBrandId === brandId) {
    selectedBrandId = state.brands.length ? state.brands[0].id : null;
  }
  renderPalette();
  renderTable();
  renderTotals();
  const ok = await saveState({
    assignmentRows: affectedAssignmentRows,
    removedBrandIds: [brandId]
  });
  if (ok) showToast(`Brand "${brand.name}" deleted`, "success");
}

function parseBrandList(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const brands = [];
  const colorsPicked = new Set();

  for (const line of lines) {
    const parts = line.split('\t').map(p => p.trim());
    if (parts.length < 4) continue;
    
    // Check if last column contains "SI USAR"
    const lastCol = parts[parts.length - 1];
    if (!lastCol.includes("SI USAR")) continue;
    
    // Extract brand name (first column) and code (second column)
    const brandName = parts[0];
    const code = parts[1] || parts[2]; // Could be in col 2 or 3
    
    if (!brandName) continue;
    
    // Pick a color from fallback colors (cycle through)
    const colorIdx = brands.length % fallbackColors.length;
    const color = fallbackColors[colorIdx];
    
    brands.push({
      name: brandName,
      color: color,
      billingCode: code || ""
    });
  }
  
  return brands;
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

function openMemberModal(prefillName = "", prefillId = "") {
  const isEdit = prefillName !== "";
  memberModalName.value = prefillName;
  memberModalName.disabled = false;
  memberModalId.value = prefillId;
  memberModalId.placeholder = isEdit && prefillId ? prefillId : "e.g. 010101";
  // Update title dynamically
  memberModal.querySelector("h3").textContent = isEdit ? "Edit Team Member" : "Add Team Member";
  memberModal.hidden = false;
  memberModalName.focus();
  return new Promise((resolve) => {
    _memberModalResolve = (ok) => {
      _memberModalResolve = null;
      memberModalName.disabled = false;
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

async function editMember(memberName) {
  const currentId = state.memberDetails?.[memberName]?.memberId || "";
  const result = await openMemberModal(memberName, currentId);
  if (!result) return;
  if (typeof window.flushPendingScheduleChanges === "function") {
    const pendingSaved = await window.flushPendingScheduleChanges();
    if (!pendingSaved) {
      console.warn("No se puede editar el miembro mientras haya cambios pendientes.");
      return;
    }
  }
  const newName = result.name;
  if (!state.memberDetails) state.memberDetails = {};
  if (newName !== memberName) {
    // Rename in members array
    const idx = state.members.indexOf(memberName);
    if (idx !== -1) state.members[idx] = newName;
    // Migrate memberDetails
    state.memberDetails[newName] = state.memberDetails[memberName] || {};
    delete state.memberDetails[memberName];
    // Migrate assignments across all days
    for (const dayKey of Object.keys(state.assignments)) {
      if (memberName in state.assignments[dayKey]) {
        state.assignments[dayKey][newName] = state.assignments[dayKey][memberName];
        delete state.assignments[dayKey][memberName];
      }
    }
  }
  state.memberDetails[newName] = { memberId: result.memberId };
  const ok = await saveState({
    memberChanges: [{ name: newName, previousName: memberName }]
  });
  renderTable();
  if (ok) showToast(`Member "${newName}" updated`, "success");
}

function applyTotalsCollapse(collapsed) {
  totalsPanel.classList.toggle("collapsed", collapsed);
  toggleTotalsBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  toggleTotalsBtn.setAttribute("aria-label", collapsed ? "Expand Totals" : "Collapse Totals");
  toggleTotalsBtn.title = collapsed ? "Expand Totals" : "Collapse Totals";
}

function applyLegendCollapse(collapsed) {
  legendPanel.classList.toggle("collapsed", collapsed);
  toggleLegendBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  toggleLegendBtn.setAttribute("aria-label", collapsed ? "Expand Brand Palette" : "Collapse Brand Palette");
  toggleLegendBtn.title = collapsed ? "Expand Brand Palette" : "Collapse Brand Palette";
}

function buildDotCursorValue(color) {
  const normalized = normalizeHex(color);
  if (!normalized) return "crosshair";

  const svg = [
    "<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 12 12'>",
    `<circle cx='6' cy='6' r='3' fill='${normalized}' stroke='#181818' stroke-width='0.5'/>`,
    "</svg>"
  ].join("");

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 6 6, crosshair`;
}

function updateSlotCursor() {
  const root = document.documentElement;
  const eraserColor = getComputedStyle(root).getPropertyValue("--eraser-color").trim() || "#E52D4D";
  const activeBrand = state?.brands?.find((brand) => brand.id === selectedBrandId) || null;
  const cursorColor = paintMode === "erase"
    ? eraserColor
    : (activeBrand?.color || getComputedStyle(root).getPropertyValue("--accent").trim() || "#0E75FF");

  root.style.setProperty("--slot-cell-cursor", buildDotCursorValue(cursorColor));
}

function updateEraserVisual() {
  const timeOffBrand = getTimeOffBrand();
  const timeOffActive = paintMode === "brand" && selectedBrandId === timeOffBrand?.id;

  eraserBtn.style.borderColor = paintMode === "erase" ? "var(--eraser-active-border)" : "var(--eraser-border)";
  eraserBtn.style.background = paintMode === "erase" ? "var(--eraser-active-bg)" : "var(--eraser-bg)";
  eraserBtn.style.color = "var(--eraser-color)";
  eraserBtn.setAttribute("aria-pressed", paintMode === "erase" ? "true" : "false");

  if (timeOffBtn) {
    timeOffBtn.style.borderColor = timeOffActive ? "var(--time-off-active-border)" : "var(--time-off-border)";
    timeOffBtn.style.background = timeOffActive ? "var(--time-off-active-bg)" : "var(--time-off-bg)";
    timeOffBtn.style.color = timeOffActive ? "var(--time-off-active-color)" : "var(--time-off-color)";
    timeOffBtn.setAttribute("aria-pressed", timeOffActive ? "true" : "false");
    timeOffBtn.disabled = false;
    timeOffBtn.title = "Time Off";
  }

  updateSlotCursor();
}

function toLabel(hour, minute) {
  const min = minute === 0 ? "00" : "30";
  return `${hour}:${min}`;
}

function getSlotEndLabel(slotIndex) {
  const slot = slots[slotIndex];
  if (!slot) return "";
  const endHour = slot.minute === 30 ? slot.hour + 1 : slot.hour;
  const endMinute = slot.minute === 30 ? 0 : 30;
  return toLabel(endHour, endMinute);
}

function configureLunchSlots(memberSlots, startIdx, endExclusiveIdx, dayKey) {
  if (!Array.isArray(memberSlots)) return 0;

  for (let i = 0; i < memberSlots.length; i += 1) {
    if (memberSlots[i] === "LUNCH") memberSlots[i] = null;
  }

  let configuredSlots = 0;
  for (let i = startIdx; i < endExclusiveIdx && i < memberSlots.length; i += 1) {
    if (isMonthlyTimeOffSlot(dayKey, i)) continue;
    memberSlots[i] = "LUNCH";
    configuredSlots += 1;
  }

  return configuredSlots;
}

function applyRecurringAutomaticTimeOff(
  memberSlots,
  brandId,
  startIdx,
  endExclusiveIdx,
  dayKey
) {
  const timeOffBrand = getTimeOffBrand() || ensureTimeOffBrand(state?.brands);
  if (
    !Array.isArray(memberSlots)
    || !isAutomaticShiftWorkValue(brandId, timeOffBrand?.id)
  ) {
    return [];
  }

  const includesEarlyArrival = Array.from(
    { length: Math.max(0, endExclusiveIdx - startIdx) },
    (_, offset) => startIdx + offset
  ).some((slotIndex) => (
    isEarlyArrivalSlot(slotIndex) && memberSlots[slotIndex] === brandId
  ));

  return includesEarlyArrival
    ? reconcileAutomaticTimeOff(memberSlots, timeOffBrand.id, dayKey)
    : [];
}

/* ── Recurring Schedule Modal ── */
function openRecurringModal() {
  const modal = document.getElementById("recurringModal");
  const memberSel = document.getElementById("recMember");
  const brandSel = document.getElementById("recBrand");
  const startSel = document.getElementById("recStart");
  const endSel = document.getElementById("recEnd");
  const lunchStartSel = document.getElementById("recLunchStart");
  const lunchEndSel = document.getElementById("recLunchEnd");
  const scopeSel = document.getElementById("recScope");
  const weekPicker = document.getElementById("recWeekPicker");
  const weekLabel = weekPicker.querySelector(".modal-label");
  const weekSel = document.getElementById("recWeek");
  const dayPicker = document.getElementById("recDayPicker");
  const daysGrid = document.getElementById("recDays");
  let weeksGrid = document.getElementById("recWeeks");

  if (!weeksGrid) {
    weeksGrid = document.createElement("div");
    weeksGrid.id = "recWeeks";
    weeksGrid.className = "rec-days-grid";
    weekPicker.appendChild(weeksGrid);
  }
  if (weekLabel) weekLabel.textContent = "Weeks";
  if (weekSel) weekSel.hidden = true;

  // Populate members
  memberSel.innerHTML = [
    '<option value="">-- None --</option>',
    ...state.members.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
  ].join("");
  memberSel.value = "";

  // Populate brands
  brandSel.innerHTML = state.brands
    .filter((b) => b.name !== "LUNCH")
    .map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`)
    .join("");
  if (selectedBrandId) brandSel.value = selectedBrandId;

  // Populate time slots (all slots including lunch)
  const startTimeOptions = slots
    .map((s) => `<option value="${s.index}">${s.label}</option>`)
    .join("");
  const endTimeOptions = slots
    .map((s) => `<option value="${s.index + 1}">${getSlotEndLabel(s.index)}</option>`)
    .join("");
  startSel.innerHTML = startTimeOptions;
  endSel.innerHTML = endTimeOptions;
  lunchStartSel.innerHTML = `<option value="">---</option>${startTimeOptions}`;
  lunchEndSel.innerHTML = `<option value="">---</option>${endTimeOptions}`;
  lunchStartSel.value = "";
  lunchEndSel.value = "";

  lunchStartSel.onchange = () => {
    if (lunchStartSel.value === "") {
      lunchEndSel.value = "";
      return;
    }

    const lunchStartIdx = Number(lunchStartSel.value);
    if (lunchEndSel.value === "" || Number(lunchEndSel.value) <= lunchStartIdx) {
      lunchEndSel.value = String(Math.min(lunchStartIdx + 2, slots.length));
    }
  };
  // Default start to 8:00
  const defaultStartSlot = slots.find((slot) => slot.label === "8:00");
  if (defaultStartSlot) {
    startSel.value = String(defaultStartSlot.index);
  }
  // Default end to 9:00
  const defaultEndSlot = slots.findIndex((slot) => getSlotEndLabel(slot.index) === "9:00");
  if (defaultEndSlot !== -1) {
    endSel.value = String(defaultEndSlot + 1);
  } else if (slots.length) {
    endSel.value = String(slots.length);
  }

  function renderWeekChips() {
    weeksGrid.innerHTML = "";
    weeks.forEach((week, i) => {
      const chip = document.createElement("span");
      chip.className = "rec-day-chip";
      chip.textContent = `Week ${i + 1}`;
      chip.dataset.weekIndex = String(i);
      chip.title = week.filter((d) => !d.foreign).map((d) => d.label).join(", ");
      if (i === 0) chip.classList.add("selected");
      chip.addEventListener("click", () => chip.classList.toggle("selected"));
      weeksGrid.appendChild(chip);
    });
  }
  renderWeekChips();

  // Populate day chips
  function renderDayChips() {
    daysGrid.innerHTML = "";
    for (const day of weekdays) {
      if (day.foreign) continue;
      const chip = document.createElement("span");
      chip.className = "rec-day-chip";
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
    const endExclusiveIdx = Number(endSel.value);
    const hasLunchStart = lunchStartSel.value !== "";
    const hasLunchEnd = lunchEndSel.value !== "";
    const shouldConfigureLunch = hasLunchStart && hasLunchEnd;
    const lunchStartIdx = shouldConfigureLunch ? Number(lunchStartSel.value) : null;
    const lunchEndExclusiveIdx = shouldConfigureLunch ? Number(lunchEndSel.value) : null;
    const brandName = state.brands.find((b) => b.id === brandId)?.name || "Selected brand";

    if (!member) {
      alert("Please select a team member.");
      memberSel.focus();
      return;
    }

    if (startIdx >= endExclusiveIdx) {
      alert("End time must be after start time.");
      return;
    }

    if (hasLunchStart !== hasLunchEnd) {
      alert("Please select both Lunch Start Time and Lunch End Time, or leave both as ---.");
      return;
    }

    if (shouldConfigureLunch && lunchStartIdx >= lunchEndExclusiveIdx) {
      alert("Lunch End Time must be after Lunch Start Time.");
      return;
    }

    // Determine which days to apply
    let targetDays;
    if (scopeSel.value === "month") {
      targetDays = weekdays.filter((d) => !d.foreign).map((d) => d.key);
    } else if (scopeSel.value === "monToFri") {
      const selectedWeekIndexes = [...weeksGrid.querySelectorAll(".rec-day-chip.selected")]
        .map((chip) => Number(chip.dataset.weekIndex))
        .filter((idx) => !Number.isNaN(idx));

      targetDays = selectedWeekIndexes.flatMap((wIdx) =>
        (weeks[wIdx] || []).filter((d) => !d.foreign).map((d) => d.key)
      );
    } else {
      targetDays = [...daysGrid.querySelectorAll(".rec-day-chip.selected")].map((c) => c.dataset.key);
    }

    targetDays = [...new Set(targetDays)];

    if (!targetDays.length) {
      alert("No days selected.");
      return;
    }

    const slotIndexesInRange = [];
    for (let i = startIdx; i < endExclusiveIdx; i += 1) {
      slotIndexesInRange.push(i);
    }

    const configuredLunchSlotIndexes = new Set();
    if (shouldConfigureLunch) {
      for (let i = lunchStartIdx; i < lunchEndExclusiveIdx; i += 1) {
        configuredLunchSlotIndexes.add(i);
      }
    }

    const availableSlotsByDay = targetDays.map((dayKey) => (
      slotIndexesInRange.filter((slotIndex) => {
        if (isMonthlyTimeOffSlot(dayKey, slotIndex)) return false;
        if (shouldConfigureLunch) return !configuredLunchSlotIndexes.has(slotIndex);
        return state.assignments[dayKey]?.[member]?.[slotIndex] !== "LUNCH";
      })
    ));
    const hoursPerRegularDay = Math.max(0, ...availableSlotsByDay.map((daySlots) => daySlots.length * 0.5));
    const totalHours = availableSlotsByDay.reduce((total, daySlots) => total + daySlots.length * 0.5, 0);
    if (totalHours === 0) {
      alert("The selected work time is blocked by Lunch or Monthly Time Off.");
      return;
    }

    const totalLunchHours = shouldConfigureLunch
      ? targetDays.reduce((total, dayKey) => (
        total + [...configuredLunchSlotIndexes]
          .filter((slotIndex) => !isMonthlyTimeOffSlot(dayKey, slotIndex)).length * 0.5
      ), 0)
      : 0;
    if (shouldConfigureLunch && totalLunchHours === 0) {
      alert("The selected Lunch time is blocked by Monthly Time Off.");
      return;
    }

    const lunchSummary = shouldConfigureLunch
      ? `${slots[lunchStartIdx].label} - ${lunchEndSel.options[lunchEndSel.selectedIndex].text}`
      : "No change";
    const confirmationMessage = [
      "Apply recurring schedule?",
      "",
      `Team Member: ${member}`,
      `Brand: ${brandName}`,
      `Time: ${slots[startIdx].label} - ${endSel.options[endSel.selectedIndex].text}`,
      `Lunch: ${lunchSummary}`,
      `Days: ${targetDays.length}`,
      `Hours per regular day: ${hoursPerRegularDay.toFixed(1)}h`,
      `Total scheduled hours: ${totalHours.toFixed(1)}h`
    ].join("\n");

    if (!confirm(confirmationMessage)) {
      return;
    }

    const undoAction = createAssignmentUndoAction("Apply recurring schedule");

    // Apply work hours and, when requested, replace the existing Lunch time.
    for (const dayKey of targetDays) {
      const memberSlots = state.assignments[dayKey]?.[member];
      if (!memberSlots) continue;
      captureAssignmentUndoRow(undoAction, dayKey, member);

      for (let i = startIdx; i < endExclusiveIdx; i += 1) {
        if (isMonthlyTimeOffSlot(dayKey, i)) continue;
        if (shouldConfigureLunch && configuredLunchSlotIndexes.has(i)) continue;
        if (!shouldConfigureLunch && memberSlots[i] === "LUNCH") continue;
        memberSlots[i] = brandId;
      }

      if (shouldConfigureLunch) {
        configureLunchSlots(memberSlots, lunchStartIdx, lunchEndExclusiveIdx, dayKey);
      }

      applyRecurringAutomaticTimeOff(
        memberSlots,
        brandId,
        startIdx,
        endExclusiveIdx,
        dayKey
      );
    }

    commitAssignmentUndoAction(undoAction);
    modal.hidden = true;
    renderTable();
    renderTotals();
    const ok = await saveState({
      assignmentRows: assignmentRowsFor(targetDays, member)
    });
    if (ok) {
      showToast(
        `${member} scheduled for ${totalHours.toFixed(1)}h across ${targetDays.length} day(s)${shouldConfigureLunch ? " with Lunch updated" : ""}`,
        "success"
      );
    } else {
      console.warn("No se pudo guardar el horario recurrente; se reintentará automáticamente.");
    }
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
