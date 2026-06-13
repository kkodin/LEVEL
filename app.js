const STORAGE_KEY = "levelBook.image2.v1";
const POINTS_KEY = "levelBook.savedPoints.v1";
const META_KEY = "levelBook.meta.v1";
const TABLES_KEY = "levelBook.tables.v1";

let rows = [];
let tables = [];
let activeTableIndex = 0;
let savedPoints = [];
let meta = { title: "", site: "", date: "", place: "" };
let selected = { row: 0, field: "gl" };
let buffer = "";
let saveTimer = 0;
let drawerMode = "normal";
let drawerTargetRow = null;
let drawerSaved = false;
let startupImport = false;
let setupComplete = false;
let hasSavedWork = false;
let pickerTargetRow = null;
let expandedClosureRows = new Set();
let locked = false;

const $ = (selector) => document.querySelector(selector);
const fields = ["bs", "ih", "fs", "gl", "point"];
const EXCEL_EXTRA_ROWS = 30;

function blankRow(seed = {}) {
  return { bs: "", ih: "", fs: "", gl: "", point: "", ...seed };
}

function load() {
  tables = readJson(TABLES_KEY, []);
  activeTableIndex = 0;
  rows = tables[0]?.rows || readJson(STORAGE_KEY, [blankRow()]);
  savedPoints = readJson(POINTS_KEY, []);
  meta = readJson(META_KEY, { title: "", date: todayString(), site: "", place: "" });
  if (!meta.date) meta.date = todayString();
  ensureTables();
  hasSavedWork = tables.some((table) => (table.rows || []).some(rowHasWork))
    || savedPoints.length > 0
    || Boolean(meta.site || meta.place);
  $("#basePoint").value = rows[0]?.point || "";
  $("#baseGl").value = rows[0]?.gl || "";
  syncMetaToInputs();
}

function ensureTables() {
  if (!tables.length) {
    tables = [{ name: tableNameFromMeta() || "表1", date: meta.date || todayString(), rows }];
    activeTableIndex = 0;
  }
  tables = tables.map((table, index) => normalizeTable(table, index));
  if (!tables[activeTableIndex]) activeTableIndex = 0;
  rows = tables[activeTableIndex].rows || [blankRow()];
  syncTableToLegacyMeta();
}

function normalizeTable(table, index) {
  return {
    name: String(table?.name || (index === 0 ? tableNameFromMeta() : "") || `表${index + 1}`).trim(),
    date: table?.date || (index === 0 ? meta.date : "") || todayString(),
    rows: table?.rows?.length ? table.rows : [blankRow()]
  };
}

function currentTable() {
  if (!tables[activeTableIndex]) ensureTables();
  return tables[activeTableIndex];
}

function tableNameFromMeta() {
  return String(meta.place || "").trim();
}

function syncTableToLegacyMeta() {
  const table = tables[activeTableIndex];
  if (!table) return;
  meta.date = table.date || meta.date || todayString();
  meta.place = table.name || meta.place || "";
}

function tableDisplayName(table, index) {
  const date = table?.date ? formatSurveyDate(table.date) : "日付未設定";
  const name = table?.name || `表${index + 1}`;
  return `${date} ${name}`;
}

function rowHasWork(row) {
  return Boolean(row && (row.bs || row.fs || row.gl || row.point));
}

function syncActiveTable() {
  if (!tables.length) ensureTables();
  if (!tables[activeTableIndex]) activeTableIndex = 0;
  tables[activeTableIndex] = {
    ...tables[activeTableIndex],
    name: tables[activeTableIndex]?.name || tableNameFromMeta() || `表${activeTableIndex + 1}`,
    date: tables[activeTableIndex]?.date || meta.date || todayString(),
    rows
  };
}

function renderTableSelect() {
  const select = $("#tableSelect");
  if (!select) return;
  syncActiveTable();
  select.innerHTML = "";
  tables.forEach((table, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = tableDisplayName(table, index);
    select.appendChild(option);
  });
  select.value = String(activeTableIndex);
}

function switchTable(index) {
  syncActiveTable();
  activeTableIndex = Math.max(0, Math.min(tables.length - 1, index));
  rows = tables[activeTableIndex]?.rows || [blankRow()];
  expandedClosureRows.clear();
  syncTableToLegacyMeta();
  selected = { row: 0, field: "gl" };
  buffer = rows[0]?.gl || "";
  syncMetaToInputs();
  syncBaseInputs();
  render();
  saveSoon();
}

function addTable() {
  syncActiveTable();
  const defaultName = currentTable()?.name || "";
  showInputModal(
    "表を追加",
    [
      { id: "modal-table-name", label: "作業名（表の名前）", value: defaultName, type: "text" },
      { id: "modal-table-date", label: "作成日", value: todayString(), type: "date" }
    ],
    (values) => {
      const name = (values["modal-table-name"] || "").trim();
      if (!name) return;
      const date = normalizeDateInput(values["modal-table-date"] || todayString());
      tables.push({ name, date, rows: [blankRow()] });
      activeTableIndex = tables.length - 1;
      rows = tables[activeTableIndex].rows;
      syncTableToLegacyMeta();
      selected = { row: 0, field: "gl" };
      buffer = "";
      syncMetaToInputs();
      syncBaseInputs();
      render();
      saveSoon();
    }
  );
}

function todayString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
    syncActiveTable();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    localStorage.setItem(POINTS_KEY, JSON.stringify(savedPoints));
    localStorage.setItem(TABLES_KEY, JSON.stringify(tables));
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    hasSavedWork = tables.some((table) => (table.rows || []).some(rowHasWork))
      || savedPoints.length > 0
      || Boolean(meta.site || meta.place);
    updateStartupChoice();
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
  rows = rows.map((row, index, sourceRows) => {
    const next = { ...row };
    const bs = num(next.bs);
    const fs = num(next.fs);
    let gl = num(next.gl);
    if (index > 0 && fs !== null) {
      gl = currentIH !== null ? currentIH - fs : null;
      next.gl = fmt(gl);
    }
    if (gl !== null && bs !== null) {
      currentIH = gl + bs;
      next.ih = fmt(currentIH);
      return next;
    }
    const nextRowHasFs = index < sourceRows.length - 1 && num(sourceRows[index + 1]?.fs) !== null;
    next.ih = fs !== null && nextRowHasFs && currentIH !== null ? fmt(currentIH) : "";
    return next;
  });
}

function requireFirstBsBeforeFs() {
  if (num(rows[0]?.bs) !== null) return true;
  window.alert("一番上のBSを入力してからFSへ進んでください。");
  selected = { row: 0, field: "bs" };
  buffer = rows[0]?.bs || "";
  render();
  return false;
}

function render() {
  calculate();
  syncBaseInputs();
  updateSurveySummary();
  const tbody = $("#rows");
  tbody.innerHTML = "";
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    tr.dataset.rowIndex = String(rowIndex);
    const closure = closureForRow(row);
    fields.forEach((field) => {
      const td = document.createElement("td");
      td.className = field;
      td.dataset.row = String(rowIndex);
      td.dataset.field = field;
      if (field === "ih" || (field === "gl" && rowIndex > 0)) td.classList.add("computed");
      if (selected.row === rowIndex && selected.field === field) td.classList.add("selected");
      if (field === "point" && closure) {
        const isExpanded = expandedClosureRows.has(rowIndex);
        td.appendChild(document.createTextNode(row.point || ""));
        const toggle = document.createElement("span");
        toggle.className = "closure-toggle";
        toggle.textContent = isExpanded ? "▲" : "▼";
        toggle.addEventListener("click", (e) => {
          e.stopPropagation();
          if (expandedClosureRows.has(rowIndex)) {
            expandedClosureRows.delete(rowIndex);
          } else {
            expandedClosureRows.add(rowIndex);
          }
          render();
        });
        td.appendChild(toggle);
      } else {
        td.textContent = row[field] || "";
      }
      td.addEventListener("click", () => selectCell(rowIndex, field));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
    if (closure && expandedClosureRows.has(rowIndex)) {
      const diffMm = Math.round(closure.diff * 1000);
      const sign = diffMm >= 0 ? "+" : "";
      const absDiff = Math.abs(closure.diff);
      let cls = "ok";
      if (absDiff >= 0.01) cls = "error";
      else if (absDiff >= 0.005) cls = "warn";
      const expandTr = document.createElement("tr");
      expandTr.className = "closure-expand-row";
      const expandTd = document.createElement("td");
      expandTd.colSpan = 5;
      expandTd.innerHTML = `既知 ${closure.ref.toFixed(3)}　測定 ${closure.measured.toFixed(3)}　誤差 <span class="closure-badge ${cls}">${sign}${diffMm} mm</span>`;
      expandTr.appendChild(expandTd);
      tbody.appendChild(expandTr);
    }
  });
  for (let i = rows.length; i < 8; i += 1) {
    const tr = document.createElement("tr");
    fields.forEach((field) => {
      const td = document.createElement("td");
      td.className = field;
      td.innerHTML = "&nbsp;";
      td.dataset.row = String(i);
      td.dataset.field = field;
      td.addEventListener("click", () => {
        while (rows.length <= i) rows.push(blankRow());
        selectCell(i, field);
      });
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  updateReadout();
  updateModes();
  renderPointList();
  renderPointSuggestions();
  renderTableSelect();
  updateSavePointButton();
  updateRowHighlights();
}

function selectCell(row, field) {
  if (locked) return;
  if (field === "ih" || (field === "gl" && row > 0)) return;
  if (field === "fs" && !requireFirstBsBeforeFs()) return;
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
  if (locked) return;
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
  if (locked) return;
  if (selected.field === "point") return;
  if (key === "." && buffer.includes(".")) return;
  speakKey(key);
  buffer = buffer === "0" ? key : `${buffer}${key}`;
  writeSelectedValue(buffer);
}

function toggleSign() {
  if (locked) return;
  if (selected.field === "point") return;
  if (!buffer) buffer = rows[selected.row]?.[selected.field] || "0";
  buffer = buffer.startsWith("-") ? buffer.slice(1) : `-${buffer}`;
  writeSelectedValue(buffer);
}

function backspace() {
  if (locked) return;
  if (selected.field === "point") {
    const next = ($("#activePoint").value || "").slice(0, -1);
    $("#activePoint").value = next;
    commitPointName();
    return;
  }
  buffer = buffer.slice(0, -1);
  writeSelectedValue(buffer);
}

function clearBuffer() {
  if (locked) return;
  if (selected.field === "point") {
    if (!rows[selected.row]) rows[selected.row] = blankRow();
    rows[selected.row].point = "";
    $("#activePoint").value = "";
    buffer = "";
  } else {
    buffer = "";
    writeSelectedValue("");
    return;
  }
  syncBaseInputs();
  render();
  saveSoon();
}

function clearAllRows() {
  if (locked) return;
  rows = [blankRow()];
  expandedClosureRows.clear();
  selected = { row: 0, field: "gl" };
  buffer = "";
  syncBaseInputs();
  render();
  saveSoon();
}

function chooseBs() {
  if (locked) return;
  finalizeSelectedValue();
  let row = selected.row;
  if (!rows[row]) row = rows.length - 1;
  selected = { row: Math.max(0, row), field: "bs" };
  buffer = rows[selected.row]?.bs || "";
  render();
}

function chooseFs() {
  if (locked) return;
  finalizeSelectedValue();
  if (!requireFirstBsBeforeFs()) return;
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
  const nextField = editableFields[nextIndex];
  if (nextField === "fs" && !requireFirstBsBeforeFs()) return;
  selected = { row: selected.row, field: nextField };
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

function isTextEditingTarget(target) {
  if (!target) return false;
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target.isContentEditable;
}

function handlePhysicalKeyboard(event) {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (isTextEditingTarget(event.target)) return;
  if (!$("#startupChoice").classList.contains("hidden")) return;
  if (locked) return;

  const key = event.key;
  if (/^[0-9]$/.test(key)) {
    event.preventDefault();
    appendKey(key);
    return;
  }
  if (key === "." || key === "Decimal") {
    event.preventDefault();
    appendKey(".");
    return;
  }
  if (key === "-" || key === "Subtract") {
    event.preventDefault();
    toggleSign();
    return;
  }
  if (key === "Backspace") {
    event.preventDefault();
    backspace();
    return;
  }
  if (key === "Enter") {
    event.preventDefault();
    finalizeSelectedValue();
    return;
  }
  if (key === "ArrowLeft") {
    event.preventDefault();
    moveField(-1);
    return;
  }
  if (key === "ArrowRight") {
    event.preventDefault();
    moveField(1);
    return;
  }
  if (key === "ArrowUp") {
    event.preventDefault();
    moveRow(-1);
    return;
  }
  if (key === "ArrowDown") {
    event.preventDefault();
    moveRow(1);
    return;
  }
  if (key === "Tab") {
    event.preventDefault();
    moveField(event.shiftKey ? -1 : 1);
    return;
  }
  if (key.toLowerCase() === "b") {
    event.preventDefault();
    chooseBs();
    return;
  }
  if (key.toLowerCase() === "f") {
    event.preventDefault();
    chooseFs();
  }
}

function syncBaseInputs() {
  $("#basePoint").value = rows[0]?.point || "";
  $("#baseGl").value = rows[0]?.gl || "";
}

function syncMetaToInputs() {
  const table = currentTable();
  $("#surveyDate").value = table?.date || meta.date || todayString();
  $("#siteName").value = meta.site || "";
  $("#surveyPlace").value = table?.name || meta.place || "";
  updateSurveySummary();
}

function readMetaFromInputs() {
  meta.site = $("#siteName").value;
  const table = currentTable();
  if (table) {
    table.date = $("#surveyDate").value || todayString();
    table.name = $("#surveyPlace").value.trim() || table.name || `表${activeTableIndex + 1}`;
    meta.date = table.date;
    meta.place = table.name;
  }
}

function updateSurveySummary() {
  const table = currentTable();
  const parts = [];
  if (meta.site) parts.push(`現場名：${meta.site}`);
  if (table?.name) parts.push(`作業名：${table.name}`);
  const firstLine = parts.join("　/　");
  const secondLine = table?.date ? `作成日：${formatSurveyDate(table.date)}` : "";
  $("#surveySummary").innerHTML = [firstLine, secondLine].filter(Boolean).map(escapeHtml).join("<br>");
}

function normalizeDateInput(value) {
  const text = String(value || "").trim().replace(/[./]/g, "-");
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return todayString();
  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
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
  $("#drawer").classList.toggle("context-mode", drawerMode === "register");
  $("#drawer").classList.toggle("setup-mode", drawerMode === "setup");
  $("#savedPointName").setAttribute("list", "pointSuggestions");
  if ((drawerMode === "base" || drawerMode === "register" || drawerMode === "setup") && rows[row]) {
    $("#savedPointName").value = drawerMode === "base" ? rows[row].point || "" : "";
    $("#savedPointValue").value = fmtInput(rows[row].gl || "");
  }
  if (drawerMode === "register") $("#savedPointName").removeAttribute("list");
  renderPointSuggestions();
  updateSavePointButton();
  setDrawerAccordion(drawerMode === "setup" || drawerMode === "register" ? "info" : "points");
  if (drawerMode === "setup" || drawerMode === "register") window.setTimeout(() => $("#savedPointName").focus(), 0);
  $("#drawer").classList.add("open");
  $("#drawerBackdrop").classList.add("open");
}

function closeDrawer() {
  if (drawerMode === "setup" && !setupComplete) {
    window.alert("測定情報と基準点を登録してください。");
    return;
  }
  applyBaseEntry();
  applyDrawerPointName();
  $("#drawer").classList.remove("open");
  $("#drawer").classList.remove("context-mode");
  $("#drawer").classList.remove("setup-mode");
  $("#drawerBackdrop").classList.remove("open");
  drawerMode = "normal";
  drawerTargetRow = null;
  drawerSaved = false;
}

function openPointDrawer(row) {
  if (!rows[row]) rows[row] = blankRow();
  if (!rows[row].bs && !rows[row].fs) {
    openDrawer("resume", row);
    return;
  }
  if (rows[row].fs) {
    openPointPicker(row);
    return;
  }
  openDrawer("base", row);
}

function applyBaseEntry() {
  if (!["base", "resume"].includes(drawerMode) || drawerTargetRow === null || drawerSaved) return;
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
  readMetaFromInputs();
  const wasSetup = drawerMode === "setup";
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
  if (drawerMode === "setup") {
    rows = [blankRow({ point: name, gl: value })];
    tables = [{ name: meta.place || name || "表1", date: meta.date || todayString(), rows }];
    activeTableIndex = 0;
    selected = { row: 0, field: "bs" };
    buffer = "";
    drawerSaved = true;
    setupComplete = true;
    syncBaseInputs();
  }
  if (drawerMode === "register" && drawerTargetRow !== null && rows[drawerTargetRow]) {
    rows[drawerTargetRow].point = name;
    selected = { row: drawerTargetRow, field: "point" };
    buffer = name;
    drawerSaved = true;
  }
  clearPointEntry();
  renderPointList();
  if (wasSetup) setDrawerAccordion("points");
  render();
  saveSoon();
  if (shouldCloseAfterSave) closeDrawer();
  if (wasSetup) selectFirstBs();
}

function recallPoint(point) {
  const row = ["base", "resume"].includes(drawerMode) && drawerTargetRow !== null ? drawerTargetRow : 0;
  if (!rows[row]) rows[row] = blankRow();
  rows[row] = blankRow({ ...rows[row], point: point.name, gl: point.value });
  if (row === 0) syncBaseInputs();
  selected = { row, field: drawerMode === "resume" ? "bs" : "gl" };
  buffer = drawerMode === "resume" ? (rows[row].bs || "") : point.value;
  drawerSaved = true;
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
  const needsMeta = drawerMode === "setup";
  const hasMeta = $("#surveyDate").value && $("#siteName").value.trim() && $("#surveyPlace").value.trim();
  $("#savePoint").disabled = !name || !value || (needsMeta && !hasMeta);
}

function toggleLock() {
  locked = !locked;
  updateLockButton();
}

function updateLockButton() {
  const btn = $("#lockTable");
  if (!btn) return;
  btn.textContent = locked ? "解除" : "保護";
  btn.classList.toggle("locked", locked);
  document.querySelector(".table-wrap")?.classList.toggle("locked", locked);
}

function continueSavedWork() {
  $("#startupChoice").classList.add("hidden");
  locked = true;
  updateLockButton();
}

function updateStartupChoice() {
  const continueButton = $("#startupContinue");
  if (!continueButton) return;
  continueButton.disabled = !hasSavedWork;
}

function setDrawerAccordion(active) {
  const info = $("#drawerInfoSection");
  const points = $("#drawerPointsSection");
  const infoToggle = $("#toggleInfo");
  const pointsToggle = $("#togglePoints");
  if (!info || !points) return;
  const showPoints = active === "points";
  info.classList.toggle("open", !showPoints);
  points.classList.toggle("open", showPoints);
  infoToggle?.setAttribute("aria-expanded", String(!showPoints));
  pointsToggle?.setAttribute("aria-expanded", String(showPoints));
}

function toggleDrawerAccordion(active) {
  const section = active === "points" ? $("#drawerPointsSection") : $("#drawerInfoSection");
  const next = section?.classList.contains("open") ? (active === "points" ? "info" : "points") : active;
  setDrawerAccordion(next);
  if (next === "points") {
    window.setTimeout(() => $("#pointList")?.scrollTo({ top: 0 }), 0);
  }
}

function handleSavedPointNameInput() {
  const name = $("#savedPointName").value.trim();
  if (drawerMode === "base" || drawerMode === "resume") {
    const value = findPointValue(name);
    $("#savedPointValue").value = value || "";
  }
  updateSavePointButton();
}

function selectFirstBs() {
  if (!rows[0]) rows[0] = blankRow();
  selected = { row: 0, field: "bs" };
  buffer = rows[0].bs || "";
  render();
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
    if (dx < 18) return;
    element.classList.add("swiping");
    element.style.transform = `translateX(${Math.min(90, dx)}px)`;
  });

  element.addEventListener("pointerup", () => {
    if (!swiping) return;
    swiping = false;
    const dx = currentX - startX;
    element.classList.remove("swiping");
    element.style.transform = "";
    if (dx > 90) {
      element.classList.add("delete-ready");
      element.dataset.swiped = "1";
      window.setTimeout(() => {
        element.dataset.swiped = "";
      }, 250);
    } else if (dx < -45) {
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
  document.addEventListener("keydown", handlePhysicalKeyboard);
  document.addEventListener("pointerdown", (event) => {
    const tapped = event.target.closest(".point-item");
    document.querySelectorAll(".point-item.delete-ready").forEach((el) => {
      if (el !== tapped) el.classList.remove("delete-ready");
    });
  });
  $("#edgeOpen").addEventListener("click", () => openDrawer("normal"));
  $("#startupContinue").addEventListener("click", continueSavedWork);
  $("#startupImport").addEventListener("click", () => {
    startupImport = true;
    $("#csvFile").click();
  });
  $("#startupNew").addEventListener("click", startNewSite);
  $("#menuClose").addEventListener("click", closeDrawer);
  $("#drawerBackdrop").addEventListener("click", closeDrawer);
  $("#toggleInfo").addEventListener("click", () => toggleDrawerAccordion("info"));
  $("#togglePoints").addEventListener("click", () => toggleDrawerAccordion("points"));
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
      if (tables[activeTableIndex]) {
        tables[activeTableIndex].date = $("#surveyDate").value || tables[activeTableIndex].date || todayString();
        tables[activeTableIndex].name = $("#surveyPlace").value.trim() || tables[activeTableIndex].name;
        syncTableToLegacyMeta();
      }
      updateSurveySummary();
      renderTableSelect();
      updateSavePointButton();
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
  $("#modeBs").addEventListener("click", chooseBs);
  $("#modeFs").addEventListener("click", chooseFs);
  $("#prevRow").addEventListener("click", () => moveRow(-1));
  $("#nextRow").addEventListener("click", () => moveRow(1));
  $("#confirmEntry").addEventListener("click", confirmAndAdvance);
  $("#allClearButton").addEventListener("click", () => showConfirmModal(
    "入力内容を消去",
    "BS・FS・GL・測点名をすべて消去してよいですか？",
    clearAllRows
  ));
  $("#exportExcel").addEventListener("click", exportExcel);
  $("#pointPickerClose").addEventListener("click", closePointPicker);
  $("#pointPickerCancel").addEventListener("click", closePointPicker);
  $("#pointPickerConfirm").addEventListener("click", () => confirmPointPicker());
  $("#pointPickerInput").addEventListener("input", (e) => renderPointPickerList(e.target.value));
  $("#pointPicker").addEventListener("click", (e) => { if (e.target === e.currentTarget) closePointPicker(); });
  $("#errorModalClose").addEventListener("click", closeErrorModal);
  $("#errorModal").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeErrorModal(); });
  $("#errorModalCsv").addEventListener("click", exportErrorCsv);
  $("#errorModalExcel").addEventListener("click", exportErrorExcel);
  $("#importCsv").addEventListener("click", () => {
    startupImport = drawerMode === "setup";
    $("#csvFile").click();
  });
  $("#tableSelect").addEventListener("change", (event) => switchTable(Number(event.target.value)));
  $("#addTable").addEventListener("click", addTable);
  $("#lockTable").addEventListener("click", toggleLock);
  $("#csvFile").addEventListener("change", importCsv);
  document.querySelector(".keypad").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.key) appendKey(button.dataset.key);
    if (button.dataset.action === "sign") toggleSign();
    if (button.dataset.action === "back") backspace();
    if (button.dataset.action === "clear") clearBuffer();
    if (button.dataset.action === "all-clear") clearAllRows();
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

function startNewSite() {
  const doStart = () => {
    $("#startupChoice").classList.add("hidden");
    setupComplete = false;
    startupImport = false;
    locked = false;
    updateLockButton();
    rows = [blankRow()];
    tables = [{ name: "表1", date: todayString(), rows }];
    activeTableIndex = 0;
    savedPoints = [];
    meta = { title: "", date: todayString(), site: "", place: "" };
    selected = { row: 0, field: "gl" };
    buffer = "";
    syncMetaToInputs();
    syncBaseInputs();
    render();
    openDrawer("setup", 0);
    saveSoon();
  };
  if (hasSavedWork) {
    showConfirmModal("新規現場を開始", "保存済みの作業を消去して新規現場を開始しますか？", doStart);
  } else {
    doStart();
  }
}

function excelFilename() {
  const site = sanitizeFilename(meta.site || "現場名未入力");
  return `${site}.xls`;
}

function exportExcel() {
  finalizeSelectedValue();
  calculate();
  readMetaFromInputs();
  if (!meta.date) meta.date = todayString();
  syncMetaToInputs();
  syncActiveTable();
  const workbook = buildExcelWorkbook();
  download(excelFilename(), `\ufeff${workbook}`, "application/vnd.ms-excel;charset=utf-8");
}

function buildExcelWorkbook() {
  const closureData = computeClosureAll();
  const worksheets = [
    excelBasicWorksheet(),
    ...tables.map((table, index) => excelTableWorksheet(table, index)),
    ...(closureData.length ? [excelClosureWorksheet(closureData)] : [])
  ];
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9D8BD" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Input"><Interior ss:Color="#FFFBC4" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Text"><NumberFormat ss:Format="@"/></Style>
  <Style ss:ID="Num"><NumberFormat ss:Format="0.000"/></Style>
 </Styles>
 ${worksheets.join("\n")}
</Workbook>`;
}

function excelBasicWorksheet() {
  const rowsXml = [
    excelRow([excelStringCell("LEVEL_APP"), excelStringCell("4")]),
    excelRow([excelStringCell("TITLE"), excelStringCell(meta.title || "")]),
    excelRow([excelStringCell("SITE"), excelStringCell(meta.site || "")]),
    excelRow([]),
    excelRow([excelStringCell("POINTS")]),
    excelRow([excelStringCell("測点名", "Header"), excelStringCell("数値", "Header")]),
    ...savedPoints.map((point) => excelRow([excelStringCell(point.name), excelNumberCell(point.value)]))
  ];
  return excelWorksheet("基本情報", rowsXml);
}

function excelTableWorksheet(table, index) {
  const rowsXml = [
    excelRow(["BS", "IH", "FS", "GL", "測点名"].map((label) => excelStringCell(label, "Header"))),
    ...excelRowsForRows(table.rows || [blankRow()])
  ];
  return excelWorksheet(uniqueSheetName(tableSheetTitle(table, index), index), rowsXml);
}

function tableSheetTitle(table, index) {
  const date = table?.date ? formatSurveyDate(table.date) : "日付未設定";
  const name = table?.name || `表${index + 1}`;
  return `${date}_${name}`;
}

function excelRowsForRows(sourceRows) {
  const usefulRows = sourceRows.filter((row, index) => index === 0 || row.bs || row.fs || row.gl || row.point);
  const rowCount = Math.max(usefulRows.length + EXCEL_EXTRA_ROWS, EXCEL_EXTRA_ROWS + 1);
  return Array.from({ length: rowCount }, (_, index) => excelMeasurementRow(usefulRows[index] || blankRow(), index));
}

function excelMeasurementRow(row, index) {
  const ihFormula = index === 0
    ? '=IF(RC[-1]="","",RC[2]+RC[-1])'
    : '=IF(ISNUMBER(RC[-1]),RC[-1]+RC[2],IF(AND(ISNUMBER(R[-1]C),ISNUMBER(R[1]C[1])),R[-1]C,""))';
  const glFormula = '=IF(ISNUMBER(RC[-1]),R[-1]C[-2]-RC[-1],"")';
  return excelRow([
    excelNumberCell(row.bs, "Input"),
    excelFormulaCell(ihFormula, row.ih),
    excelNumberCell(row.fs, "Input"),
    index > 0 ? excelFormulaCell(glFormula, row.gl) : excelNumberCell(row.gl),
    excelStringCell(row.point || "")
  ]);
}

function excelWorksheet(name, rowsXml) {
  return `<Worksheet ss:Name="${xmlAttr(sanitizeSheetName(name))}"><Table>${rowsXml.join("")}</Table></Worksheet>`;
}

function excelRow(cells) {
  return `<Row>${cells.join("")}</Row>`;
}

function excelStringCell(value, style = "Text") {
  return `<Cell ss:StyleID="${style}"><Data ss:Type="String">${xmlText(value)}</Data></Cell>`;
}

function excelNumberCell(value, style = "Num") {
  const parsed = num(value);
  if (parsed === null) return `<Cell ss:StyleID="${style}"><Data ss:Type="String"></Data></Cell>`;
  return `<Cell ss:StyleID="${style}"><Data ss:Type="Number">${parsed.toFixed(3)}</Data></Cell>`;
}

function excelFormulaCell(formula, value) {
  const parsed = num(value);
  const dataType = parsed === null ? "String" : "Number";
  const dataValue = parsed === null ? "" : parsed.toFixed(3);
  return `<Cell ss:Formula="${xmlAttr(formula)}" ss:StyleID="Num"><Data ss:Type="${dataType}">${dataValue}</Data></Cell>`;
}

function uniqueSheetName(name, index) {
  const base = sanitizeSheetName(name || `表${index + 1}`);
  const suffix = index > 0 ? `_${index + 1}` : "";
  return `${base.slice(0, 31 - suffix.length)}${suffix}`;
}

function sanitizeSheetName(value) {
  return String(value || "表").trim().replace(/[\\/:?*\[\]]/g, "_").slice(0, 31) || "表";
}

function xmlText(value) {
  return String(value ?? "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);
}

function xmlAttr(value) {
  return xmlText(value).replace(/"/g, "&quot;");
}

function sanitizeFilename(value) {
  return String(value || "").trim().replace(/[\\/:*?"<>|]/g, "_") || "未入力";
}

function importCsv(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!startupImport && !window.confirm("現在の内容を破棄してファイルを読み込みますか?")) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const text = String(reader.result || "");
    if (looksLikeExcelXml(text)) {
      applyImportedWorkbook(parseExcelXml(text, file.name));
    } else {
      applyImportedCsv(parseCsv(text), file.name);
    }
    $("#startupChoice").classList.add("hidden");
    startupImport = false;
  });
  reader.readAsText(file, "utf-8");
}

function looksLikeExcelXml(text) {
  return /<Workbook[\s>]/i.test(text) || /<Worksheet[\s>]/i.test(text);
}

function applyImportedWorkbook(workbook) {
  locked = true;
  updateLockButton();
  meta = workbook.meta;
  savedPoints = workbook.points;
  tables = workbook.tables.length ? workbook.tables : [{ name: "表1", date: todayString(), rows: [blankRow()] }];
  activeTableIndex = 0;
  rows = tables[0].rows;
  setupComplete = true;
  syncTableToLegacyMeta();
  selected = { row: 0, field: "gl" };
  buffer = rows[0]?.gl || "";
  syncMetaToInputs();
  syncBaseInputs();
  render();
  saveSoon();
}

function parseExcelXml(text, filename) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const workbook = { meta: { title: filename, site: "", date: "", place: "" }, points: [], tables: [] };
  const worksheets = Array.from(doc.getElementsByTagName("Worksheet"));
  worksheets.forEach((sheet, index) => {
    const sheetName = sheet.getAttribute("ss:Name") || sheet.getAttribute("Name") || `表${index}`;
    const values = excelSheetValues(sheet);
    if (index === 0 || sheetName === "基本情報") {
      readExcelBasicSheet(values, workbook, filename);
      return;
    }
    const tableMeta = tableMetaFromSheetName(sheetName, workbook.meta.date);
    const dataRows = values.slice(1).map((line) => blankRow({
      bs: cleanCsvNumber(line[0]),
      ih: cleanCsvNumber(line[1]),
      fs: cleanCsvNumber(line[2]),
      gl: cleanCsvNumber(line[3]),
      point: line[4] || ""
    })).filter(rowHasWork);
    workbook.tables.push({ name: tableMeta.name, date: tableMeta.date, rows: normalizeImportedRows(dataRows) });
  });
  return workbook;
}

function readExcelBasicSheet(values, workbook, filename) {
  let section = "";
  values.forEach((line) => {
    const tag = stripBom(line[0] || "").trim();
    if (!tag) return;
    if (tag === "POINTS") {
      section = "POINTS";
      return;
    }
    if (tag === "TITLE") workbook.meta.title = filename || line[1] || "";
    if (tag === "SITE") workbook.meta.site = line[1] || "";
    if (tag === "DATE") workbook.meta.date = normalizeDateInput(line[1] || "");
    if (tag === "PLACE") workbook.meta.place = line[1] || "";
    if (section === "POINTS" && tag !== "測点名") {
      const name = line[0]?.trim();
      const value = fmtInput(line[1] || "");
      if (name && value) workbook.points.push({ name, value });
    }
  });
}

function excelSheetValues(sheet) {
  return Array.from(sheet.getElementsByTagName("Row")).map((row) => {
    const values = [];
    Array.from(row.getElementsByTagName("Cell")).forEach((cell) => {
      const indexAttr = cell.getAttribute("ss:Index") || cell.getAttribute("Index");
      if (indexAttr) {
        while (values.length < Number(indexAttr) - 1) values.push("");
      }
      const data = cell.getElementsByTagName("Data")[0];
      values.push(data?.textContent || "");
    });
    return values;
  });
}

function tableMetaFromSheetName(sheetName, fallbackDate) {
  const match = String(sheetName || "").match(/^(\d{4})[.\-](\d{2})[.\-](\d{2})_(.+)$/);
  if (!match) return { date: fallbackDate || todayString(), name: sheetName || "表1" };
  return { date: `${match[1]}-${match[2]}-${match[3]}`, name: match[4] || "表1" };
}
function applyImportedCsv(table, filename) {
  const nextMeta = { title: filename, date: "", site: "", place: "" };
  const nextPoints = [];
  const nextTables = [];
  let section = "";
  let currentRows = null;
  let currentTableName = "";
  let currentTableDate = "";

  function pushCurrentTable() {
    if (!currentRows) return;
    const normalizedRows = normalizeImportedRows(currentRows);
    if (normalizedRows.length) {
      nextTables.push({ name: currentTableName || `表${nextTables.length + 1}`, date: currentTableDate || nextMeta.date || todayString(), rows: normalizedRows });
    }
    currentRows = null;
    currentTableName = "";
    currentTableDate = "";
  }

  table.forEach((line) => {
    const tag = stripBom(line[0] || "").trim();
    const isEmptyLine = line.every((cell) => String(cell || "").trim() === "");
    if (isEmptyLine) return;

    if (tag === "TABLE") {
      pushCurrentTable();
      currentTableName = line[1] || `表${nextTables.length + 1}`;
      currentTableDate = normalizeDateInput(line[2] || nextMeta.date || todayString());
      currentRows = [];
      section = "ROWS";
      return;
    }
    if (tag === "POINTS") {
      pushCurrentTable();
      section = "POINTS";
      return;
    }
    if (tag === "ROWS") {
      if (!currentRows) currentRows = [];
      section = "ROWS";
      return;
    }
    if (tag === "BS") {
      if (!currentRows) currentRows = [];
      section = "ROWS";
      return;
    }

    if (tag === "TITLE") nextMeta.title = filename || line[1] || "";
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
      const ih = cleanCsvNumber(line[1]);
      const fs = cleanCsvNumber(line[2]);
      const gl = cleanCsvNumber(line[3]);
      const point = line[4] || "";
      if (bs || ih || fs || gl || point) {
        if (!currentRows) currentRows = [];
        currentRows.push(blankRow({ bs, ih, fs, gl, point }));
      }
    }
  });
  pushCurrentTable();

  tables = nextTables.length ? nextTables : [{ name: nextMeta.place || "表1", date: nextMeta.date || todayString(), rows: [blankRow()] }];
  activeTableIndex = 0;
  rows = tables[0].rows;
  savedPoints = nextPoints;
  locked = true;
  updateLockButton();
  if (!nextMeta.date) nextMeta.date = todayString();
  meta = nextMeta;
  selected = { row: 0, field: "gl" };
  buffer = rows[0]?.gl || "";
  setupComplete = true;
  syncMetaToInputs();
  syncBaseInputs();
  render();
  saveSoon();
}

function normalizeImportedRows(sourceRows) {
  let lastKnownIH = null;
  return sourceRows.map((row, index) => {
    const next = blankRow(row);
    const bs = num(next.bs);
    const ih = num(next.ih);
    const fs = num(next.fs);
    let gl = num(next.gl);

    if (index > 0 && fs !== null && gl === null && lastKnownIH !== null) {
      gl = lastKnownIH - fs;
      next.gl = fmt(gl);
    }
    if (gl !== null && bs !== null) {
      lastKnownIH = gl + bs;
    } else if (ih !== null) {
      lastKnownIH = ih;
    }
    return next;
  });
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

// ── Confirm and advance (new "確定 →" button) ──────────────────────────────
function confirmAndAdvance() {
  if (locked) return;
  finalizeSelectedValue();
  // Decide next logical cell based on current field
  if (selected.field === "gl") {
    // row 0 GL confirmed → move to BS
    selected = { row: 0, field: "bs" };
    buffer = rows[0]?.bs || "";
  } else if (selected.field === "bs") {
    // BS confirmed → move to FS of next row
    chooseFs();
    return;
  } else if (selected.field === "fs") {
    // FS confirmed → point name of same row
    if (!rows[selected.row]) rows[selected.row] = blankRow();
    const row = selected.row;
    selected = { row, field: "point" };
    buffer = rows[row]?.point || "";
    render();
    openPointDrawer(row);
    return;
  } else if (selected.field === "point") {
    // Point confirmed → BS mode, advance to next row
    commitPointName();
    chooseFs();
    return;
  }
  render();
}

// ── Closure difference (閉合差) ────────────────────────────────────────────
function closureForRow(row) {
  if (!row.point || !row.gl) return null;
  const saved = savedPoints.find((p) => p.name === row.point);
  if (!saved) return null;
  const refGl = num(saved.value);
  const rowGl = num(row.gl);
  if (refGl === null || rowGl === null) return null;
  return { ref: refGl, measured: rowGl, diff: rowGl - refGl };
}

function computeClosureAll() {
  const seen = new Map();
  rows.forEach((row) => {
    if (!row.point || !row.gl) return;
    const saved = savedPoints.find((p) => p.name === row.point);
    if (!saved) return;
    const refGl = num(saved.value);
    const rowGl = num(row.gl);
    if (refGl !== null && rowGl !== null) {
      seen.set(row.point, { point: row.point, ref: refGl, measured: rowGl, diff: rowGl - refGl });
    }
  });
  return [...seen.values()];
}

function updateClosureDisplay() {
  const results = computeClosureAll();
  const summary = $("#surveySummary");
  if (!results.length || !summary) return;

  const worst = results.reduce((a, b) => Math.abs(b.diff) > Math.abs(a.diff) ? b : a);
  const absDiff = Math.abs(worst.diff);
  let cls = "ok";
  if (absDiff >= 0.01) cls = "error";
  else if (absDiff >= 0.005) cls = "warn";
  const sign = worst.diff >= 0 ? "+" : "";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "closure-trigger";
  btn.innerHTML = `既知点との誤差　<span class="closure-badge ${cls}">${sign}${worst.diff.toFixed(3)} m</span>`;
  btn.addEventListener("click", openErrorModal);
  summary.appendChild(btn);
}

// ── Point name picker ──────────────────────────────────────────────────────
function openPointPicker(row) {
  pickerTargetRow = row;
  $("#pointPickerInput").value = rows[row]?.point || "";
  renderPointPickerList("");
  $("#pointPicker").classList.remove("hidden");
  window.setTimeout(() => $("#pointPickerInput").focus(), 80);
}

function closePointPicker() {
  $("#pointPicker").classList.add("hidden");
  pickerTargetRow = null;
}

function renderPointPickerList(query) {
  const list = $("#pointPickerList");
  if (!list) return;
  list.innerHTML = "";
  const q = String(query || "").toLowerCase();
  const filtered = savedPoints.filter((p) => !q || p.name.toLowerCase().includes(q));
  if (!filtered.length) {
    const msg = document.createElement("p");
    msg.textContent = savedPoints.length ? "一致する測点なし" : "登録済み測点なし";
    list.appendChild(msg);
    return;
  }
  filtered.forEach((point) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "point-picker-item";
    btn.innerHTML = `<strong>${escapeHtml(point.name)}</strong><span>GL ${escapeHtml(point.value)}</span>`;
    btn.addEventListener("click", () => confirmPointPicker(point.name));
    list.appendChild(btn);
  });
}

function confirmPointPicker(name) {
  const n = name !== undefined ? String(name).trim() : $("#pointPickerInput").value.trim();
  const row = pickerTargetRow;
  closePointPicker();
  if (!n || row === null || !rows[row]) { render(); return; }
  rows[row].point = n;
  selected = { row, field: "point" };
  buffer = n;
  $("#activePoint").value = n;
  render();
  saveSoon();
  chooseFs();
}

// ── Error comparison modal ─────────────────────────────────────────────────
function openErrorModal() {
  const results = computeClosureAll();
  const body = $("#errorModalBody");
  if (!results.length) {
    body.innerHTML = "<p>既知点との照合データがありません</p>";
  } else {
    const rowsHtml = results.map(({ point, ref, measured, diff }) => {
      const absDiff = Math.abs(diff);
      let cls = "ok";
      if (absDiff >= 0.01) cls = "error";
      else if (absDiff >= 0.005) cls = "warn";
      const sign = diff >= 0 ? "+" : "";
      return `<tr>
        <td>${escapeHtml(point)}</td>
        <td>${ref.toFixed(3)}</td>
        <td>${measured.toFixed(3)}</td>
        <td><span class="closure-badge ${cls}">${sign}${diff.toFixed(3)}</span></td>
      </tr>`;
    }).join("");
    body.innerHTML = `<table class="error-table">
      <thead><tr><th>測点名</th><th>既知GL</th><th>測定GL</th><th>誤差</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
  }
  $("#errorModal").classList.remove("hidden");
}

function closeErrorModal() {
  $("#errorModal").classList.add("hidden");
}

function exportErrorCsv() {
  const results = computeClosureAll();
  if (!results.length) return;
  const header = "測点名,既知GL,測定GL,誤差\n";
  const body = results.map(({ point, ref, measured, diff }) => {
    const sign = diff >= 0 ? "+" : "";
    return `${point},${ref.toFixed(3)},${measured.toFixed(3)},${sign}${diff.toFixed(3)}`;
  }).join("\n");
  const site = sanitizeFilename(meta.site || "現場名未入力");
  download(`${site}_誤差一覧.csv`, `﻿${header}${body}`, "text/csv;charset=utf-8");
}

function exportErrorExcel() {
  const results = computeClosureAll();
  if (!results.length) return;
  const ws = excelClosureWorksheet(results);
  const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9D8BD" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Text"><NumberFormat ss:Format="@"/></Style>
  <Style ss:ID="Num"><NumberFormat ss:Format="0.000"/></Style>
 </Styles>
 ${ws}
</Workbook>`;
  const site = sanitizeFilename(meta.site || "現場名未入力");
  download(`${site}_誤差一覧.xls`, `﻿${workbook}`, "application/vnd.ms-excel;charset=utf-8");
}

function excelClosureWorksheet(data) {
  const headers = ["測点名", "既知GL", "測定GL", "誤差"].map((h) => excelStringCell(h, "Header"));
  const dataRows = data.map(({ point, ref, measured, diff }) => excelRow([
    excelStringCell(point),
    excelNumberCell(ref),
    excelNumberCell(measured),
    excelNumberCell(diff)
  ]));
  return excelWorksheet("誤差一覧", [excelRow(headers), ...dataRows]);
}

// ── Inline modal (replaces window.prompt / window.confirm) ────────────────
let _modalCallback = null;
let _modalFields = [];

function showConfirmModal(title, body, onConfirm) {
  _modalCallback = onConfirm;
  _modalFields = [];
  $("#inlineModalTitle").textContent = title;
  const bodyEl = $("#inlineModalBody");
  bodyEl.textContent = body;
  bodyEl.style.display = "block";
  $("#inlineModalFields").innerHTML = "";
  $("#inlineModal").classList.remove("hidden");
  $("#inlineModalConfirm").focus();
}

function showInputModal(title, fields, onConfirm) {
  _modalCallback = onConfirm;
  _modalFields = fields;
  $("#inlineModalTitle").textContent = title;
  const bodyEl = $("#inlineModalBody");
  bodyEl.style.display = "none";
  const container = $("#inlineModalFields");
  container.innerHTML = "";
  fields.forEach((f) => {
    const label = document.createElement("label");
    label.innerHTML = `<span>${escapeHtml(f.label)}</span>
      <input id="${escapeHtml(f.id)}" type="${escapeHtml(f.type || "text")}" value="${escapeHtml(f.value || "")}">`;
    container.appendChild(label);
  });
  $("#inlineModal").classList.remove("hidden");
  if (fields[0]) {
    window.setTimeout(() => document.getElementById(fields[0].id)?.focus(), 50);
  }
}

function closeInlineModal() {
  $("#inlineModal").classList.add("hidden");
  _modalCallback = null;
  _modalFields = [];
}

function bindInlineModal() {
  $("#inlineModalCancel").addEventListener("click", closeInlineModal);
  $("#inlineModal").addEventListener("click", (e) => {
    if (e.target === $("#inlineModal")) closeInlineModal();
  });
  $("#inlineModalConfirm").addEventListener("click", () => {
    if (!_modalCallback) { closeInlineModal(); return; }
    if (_modalFields.length) {
      const values = {};
      _modalFields.forEach((f) => {
        values[f.id] = document.getElementById(f.id)?.value || "";
      });
      _modalCallback(values);
    } else {
      _modalCallback();
    }
    closeInlineModal();
  });
  // Enter key in modal inputs triggers confirm
  $("#inlineModalFields").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#inlineModalConfirm").click();
  });
}

// ── Selected row highlight helper ─────────────────────────────────────────
function updateRowHighlights() {
  document.querySelectorAll("#rows tr[data-row-index]").forEach((tr) => {
    tr.classList.toggle("selected-row", Number(tr.dataset.rowIndex) === selected.row);
  });
}

load();
bind();
bindInlineModal();
buffer = rows[0]?.gl || "";
render();
updateStartupChoice();
saveSoon();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {
      // Offline support is helpful, but the app still works if registration fails.
    });
  });
}










