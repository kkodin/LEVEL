const STORAGE_KEY = "levelBook.image2.v1";
const POINTS_KEY = "levelBook.savedPoints.v1";
const META_KEY = "levelBook.meta.v1";

let rows = [];
let savedPoints = [];
let meta = { title: "レベル野帳", date: "", site: "", place: "" };
let selected = { row: 0, field: "gl" };
let buffer = "";
let saveTimer = 0;
let drawerMode = "normal";
let drawerTargetRow = null;
let drawerSaved = false;

const $ = (selector) => document.querySelector(selector);
const fields = ["bs", "ih", "fs", "gl", "point"];

function blankRow(seed = {}) {
  return { bs: "", ih: "", fs: "", gl: "", point: "", ...seed };
}

function load() {
  rows = readJson(STORAGE_KEY, []);
  savedPoints = readJson(POINTS_KEY, []);
  meta = { ...meta, ...readJson(META_KEY, {}) };
  if (!rows.length) {
    rows = [
      blankRow({ bs: "1.058", gl: "10.830", point: "KBM1" }),
      blankRow({ bs: "0.883", fs: "3.481", point: "カルバート上流部" }),
      blankRow({ fs: "0.967", point: "カルバート接続部" })
    ];
  }
  $("#basePoint").value = rows[0]?.point || "KBM1";
  $("#baseGl").value = rows[0]?.gl || "";
  syncMetaToInputs();
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function saveSoon() {
  $("#saveState").textContent = "保存中...";
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    localStorage.setItem(POINTS_KEY, JSON.stringify(savedPoints));
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    $("#saveState").textContent = "保存済み";
  }, 120);
}

function num(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmt(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "";
}

function fmtInput(value) {
  let normalized = String(value ?? "").trim();
  if (normalized.startsWith(".")) normalized = `0${normalized}`;
  if (normalized.startsWith("-.")) normalized = normalized.replace("-.", "-0.");
  const parsed = num(normalized);
  return parsed === null ? "" : parsed.toFixed(3);
}

function calculate() {
  let currentIH = null;
  rows = rows.map((row, index) => {
    const next = { ...row };
    const bs = num(next.bs);
    const fs = num(next.fs);
    let gl = num(next.gl);
    if (index > 0 && fs !== null) {
      gl = currentIH !== null && fs !== null ? currentIH - fs : null;
      next.gl = fmt(gl);
    }
    if (index > 0 && fs === null) currentIH = null;
    if (gl !== null && bs !== null) currentIH = gl + bs;
    next.ih = fmt(currentIH);
    return next;
  });
}

function render() {
  calculate();
  syncBaseInputs();
  updateBookTitle();
  updateSurveySummary();
  const tbody = $("#rows");
  tbody.innerHTML = "";
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    fields.forEach((field) => {
      const td = document.createElement("td");
      td.className = field;
      td.textContent = row[field] || "";
      td.dataset.row = String(rowIndex);
      td.dataset.field = field;
      if (field === "ih" || (field === "gl" && rowIndex > 0)) td.classList.add("computed");
      if (selected.row === rowIndex && selected.field === field) td.classList.add("selected");
      td.addEventListener("click", () => selectCell(rowIndex, field));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  for (let i = rows.length; i < 8; i += 1) {
    const tr = document.createElement("tr");
    fields.forEach((field) => {
      const td = document.createElement("td");
      td.className = field;
      td.innerHTML = "&nbsp;";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  updateReadout();
  updateModes();
  renderPointList();
  renderPointSuggestions();
  updateSavePointButton();
}

function selectCell(row, field) {
  if (field === "ih" || (field === "gl" && row > 0)) return;
  if (field === "point") {
    selected = { row, field };
    buffer = rows[row]?.point || "";
    render();
    openPointDrawer(row);
    return;
  }
  selected = { row, field };
  buffer = rows[row]?.[field] || "";
  render();
}

function updateReadout() {
  const row = rows[selected.row] || blankRow();
  $("#activeType").textContent = selected.field.toUpperCase();
  $("#activePoint").value = row.point || "";
  $("#activeValue").textContent = buffer || row[selected.field] || "-";
}

function updateModes() {
  $("#modeBs").classList.toggle("active-mode", selected.field === "bs");
  $("#modeFs").classList.toggle("active-mode", selected.field === "fs");
}

function writeSelectedValue(value) {
  if (!rows[selected.row]) rows[selected.row] = blankRow();
  rows[selected.row][selected.field] = value;
  if (selected.row === 0 && selected.field === "gl") $("#baseGl").value = value;
  render();
  saveSoon();
}

function finalizeSelectedValue() {
  if (!rows[selected.row]) rows[selected.row] = blankRow();
  if (selected.field === "point") {
    commitPointName();
    return;
  }
  const normalized = fmtInput(rows[selected.row][selected.field] || buffer);
  rows[selected.row][selected.field] = normalized;
  buffer = normalized;
  if (selected.row === 0 && selected.field === "gl") $("#baseGl").value = normalized;
  render();
  saveSoon();
}

function commitPointName() {
  if (!rows[selected.row]) rows[selected.row] = blankRow();
  rows[selected.row].point = $("#activePoint").value;
  syncBaseInputs();
  render();
  saveSoon();
}

function appendKey(key) {
  if (selected.field === "point") return;
  if (key === "." && buffer.includes(".")) return;
  speakKey(key);
  buffer = buffer === "0" ? key : `${buffer}${key}`;
  writeSelectedValue(buffer);
}

function toggleSign() {
  if (selected.field === "point") return;
  if (!buffer) buffer = rows[selected.row]?.[selected.field] || "0";
  buffer = buffer.startsWith("-") ? buffer.slice(1) : `-${buffer}`;
  writeSelectedValue(buffer);
}

function backspace() {
  buffer = buffer.slice(0, -1);
  writeSelectedValue(buffer);
}

function clearBuffer() {
  if (!window.confirm("BS FSの数値を消去してよいですか?")) return;
  rows = rows.map((row) => blankRow({ ...row, bs: "", fs: "" }));
  if (selected.field === "bs" || selected.field === "fs") buffer = "";
  render();
  saveSoon();
}

function chooseBs() {
  finalizeSelectedValue();
  let row = selected.row;
  if (!rows[row]) row = rows.length - 1;
  selected = { row: Math.max(0, row), field: "bs" };
  buffer = rows[selected.row]?.bs || "";
  render();
}

function chooseFs() {
  finalizeSelectedValue();
  let row = selected.row;
  if (selected.field === "bs" || rows[row]?.fs) row += 1;
  if (!rows[row]) rows[row] = blankRow();
  selected = { row, field: "fs" };
  buffer = rows[row].fs || "";
  render();
  saveSoon();
}

function moveRow(delta) {
  finalizeSelectedValue();
  const nextRow = Math.max(0, Math.min(rows.length - 1, selected.row + delta));
  selected = { row: nextRow, field: selected.field };
  if (selected.field === "gl" && nextRow > 0) selected.field = "fs";
  buffer = rows[selected.row]?.[selected.field] || "";
  render();
}

function moveField(delta) {
  finalizeSelectedValue();
  const editableFields = selected.row === 0 ? ["gl", "bs", "fs", "point"] : ["bs", "fs", "point"];
  const index = editableFields.indexOf(selected.field);
  const nextIndex = Math.max(0, Math.min(editableFields.length - 1, index + delta));
  selected = { row: selected.row, field: editableFields[nextIndex] };
  buffer = rows[selected.row]?.[selected.field] || "";
  render();
}

function speakKey(key) {
  if (!("speechSynthesis" in window)) return;
  const text = key === "." ? "点" : key;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function syncBaseInputs() {
  $("#basePoint").value = rows[0]?.point || "";
  $("#baseGl").value = rows[0]?.gl || "";
}

function syncMetaToInputs() {
  $("#surveyDate").value = meta.date || "";
  $("#siteName").value = meta.site || "";
  $("#surveyPlace").value = meta.place || "";
  updateBookTitle();
  updateSurveySummary();
}

function readMetaFromInputs() {
  meta.date = $("#surveyDate").value;
  meta.site = $("#siteName").value;
  meta.place = $("#surveyPlace").value;
}

function updateBookTitle() {
  $("#bookTitle").textContent = meta.title || "レベル野帳";
}

function updateSurveySummary() {
  const parts = [];
  if (meta.site) parts.push(`現場名：${meta.site}`);
  if (meta.place) parts.push(`測定箇所：${meta.place}`);
  const firstLine = parts.join("　/　");
  const secondLine = meta.date ? `測定日：${formatSurveyDate(meta.date)}` : "";
  $("#surveySummary").innerHTML = [firstLine, secondLine].filter(Boolean).map(escapeHtml).join("<br>");
}

function formatSurveyDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value || "";
  return `${match[1]}.${match[2]}.${match[3]}`;
}

function openDrawer(mode = "normal", row = null) {
  drawerMode = mode;
  drawerTargetRow = row;
  drawerSaved = false;
  clearPointEntry();
  $("#drawer").classList.toggle("context-mode", drawerMode !== "normal");
  $("#savedPointName").setAttribute("list", "pointSuggestions");
  if ((drawerMode === "base" || drawerMode === "register") && rows[row]) {
    $("#savedPointName").value = drawerMode === "base" ? rows[row].point || "" : "";
    $("#savedPointValue").value = fmtInput(rows[row].gl || "");
  }
  if (drawerMode === "register") $("#savedPointName").removeAttribute("list");
  renderPointSuggestions();
  updateSavePointButton();
  window.setTimeout(() => $("#savedPointName").focus(), 0);
  $("#drawer").classList.add("open");
  $("#drawerBackdrop").classList.add("open");
}

function closeDrawer() {
  applyBaseEntry();
  applyDrawerPointName();
  $("#drawer").classList.remove("open");
  $("#drawer").classList.remove("context-mode");
  $("#drawerBackdrop").classList.remove("open");
  drawerMode = "normal";
  drawerTargetRow = null;
  drawerSaved = false;
}

function openPointDrawer(row) {
  if (!rows[row]) rows[row] = blankRow();
  openDrawer(rows[row].fs ? "register" : "base", row);
}

function applyBaseEntry() {
  if (drawerMode !== "base" || drawerTargetRow === null || drawerSaved) return;
  const name = $("#savedPointName").value.trim();
  const value = fmtInput($("#savedPointValue").value);
  if (!name || !value) return;
  rows[drawerTargetRow] = blankRow({ ...rows[drawerTargetRow], point: name, gl: value });
  if (drawerTargetRow === 0) syncBaseInputs();
  selected = { row: drawerTargetRow, field: "gl" };
  buffer = value;
  render();
  saveSoon();
}

function applyDrawerPointName() {
  if (drawerMode !== "register" || drawerTargetRow === null || drawerSaved) return;
  const name = $("#savedPointName").value.trim();
  if (!name) return;
  rows[drawerTargetRow].point = name;
  selected = { row: drawerTargetRow, field: "point" };
  buffer = name;
  render();
  saveSoon();
}

function saveCurrentPoint() {
  const name = $("#savedPointName").value.trim();
  const value = fmtInput($("#savedPointValue").value);
  if (!name || !value) return;
  const shouldCloseAfterSave = drawerMode !== "normal";
  const existing = savedPoints.find((point) => point.name === name);
  if (existing) {
    existing.value = value;
  } else {
    savedPoints.push({ name, value });
  }
  if (drawerMode === "base" && drawerTargetRow !== null && rows[drawerTargetRow]) {
    rows[drawerTargetRow] = blankRow({ ...rows[drawerTargetRow], point: name, gl: value });
    selected = { row: drawerTargetRow, field: "gl" };
    buffer = value;
    drawerSaved = true;
    if (drawerTargetRow === 0) syncBaseInputs();
  }
  if (drawerMode === "register" && drawerTargetRow !== null && rows[drawerTargetRow]) {
    rows[drawerTargetRow].point = name;
    selected = { row: drawerTargetRow, field: "point" };
    buffer = name;
    drawerSaved = true;
  }
  clearPointEntry();
  renderPointList();
  render();
  saveSoon();
  if (shouldCloseAfterSave) closeDrawer();
}

function recallPoint(point) {
  const row = drawerMode === "base" && drawerTargetRow !== null ? drawerTargetRow : 0;
  if (!rows[row]) rows[row] = blankRow();
  rows[row] = blankRow({ ...rows[row], point: point.name, gl: point.value });
  if (row === 0) syncBaseInputs();
  selected = { row, field: "gl" };
  buffer = point.value;
  closeDrawer();
  render();
  saveSoon();
}

function renderPointList() {
  const list = $("#pointList");
  if (!list) return;
  list.innerHTML = "";
  savedPoints.forEach((point, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "point-item";
    button.innerHTML = `<strong>${escapeHtml(point.name)}</strong><span>${escapeHtml(point.value)}</span>`;
    button.addEventListener("click", () => {
      if (button.dataset.swiped === "1") {
        button.dataset.swiped = "";
        return;
      }
      if (button.classList.contains("delete-ready")) {
        deleteSavedPoint(index);
        return;
      }
      recallPoint(point);
    });
    bindSwipeDelete(button, index);
    list.appendChild(button);
  });
}

function renderPointSuggestions() {
  const datalist = $("#pointSuggestions");
  if (!datalist) return;
  const options = new Map();
  savedPoints.forEach((point) => options.set(point.name, point.value));
  rows.forEach((row) => {
    if (row.point && row.gl) options.set(row.point, row.gl);
  });
  datalist.innerHTML = "";
  options.forEach((value, name) => {
    const option = document.createElement("option");
    option.value = name;
    option.label = `GL ${value}`;
    datalist.appendChild(option);
  });
}

function findPointValue(name) {
  const key = String(name || "").trim();
  if (!key) return "";
  const saved = savedPoints.find((point) => point.name === key);
  if (saved) return saved.value;
  const row = rows.find((item) => item.point === key && item.gl);
  return row?.gl || "";
}

function clearPointEntry() {
  $("#savedPointName").value = "";
  $("#savedPointValue").value = "";
  updateSavePointButton();
}

function updateSavePointButton() {
  const name = $("#savedPointName")?.value.trim();
  const value = fmtInput($("#savedPointValue")?.value || "");
  $("#savePoint").disabled = !name || !value;
}

function handleSavedPointNameInput() {
  const name = $("#savedPointName").value.trim();
  if (drawerMode === "base") {
    const value = findPointValue(name);
    $("#savedPointValue").value = value || "";
  }
  updateSavePointButton();
}

function deleteSavedPoint(index) {
  savedPoints.splice(index, 1);
  renderPointList();
  saveSoon();
}

function bindSwipeDelete(element, index) {
  let startX = 0;
  let currentX = 0;
  let swiping = false;

  element.addEventListener("pointerdown", (event) => {
    startX = event.clientX;
    currentX = startX;
    swiping = true;
    element.setPointerCapture?.(event.pointerId);
  });

  element.addEventListener("pointermove", (event) => {
    if (!swiping) return;
    currentX = event.clientX;
    const dx = currentX - startX;
    if (Math.abs(dx) < 8) return;
    element.classList.add("swiping");
    element.style.transform = `translateX(${Math.max(-90, Math.min(90, dx))}px)`;
  });

  element.addEventListener("pointerup", () => {
    if (!swiping) return;
    swiping = false;
    const dx = currentX - startX;
    element.classList.remove("swiping");
    element.style.transform = "";
    if (dx < -70) {
      element.classList.add("delete-ready");
      element.dataset.swiped = "1";
      window.setTimeout(() => {
        element.dataset.swiped = "";
      }, 250);
    } else if (dx > 30) {
      element.classList.remove("delete-ready");
    }
  });

  element.addEventListener("pointercancel", () => {
    swiping = false;
    element.classList.remove("swiping");
    element.style.transform = "";
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function bind() {
  document.addEventListener("gesturestart", (event) => event.preventDefault());
  document.addEventListener("dblclick", (event) => event.preventDefault(), { passive: false });
  $("#menuOpen").addEventListener("click", () => openDrawer("normal"));
  $("#edgeOpen").addEventListener("click", () => openDrawer("normal"));
  $("#menuClose").addEventListener("click", closeDrawer);
  $("#drawerBackdrop").addEventListener("click", closeDrawer);
  $("#savePoint").addEventListener("click", saveCurrentPoint);
  $("#savedPointName").addEventListener("input", handleSavedPointNameInput);
  $("#savedPointValue").addEventListener("input", updateSavePointButton);
  $("#savedPointValue").addEventListener("click", () => {
    const value = drawerMode === "register" || drawerMode === "base"
      ? rows[drawerTargetRow]?.gl || ""
      : rows[selected.row]?.[selected.field] || buffer || "";
    $("#savedPointValue").value = value;
    updateSavePointButton();
  });
  ["surveyDate", "siteName", "surveyPlace"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      readMetaFromInputs();
      updateSurveySummary();
      saveSoon();
    });
  });
  bindDrawerSwipe();
  $("#basePoint").addEventListener("input", () => {
    rows[0].point = $("#basePoint").value;
    render();
    saveSoon();
  });
  $("#baseGl").addEventListener("click", () => {
    selected = { row: 0, field: "gl" };
    buffer = rows[0]?.gl || "";
    render();
  });
  $("#activePoint").addEventListener("input", commitPointName);
  $("#resetBook").addEventListener("click", startNewBook);
  $("#modeBs").addEventListener("click", chooseBs);
  $("#modeFs").addEventListener("click", chooseFs);
  $("#prevRow").addEventListener("click", () => moveRow(-1));
  $("#nextRow").addEventListener("click", () => moveRow(1));
  $("#exportCsv").addEventListener("click", exportCsv);
  $("#importCsv").addEventListener("click", () => $("#csvFile").click());
  $("#csvFile").addEventListener("change", importCsv);
  document.querySelector(".keypad").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.key) appendKey(button.dataset.key);
    if (button.dataset.action === "sign") toggleSign();
    if (button.dataset.action === "back") backspace();
    if (button.dataset.action === "clear") clearBuffer();
    if (button.dataset.action === "left") moveField(-1);
    if (button.dataset.action === "right") moveField(1);
  });
}

function bindDrawerSwipe() {
  let startX = 0;
  let swiping = false;
  $("#drawer").addEventListener("pointerdown", (event) => {
    startX = event.clientX;
    swiping = true;
  });
  $("#drawer").addEventListener("pointerup", (event) => {
    if (!swiping) return;
    swiping = false;
    if (event.clientX - startX < -70) closeDrawer();
  });
  $("#drawer").addEventListener("pointercancel", () => {
    swiping = false;
  });
}

function startNewBook() {
  if (!window.confirm("BS FSの内容を破棄して新規作成しますか?")) return;
  meta = { title: "レベル野帳", date: "", site: "", place: "" };
  syncMetaToInputs();
  rows = [blankRow()];
  selected = { row: 0, field: "gl" };
  buffer = "";
  syncBaseInputs();
  render();
  openDrawer("base", 0);
  saveSoon();
}

function exportCsv() {
  calculate();
  readMetaFromInputs();
  const firstDataExcelRow = savedPoints.length + 12;
  const lines = [
    ["LEVEL_APP", "2"],
    ["TITLE", meta.title || "レベル野帳"],
    ["DATE", meta.date],
    ["SITE", meta.site],
    ["PLACE", meta.place],
    [],
    ["POINTS"],
    ["測点名", "数値"],
    ...savedPoints.map((point) => [point.name, point.value]),
    [],
    ["ROWS"],
    ["BS", "IH", "FS", "GL", "測点名"],
    ...rows.map((row, index) => csvRow(row, index, firstDataExcelRow))
  ];
  const csv = lines.map((line) => line.map(csvCell).join(",")).join("\n");
  download("level-book.csv", `\ufeff${csv}`, "text/csv;charset=utf-8");
}

function csvRow(row, index, firstDataExcelRow) {
  const excelRow = firstDataExcelRow + index;
  const prevExcelRow = excelRow - 1;
  const ihValue = row.bs ? `=D${excelRow}+A${excelRow}` : "";
  const glValue = index > 0 && row.fs
    ? `=B${prevExcelRow}-C${excelRow}`
    : row.gl;
  return [row.bs, ihValue, row.fs, glValue, row.point];
}

function csvCell(value) {
  const text = String(value ?? "").replaceAll('"', '""');
  return text.startsWith("=") ? text : `"${text}"`;
}

function importCsv(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!window.confirm("現在の内容を破棄してCSVを読み込みますか?")) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const table = parseCsv(String(reader.result || ""));
    applyImportedCsv(table, file.name);
  });
  reader.readAsText(file, "utf-8");
}

function applyImportedCsv(table, filename) {
  const nextMeta = { title: filename, date: "", site: "", place: "" };
  const nextPoints = [];
  const nextRows = [];
  let section = "";

  table.forEach((line) => {
    const tag = stripBom(line[0] || "");
    if (!tag) return;
    if (tag === "POINTS" || tag === "ROWS") {
      section = tag;
      return;
    }
    if (tag === "BS") {
      section = "ROWS";
      return;
    }
    if (tag === "TITLE") nextMeta.title = filename || line[1] || "レベル野帳";
    if (tag === "DATE") nextMeta.date = line[1] || "";
    if (tag === "SITE") nextMeta.site = line[1] || "";
    if (tag === "PLACE") nextMeta.place = line[1] || "";
    if (section === "POINTS" && tag !== "測点名") {
      const name = line[0]?.trim();
      const value = fmtInput(line[1] || "");
      if (name && value) nextPoints.push({ name, value });
    }
    if (section === "ROWS" && tag !== "BS") {
      const bs = cleanCsvNumber(line[0]);
      const fs = cleanCsvNumber(line[2]);
      const gl = cleanCsvNumber(line[3]);
      const point = line[4] || "";
      if (bs || fs || gl || point) nextRows.push(blankRow({ bs, fs, gl, point }));
    }
  });

  rows = nextRows.length ? nextRows : [blankRow()];
  savedPoints = nextPoints;
  meta = nextMeta;
  selected = { row: 0, field: "gl" };
  buffer = rows[0]?.gl || "";
  syncMetaToInputs();
  syncBaseInputs();
  render();
  saveSoon();
}

function cleanCsvNumber(value) {
  const text = String(value || "").trim();
  return text.startsWith("=") ? "" : fmtInput(text);
}

function parseCsv(text) {
  const rowsOut = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        i += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rowsOut.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rowsOut.push(row);
  return rowsOut;
}

function stripBom(value) {
  return String(value || "").replace(/^\ufeff/, "");
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

load();
bind();
buffer = rows[0]?.gl || "";
render();
saveSoon();
