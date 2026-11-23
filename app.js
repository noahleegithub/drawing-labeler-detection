import * as pdfjsLib from "./pdfjs/pdf.min.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "./pdfjs/pdf.worker.min.js",
  import.meta.url
).href;

const SCHEMA = "drawing-symbol-labeler/v1";
const DEFAULT_CLASS = "symbol";
const PALETTE = [
  "#0f6d72", "#c2571a", "#2f7d32", "#8a4f9e", "#b58a00",
  "#006d9c", "#9e3c55", "#4f6b29", "#6b4c3b", "#3d5a80",
];
const MIN_NORM = 0.004;
const MAX_HISTORY = 60;

const $ = (id) => document.getElementById(id);
const els = {
  fileInput: $("fileInput"),
  importInput: $("importInput"),
  dropZone: $("dropZone"),
  fileMeta: $("fileMeta"),
  fileName: $("fileName"),
  fileSub: $("fileSub"),
  clearFileBtn: $("clearFileBtn"),
  classInput: $("classInput"),
  addClassBtn: $("addClassBtn"),
  classList: $("classList"),
  classCount: $("classCount"),
  pageList: $("pageList"),
  pageCount: $("pageCount"),
  progressText: $("progressText"),
  fileState: $("fileState"),
  resetBtn: $("resetBtn"),
  importBtn: $("importBtn"),
  exportJsonBtn: $("exportJsonBtn"),
  selectTool: $("selectTool"),
  drawTool: $("drawTool"),
  prevBtn: $("prevBtn"),
  nextBtn: $("nextBtn"),
  pageIndicator: $("pageIndicator"),
  previewLabel: $("previewLabel"),
  undoBtn: $("undoBtn"),
  redoBtn: $("redoBtn"),
  zoomOutBtn: $("zoomOutBtn"),
  zoomInBtn: $("zoomInBtn"),
  zoomLabel: $("zoomLabel"),
  fitBtn: $("fitBtn"),
  toggleBoxesBtn: $("toggleBoxesBtn"),
  stage: $("stage"),
  emptyState: $("emptyState"),
  canvasWrap: $("canvasWrap"),
  pdfCanvas: $("pdfCanvas"),
  overlayCanvas: $("overlayCanvas"),
  viewerStatus: $("viewerStatus"),
  labelSummary: $("labelSummary"),
  selectedEmpty: $("selectedEmpty"),
  selectedPanel: $("selectedPanel"),
  selClass: $("selClass"),
  selX: $("selX"),
  selY: $("selY"),
  selW: $("selW"),
  selH: $("selH"),
  duplicateBoxBtn: $("duplicateBoxBtn"),
  ignoreBoxBtn: $("ignoreBoxBtn"),
  deleteBoxBtn: $("deleteBoxBtn"),
  boxCount: $("boxCount"),
  boxFilter: $("boxFilter"),
  boxList: $("boxList"),
  pageStatusBtn: $("pageStatusBtn"),
  clearPageBtn: $("clearPageBtn"),
  exportLongEdge: $("exportLongEdge"),
  exportDatasetBtn: $("exportDatasetBtn"),
  exportYoloBtn: $("exportYoloBtn"),
  exportCocoBtn: $("exportCocoBtn"),
  exportProgress: $("exportProgress"),
  toast: $("toast"),
};

const state = {
  pdf: null,
  file: null,
  numPages: 0,
  currentPage: 1,
  zoom: 1,
  classes: [],
  activeClassId: null,
  annotations: {},
  pageStatus: {},
  selectedId: null,
  tool: "select",
  showBoxes: true,
  view: { w: 0, h: 0, dpr: 1 },
  renderToken: 0,
  drag: null,
  history: [],
  future: [],
  pageDims: new Map(),
  exporting: false,
};

function uid() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `b-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toast(message, duration = 2400) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => els.toast.classList.remove("show"), duration);
}

function storageKey() {
  if (!state.file) return null;
  return `drawing-symbol-labeler:v1:${state.file.name}:${state.file.size}:${state.file.lastModified}`;
}

function defaultClasses() {
  return [{ id: 1, name: DEFAULT_CLASS, color: PALETTE[0] }];
}

function activeClass() {
  return state.classes.find((item) => item.id === state.activeClassId) || state.classes[0] || null;
}

function classById(id) {
  return state.classes.find((item) => item.id === id) || null;
}

function classIndex(id) {
  return state.classes.findIndex((item) => item.id === id);
}

function nextBoxId() {
  return uid();
}

function boxesFor(page = state.currentPage) {
  return state.annotations[String(page)] || [];
}

function ensureBoxes(page = state.currentPage) {
  const key = String(page);
  if (!state.annotations[key]) state.annotations[key] = [];
  return state.annotations[key];
}

function selectedBox() {
  return boxesFor().find((box) => box.id === state.selectedId) || null;
}

function normalizeRect(x1, y1, x2, y2) {
  const x = clamp(Math.min(x1, x2), 0, 1);
  const y = clamp(Math.min(y1, y2), 0, 1);
  const right = clamp(Math.max(x1, x2), 0, 1);
  const bottom = clamp(Math.max(y1, y2), 0, 1);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

function isValidBox(box) {
  return box
    && Number.isFinite(box.x) && Number.isFinite(box.y)
    && Number.isFinite(box.w) && Number.isFinite(box.h)
    && box.w > 0 && box.h > 0;
}

function pageLabel(page = state.currentPage) {
  return `Page ${page}`;
}

function pageStatus(page = state.currentPage) {
  return state.pageStatus[String(page)] || "todo";
}

function saveState() {
  const key = storageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      schema: SCHEMA,
      classes: state.classes,
      activeClassId: state.activeClassId,
      annotations: state.annotations,
      pageStatus: state.pageStatus,
      currentPage: state.currentPage,
      zoom: state.zoom,
      tool: state.tool,
    }));
  } catch (err) {
    console.warn("Could not save annotations", err);
    toast("Could not save locally; export a project backup.");
  }
}

function restoreState() {
  const key = storageKey();
  if (!key) return;
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(key) || "null");
  } catch (err) {
    console.warn("Could not read saved annotations", err);
  }
  if (!saved) return;
  if (Array.isArray(saved.classes) && saved.classes.length) {
    state.classes = saved.classes
      .filter((item) => item && Number.isFinite(Number(item.id)) && item.name)
      .map((item, index) => ({
        id: Number(item.id),
        name: String(item.name).slice(0, 40),
        color: /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : PALETTE[index % PALETTE.length],
      }));
  }
  if (!state.classes.length) state.classes = defaultClasses();
  state.activeClassId = state.classes.some((item) => item.id === Number(saved.activeClassId))
    ? Number(saved.activeClassId)
    : state.classes[0].id;
  state.annotations = sanitizeAnnotations(saved.annotations);
  state.pageStatus = sanitizeStatus(saved.pageStatus);
  state.currentPage = clamp(Number(saved.currentPage) || 1, 1, state.numPages);
  state.zoom = clamp(Number(saved.zoom) || 1, 0.25, 5);
  state.tool = saved.tool === "draw" ? "draw" : "select";
  if (Object.keys(state.annotations).length || Object.keys(state.pageStatus).length) {
    toast("Restored saved boxes for this file");
  }
}

function sanitizeAnnotations(raw) {
  const result = {};
  if (!raw || typeof raw !== "object") return result;
  for (const [page, boxes] of Object.entries(raw)) {
    if (!Array.isArray(boxes)) continue;
    const pageNumber = Number(page);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > state.numPages) continue;
    result[String(pageNumber)] = boxes
      .filter((box) => isValidBox(box))
      .map((box) => ({
        id: box.id || nextBoxId(),
        classId: Number(box.classId),
        x: clamp(Number(box.x), 0, 1),
        y: clamp(Number(box.y), 0, 1),
        w: clamp(Number(box.w), 0, 1),
        h: clamp(Number(box.h), 0, 1),
        ignored: Boolean(box.ignored),
      }))
      .filter((box) => box.w > 0 && box.h > 0);
    if (!result[String(pageNumber)].length) delete result[String(pageNumber)];
  }
  return result;
}

function sanitizeStatus(raw) {
  const result = {};
  if (!raw || typeof raw !== "object") return result;
  for (const [page, status] of Object.entries(raw)) {
    const number = Number(page);
    if (Number.isInteger(number) && number >= 1 && number <= state.numPages && status === "complete") {
      result[String(number)] = "complete";
    }
  }
  return result;
}

function showEmptyState(message = "Load a drawing to start labeling") {
  els.emptyState.hidden = false;
  els.emptyState.querySelector("h2").textContent = message;
  els.canvasWrap.hidden = true;
}

function updateChrome() {
  const totalBoxes = Object.values(state.annotations).reduce((sum, boxes) => sum + boxes.length, 0);
  const completePages = Object.values(state.pageStatus).filter((status) => status === "complete").length;
  els.progressText.textContent = `${totalBoxes} box${totalBoxes === 1 ? "" : "es"} · ${completePages}/${state.numPages || 0} pages complete`;
  els.fileState.textContent = state.file
    ? `${state.numPages} page${state.numPages === 1 ? "" : "s"}`
    : "No file";
  els.pageIndicator.textContent = state.pdf ? `${state.currentPage} / ${state.numPages}` : "—";
  els.prevBtn.disabled = !state.pdf || state.currentPage <= 1;
  els.nextBtn.disabled = !state.pdf || state.currentPage >= state.numPages;
  els.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  els.undoBtn.disabled = state.history.length === 0;
  els.redoBtn.disabled = state.future.length === 0;
  els.selectTool.classList.toggle("active", state.tool === "select");
  els.drawTool.classList.toggle("active", state.tool === "draw");
  els.selectTool.setAttribute("aria-pressed", String(state.tool === "select"));
  els.drawTool.setAttribute("aria-pressed", String(state.tool === "draw"));
  els.canvasWrap.classList.toggle("draw-mode", state.tool === "draw");
  els.canvasWrap.classList.toggle("hide-boxes", !state.showBoxes);
  els.toggleBoxesBtn.textContent = state.showBoxes ? "Hide boxes" : "Show boxes";
  els.toggleBoxesBtn.setAttribute("aria-pressed", String(state.showBoxes));
  els.labelSummary.textContent = activeClass() ? `Active class: ${activeClass().name}` : "No class selected";
  const status = pageStatus();
  els.pageStatusBtn.textContent = status === "complete" ? "Reopen page" : "Mark page complete";
  els.pageStatusBtn.classList.toggle("complete", status === "complete");
  const current = selectedBox();
  els.selectedEmpty.hidden = Boolean(current);
  els.selectedPanel.hidden = !current;
  if (current) {
    const cls = classById(current.classId);
    els.selClass.value = String(current.classId);
    els.selX.textContent = current.x.toFixed(3);
    els.selY.textContent = current.y.toFixed(3);
    els.selW.textContent = current.w.toFixed(3);
    els.selH.textContent = current.h.toFixed(3);
    els.ignoreBoxBtn.textContent = current.ignored ? "Unignore" : "Ignore";
    els.ignoreBoxBtn.setAttribute("aria-pressed", String(current.ignored));
    els.selClass.title = cls ? cls.name : "Unknown class";
  }
  els.previewLabel.textContent = state.pdf
    ? `${pageLabel()} of ${state.numPages} · ${state.showBoxes ? "boxes visible" : "boxes hidden"}`
    : "No page loaded";
}

function renderClasses() {
  els.classList.innerHTML = "";
  if (!state.classes.length) state.classes = defaultClasses();
  if (!state.classes.some((item) => item.id === state.activeClassId)) state.activeClassId = state.classes[0].id;
  for (const cls of state.classes) {
    const row = document.createElement("div");
    row.className = "class-row";
    row.classList.toggle("active", cls.id === state.activeClassId);
    row.dataset.id = String(cls.id);

    const color = document.createElement("input");
    color.type = "color";
    color.className = "class-swatch";
    color.value = cls.color;
    color.title = "Class color";
    color.addEventListener("input", () => {
      cls.color = color.value;
      saveState();
      drawOverlay();
      renderBoxList();
    });

    const name = document.createElement("button");
    name.type = "button";
    name.className = "class-name-button";
    name.textContent = cls.name;
    name.title = "Select class; double-click to rename";
    name.addEventListener("click", () => selectClass(cls.id));
    name.addEventListener("dblclick", () => renameClass(cls.id));

    const key = document.createElement("span");
    key.className = "class-key";
    const index = classIndex(cls.id);
    key.textContent = index < 9 ? String(index + 1) : "·";

    const del = document.createElement("button");
    del.type = "button";
    del.className = "class-delete";
    del.textContent = "×";
    del.title = "Delete class";
    del.addEventListener("click", (event) => {
      event.stopPropagation();
      removeClass(cls.id);
    });

    row.append(color, name, key, del);
    els.classList.append(row);
  }
  els.classCount.textContent = `${state.classes.length} class${state.classes.length === 1 ? "" : "es"}`;
  const selectedFilter = els.boxFilter.value;
  els.boxFilter.innerHTML = '<option value="">All classes</option>';
  for (const cls of state.classes) {
    const option = document.createElement("option");
    option.value = String(cls.id);
    option.textContent = cls.name;
    els.boxFilter.append(option);
  }
  els.boxFilter.value = state.classes.some((cls) => String(cls.id) === selectedFilter) ? selectedFilter : "";
  renderInspectorClassOptions();
}

function renderInspectorClassOptions() {
  const current = selectedBox();
  els.selClass.innerHTML = "";
  for (const cls of state.classes) {
    const option = document.createElement("option");
    option.value = String(cls.id);
    option.textContent = cls.name;
    els.selClass.append(option);
  }
  if (current) els.selClass.value = String(current.classId);
}

function selectClass(id) {
  if (!state.classes.some((cls) => cls.id === id)) return;
  state.activeClassId = id;
  saveState();
  renderClasses();
  updateChrome();
}

function addClass() {
  const raw = els.classInput.value.trim();
  if (!raw) {
    els.classInput.focus();
    return;
  }
  if (raw.length > 40) {
    toast("Class names are limited to 40 characters.");
    return;
  }
  if (state.classes.some((cls) => cls.name.toLowerCase() === raw.toLowerCase())) {
    toast("That class already exists.");
    return;
  }
  const nextId = Math.max(0, ...state.classes.map((cls) => cls.id)) + 1;
  const cls = {
    id: nextId,
    name: raw,
    color: PALETTE[state.classes.length % PALETTE.length],
  };
  state.classes.push(cls);
  state.activeClassId = cls.id;
  els.classInput.value = "";
  saveState();
  renderClasses();
  updateChrome();
  drawOverlay();
  toast(`Class “${cls.name}” added`);
}

function renameClass(id) {
  const cls = classById(id);
  if (!cls) return;
  const next = window.prompt("Rename class", cls.name);
  if (next == null) return;
  const name = next.trim();
  if (!name) return;
  if (name.length > 40) {
    toast("Class names are limited to 40 characters.");
    return;
  }
  if (state.classes.some((item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) {
    toast("That class already exists.");
    return;
  }
  cls.name = name;
  saveState();
  renderClasses();
  renderBoxList();
  updateChrome();
  toast("Class renamed");
}

function removeClass(id) {
  if (state.classes.length <= 1) {
    toast("Keep at least one class.");
    return;
  }
  const used = Object.values(state.annotations).some((boxes) => boxes.some((box) => box.classId === id));
  if (used) {
    toast("That class has boxes. Reassign or delete them first.");
    return;
  }
  const cls = classById(id);
  if (!cls || !window.confirm(`Delete class “${cls.name}”?`)) return;
  state.classes = state.classes.filter((item) => item.id !== id);
  if (state.activeClassId === id) state.activeClassId = state.classes[0].id;
  saveState();
  renderClasses();
  renderBoxFilter();
  updateChrome();
}

function renderPageList() {
  els.pageList.innerHTML = "";
  if (!state.pdf) {
    els.pageCount.textContent = "No PDF loaded";
    return;
  }
  els.pageCount.textContent = `${state.numPages} page${state.numPages === 1 ? "" : "s"}`;
  for (let page = 1; page <= state.numPages; page += 1) {
    const boxCount = boxesFor(page).length;
    const status = pageStatus(page);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "page-card";
    card.classList.toggle("current", page === state.currentPage);
    card.classList.toggle("complete", status === "complete");
    card.dataset.page = String(page);
    card.innerHTML = `
      <span class="page-num">Page ${page}</span>
      <span class="page-count">${boxCount} box${boxCount === 1 ? "" : "es"}</span>
      <span class="page-status">${status === "complete" ? "Complete" : boxCount ? "In progress" : "Not started"}</span>
    `;
    card.addEventListener("click", () => setPage(page));
    els.pageList.append(card);
  }
}

function setPage(page) {
  if (!state.pdf) return;
  const next = clamp(page, 1, state.numPages);
  if (next === state.currentPage) {
    renderPageList();
    return;
  }
  state.currentPage = next;
  state.selectedId = null;
  state.drag = null;
  saveState();
  renderPageList();
  renderBoxList();
  updateChrome();
  renderPage();
}

function renderBoxList() {
  const boxes = boxesFor();
  const filterValue = els.boxFilter.value;
  const filtered = filterValue ? boxes.filter((box) => String(box.classId) === filterValue) : boxes.slice();
  filtered.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  els.boxList.innerHTML = "";
  els.boxCount.textContent = filterValue ? `${filtered.length}/${boxes.length}` : String(boxes.length);
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-boxes";
    empty.textContent = boxes.length ? "No boxes match this filter." : "No boxes yet on this page.";
    els.boxList.append(empty);
    return;
  }
  for (const box of filtered) {
    const cls = classById(box.classId);
    const row = document.createElement("div");
    row.className = "box-row";
    row.classList.toggle("selected", box.id === state.selectedId);
    row.classList.toggle("ignored", box.ignored);
    row.dataset.id = box.id;
    const dot = document.createElement("span");
    dot.className = "box-dot";
    dot.style.background = cls ? cls.color : "#777";
    const label = document.createElement("button");
    label.type = "button";
    label.className = "box-label";
    label.style.border = "0";
    label.style.background = "none";
    label.style.textAlign = "left";
    label.style.padding = "0";
    label.innerHTML = `${escapeHtml(cls ? cls.name : "Unknown")}<small>${Math.round(box.w * 1000) / 10}×${Math.round(box.h * 1000) / 10}%</small>`;
    label.addEventListener("click", () => selectBox(box.id));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "box-delete";
    del.textContent = "×";
    del.title = "Delete box";
    del.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteBox(box.id);
    });
    row.append(dot, label, del);
    row.addEventListener("click", () => selectBox(box.id));
    els.boxList.append(row);
  }
}

function renderBoxFilter() {
  const selected = els.boxFilter.value;
  els.boxFilter.innerHTML = '<option value="">All classes</option>';
  for (const cls of state.classes) {
    const option = document.createElement("option");
    option.value = String(cls.id);
    option.textContent = cls.name;
    els.boxFilter.append(option);
  }
  els.boxFilter.value = state.classes.some((cls) => String(cls.id) === selected) ? selected : "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function selectBox(id) {
  const box = boxesFor().find((item) => item.id === id);
  if (!box) return;
  state.selectedId = id;
  renderBoxList();
  renderInspectorClassOptions();
  updateChrome();
  drawOverlay();
}

function deleteBox(id) {
  if (!state.pdf) return;
  const boxes = boxesFor();
  const index = boxes.findIndex((box) => box.id === id);
  if (index === -1) return;
  pushHistory();
  boxes.splice(index, 1);
  if (state.selectedId === id) state.selectedId = null;
  saveState();
  renderPageList();
  renderBoxList();
  updateChrome();
  drawOverlay();
}

function duplicateBox() {
  const box = selectedBox();
  if (!box) return;
  pushHistory();
  const copy = {
    ...clone(box),
    id: nextBoxId(),
    x: clamp(box.x + 0.01, 0, 1 - box.w),
    y: clamp(box.y + 0.01, 0, 1 - box.h),
  };
  boxesFor().push(copy);
  state.selectedId = copy.id;
  saveState();
  renderPageList();
  renderBoxList();
  updateChrome();
  drawOverlay();
}

function toggleIgnore() {
  const box = selectedBox();
  if (!box) return;
  pushHistory();
  box.ignored = !box.ignored;
  saveState();
  renderBoxList();
  updateChrome();
  drawOverlay();
}

function changeSelectedClass(id) {
  const box = selectedBox();
  if (!box) return;
  pushHistory();
  box.classId = Number(id);
  saveState();
  renderPageList();
  renderBoxList();
  updateChrome();
  drawOverlay();
}

function clearPage() {
  if (!state.pdf) return;
  const boxes = boxesFor();
  if (!boxes.length) return;
  if (!window.confirm(`Delete ${boxes.length} box${boxes.length === 1 ? "" : "es"} on ${pageLabel()}?`)) return;
  pushHistory();
  delete state.annotations[String(state.currentPage)];
  state.selectedId = null;
  saveState();
  renderPageList();
  renderBoxList();
  updateChrome();
  drawOverlay();
}

function togglePageStatus() {
  if (!state.pdf) return;
  const key = String(state.currentPage);
  if (state.pageStatus[key] === "complete") delete state.pageStatus[key];
  else state.pageStatus[key] = "complete";
  saveState();
  renderPageList();
  updateChrome();
}

function setTool(tool) {
  state.tool = tool === "draw" ? "draw" : "select";
  if (state.tool === "select") state.drag = null;
  saveState();
  updateChrome();
  drawOverlay();
}

function setShowBoxes(value) {
  state.showBoxes = Boolean(value);
  updateChrome();
  drawOverlay();
}

function setZoom(value) {
  state.zoom = clamp(value, 0.25, 5);
  saveState();
  updateChrome();
  renderPage();
}

function undo() {
  const entry = state.history.pop();
  if (!entry) return;
  state.future.push({ page: state.currentPage, boxes: clone(boxesFor()) });
  state.currentPage = entry.page;
  state.annotations[String(entry.page)] = clone(entry.boxes);
  if (!state.annotations[String(entry.page)].length) delete state.annotations[String(entry.page)];
  state.selectedId = null;
  saveState();
  renderPageList();
  renderBoxList();
  updateChrome();
  renderPage();
}

function redo() {
  const entry = state.future.pop();
  if (!entry) return;
  state.history.push({ page: state.currentPage, boxes: clone(boxesFor()) });
  state.currentPage = entry.page;
  state.annotations[String(entry.page)] = clone(entry.boxes);
  if (!state.annotations[String(entry.page)].length) delete state.annotations[String(entry.page)];
  state.selectedId = null;
  saveState();
  renderPageList();
  renderBoxList();
  updateChrome();
  renderPage();
}

function pushHistory() {
  if (!state.pdf) return;
  state.history.push({ page: state.currentPage, boxes: clone(boxesFor()) });
  if (state.history.length > MAX_HISTORY) state.history.shift();
  state.future = [];
  updateChrome();
}

function pageToCanvas(point, rect = els.overlayCanvas.getBoundingClientRect()) {
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  return {
    x: clamp((point.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((point.clientY - rect.top) / rect.height, 0, 1),
  };
}

function boxToPixels(box) {
  return {
    x: box.x * state.view.w,
    y: box.y * state.view.h,
    w: box.w * state.view.w,
    h: box.h * state.view.h,
  };
}

function handleAt(point) {
  const box = selectedBox();
  if (!box) return null;
  const rect = boxToPixels(box);
  const tolerance = 8;
  const px = point.x * state.view.w;
  const py = point.y * state.view.h;
  const handles = {
    nw: [rect.x, rect.y], n: [rect.x + rect.w / 2, rect.y],
    ne: [rect.x + rect.w, rect.y], e: [rect.x + rect.w, rect.y + rect.h / 2],
    se: [rect.x + rect.w, rect.y + rect.h], s: [rect.x + rect.w / 2, rect.y + rect.h],
    sw: [rect.x, rect.y + rect.h], w: [rect.x, rect.y + rect.h / 2],
  };
  for (const [name, [x, y]] of Object.entries(handles)) {
    if (Math.hypot(px - x, py - y) <= tolerance) return name;
  }
  return null;
}

function boxAt(point) {
  const boxes = boxesFor();
  for (let i = boxes.length - 1; i >= 0; i -= 1) {
    const box = boxes[i];
    if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) {
      return box;
    }
  }
  return null;
}

function startDrag(event, kind, box = null) {
  if (!state.pdf || !state.showBoxes) return;
  const point = pageToCanvas(event);
  if (kind === "draw") {
    state.drag = { kind, start: point, current: point, pointerId: event.pointerId };
  } else if (kind === "move" && box) {
    pushHistory();
    state.drag = {
      kind, boxId: box.id, start: point, origin: clone(box),
      pointerId: event.pointerId,
    };
  } else if (kind === "resize" && box) {
    pushHistory();
    state.drag = {
      kind, boxId: box.id, handle: handleAt(point), start: point,
      origin: clone(box), pointerId: event.pointerId,
    };
  }
  if (state.drag) {
    try {
      els.overlayCanvas.setPointerCapture?.(event.pointerId);
    } catch (err) {
      // Synthetic pointer events in tests may not be capturable.
    }
    event.preventDefault();
    drawOverlay();
  }
}

function updateDrag(event) {
  if (!state.drag) return;
  const point = pageToCanvas(event);
  const drag = state.drag;
  if (drag.kind === "draw") {
    drag.current = point;
  } else {
    const box = boxesFor().find((item) => item.id === drag.boxId);
    if (!box) return;
    if (drag.kind === "move") {
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      box.x = clamp(drag.origin.x + dx, 0, 1 - drag.origin.w);
      box.y = clamp(drag.origin.y + dy, 0, 1 - drag.origin.h);
    } else if (drag.kind === "resize") {
      const origin = drag.origin;
      let x1 = origin.x;
      let y1 = origin.y;
      let x2 = origin.x + origin.w;
      let y2 = origin.y + origin.h;
      if (drag.handle.includes("w")) x1 = clamp(point.x, 0, x2 - MIN_NORM);
      if (drag.handle.includes("e")) x2 = clamp(point.x, x1 + MIN_NORM, 1);
      if (drag.handle.includes("n")) y1 = clamp(point.y, 0, y2 - MIN_NORM);
      if (drag.handle.includes("s")) y2 = clamp(point.y, y1 + MIN_NORM, 1);
      Object.assign(box, normalizeRect(x1, y1, x2, y2));
    }
  }
  event.preventDefault();
  drawOverlay();
}

function endDrag(event) {
  if (!state.drag) return;
  const drag = state.drag;
  state.drag = null;
  if (drag.kind === "draw") {
    const rect = normalizeRect(drag.start.x, drag.start.y, drag.current.x, drag.current.y);
    const minPixels = 5;
    if (rect.w * state.view.w >= minPixels && rect.h * state.view.h >= minPixels) {
      pushHistory();
      const cls = activeClass();
      if (!cls) {
        toast("Add a class before drawing boxes.");
        return;
      }
      const box = { id: nextBoxId(), classId: cls.id, ...rect, ignored: false };
      ensureBoxes().push(box);
      state.selectedId = box.id;
      saveState();
      renderPageList();
      renderBoxList();
      updateChrome();
    }
  } else {
    if (drag.kind === "move" || drag.kind === "resize") {
      saveState();
      renderPageList();
      renderBoxList();
      updateChrome();
    }
  }
  drawOverlay();
  event.preventDefault();
}

function cancelDrag(event) {
  if (!state.drag) return;
  const drag = state.drag;
  if (drag.kind === "move" || drag.kind === "resize") {
    const box = boxesFor().find((item) => item.id === drag.boxId);
    if (box) Object.assign(box, drag.origin);
  }
  state.drag = null;
  drawOverlay();
  event?.preventDefault?.();
}

function nudgeSelected(dx, dy) {
  const box = selectedBox();
  if (!box) return;
  pushHistory();
  box.x = clamp(box.x + dx / state.view.w, 0, 1 - box.w);
  box.y = clamp(box.y + dy / state.view.h, 0, 1 - box.h);
  saveState();
  renderBoxList();
  updateChrome();
  drawOverlay();
}

function drawOverlay() {
  const canvas = els.overlayCanvas;
  const view = state.view;
  if (!view.w || !view.h || !canvas.width || !canvas.height) return;
  const ctx = canvas.getContext("2d");
  const dpr = view.dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, view.w, view.h);
  if (!state.showBoxes) return;

  for (const box of boxesFor()) {
    const cls = classById(box.classId);
    const color = cls ? cls.color : "#777";
    const rect = boxToPixels(box);
    ctx.save();
    ctx.fillStyle = hexToRgba(color, box.ignored ? 0.07 : 0.14);
    ctx.strokeStyle = color;
    ctx.lineWidth = box.id === state.selectedId ? 2 : 1.25;
    if (box.ignored) ctx.setLineDash([5, 4]);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.setLineDash([]);

    const label = cls ? cls.name : "?";
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    const padding = 4;
    const textWidth = ctx.measureText(label).width;
    const labelY = Math.max(0, rect.y - 18);
    ctx.fillStyle = color;
    ctx.fillRect(rect.x, labelY, textWidth + padding * 2, 17);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, rect.x + padding, labelY + 12);

    if (box.id === state.selectedId) {
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      for (const [x, y] of handlePoints(rect)) {
        ctx.beginPath();
        ctx.rect(x - 4, y - 4, 8, 8);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  if (state.drag && state.drag.kind === "draw") {
    const rect = normalizeRect(
      state.drag.start.x, state.drag.start.y,
      state.drag.current.x, state.drag.current.y,
    );
    const pixels = boxToPixels(rect);
    const cls = activeClass();
    const color = cls ? cls.color : "#0f6d72";
    ctx.save();
    ctx.fillStyle = hexToRgba(color, 0.12);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.fillRect(pixels.x, pixels.y, pixels.w, pixels.h);
    ctx.strokeRect(pixels.x, pixels.y, pixels.w, pixels.h);
    ctx.restore();
  }
}

function handlePoints(rect) {
  return [
    [rect.x, rect.y], [rect.x + rect.w / 2, rect.y], [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h / 2], [rect.x + rect.w, rect.y + rect.h],
    [rect.x + rect.w / 2, rect.y + rect.h], [rect.x, rect.y + rect.h],
    [rect.x, rect.y + rect.h / 2],
  ];
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
  const number = parseInt(full, 16);
  if (!Number.isFinite(number)) return `rgba(120,120,120,${alpha})`;
  return `rgba(${(number >> 16) & 255},${(number >> 8) & 255},${number & 255},${alpha})`;
}

async function renderPage() {
  if (!state.pdf || !state.numPages) return;
  const token = ++state.renderToken;
  const pageNumber = state.currentPage;
  if (state.renderTask) {
    try {
      state.renderTask.cancel();
      await state.renderTask.promise;
    } catch (err) {
      // A canceled render is expected when the page or zoom changes quickly.
    }
    state.renderTask = null;
  }
  try {
    const page = await state.pdf.getPage(pageNumber);
    if (token !== state.renderToken) return;
    const base = page.getViewport({ scale: 1 });
    const stageWidth = Math.max(240, els.stage.clientWidth - 44);
    const stageHeight = Math.max(240, els.stage.clientHeight - 44);
    const fit = Math.max(0.05, Math.min(stageWidth / base.width, stageHeight / base.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const viewport = page.getViewport({ scale: fit * state.zoom * dpr });
    const cssWidth = viewport.width / dpr;
    const cssHeight = viewport.height / dpr;

    state.view = { w: cssWidth, h: cssHeight, dpr };
    state.pageDims.set(pageNumber, { width: base.width, height: base.height });

    const pdfCanvas = els.pdfCanvas;
    const overlay = els.overlayCanvas;
    for (const canvas of [pdfCanvas, overlay]) {
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
    }
    els.canvasWrap.style.width = `${cssWidth}px`;
    els.canvasWrap.style.height = `${cssHeight}px`;
    els.canvasWrap.hidden = false;
    els.emptyState.hidden = true;

    const ctx = pdfCanvas.getContext("2d", { alpha: false });
    const task = page.render({ canvasContext: ctx, viewport, background: "#ffffff" });
    state.renderTask = task;
    try {
      await task.promise;
    } catch (err) {
      if (token !== state.renderToken || err?.name === "RenderingCancelledException") return;
      throw err;
    } finally {
      if (state.renderTask === task) state.renderTask = null;
    }
    if (token !== state.renderToken) return;
    drawOverlay();
    updateChrome();
    els.viewerStatus.textContent = "Local-only. Files never leave this browser.";
  } catch (err) {
    if (token !== state.renderToken || err?.name === "RenderingCancelledException") return;
    console.error(err);
    els.viewerStatus.textContent = "Could not render this page.";
    toast(`Render error: ${err.message || err}`);
  }
}

async function loadPdf(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    toast("Please choose a PDF file.");
    return;
  }
  resetLoadedFile();
  els.viewerStatus.textContent = "Loading PDF…";
  try {
    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    state.pdf = pdf;
    state.file = file;
    state.numPages = pdf.numPages;
    state.currentPage = 1;
    state.zoom = 1;
    state.classes = defaultClasses();
    state.activeClassId = state.classes[0].id;
    state.annotations = {};
    state.pageStatus = {};
    state.selectedId = null;
    state.history = [];
    state.future = [];
    state.pageDims = new Map();
    restoreState();

    els.fileName.textContent = file.name;
    els.fileSub.textContent = `${pdf.numPages} page${pdf.numPages === 1 ? "" : "s"} · local file`;
    els.fileMeta.hidden = false;
    els.dropZone.hidden = true;
    els.emptyState.hidden = true;
    els.canvasWrap.hidden = false;
    renderClasses();
    renderPageList();
    renderBoxFilter();
    renderBoxList();
    updateChrome();
    await renderPage();
    toast("PDF loaded");
  } catch (err) {
    console.error(err);
    els.viewerStatus.textContent = "Could not open this PDF.";
    toast(`Could not open PDF: ${err.message || err}`);
    resetLoadedFile();
  } finally {
    els.fileInput.value = "";
  }
}

function resetLoadedFile() {
  if (state.renderTask) {
    try { state.renderTask.cancel(); } catch (err) { /* ignore */ }
    state.renderTask = null;
  }
  state.pdf = null;
  state.file = null;
  state.numPages = 0;
  state.currentPage = 1;
  state.zoom = 1;
  state.classes = defaultClasses();
  state.activeClassId = state.classes[0].id;
  state.annotations = {};
  state.pageStatus = {};
  state.selectedId = null;
  state.drag = null;
  state.history = [];
  state.future = [];
  state.pageDims = new Map();
  state.view = { w: 0, h: 0, dpr: 1 };
  els.fileMeta.hidden = true;
  els.dropZone.hidden = false;
  els.canvasWrap.hidden = true;
  els.emptyState.hidden = false;
  els.pageList.innerHTML = "";
  els.boxList.innerHTML = "";
  renderClasses();
  renderPageList();
  renderBoxList();
  updateChrome();
  els.fileState.textContent = "No file";
  els.pageCount.textContent = "No PDF loaded";
  els.pageIndicator.textContent = "—";
  els.zoomLabel.textContent = "100%";
  els.previewLabel.textContent = "No page loaded";
  els.viewerStatus.textContent = "Local-only. Files never leave this browser.";
}

function resetAnnotations() {
  if (!state.file) return;
  if (!window.confirm("Clear all boxes and page status for this file?")) return;
  state.annotations = {};
  state.pageStatus = {};
  state.selectedId = null;
  state.history = [];
  state.future = [];
  const key = storageKey();
  if (key) localStorage.removeItem(key);
  saveState();
  renderPageList();
  renderBoxList();
  updateChrome();
  drawOverlay();
  toast("Annotations cleared for this file");
}

async function pageDimensions(pageNumber) {
  if (state.pageDims.has(pageNumber)) return state.pageDims.get(pageNumber);
  const page = await state.pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const dims = { width: base.width, height: base.height };
  state.pageDims.set(pageNumber, dims);
  return dims;
}

async function exportDimensions(pageNumber) {
  const base = await pageDimensions(pageNumber);
  const longEdge = Number(els.exportLongEdge.value) || 2000;
  const scale = longEdge / Math.max(base.width, base.height);
  return {
    width: Math.max(1, Math.round(base.width * scale)),
    height: Math.max(1, Math.round(base.height * scale)),
    scale,
  };
}

function baseName() {
  return (state.file?.name || "drawing").replace(/\.pdf$/i, "").replace(/[^\w.-]+/g, "_");
}

function projectJson() {
  const pages = [];
  for (let page = 1; page <= state.numPages; page += 1) {
    pages.push({
      page,
      status: pageStatus(page),
      annotations: clone(boxesFor(page)).map((box) => ({
        id: box.id,
        classId: box.classId,
        x: box.x, y: box.y, w: box.w, h: box.h,
        ignored: Boolean(box.ignored),
      })),
    });
  }
  return {
    schema: SCHEMA,
    exported_at: new Date().toISOString(),
    file: state.file ? {
      name: state.file.name,
      size: state.file.size,
      lastModified: state.file.lastModified,
      pages: state.numPages,
    } : null,
    classes: clone(state.classes),
    pages,
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadProject() {
  if (!state.pdf) {
    toast("Load a PDF first.");
    return;
  }
  const blob = new Blob([JSON.stringify(projectJson(), null, 2)], { type: "application/json" });
  downloadBlob(blob, `${baseName()}.symbol-project.json`);
}

async function importProject(file) {
  if (!file) return;
  if (!state.pdf || !state.file) {
    toast("Load the matching PDF before importing a project.");
    return;
  }
  try {
    const data = JSON.parse(await file.text());
    if (data.schema !== SCHEMA) {
      toast("This is not a Symbol Labeler project.");
      return;
    }
    if (data.file && data.file.name && data.file.name !== state.file.name) {
      if (!window.confirm(`Project is for “${data.file.name}”, not “${state.file.name}”. Import anyway?`)) return;
    }
    const classes = Array.isArray(data.classes) && data.classes.length
      ? data.classes
        .filter((item) => item && Number.isFinite(Number(item.id)) && item.name)
        .map((item, index) => ({
          id: Number(item.id),
          name: String(item.name).slice(0, 40),
          color: /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : PALETTE[index % PALETTE.length],
        }))
      : defaultClasses();
    state.classes = classes;
    state.activeClassId = classes[0].id;
    state.annotations = {};
    state.pageStatus = {};
    if (Array.isArray(data.pages)) {
      for (const page of data.pages) {
        const number = Number(page.page);
        if (!Number.isInteger(number) || number < 1 || number > state.numPages) continue;
        const boxes = Array.isArray(page.annotations)
          ? page.annotations.filter(isValidBox).map((box) => ({
            id: box.id || nextBoxId(),
            classId: Number(box.classId),
            x: clamp(Number(box.x), 0, 1),
            y: clamp(Number(box.y), 0, 1),
            w: clamp(Number(box.w), 0, 1),
            h: clamp(Number(box.h), 0, 1),
            ignored: Boolean(box.ignored),
          })).filter((box) => box.w > 0 && box.h > 0)
          : [];
        if (boxes.length) state.annotations[String(number)] = boxes;
        if (page.status === "complete") state.pageStatus[String(number)] = "complete";
      }
    }
    state.selectedId = null;
    state.history = [];
    state.future = [];
    saveState();
    renderClasses();
    renderPageList();
    renderBoxFilter();
    renderBoxList();
    updateChrome();
    renderPage();
    toast("Project imported");
  } catch (err) {
    console.error(err);
    toast(`Could not import project: ${err.message || err}`);
  } finally {
    els.importInput.value = "";
  }
}

function yoloLabels() {
  const lines = [];
  for (let page = 1; page <= state.numPages; page += 1) {
    const pageBoxes = boxesFor(page);
    const content = pageBoxes
      .filter((box) => !box.ignored)
      .map((box) => {
        const index = classIndex(box.classId);
        if (index === -1) return null;
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        return `${index} ${cx.toFixed(6)} ${cy.toFixed(6)} ${box.w.toFixed(6)} ${box.h.toFixed(6)}`;
      })
      .filter(Boolean)
      .join("\n");
    lines.push({ page, content });
  }
  return lines;
}

function dataYaml() {
  const names = state.classes.map((cls, index) => `  ${index}: ${JSON.stringify(cls.name)}`).join("\n");
  return `path: .\ntrain: images\nval: images\nnames:\n${names}\n`;
}

function classesText() {
  return state.classes.map((cls) => cls.name).join("\n") + "\n";
}

async function buildCoco() {
  const images = [];
  const annotations = [];
  const categories = state.classes.map((cls, index) => ({
    id: index + 1,
    name: cls.name,
    supercategory: "symbol",
  }));
  let annotationId = 1;
  for (let page = 1; page <= state.numPages; page += 1) {
    const dims = await exportDimensions(page);
    images.push({
      id: page,
      file_name: `images/page-${String(page).padStart(4, "0")}.png`,
      width: dims.width,
      height: dims.height,
    });
    for (const box of boxesFor(page)) {
      if (box.ignored) continue;
      const category = categories.find((item) => item.id === classIndex(box.classId) + 1);
      if (!category) continue;
      const x = box.x * dims.width;
      const y = box.y * dims.height;
      const w = box.w * dims.width;
      const h = box.h * dims.height;
      annotations.push({
        id: annotationId++,
        image_id: page,
        category_id: category.id,
        bbox: [x, y, w, h],
        area: w * h,
        iscrowd: 0,
      });
    }
  }
  return {
    info: { description: "Symbol Labeler export", version: "1.0", date_created: new Date().toISOString() },
    licenses: [],
    images,
    annotations,
    categories,
  };
}

async function exportCoco() {
  if (!state.pdf || state.exporting) return;
  try {
    state.exporting = true;
    setExportProgress("Building COCO JSON…");
    const coco = await buildCoco();
    downloadBlob(new Blob([JSON.stringify(coco, null, 2)], { type: "application/json" }), `${baseName()}.coco.json`);
    toast("COCO JSON exported");
  } catch (err) {
    console.error(err);
    toast(`COCO export failed: ${err.message || err}`);
  } finally {
    state.exporting = false;
    setExportProgress("");
  }
}

async function renderPageBlob(pageNumber, dims) {
  const page = await state.pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: dims.width / page.getViewport({ scale: 1 }).width });
  const canvas = document.createElement("canvas");
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  await page.render({ canvasContext: ctx, viewport, background: "#ffffff" }).promise;
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode PNG")), "image/png");
  });
}

function setExportProgress(message) {
  els.exportProgress.hidden = !message;
  els.exportProgress.textContent = message;
}

function setExporting(value) {
  state.exporting = value;
  for (const button of [els.exportDatasetBtn, els.exportYoloBtn, els.exportCocoBtn]) {
    button.disabled = value;
  }
}

async function exportDataset() {
  if (!state.pdf || state.exporting) return;
  if (!state.classes.length) {
    toast("Add a class first.");
    return;
  }
  try {
    setExporting(true);
    const zip = new StoreZip();
    const labels = yoloLabels();
    for (let page = 1; page <= state.numPages; page += 1) {
      setExportProgress(`Rendering page ${page} / ${state.numPages}…`);
      const dims = await exportDimensions(page);
      const blob = await renderPageBlob(page, dims);
      zip.addBytes(`images/page-${String(page).padStart(4, "0")}.png`, new Uint8Array(await blob.arrayBuffer()));
      zip.addText(`labels/page-${String(page).padStart(4, "0")}.txt`, `${labels[page - 1].content}${labels[page - 1].content ? "\n" : ""}`);
    }
    setExportProgress("Writing metadata…");
    zip.addText("classes.txt", classesText());
    zip.addText("data.yaml", dataYaml());
    zip.addText("README.txt", datasetReadme());
    zip.addText("project.json", JSON.stringify(projectJson(), null, 2));
    zip.addText("annotations.coco.json", JSON.stringify(await buildCoco(), null, 2));
    downloadBlob(zip.blob(), `${baseName()}-dataset.zip`);
    toast("Dataset ZIP exported");
  } catch (err) {
    console.error(err);
    toast(`Dataset export failed: ${err.message || err}`);
  } finally {
    setExporting(false);
    setExportProgress("");
  }
}

function exportYolo() {
  if (!state.pdf || state.exporting) return;
  if (!state.classes.length) {
    toast("Add a class first.");
    return;
  }
  try {
    const zip = new StoreZip();
    for (const { page, content } of yoloLabels()) {
      zip.addText(`labels/page-${String(page).padStart(4, "0")}.txt`, `${content}${content ? "\n" : ""}`);
    }
    zip.addText("classes.txt", classesText());
    zip.addText("data.yaml", dataYaml());
    zip.addText("project.json", JSON.stringify(projectJson(), null, 2));
    downloadBlob(zip.blob(), `${baseName()}-yolo-labels.zip`);
    toast("YOLO labels exported");
  } catch (err) {
    console.error(err);
    toast(`YOLO export failed: ${err.message || err}`);
  }
}

function datasetReadme() {
  return `Symbol Labeler dataset\n\n` +
    `File: ${state.file?.name || ""}\n` +
    `Pages: ${state.numPages}\n` +
    `Classes: ${state.classes.map((cls) => cls.name).join(", ")}\n\n` +
    `Layout:\n  images/page-XXXX.png\n  labels/page-XXXX.txt  (YOLO: class cx cy w h, normalized)\n` +
    `  classes.txt\n  data.yaml\n  annotations.coco.json\n  project.json\n\n` +
    `Boxes marked Ignore are omitted from YOLO and COCO labels. Empty label files are negative examples.\n` +
    `The data.yaml currently points train and val at the same images directory; split the pages before training.\n`;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  return {
    time: ((hours << 11) | (minutes << 5) | seconds) & 0xffff,
    date: (((year - 1980) << 9) | (month << 5) | day) & 0xffff,
  };
}

class StoreZip {
  constructor() {
    this.parts = [];
    this.central = [];
    this.offset = 0;
  }

  addText(name, text) {
    this.addBytes(name, new TextEncoder().encode(text));
  }

  addBytes(name, bytes) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(bytes);
    const { time, date } = dosDateTime();
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, time, true);
    view.setUint16(12, date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true);
    view.setUint32(22, bytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);
    this.parts.push(header, bytes);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, bytes.length, true);
    centralView.setUint32(24, bytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, this.offset, true);
    central.set(nameBytes, 46);
    this.central.push(central);
    this.offset += header.length + bytes.length;
  }

  blob() {
    const centralSize = this.central.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, this.central.length, true);
    view.setUint16(10, this.central.length, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, this.offset, true);
    view.setUint16(20, 0, true);
    return new Blob([...this.parts, ...this.central, end], { type: "application/zip" });
  }
}

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function isEditableTarget(target) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function handleKey(event) {
  if (isEditableTarget(event.target)) return;
  if (event.key === "Escape") {
    if (state.drag) cancelDrag(event);
    else {
      state.selectedId = null;
      updateChrome();
      renderBoxList();
      drawOverlay();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo(); else undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (event.key === "PageUp") {
    event.preventDefault();
    setPage(state.currentPage - 1);
    return;
  }
  if (event.key === "PageDown") {
    event.preventDefault();
    setPage(state.currentPage + 1);
    return;
  }
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    setZoom(state.zoom * 1.2);
    return;
  }
  if (event.key === "-") {
    event.preventDefault();
    setZoom(state.zoom / 1.2);
    return;
  }
  if (event.key.toLowerCase() === "v") {
    setTool("select");
    return;
  }
  if (event.key.toLowerCase() === "b") {
    setTool("draw");
    return;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId) {
    event.preventDefault();
    deleteBox(state.selectedId);
    return;
  }
  if (event.key.startsWith("Arrow") && state.selectedId) {
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 1;
    const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
    const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
    nudgeSelected(dx, dy);
    return;
  }
  if (/^[1-9]$/.test(event.key)) {
    const cls = state.classes[Number(event.key) - 1];
    if (cls) selectClass(cls.id);
  }
}

function wireEvents() {
  els.dropZone.addEventListener("click", () => els.fileInput.click());
  els.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      els.fileInput.click();
    }
  });
  els.fileInput.addEventListener("change", () => loadPdf(els.fileInput.files?.[0]));
  for (const type of ["dragenter", "dragover"]) {
    els.dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("dragover");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    els.dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("dragover");
    });
  }
  els.dropZone.addEventListener("drop", (event) => loadPdf(event.dataTransfer?.files?.[0]));
  els.clearFileBtn.addEventListener("click", () => {
    if (state.file && !window.confirm("Unload the current PDF? Saved boxes remain in this browser.")) return;
    resetLoadedFile();
  });
  els.addClassBtn.addEventListener("click", addClass);
  els.classInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addClass();
    }
  });
  els.selectTool.addEventListener("click", () => setTool("select"));
  els.drawTool.addEventListener("click", () => setTool("draw"));
  els.prevBtn.addEventListener("click", () => setPage(state.currentPage - 1));
  els.nextBtn.addEventListener("click", () => setPage(state.currentPage + 1));
  els.zoomOutBtn.addEventListener("click", () => setZoom(state.zoom / 1.2));
  els.zoomInBtn.addEventListener("click", () => setZoom(state.zoom * 1.2));
  els.fitBtn.addEventListener("click", () => setZoom(1));
  els.toggleBoxesBtn.addEventListener("click", () => setShowBoxes(!state.showBoxes));
  els.undoBtn.addEventListener("click", undo);
  els.redoBtn.addEventListener("click", redo);
  els.resetBtn.addEventListener("click", resetAnnotations);
  els.importBtn.addEventListener("click", () => els.importInput.click());
  els.importInput.addEventListener("change", () => importProject(els.importInput.files?.[0]));
  els.exportJsonBtn.addEventListener("click", downloadProject);
  els.exportDatasetBtn.addEventListener("click", exportDataset);
  els.exportYoloBtn.addEventListener("click", exportYolo);
  els.exportCocoBtn.addEventListener("click", exportCoco);
  els.exportLongEdge.addEventListener("change", () => {});
  els.pageStatusBtn.addEventListener("click", togglePageStatus);
  els.clearPageBtn.addEventListener("click", clearPage);
  els.duplicateBoxBtn.addEventListener("click", duplicateBox);
  els.ignoreBoxBtn.addEventListener("click", toggleIgnore);
  els.deleteBoxBtn.addEventListener("click", () => state.selectedId && deleteBox(state.selectedId));
  els.selClass.addEventListener("change", () => changeSelectedClass(els.selClass.value));
  els.boxFilter.addEventListener("change", renderBoxList);

  els.overlayCanvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const point = pageToCanvas(event);
    if (state.tool === "draw") {
      startDrag(event, "draw");
      return;
    }
    const handle = handleAt(point);
    if (handle) {
      startDrag(event, "resize", selectedBox());
      return;
    }
    const box = boxAt(point);
    if (box) {
      selectBox(box.id);
      startDrag(event, "move", box);
    } else {
      state.selectedId = null;
      updateChrome();
      renderBoxList();
      drawOverlay();
    }
  });
  els.overlayCanvas.addEventListener("pointermove", (event) => {
    if (state.drag) updateDrag(event);
    else if (state.tool === "select") {
      const handle = handleAt(pageToCanvas(event));
      els.overlayCanvas.style.cursor = handle ? cursorForHandle(handle) : "default";
    }
  });
  els.overlayCanvas.addEventListener("pointerup", endDrag);
  els.overlayCanvas.addEventListener("pointercancel", cancelDrag);
  window.addEventListener("keydown", handleKey);

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.pdf) renderPage();
    }, 160);
  });
}

function cursorForHandle(handle) {
  if (handle === "n" || handle === "s") return "ns-resize";
  if (handle === "e" || handle === "w") return "ew-resize";
  if (handle === "nw" || handle === "se") return "nwse-resize";
  return "nesw-resize";
}

function init() {
  state.classes = defaultClasses();
  state.activeClassId = state.classes[0].id;
  wireEvents();
  renderClasses();
  renderPageList();
  renderBoxList();
  updateChrome();
}

init();
