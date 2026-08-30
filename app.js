const STORAGE_KEY = "levelBook.image2.v1";
const POINTS_KEY = "levelBook.savedPoints.v1";
const META_KEY = "levelBook.meta.v1";
const TABLES_KEY = "levelBook.tables.v1";

let rows = [];
let tables = [];
let activeTableIndex = 0;
let savedPoints = [];
let meta = { title: "", site: "", date: "", place: "" };
let selected = { row: 0, field: "bs" };
let buffer = "";
let saveTimer = 0;
let drawerMode = "normal";
let drawerTargetRow = null;
let drawerSaved = false;
let startupImport = false;
let setupComplete = false;
let hasSavedWork = false;
let pickerTargetRow = null;
let basePointSheetTarget = null;
let basePointSheetRequired = false;
let basePointSheetReturnTo = null;
let expandedClosureRows = new Set();
let locked = false;
const DECIMALS = 3;
let rejectFlashTimer = null;
let audioCtx = null;
let entryDirty = false;
// 入力値の確認は音声をやめ、大きな文字＋OKボタンで行う。
// skipConfirm が false のあいだは、OK を押すまで BS・FS を押させない。
let skipConfirm = false;
let awaitingConfirm = false;

const $ = (selector) => document.querySelector(selector);
const fields = ["bs", "ih", "fs", "gl", "point"];
const EXCEL_EXTRA_ROWS = 30;

function blankRow(seed = {}) {
  // isBase: その行のGLが「計算結果」ではなく「新たに置いた基準高」であることの印。
  // 行0は常に基準行なので印は不要。
  return { bs: "", ih: "", fs: "", gl: "", point: "", isBase: false, ...seed };
}

// 行0、または基準高を置き直した行か
function isBaseRow(row) {
  return row === 0 || rows[row]?.isBase === true;
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
    time: normalizeTimeInput(table?.time),
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
  const time = normalizeTimeInput(table?.time);
  const name = table?.name || `表${index + 1}`;
  return `${date}${time ? ` ${time}` : ""} ${name}`;
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
  const deleteBtn = $("#deleteTable");
  if (deleteBtn) deleteBtn.disabled = tables.length <= 1;
}

function switchTable(index) {
  syncActiveTable();
  activeTableIndex = Math.max(0, Math.min(tables.length - 1, index));
  rows = tables[activeTableIndex]?.rows || [blankRow()];
  expandedClosureRows.clear();
  syncTableToLegacyMeta();
  selected = { row: 0, field: "bs" };
  buffer = rows[0]?.bs || "";
  // 読み込んだ直後の表は誤操作で書き換えないよう、必ず保護状態に戻す。
  locked = true;
  updateLockButton();
  entryDirty = false;
  awaitingConfirm = false;
  syncMetaToInputs();
  syncBaseInputs();
  render();
  saveSoon();
}

function renameTable() {
  const table = currentTable();
  showInputModal(
    "表の名称変更",
    [
      { id: "modal-rename-name", label: "作業名（表の名前）", value: table.name || "", type: "text" },
      { id: "modal-rename-date", label: "作成日", value: table.date || todayString(), type: "date" },
      { id: "modal-rename-time", label: "作成時刻", value: normalizeTimeInput(table.time) || nowTimeString(), type: "time" }
    ],
    (values) => {
      const name = (values["modal-rename-name"] || "").trim();
      if (!name) return;
      tables[activeTableIndex].name = name;
      tables[activeTableIndex].date = normalizeDateInput(values["modal-rename-date"] || todayString());
      tables[activeTableIndex].time = normalizeTimeInput(values["modal-rename-time"]);
      syncTableToLegacyMeta();
      syncMetaToInputs();
      render();
      saveSoon();
    }
  );
}

function deleteTable() {
  if (tables.length <= 1) return;
  syncActiveTable();
  showConfirmModal(
    "表を削除",
    `「${currentTable().name}」を削除してよいですか？`,
    () => {
      tables.splice(activeTableIndex, 1);
      activeTableIndex = Math.max(0, activeTableIndex - 1);
      rows = tables[activeTableIndex].rows;
      expandedClosureRows.clear();
      syncTableToLegacyMeta();
      selected = { row: 0, field: "bs" };
      buffer = rows[0]?.bs || "";
      syncMetaToInputs();
      syncBaseInputs();
      render();
      saveSoon();
    }
  );
}

function addTable() {
  syncActiveTable();
  const defaultName = currentTable()?.name || "";
  showInputModal(
    "表を追加",
    [
      { id: "modal-table-name", label: "作業名（表の名前）", value: defaultName, type: "text" },
      { id: "modal-table-date", label: "作成日", value: todayString(), type: "date" },
      { id: "modal-table-time", label: "作成時刻", value: nowTimeString(), type: "time" }
    ],
    (values) => {
      const name = (values["modal-table-name"] || "").trim();
      if (!name) return;
      const date = normalizeDateInput(values["modal-table-date"] || todayString());
      const time = normalizeTimeInput(values["modal-table-time"]) || nowTimeString();
      tables.push({ name, date, time, rows: [blankRow()] });
      activeTableIndex = tables.length - 1;
      rows = tables[activeTableIndex].rows;
      expandedClosureRows.clear();
      syncTableToLegacyMeta();
      selected = { row: 0, field: "bs" };
      buffer = "";
      syncMetaToInputs();
      syncBaseInputs();
      render();
      saveSoon();
      // 表を新設したら、その表の出発点となる基準点を続けて決めてもらう（必須）。
      openBasePointSheet(0, true);
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
    const baseRow = index === 0 || next.isBase === true;
    if (baseRow) {
      // 基準高を置き直した行からは器高を計算し直す
      if (index > 0) currentIH = null;
    } else if (fs !== null) {
      gl = currentIH !== null ? currentIH - fs : null;
      next.gl = fmt(gl);
    } else {
      // FSが消えたら、そのFSから求めた前回の計算結果も消す
      gl = null;
      next.gl = "";
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

// 数値セルは常に小数点3桁で表示する。ただし編集中のセルだけは
// 入力途中の値をそのまま見せる（打っている桁が見えなくなるため）。
function cellDisplay(row, field, rowIndex) {
  const raw = row[field] || "";
  if (field === "point") return raw;
  if (selected.row === rowIndex && selected.field === field) return buffer || raw;
  return raw === "" ? "" : fmtInput(raw) || raw;
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
      if (isUnusedCell(rowIndex, field)) td.classList.add("unused");
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
        td.textContent = cellDisplay(row, field, rowIndex);
      }
      td.addEventListener("click", () => selectCell(rowIndex, field));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
    if (closure && expandedClosureRows.has(rowIndex)) {
      const expandTr = document.createElement("tr");
      expandTr.className = "closure-expand-row";
      const expandTd = document.createElement("td");
      expandTd.colSpan = 5;
      expandTd.innerHTML = `既知 ${closure.ref.toFixed(3)}　測定 ${closure.measured.toFixed(3)}　誤差 <span class="closure-badge ${closureClass(closure.diff)}">${signedMm(closure.diff)}</span>`;
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
  updateConfirmUi();
  renderInfoPane();
  renderPointList();
  renderPointSuggestions();
  renderTableSelect();
  updateSavePointButton();
  updateRowHighlights();
}

function selectCell(row, field) {
  if (locked) return;
  if (field === "ih" || (field === "gl" && row > 0)) return;
  if (isUnusedCell(row, field)) return;
  // 1行目のGL・測点名は直接入力させず、基準点選択画面から決める。
  if (isBasePointCell(row, field)) {
    openBasePointSheet(0, !hasBasePoint(0));
    return;
  }
  if (row !== selected.row || field !== selected.field) {
    entryDirty = false;
    awaitingConfirm = false;
  }
  if (field === "fs" && !requireFirstBsBeforeFs()) return;
  // FSが空で基準行でもない行はGLが求まっていない。
  // そこにBSを入れてもIH(=GL+BS)を出せないので、先に基準高を決めてもらう。
  if (field === "bs" && row > 0 && !isBaseRow(row) && num(rows[row]?.fs) === null) {
    requestNewBaseGl(row, { ...selected });
    return;
  }
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
  entryDirty = false;
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

// 小数点以下の桁数（小数点が無ければ 0）
function decimalsOf(value) {
  const text = String(value ?? "");
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

// 受け付けられない入力を画面の点滅とブザー（＋振動）で知らせる。
function rejectInput() {
  buzz();
  const body = document.body;
  body.classList.remove("input-reject");
  void body.offsetWidth; // アニメーションを毎回やり直すためリフローさせる
  body.classList.add("input-reject");
  window.clearTimeout(rejectFlashTimer);
  rejectFlashTimer = window.setTimeout(() => body.classList.remove("input-reject"), 460);
}

function buzz() {
  if (navigator.vibrate) navigator.vibrate([90, 60, 90]);
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = 190;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    osc.start(t);
    osc.stop(t + 0.25);
  } catch (error) {
    /* 音を鳴らせない環境では点滅と振動だけで知らせる */
  }
}

function appendKey(key) {
  if (locked) return;
  if (selected.field === "point") return;
  if (isBasePointCell(selected.row, selected.field)) return;
  if (key === "." && buffer.includes(".")) { rejectInput(); return; }
  // 小数点以下は3桁まで。4桁目は受け付けない。
  if (key !== "." && decimalsOf(buffer) >= DECIMALS) { rejectInput(); return; }
  clickTone();
  markEntryStarted();
  // 先頭の0は次の数字で置き換える。ただし「0.」はそのまま残す。
  buffer = buffer === "0" && key !== "." ? key : `${buffer}${key}`;
  writeSelectedValue(buffer);
}

function toggleSign() {
  if (locked) return;
  if (selected.field === "point") return;
  if (isBasePointCell(selected.row, selected.field)) return;
  clickTone();
  markEntryStarted();
  if (!buffer) buffer = rows[selected.row]?.[selected.field] || "0";
  buffer = buffer.startsWith("-") ? buffer.slice(1) : `-${buffer}`;
  writeSelectedValue(buffer);
}

function backspace() {
  if (locked) return;
  if (isBasePointCell(selected.row, selected.field)) return;
  if (selected.field === "point") {
    const next = ($("#activePoint").value || "").slice(0, -1);
    $("#activePoint").value = next;
    commitPointName();
    return;
  }
  clickTone();
  markEntryStarted();
  buffer = buffer.slice(0, -1);
  writeSelectedValue(buffer);
}

function clearBuffer() {
  if (locked) return;
  if (isBasePointCell(selected.row, selected.field)) return;
  if (selected.field === "point") {
    if (!rows[selected.row]) rows[selected.row] = blankRow();
    rows[selected.row].point = "";
    $("#activePoint").value = "";
    buffer = "";
  } else {
    clickTone();
    entryDirty = false;
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
  selected = { row: 0, field: "bs" };
  buffer = "";
  syncBaseInputs();
  render();
  saveSoon();
  // 基準点も消えるので、決め直すまで先へ進ませない。
  ensureBasePoint();
}

// FS列に数値が入っている最下段の行番号を返す（1件も無ければ -1）。
// BS/FS ボタンはこの「すぐ一つ下の行」＝次に記入すべき行を選択する。
function lastFilledFsRow() {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (num(rows[i]?.fs) !== null) return i;
  }
  return -1;
}

function chooseBs() {
  if (locked || isBsKeyBlocked()) return;
  const origin = { ...selected };
  finalizeSelectedValue();
  // FS列から押したときは同じ行のBSへ。器高式では同一行のFSとBSが同じ移器点を指す。
  // それ以外はFS入力済み最下段のすぐ一つ下へ。
  const row = origin.field === "fs" ? origin.row : lastFilledFsRow() + 1;
  if (!rows[row]) rows[row] = blankRow();
  // BS列から押したときは、移動先で計算を始めるための基準高を選んでもらう
  if (origin.field === "bs" && !isBaseRow(row) && num(rows[row].fs) === null) {
    requestNewBaseGl(row, origin);
    return;
  }
  selected = { row, field: "bs" };
  buffer = rows[row].bs || "";
  awaitingConfirm = false;
  render();
  saveSoon();
}

function chooseFs() {
  if (locked || isAwaitingConfirm()) return;
  finalizeSelectedValue();
  if (!requireFirstBsBeforeFs()) return;
  // 0行目は基準点行でFSを持たないため、FSの選択は1行目以降に限る。
  const row = Math.max(lastFilledFsRow() + 1, 1);
  if (!rows[row]) rows[row] = blankRow();
  selected = { row, field: "fs" };
  buffer = rows[row].fs || "";
  awaitingConfirm = false;
  render();
  saveSoon();
}

function moveRow(delta) {
  finalizeSelectedValue();
  const nextRow = Math.max(0, Math.min(rows.length - 1, selected.row + delta));
  if (nextRow === selected.row) return;

  // FS列は「数値を入れた最下段のすぐ一つ下」までしか下がれない。
  // 空のまま、さらに下の行へ飛ばさない。
  if (selected.field === "fs" && delta > 0 && nextRow > Math.max(lastFilledFsRow() + 1, 1)) {
    rejectInput();
    return;
  }

  // FSが空の行のBSは、器高を計算する元になるGLが無い。
  // 新たに基準高を置いてもらい、選ばなければ元のセルに留まる。
  if (selected.field === "bs" && nextRow > 0
      && !isBaseRow(nextRow) && num(rows[nextRow]?.fs) === null) {
    requestNewBaseGl(nextRow, { ...selected });
    return;
  }

  selected = { row: nextRow, field: selected.field };
  if (selected.field === "gl" && nextRow > 0) selected.field = "fs";
  if (isBasePointCell(nextRow, selected.field)) selected.field = "bs";
  if (isUnusedCell(nextRow, selected.field)) selected.field = "bs";
  buffer = rows[selected.row]?.[selected.field] || "";
  awaitingConfirm = false;
  render();
}

function moveField(delta) {
  finalizeSelectedValue();
  const editableFields = selected.row === 0 ? ["bs"] : ["bs", "fs", "point"];
  const index = editableFields.indexOf(selected.field);
  const nextIndex = Math.max(0, Math.min(editableFields.length - 1, index + delta));
  const nextField = editableFields[nextIndex];
  if (nextField === "fs" && !requireFirstBsBeforeFs()) return;
  selected = { row: selected.row, field: nextField };
  buffer = rows[selected.row]?.[selected.field] || "";
  render();
}

// 打鍵の合図は遅延のない Web Audio の打鍵音だけ。
// 音声合成による読み上げは処理が遅れて連打に追いつかないため使わない。
function clickTone() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 2100;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    osc.start(t);
    osc.stop(t + 0.04);
  } catch (error) {
    /* 音を鳴らせない環境では無音のまま続行する */
  }
}

// ── 入力値の確認 ──
// 既定では、入力を始めると OK / 修正 が出て、OK を押すまで BS・FS を押せない。
// 「確認せず次へ」にチェックを入れると、この確認を挟まず BS・FS が押せる。

// 確認待ち＝BS・FSを押せない状態か
function isAwaitingConfirm() {
  return awaitingConfirm && !skipConfirm;
}

// 数値の入力が始まったことを記録する
function markEntryStarted() {
  entryDirty = true;
  if (!skipConfirm) awaitingConfirm = true;
}

function updateConfirmUi() {
  const panel = document.querySelector(".entry-panel");
  if (!panel) return;
  panel.classList.toggle("awaiting-confirm", isAwaitingConfirm());
  const skip = $("#skipConfirm");
  skip.classList.toggle("checked", skipConfirm);
  skip.setAttribute("aria-pressed", String(skipConfirm));
  $("#skipConfirmMark").textContent = skipConfirm ? "☑" : "☐";
  $("#modeBs").disabled = isBsKeyBlocked();
  $("#modeFs").disabled = isAwaitingConfirm();
}

// BSキーを押せない条件。どれも「GLが求まっていない＝BSを入れても
// IH(=GL+BS)を出せない」場面で、意味のない入力を防ぐためのもの。
function isBsKeyBlocked() {
  if (isAwaitingConfirm()) return true;
  // FS列に数値が1つも無い＝GLがどこにも無い
  if (selected.field === "bs") return lastFilledFsRow() < 0;
  // FS列にいて、その行のFSがまだ空＝この行のGLが決まっていない
  if (selected.field === "fs") return num(buffer || rows[selected.row]?.fs) === null;
  return false;
}

// OK: 値を確定して確認待ちを解除する（BS・FSが押せるようになる）
function confirmEntryOk() {
  if (locked) return;
  clickTone();
  finalizeSelectedValue();
  awaitingConfirm = false;
  render();
}

// 修正: 入力し直せるよう値を消す。確認待ちは続く。
function confirmEntryFix() {
  if (locked) return;
  clickTone();
  buffer = "";
  writeSelectedValue("");
}

// 「確認せず次へ」のチェックを切り替える
function toggleSkipConfirm() {
  clickTone();
  skipConfirm = !skipConfirm;
  if (skipConfirm) awaitingConfirm = false;
  render();
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
  $("#surveyTime").value = normalizeTimeInput(table?.time);
  $("#siteName").value = meta.site || "";
  $("#surveyPlace").value = table?.name || meta.place || "";
  updateSurveySummary();
}

function readMetaFromInputs() {
  meta.site = $("#siteName").value;
  const table = currentTable();
  if (table) {
    table.date = $("#surveyDate").value || todayString();
    table.time = normalizeTimeInput($("#surveyTime").value);
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
  const time = normalizeTimeInput(table?.time);
  const secondLine = table?.date
    ? `作成日：${formatSurveyDate(table.date)}${time ? ` ${time}` : ""}`
    : "";
  $("#surveySummary").innerHTML = [firstLine, secondLine].filter(Boolean).map(escapeHtml).join("<br>");
  updateClosureDisplay();
}

// 作成時刻は24時制の "HH:MM"。"H:MM" や "HHMM" も受け付けて整える。
// 空文字はそのまま空で返す（時刻の無い古い表を勝手に埋めないため）。
function nowTimeString() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function normalizeTimeInput(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{1,2}):?(\d{2})$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
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
    window.alert("作成日・現場名・作業名を入力してください。");
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
  rows[drawerTargetRow] = blankRow({ ...rows[drawerTargetRow], point: name, gl: value, isBase: true });
  if (drawerTargetRow === 0) syncBaseInputs();
  // 1行目のGLは編集できないので、選択は隣のBSに置く。
  selected = { row: drawerTargetRow, field: drawerTargetRow === 0 ? "bs" : "gl" };
  buffer = drawerTargetRow === 0 ? (rows[drawerTargetRow].bs || "") : value;
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

function registerSavedPoint(name, value) {
  const existing = savedPoints.find((point) => point.name === name);
  if (existing) {
    existing.value = value;
    return existing;
  }
  const point = { name, value };
  savedPoints.push(point);
  return point;
}

function saveCurrentPoint() {
  // 新規現場の初期設定では測定情報だけ確定させ、基準点は専用画面で入力させる。
  if (drawerMode === "setup") {
    finishSetupAndChooseBasePoint();
    return;
  }
  const name = $("#savedPointName").value.trim();
  const value = fmtInput($("#savedPointValue").value);
  if (!name || !value) return;
  readMetaFromInputs();
  const shouldCloseAfterSave = drawerMode !== "normal";
  registerSavedPoint(name, value);
  if (drawerMode === "base" && drawerTargetRow !== null && rows[drawerTargetRow]) {
    rows[drawerTargetRow] = blankRow({ ...rows[drawerTargetRow], point: name, gl: value, isBase: true });
    selected = { row: drawerTargetRow, field: drawerTargetRow === 0 ? "bs" : "gl" };
    buffer = drawerTargetRow === 0 ? (rows[drawerTargetRow].bs || "") : value;
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

// 測定情報の入力が終わった時点で初期設定を確定し、基準点の選択画面へ進む。
function finishSetupAndChooseBasePoint() {
  readMetaFromInputs();
  if (!$("#surveyDate").value || !$("#siteName").value.trim() || !$("#surveyPlace").value.trim()) return;
  rows = [blankRow()];
  tables = [{ name: meta.place || "表1", date: meta.date || todayString(), rows }];
  activeTableIndex = 0;
  selected = { row: 0, field: "bs" };
  buffer = "";
  setupComplete = true;
  drawerSaved = true;
  syncBaseInputs();
  render();
  saveSoon();
  closeDrawer();
  openBasePointSheet(0, true);
}

function recallPoint(point) {
  const row = ["base", "resume"].includes(drawerMode) && drawerTargetRow !== null ? drawerTargetRow : 0;
  if (!rows[row]) rows[row] = blankRow();
  rows[row] = blankRow({ ...rows[row], point: point.name, gl: point.value, isBase: true });
  if (row === 0) syncBaseInputs();
  selected = { row, field: drawerMode === "resume" ? "bs" : "gl" };
  buffer = drawerMode === "resume" ? (rows[row].bs || "") : point.value;
  drawerSaved = true;
  closeDrawer();
  render();
  saveSoon();
}

// ── 基準点の選択・追加画面 ─────────────────────────────────────────────────
// 新規現場の開始時と表の追加時に開く。基準点が無ければ追加させ、あれば選ばせる。
// required = true のときは基準点が決まるまで閉じられない。

// その行に基準点（測点名と標高）が入っているか
function hasBasePoint(row = 0) {
  const target = rows[row];
  return !!(target && target.point && num(target.gl) !== null);
}

// 1行目のGL・測点名は基準点から決めるセル。直接は編集させない。
function isBasePointCell(row, field) {
  return row === 0 && (field === "gl" || field === "point");
}

// 1行目のFSは計算に使わない（GLは基準点から入る）ので選択させない。
function isUnusedCell(row, field) {
  return row === 0 && field === "fs";
}

// 表に基準点が未設定なら、決まるまで先へ進ませない。
function ensureBasePoint() {
  if (locked) return;
  if (!$("#startupChoice").classList.contains("hidden")) return;
  if (!$("#basePointSheet").classList.contains("hidden")) return;
  if (hasBasePoint(0)) return;
  openBasePointSheet(0, true);
}

// FSが無い行のBSは、器高を計算する元になるGLが無い。
// その行へ移したうえで新しい基準高を求め、選ばれなければ元のセルへ戻す。
function requestNewBaseGl(row, originCell) {
  if (!rows[row]) rows[row] = blankRow();
  basePointSheetReturnTo = originCell;
  selected = { row, field: "bs" };
  buffer = rows[row].bs || "";
  render();
  openBasePointSheet(row, false);
}

function openBasePointSheet(row = 0, required = false) {
  basePointSheetTarget = row;
  basePointSheetRequired = required;
  $("#basePointNewName").value = "";
  $("#basePointNewValue").value = "";
  $("#basePointSheet").classList.toggle("required", required);
  updateBasePointAddButton();
  renderBasePointSheet();
  $("#basePointSheet").classList.remove("hidden");
  if (!savedPoints.length) window.setTimeout(() => $("#basePointNewName").focus(), 80);
}

function closeBasePointSheet() {
  if (basePointSheetRequired && !hasBasePoint(basePointSheetTarget ?? 0)) {
    window.alert(savedPoints.length
      ? "この表の基準点を選んでください。"
      : "基準点を1点以上登録し、この表の基準点を選んでください。");
    return;
  }
  // 基準高が決まらないまま閉じたら、呼び出し元のセルにフォーカスを戻す
  if (basePointSheetReturnTo && !hasBasePoint(basePointSheetTarget ?? 0)) {
    selected = basePointSheetReturnTo;
    buffer = rows[selected.row]?.[selected.field] || "";
    render();
  }
  basePointSheetReturnTo = null;
  basePointSheetRequired = false;
  $("#basePointSheet").classList.remove("required");
  $("#basePointSheet").classList.add("hidden");
  basePointSheetTarget = null;
}

function renderBasePointSheet() {
  const hint = $("#basePointSheetHint");
  const list = $("#basePointSheetList");
  if (!hint || !list) return;
  const suffix = basePointSheetRequired ? "設定するまで先へ進めません。" : "";
  hint.textContent = (savedPoints.length
    ? "この表の出発点にする基準点を選んでください。"
    : "基準点がまだ登録されていません。下の欄から追加してください（続けて何点でも登録できます）。") + suffix;
  list.innerHTML = "";
  savedPoints.forEach((point) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "point-picker-item";
    button.innerHTML = `<strong>${escapeHtml(point.name)}</strong><span>GL ${escapeHtml(point.value)}</span>`;
    button.addEventListener("click", () => applyBasePointSelection(point));
    list.appendChild(button);
  });
}

function updateBasePointAddButton() {
  const button = $("#basePointAdd");
  if (!button) return;
  const name = $("#basePointNewName")?.value.trim();
  const value = fmtInput($("#basePointNewValue")?.value || "");
  button.disabled = !name || !value;
}

function addBasePointFromSheet() {
  const name = $("#basePointNewName").value.trim();
  const value = fmtInput($("#basePointNewValue").value);
  if (!name || !value) return;
  registerSavedPoint(name, value);
  // 連続登録できるよう画面は閉じず、入力欄だけ空にする。
  $("#basePointNewName").value = "";
  $("#basePointNewValue").value = "";
  updateBasePointAddButton();
  renderBasePointSheet();
  renderPointList();
  renderPointSuggestions();
  saveSoon();
  $("#basePointNewName").focus();
}

function applyBasePointSelection(point) {
  const row = basePointSheetTarget ?? 0;
  if (!rows[row]) rows[row] = blankRow();
  rows[row] = blankRow({ ...rows[row], point: point.name, gl: point.value, isBase: true });
  closeBasePointSheet();
  if (row === 0) syncBaseInputs();
  selected = { row, field: "bs" };
  buffer = rows[row].bs || "";
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
  const button = $("#savePoint");
  if (!button) return;
  if (drawerMode === "setup") {
    // 初期設定では測定情報だけ求め、基準点は次の画面で入力させる。
    const hasMeta = $("#surveyDate").value && $("#siteName").value.trim() && $("#surveyPlace").value.trim();
    button.innerHTML = "次へ<br>基準点";
    button.disabled = !hasMeta;
    return;
  }
  button.innerHTML = "基準点<br>追加";
  const name = $("#savedPointName")?.value.trim();
  const value = fmtInput($("#savedPointValue")?.value || "");
  button.disabled = !name || !value;
}

function toggleLock() {
  locked = !locked;
  updateLockButton();
  render();
  // 保護を解除して編集に入る時点で、基準点が未設定なら決めてもらう。
  // （保護中は ensureBasePoint() が何もしないため、ここで拾う）
  if (!locked) ensureBasePoint();
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
    selected = { row: 0, field: "bs" };
    buffer = rows[0]?.bs || "";
    render();
  });
  $("#activePoint").addEventListener("input", commitPointName);
  $("#modeBs").addEventListener("click", chooseBs);
  $("#modeFs").addEventListener("click", chooseFs);
  $("#prevRow").addEventListener("click", () => moveRow(-1));
  $("#nextRow").addEventListener("click", () => moveRow(1));
  $("#skipConfirm").addEventListener("click", toggleSkipConfirm);
  $("#confirmOk").addEventListener("click", confirmEntryOk);
  $("#confirmFix").addEventListener("click", confirmEntryFix);
  $("#allClearButton").addEventListener("click", () => showConfirmModal(
    "入力内容を消去",
    "BS・FS・GL・測点名をすべて消去してよいですか？",
    clearAllRows
  ));
  $("#exportExcel").addEventListener("click", exportExcel);
  $("#pointPickerClose").addEventListener("click", closePointPicker);
  $("#pointPickerCancel").addEventListener("click", closePointPicker);
  $("#pointPickerConfirm").addEventListener("click", () => confirmPointPicker());
  $("#pointPickerInput").addEventListener("input", (e) => {
    renderPointPickerList(e.target.value);
    updatePickerRegisterButton();
  });
  $("#pointPickerRegister").addEventListener("click", registerPickerPointAsBase);
  $("#pointPicker").addEventListener("click", (e) => { if (e.target === e.currentTarget) closePointPicker(); });
  $("#basePointSheetClose").addEventListener("click", closeBasePointSheet);
  $("#basePointSheetCancel").addEventListener("click", closeBasePointSheet);
  $("#basePointSheet").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeBasePointSheet(); });
  $("#basePointAdd").addEventListener("click", addBasePointFromSheet);
  $("#basePointNewName").addEventListener("input", updateBasePointAddButton);
  $("#basePointNewValue").addEventListener("input", updateBasePointAddButton);
  $("#basePointNewValue").addEventListener("keydown", (event) => {
    if (event.key === "Enter") addBasePointFromSheet();
  });
  $("#errorModalClose").addEventListener("click", closeErrorModal);
  $("#errorModal").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeErrorModal(); });
  $("#errorModalCsv").addEventListener("click", exportErrorCsv);
  $("#errorModalExcel").addEventListener("click", exportErrorExcel);
  $("#importCsv").addEventListener("click", () => {
    startupImport = drawerMode === "setup";
    $("#csvFile").click();
  });
  $("#tableSelect").addEventListener("change", (event) => switchTable(Number(event.target.value)));
  $("#renameTable").addEventListener("click", renameTable);
  $("#deleteTable").addEventListener("click", deleteTable);
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
    selected = { row: 0, field: "bs" };
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

// ── XLSX (OOXML) 出力 ──────────────────────────────────────────────────────
// スマホのExcelはSpreadsheetML(.xls)を開けず、PCでは拡張子不一致の警告が出るため、
// 依存ライブラリなしで実体のある .xlsx (ZIP + OOXML) を組み立てる。
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLSX_STYLE = { normal: 0, header: 1, num: 2, input: 3, text: 4 };

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// 無圧縮(store)のZIPを組み立てる。Excel・Numbers・Googleスプレッドシートいずれも読める。
function zipStore(entries) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  entries.forEach(({ name, bytes }) => {
    const nameBytes = encoder.encode(name);
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + nameBytes.length + bytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0x0021, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, bytes.length, true);
    localView.setUint32(22, bytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(bytes, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0x0021, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, bytes.length, true);
    centralView.setUint32(24, bytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  });

  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  locals.forEach((part) => { out.set(part, cursor); cursor += part.length; });
  centrals.forEach((part) => { out.set(part, cursor); cursor += part.length; });
  out.set(end, cursor);
  return out;
}

function columnLetter(index) {
  return String.fromCharCode(65 + index);
}

function xlsxBlank(style = "normal") {
  return { kind: "blank", style };
}

function xlsxText(value, style = "text") {
  return { kind: "text", value: String(value ?? ""), style };
}

function xlsxNumber(value, style = "num") {
  const parsed = num(value);
  return parsed === null ? xlsxBlank(style) : { kind: "number", value: parsed, style };
}

function xlsxInteger(value, style = "normal") {
  return Number.isFinite(value) ? { kind: "integer", value, style } : xlsxBlank(style);
}

function xlsxFormula(formula, value, style = "num") {
  return { kind: "formula", formula, value: num(value), style };
}

function xlsxCellXml(cell, ref) {
  const style = XLSX_STYLE[cell.style] ?? 0;
  if (cell.kind === "text") {
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(cell.value)}</t></is></c>`;
  }
  if (cell.kind === "number") {
    return `<c r="${ref}" s="${style}"><v>${cell.value.toFixed(3)}</v></c>`;
  }
  if (cell.kind === "integer") {
    return `<c r="${ref}" s="${style}"><v>${cell.value}</v></c>`;
  }
  if (cell.kind === "formula") {
    // 計算済みの値もキャッシュしておく。読込時はこの値を使い、Excel は fullCalcOnLoad で再計算する。
    const cached = cell.value === null ? "" : `<v>${cell.value.toFixed(3)}</v>`;
    return `<c r="${ref}" s="${style}"><f>${xmlText(cell.formula)}</f>${cached}</c>`;
  }
  return `<c r="${ref}" s="${style}"/>`;
}

function xlsxSheetXml(sheetRows) {
  const body = sheetRows.map((cells, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cellsXml = cells
      .map((cell, columnIndex) => xlsxCellXml(cell, `${columnLetter(columnIndex)}${rowNumber}`))
      .join("");
    return `<row r="${rowNumber}">${cellsXml}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="4" width="11" customWidth="1"/><col min="5" max="5" width="20" customWidth="1"/></cols><sheetData>${body}</sheetData></worksheet>`;
}

function xlsxStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.000"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Yu Gothic"/></font><font><b/><sz val="11"/><name val="Yu Gothic"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9D8BD"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFBC4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function xlsxPackage(sheets) {
  const encoder = new TextEncoder();
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xmlAttr(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets><calcPr calcId="0" fullCalcOnLoad="1"/></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const entries = [
    { name: "[Content_Types].xml", bytes: encoder.encode(contentTypes) },
    { name: "_rels/.rels", bytes: encoder.encode(rootRels) },
    { name: "xl/workbook.xml", bytes: encoder.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", bytes: encoder.encode(workbookRels) },
    { name: "xl/styles.xml", bytes: encoder.encode(xlsxStylesXml()) },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      bytes: encoder.encode(xlsxSheetXml(sheet.rows))
    }))
  ];
  return zipStore(entries);
}

function excelFilename() {
  const site = sanitizeFilename(meta.site || "現場名未入力");
  return `${site}.xlsx`;
}

function exportExcel() {
  finalizeSelectedValue();
  calculate();
  readMetaFromInputs();
  if (!meta.date) meta.date = todayString();
  syncMetaToInputs();
  syncActiveTable();
  download(excelFilename(), new Blob([buildXlsxWorkbook()], { type: XLSX_MIME }), XLSX_MIME);
}

function buildXlsxWorkbook() {
  const closureData = computeClosureAll();
  const usedNames = new Set(["基本情報", "誤差一覧"]);
  const sheets = [
    { name: "基本情報", rows: basicSheetRows() },
    ...tables.map((table, index) => ({
      name: uniqueSheetName(tableSheetTitle(table, index), usedNames),
      rows: tableSheetRows(table)
    })),
    ...(closureData.length ? [{ name: "誤差一覧", rows: closureSheetRows(closureData) }] : [])
  ];
  return xlsxPackage(sheets);
}

function basicSheetRows() {
  return [
    [xlsxText("LEVEL_APP"), xlsxText("4")],
    [xlsxText("TITLE"), xlsxText(meta.title || "")],
    [xlsxText("SITE"), xlsxText(meta.site || "")],
    [xlsxText("DATE"), xlsxText(meta.date || "")],
    [xlsxText("PLACE"), xlsxText(meta.place || "")],
    [],
    [xlsxText("POINTS")],
    [xlsxText("測点名", "header"), xlsxText("数値", "header")],
    ...savedPoints.map((point) => [xlsxText(point.name), xlsxNumber(point.value)])
  ];
}

function tableSheetRows(table) {
  return [
    ["BS", "IH", "FS", "GL", "測点名"].map((label) => xlsxText(label, "header")),
    ...xlsxRowsForRows(table.rows || [blankRow()])
  ];
}

function closureSheetRows(data) {
  return [
    ["測点名", "既知GL", "測定GL", "誤差(mm)"].map((label) => xlsxText(label, "header")),
    ...data.map(({ point, ref, measured, diff }) => [
      xlsxText(point),
      xlsxNumber(ref),
      xlsxNumber(measured),
      xlsxInteger(Math.round(diff * 1000))
    ])
  ];
}

function tableSheetTitle(table, index) {
  const date = table?.date ? formatSurveyDate(table.date) : "日付未設定";
  const time = normalizeTimeInput(table?.time).replace(":", "");
  const name = table?.name || `表${index + 1}`;
  return `${date}_${time ? `${time}_` : ""}${name}`;
}

function xlsxRowsForRows(sourceRows) {
  const usefulRows = sourceRows.filter((row, index) => index === 0 || row.bs || row.fs || row.gl || row.point);
  const rowCount = Math.max(usefulRows.length + EXCEL_EXTRA_ROWS, EXCEL_EXTRA_ROWS + 1);
  return Array.from({ length: rowCount }, (_, index) => xlsxMeasurementRow(usefulRows[index] || blankRow(), index));
}

// 見出しが1行目のため、データ index 0 は Excel の 2 行目に載る。
// 列は A=BS / B=IH / C=FS / D=GL / E=測点名。
function xlsxMeasurementRow(row, index) {
  const line = index + 2;
  const ihFormula = index === 0
    ? `IF(A${line}="","",D${line}+A${line})`
    : `IF(ISNUMBER(A${line}),A${line}+D${line},IF(AND(ISNUMBER(B${line - 1}),ISNUMBER(C${line + 1})),B${line - 1},""))`;
  const glFormula = `IF(ISNUMBER(C${line}),B${line - 1}-C${line},"")`;
  return [
    xlsxNumber(row.bs, "input"),
    xlsxFormula(ihFormula, row.ih),
    xlsxNumber(row.fs, "input"),
    index > 0 ? xlsxFormula(glFormula, row.gl) : xlsxNumber(row.gl),
    xlsxText(row.point || "")
  ];
}

function uniqueSheetName(name, usedNames) {
  const base = sanitizeSheetName(name || "表");
  let candidate = base.slice(0, 31);
  if (!usedNames.has(candidate)) {
    usedNames.add(candidate);
    return candidate;
  }
  for (let i = 2; ; i += 1) {
    const suffix = `_${i}`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
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
  reader.addEventListener("load", async () => {
    const bytes = new Uint8Array(reader.result || new ArrayBuffer(0));
    try {
      // xlsx は ZIP なので先頭が "PK"。旧形式(.xls の SpreadsheetML)と CSV はテキストとして扱う。
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        applyImportedWorkbook(await parseXlsx(bytes, file.name));
      } else {
        const text = new TextDecoder("utf-8").decode(bytes);
        if (looksLikeExcelXml(text)) {
          applyImportedWorkbook(parseExcelXml(text, file.name));
        } else {
          applyImportedCsv(parseCsv(text), file.name);
        }
      }
    } catch (error) {
      window.alert(`ファイルを読み込めませんでした。\n${error?.message || error}`);
      startupImport = false;
      return;
    }
    $("#startupChoice").classList.add("hidden");
    startupImport = false;
  });
  reader.readAsArrayBuffer(file);
}

// ── xlsx 読込 ─────────────────────────────────────────────────────────────
async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const limit = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= limit; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("xlsxとして読み取れませんでした");
  const count = view.getUint16(eocd + 10, true);
  const decoder = new TextDecoder("utf-8");
  const files = new Map();
  let pointer = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error("xlsxの索引が壊れています");
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    files.set(name, { method, raw: bytes.subarray(dataStart, dataStart + compressedSize) });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

async function zipEntryText(files, name) {
  const entry = files.get(name);
  if (!entry) return "";
  if (entry.method === 0) return new TextDecoder("utf-8").decode(entry.raw);
  if (entry.method !== 8) throw new Error("未対応の圧縮形式のxlsxです");
  if (typeof DecompressionStream !== "function") {
    throw new Error("このブラウザでは圧縮されたxlsxを開けません。CSVで読み込んでください。");
  }
  const stream = new Blob([entry.raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

function columnIndexFromRef(ref) {
  const letters = String(ref || "").match(/^[A-Z]+/)?.[0];
  if (!letters) return -1;
  return [...letters].reduce((total, char) => total * 26 + (char.charCodeAt(0) - 64), 0) - 1;
}

function xlsxSheetGrid(xml, sharedStrings) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const grid = [];
  Array.from(doc.getElementsByTagName("row")).forEach((rowEl, order) => {
    const rowNumber = Number(rowEl.getAttribute("r") || order + 1);
    const values = [];
    Array.from(rowEl.getElementsByTagName("c")).forEach((cell) => {
      const type = cell.getAttribute("t") || "n";
      let text = "";
      if (type === "inlineStr") {
        text = Array.from(cell.getElementsByTagName("t")).map((node) => node.textContent).join("");
      } else if (type === "s") {
        const index = Number(cell.getElementsByTagName("v")[0]?.textContent ?? -1);
        text = sharedStrings[index] ?? "";
      } else {
        text = cell.getElementsByTagName("v")[0]?.textContent || "";
      }
      const columnIndex = columnIndexFromRef(cell.getAttribute("r"));
      if (columnIndex < 0) {
        values.push(text);
        return;
      }
      while (values.length < columnIndex) values.push("");
      values[columnIndex] = text;
    });
    while (grid.length < rowNumber - 1) grid.push([]);
    grid[rowNumber - 1] = values;
  });
  return grid;
}

async function parseXlsx(bytes, filename) {
  const files = await unzip(bytes);
  const sharedStrings = [];
  const sharedXml = await zipEntryText(files, "xl/sharedStrings.xml");
  if (sharedXml) {
    const sharedDoc = new DOMParser().parseFromString(sharedXml, "application/xml");
    Array.from(sharedDoc.getElementsByTagName("si")).forEach((si) => {
      sharedStrings.push(Array.from(si.getElementsByTagName("t")).map((node) => node.textContent).join(""));
    });
  }

  const relsXml = await zipEntryText(files, "xl/_rels/workbook.xml.rels");
  const relsDoc = new DOMParser().parseFromString(relsXml, "application/xml");
  const targets = new Map();
  Array.from(relsDoc.getElementsByTagName("Relationship")).forEach((rel) => {
    targets.set(rel.getAttribute("Id"), String(rel.getAttribute("Target") || "").replace(/^\/?xl\//, ""));
  });

  const workbookXml = await zipEntryText(files, "xl/workbook.xml");
  const workbookDoc = new DOMParser().parseFromString(workbookXml, "application/xml");
  const sheetEls = Array.from(workbookDoc.getElementsByTagName("sheet"));

  const workbook = { meta: { title: filename, site: "", date: "", place: "" }, points: [], tables: [] };
  for (let index = 0; index < sheetEls.length; index += 1) {
    const sheetEl = sheetEls[index];
    const sheetName = sheetEl.getAttribute("name") || `表${index}`;
    const relId = sheetEl.getAttribute("r:id") || sheetEl.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const target = targets.get(relId) || `worksheets/sheet${index + 1}.xml`;
    const sheetXml = await zipEntryText(files, `xl/${target}`);
    if (!sheetXml) continue;
    const values = xlsxSheetGrid(sheetXml, sharedStrings);
    if (index === 0 || sheetName === "基本情報") {
      readExcelBasicSheet(values, workbook, filename);
      continue;
    }
    if (sheetName === "誤差一覧") continue;
    const tableMeta = tableMetaFromSheetName(sheetName, workbook.meta.date);
    const dataRows = values.slice(1).map((line) => blankRow({
      bs: cleanCsvNumber(line[0]),
      ih: cleanCsvNumber(line[1]),
      fs: cleanCsvNumber(line[2]),
      gl: cleanCsvNumber(line[3]),
      point: line[4] || ""
    })).filter(rowHasWork);
    workbook.tables.push({ name: tableMeta.name, date: tableMeta.date, time: tableMeta.time || "", rows: normalizeImportedRows(dataRows) });
  }
  return workbook;
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
  selected = { row: 0, field: "bs" };
  buffer = rows[0]?.bs || "";
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
    if (sheetName === "誤差一覧") return;
    const tableMeta = tableMetaFromSheetName(sheetName, workbook.meta.date);
    const dataRows = values.slice(1).map((line) => blankRow({
      bs: cleanCsvNumber(line[0]),
      ih: cleanCsvNumber(line[1]),
      fs: cleanCsvNumber(line[2]),
      gl: cleanCsvNumber(line[3]),
      point: line[4] || ""
    })).filter(rowHasWork);
    workbook.tables.push({ name: tableMeta.name, date: tableMeta.date, time: tableMeta.time || "", rows: normalizeImportedRows(dataRows) });
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
  const text = String(sheetName || "");
  // 新形式 YYYY.MM.DD_HHMM_名前
  const withTime = text.match(/^(\d{4})[.\-](\d{2})[.\-](\d{2})_(\d{2})(\d{2})_(.+)$/);
  if (withTime) {
    return {
      date: `${withTime[1]}-${withTime[2]}-${withTime[3]}`,
      time: normalizeTimeInput(`${withTime[4]}:${withTime[5]}`),
      name: withTime[6] || "表1"
    };
  }
  // 旧形式 YYYY.MM.DD_名前
  const match = text.match(/^(\d{4})[.\-](\d{2})[.\-](\d{2})_(.+)$/);
  if (!match) return { date: fallbackDate || todayString(), time: "", name: text || "表1" };
  return { date: `${match[1]}-${match[2]}-${match[3]}`, time: "", name: match[4] || "表1" };
}
function applyImportedCsv(table, filename) {
  const nextMeta = { title: filename, date: "", site: "", place: "" };
  const nextPoints = [];
  const nextTables = [];
  let section = "";
  let currentRows = null;
  let currentTableName = "";
  let currentTableDate = "";
  let currentTableTime = "";

  function pushCurrentTable() {
    if (!currentRows) return;
    const normalizedRows = normalizeImportedRows(currentRows);
    if (normalizedRows.length) {
      nextTables.push({ name: currentTableName || `表${nextTables.length + 1}`, date: currentTableDate || nextMeta.date || todayString(), time: currentTableTime, rows: normalizedRows });
    }
    currentRows = null;
    currentTableName = "";
    currentTableDate = "";
    currentTableTime = "";
  }

  table.forEach((line) => {
    const tag = stripBom(line[0] || "").trim();
    const isEmptyLine = line.every((cell) => String(cell || "").trim() === "");
    if (isEmptyLine) return;

    if (tag === "TABLE") {
      pushCurrentTable();
      currentTableName = line[1] || `表${nextTables.length + 1}`;
      currentTableDate = normalizeDateInput(line[2] || nextMeta.date || todayString());
      currentTableTime = normalizeTimeInput(line[3]);
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
  selected = { row: 0, field: "bs" };
  buffer = rows[0]?.bs || "";
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
    // FSが無いのにGLが入っている行は、基準高を置き直した行とみなす
    if (index > 0 && fs === null && gl !== null) next.isBase = true;
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
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  // iOS/Android のブラウザは document に無いリンクのクリックを無視することがある。
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // 保存処理が走り切る前に revoke するとスマホでファイルが壊れるため遅らせる。
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ── Closure difference (閉合差) ────────────────────────────────────────────
// 誤差は現場で読みやすいよう mm 単位・符号付きで統一して表示する。
function signedMm(diff) {
  const mm = Math.round(diff * 1000);
  return `${mm >= 0 ? "+" : "-"}${Math.abs(mm)} mm`;
}

function closureClass(diff) {
  const absDiff = Math.abs(diff);
  if (absDiff >= 0.01) return "error";
  if (absDiff >= 0.005) return "warn";
  return "ok";
}

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

// ── 情報パネル（横向きの右カラム） ──
// 作業中に見えていて役に立つものだけを出す。誤操作を避けるため表示専用。
function renderInfoPane() {
  renderInfoClosure();
  renderInfoPoints();
  renderInfoStatus();
}

function renderInfoClosure() {
  const list = $("#infoClosure");
  if (!list) return;
  const results = computeClosureAll();
  if (!results.length) {
    list.innerHTML = `<p class="info-empty">既知点と同名の測点がまだありません</p>`;
    return;
  }
  list.innerHTML = results.map((item) => `
    <div class="info-row">
      <strong>${escapeHtml(item.point)}</strong>
      <span class="info-diff ${closureClass(item.diff)}">${escapeHtml(signedMm(item.diff))}</span>
      <span>既知 ${item.ref.toFixed(3)}　実測 ${item.measured.toFixed(3)}</span>
    </div>`).join("");
}

function renderInfoPoints() {
  const list = $("#infoPoints");
  if (!list) return;
  if (!savedPoints.length) {
    list.innerHTML = `<p class="info-empty">基準点が登録されていません</p>`;
    return;
  }
  list.innerHTML = savedPoints.map((point) => `
    <div class="info-row">
      <strong>${escapeHtml(point.name)}</strong>
      <span>GL ${escapeHtml(point.value)}</span>
    </div>`).join("");
}

function renderInfoStatus() {
  const box = $("#infoStatus");
  if (!box) return;
  // いま基準にしている行＝最後に基準高を置いた行
  let baseIndex = 0;
  rows.forEach((row, index) => { if (index === 0 || row.isBase) baseIndex = index; });
  const base = rows[baseIndex];
  const lastIh = [...rows].reverse().find((row) => num(row.ih) !== null);
  const lastGl = [...rows].reverse().find((row) => num(row.gl) !== null);
  const line = (label, value) => `<div><span>${label}</span><b>${escapeHtml(value)}</b></div>`;
  box.innerHTML = [
    line("基準点", base?.point ? `${base.point}　GL ${base.gl || "-"}` : "未設定"),
    line("器高 IH", lastIh?.ih || "-"),
    line("最新 GL", lastGl?.gl || "-"),
    line("記入行数", String(rows.filter(rowHasWork).length))
  ].join("");
}

function updateClosureDisplay() {
  const results = computeClosureAll();
  const summary = $("#surveySummary");
  if (!results.length || !summary) return;

  const worst = results.reduce((a, b) => Math.abs(b.diff) > Math.abs(a.diff) ? b : a);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "closure-trigger";
  btn.innerHTML = `既知点との誤差　<span class="closure-badge ${closureClass(worst.diff)}">${signedMm(worst.diff)}</span>`;
  btn.addEventListener("click", openErrorModal);
  summary.appendChild(btn);
}

// ── Point name picker ──────────────────────────────────────────────────────
function openPointPicker(row) {
  pickerTargetRow = row;
  $("#pointPickerInput").value = rows[row]?.point || "";
  renderPointPickerList("");
  updatePickerRegisterButton();
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
  // 今回の測定値。登録済み基準点との誤差をその場で見せるために使う。
  const measured = num(rows[pickerTargetRow]?.gl);
  const q = String(query || "").toLowerCase();
  const filtered = savedPoints.filter((p) => !q || p.name.toLowerCase().includes(q));
  if (!filtered.length) {
    const msg = document.createElement("p");
    msg.textContent = savedPoints.length ? "一致する測点なし" : "登録済み基準点なし";
    list.appendChild(msg);
    return;
  }
  filtered.forEach((point) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "point-picker-item";
    const ref = num(point.value);
    const diff = measured !== null && ref !== null ? measured - ref : null;
    const badge = diff === null
      ? ""
      : `<span class="closure-badge ${closureClass(diff)}">${signedMm(diff)}</span>`;
    btn.innerHTML = `<strong>${escapeHtml(point.name)}</strong><span>既知 ${escapeHtml(point.value)}</span>${badge}`;
    btn.addEventListener("click", () => confirmPointPicker(point.name));
    list.appendChild(btn);
  });
}

function updatePickerRegisterButton() {
  const button = $("#pointPickerRegister");
  if (!button) return;
  const name = $("#pointPickerInput")?.value.trim();
  const value = fmtInput(rows[pickerTargetRow]?.gl || "");
  const known = savedPoints.some((point) => point.name === name);
  button.textContent = known ? "基準点を更新して確定" : "基準点に登録して確定";
  button.disabled = !name || !value;
}

// 測定結果に付けた測点名を、その測定値ごと基準点一覧へ登録する。
function registerPickerPointAsBase() {
  const row = pickerTargetRow;
  if (row === null) return;
  const name = $("#pointPickerInput").value.trim();
  const value = fmtInput(rows[row]?.gl || "");
  if (!name || !value) return;
  registerSavedPoint(name, value);
  confirmPointPicker(name);
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
  // 登録済み基準点を選んだときは誤差をすぐ確認できるよう開いておく。
  if (savedPoints.some((point) => point.name === n)) expandedClosureRows.add(row);
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
    const rowsHtml = results.map(({ point, ref, measured, diff }) => `<tr>
        <td>${escapeHtml(point)}</td>
        <td>${ref.toFixed(3)}</td>
        <td>${measured.toFixed(3)}</td>
        <td><span class="closure-badge ${closureClass(diff)}">${signedMm(diff)}</span></td>
      </tr>`).join("");
    body.innerHTML = `<table class="error-table">
      <thead><tr><th>測点名</th><th>既知GL</th><th>測定GL</th><th>誤差(mm)</th></tr></thead>
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
  const header = "測点名,既知GL,測定GL,誤差(mm)\n";
  const body = results.map(({ point, ref, measured, diff }) => {
    const mm = Math.round(diff * 1000);
    return `${point},${ref.toFixed(3)},${measured.toFixed(3)},${mm >= 0 ? "+" : "-"}${Math.abs(mm)}`;
  }).join("\n");
  const site = sanitizeFilename(meta.site || "現場名未入力");
  download(`${site}_誤差一覧.csv`, `﻿${header}${body}`, "text/csv;charset=utf-8");
}

function exportErrorExcel() {
  const results = computeClosureAll();
  if (!results.length) return;
  const workbook = xlsxPackage([{ name: "誤差一覧", rows: closureSheetRows(results) }]);
  const site = sanitizeFilename(meta.site || "現場名未入力");
  download(`${site}_誤差一覧.xlsx`, new Blob([workbook], { type: XLSX_MIME }), XLSX_MIME);
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

// ── 画面サイズへの追従 ──
// 420px 幅の1画面として設計してあるので、タブレットなど広い端末では
// 全体を拡大したうえで、余った幅も使い切って表示幅いっぱいに広げる。
const UI_BASE_WIDTH = 420;        // 設計上の横幅
const UI_PANEL_MAX_RATIO = 0.5;   // 入力パネルが画面高さに占めてよい割合（縦向き）
const UI_MAX_SCALE = 2.4;         // 拡大しすぎないための上限
const UI_MAX_CONTENT_WIDTH = 900; // 横に間延びさせないための上限（縦向き）
const UI_LAND_TABLE_MIN = 300;    // 横向きで表に最低限残したい高さ
const UI_LAND_BASE_WIDTH = 980;   // 横向きで2段組みが窮屈にならない最低幅

// 横向き2段組みのレイアウトが効いているか（styles.css のメディアクエリと同条件）
function isLandscapeLayout() {
  return window.innerWidth > window.innerHeight && window.innerWidth >= 900;
}

let lastUiViewport = "";

function applyUiScale() {
  // zoom を変えると html の高さも変わって ResizeObserver が再発火するため、
  // 実際に表示領域が変わったときだけ測り直す。
  const viewport = `${window.innerWidth}x${window.innerHeight}`;
  if (viewport === lastUiViewport) return;
  lastUiViewport = viewport;

  const root = document.documentElement.style;
  // 等倍・基準幅に戻して、入力パネルの素の高さを測る
  document.body.style.zoom = "";
  root.setProperty("--app-max-width", `${UI_BASE_WIDTH}px`);
  const panel = document.querySelector(".entry-panel");
  const panelHeight = panel ? panel.getBoundingClientRect().height : UI_BASE_WIDTH;

  // 横向きはテンキーを右下に置くので、テンキーの高さに加えて
  // 表の高さも残せるところで頭打ちにする（拡大しすぎると表の行数が減る）。
  // 縦向きは入力パネルが画面の半分を超えないところで頭打ちにする。
  const fit = isLandscapeLayout()
    ? Math.min(
        window.innerHeight / (panelHeight + UI_LAND_TABLE_MIN),
        window.innerWidth / UI_LAND_BASE_WIDTH,
        UI_MAX_SCALE
      )
    : Math.min(
        window.innerWidth / UI_BASE_WIDTH,
        (window.innerHeight * UI_PANEL_MAX_RATIO) / panelHeight,
        UI_MAX_SCALE
      );
  const scale = fit > 1.02 ? fit : 1;
  document.body.style.zoom = scale === 1 ? "" : String(scale);

  // zoom は vh / vw に効かないので、拡大後の実寸を変数として配り直す。
  // 縦向きで高さに頭打ちされて幅が余ったぶんは、表と入力パネルを広げるのに使う。
  const cssWidth = window.innerWidth / scale;
  const contentWidth = isLandscapeLayout()
    ? cssWidth
    : Math.min(Math.max(UI_BASE_WIDTH, cssWidth), UI_MAX_CONTENT_WIDTH);
  root.setProperty("--app-max-width", `${contentWidth}px`);
  root.setProperty("--app-vh", `${window.innerHeight / scale}px`);
  root.setProperty("--app-vw", `${cssWidth}px`);
}

// 回転・分割表示・ソフトキーボードなどで寸法が変わるたびに測り直す。
// resize イベントが飛ばない環境もあるので ResizeObserver も併用する。
let uiScaleFrame = 0;
function scheduleUiScale() {
  if (uiScaleFrame) return;
  uiScaleFrame = window.requestAnimationFrame(() => {
    uiScaleFrame = 0;
    applyUiScale();
  });
}

load();
bind();
applyUiScale();
window.addEventListener("resize", scheduleUiScale);
window.addEventListener("orientationchange", scheduleUiScale);
if ("ResizeObserver" in window) {
  new ResizeObserver(scheduleUiScale).observe(document.documentElement);
}
bindInlineModal();
buffer = rows[0]?.bs || "";
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










