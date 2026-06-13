# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**レベル野帳** (Level Field Notebook) is a Japanese surveying/leveling PWA for mobile field use. It records and calculates leveling survey measurements using a traditional Japanese field notebook format. There are no external dependencies — the entire app is vanilla JavaScript, HTML, and CSS served as static files.

## Running the App

There is no build step. Serve files directly:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

There are no tests, no linter, and no package manager. Changes are verified by loading the app in a browser.

## Architecture

All application logic lives in a single file: **`app.js`** (~1,850 lines). It is organized into functional groups rather than modules or classes.

### State Model

The global state consists of:
- `rows[]` — current table's measurement rows (`{bs, ih, fs, gl, point}`)
- `tables[]` — array of named survey tables, each with its own `rows[]` and `locked` flag
- `savedPoints[]` — named reference/benchmark points with known elevations
- `meta{}` — survey metadata (date, site, place, title)
- `selected{}` — currently focused `{row, field}` cell
- `buffer` — live number input string being typed

### Persistence

Four `localStorage` keys:
- `levelBook.image2.v1` — legacy rows (single-table format, kept for backward compat)
- `levelBook.tables.v1` — multi-table data (current format)
- `levelBook.savedPoints.v1` — known reference points
- `levelBook.meta.v1` — survey metadata

On load, `ensureTables()` migrates legacy single-table data into the `tables` format. Saves are debounced 120ms via `saveSoon()`.

### Calculation Flow

`calculate(rows)` is a pure function. For each row:
1. If a `bs` value exists, compute `IH = previous_GL + bs`
2. `GL = IH - fs`
3. Closure error is computed by `closureForRow(row, ih)` — compares `GL` to a saved point with matching name, shown inline as a color-coded badge (ok <5mm, warn <10mm, error ≥10mm)

### Rendering Pipeline

All UI updates flow through `render()`, which rebuilds the measurement table DOM from `rows[]`. `selectCell(row, field)` updates `selected` then calls `render()` + `updateReadout()`. There is no virtual DOM — the table is rebuilt on every state change.

### Input System

Two input paths feed the same `buffer`:
- **On-screen numeric keypad** — calls `appendKey()`, `backspace()`, `toggleSign()`, `clearBuffer()`
- **Physical keyboard** — handled in `handlePhysicalKeyboard()` (lines ~542–609), which maps arrow keys, Enter, Tab, digits, and shortcuts like `b`/`f`/`s`/`g` to field navigation

Committing a value calls `commitBuffer()`, which writes `buffer` into `rows[selected.row][selected.field]`, then recalculates and re-renders.

### Drawer / Sidebar

A left-side drawer (`#drawer`) has four modes controlled by the `drawerMode` variable:
- `"normal"` — point list and basic operations
- `"setup"` — survey metadata editing
- `"register"` — save a new known point
- `"base"` — set baseline/starting elevation

Swipe gestures (touch) open/close the drawer via `bindDrawerSwipe()`.

### Multiple Tables

Tables are managed via `switchTable()`, `addTable()`, `renameTable()`, `deleteTable()`. The active table index is `currentTableIndex`. Each table can be locked (`table.locked = true`) to prevent edits.

### Import / Export

- **Excel export** (`exportExcel()`): generates an XLSX-compatible XML workbook in-browser, one sheet per table plus a closure comparison sheet
- **CSV export** (`exportCsv()`): plain comma-separated
- **Import** (`importCsv()`, `parseExcelXml()`): reads file input, parses CSV or Excel XML, creates new tables from the data

## Conventions

**DOM shorthand:** `$()` wraps `document.querySelector()`. Used throughout for element lookups.

**Event handling:** All interactions use `addEventListener`. Buttons use `data-action` or `data-key` attributes read in delegated handlers.

**Field names:** Always the 5-element array `["bs", "ih", "fs", "gl", "point"]`. `ih` is derived/calculated, not directly editable by the user (it updates automatically).

**Storage versioning:** Keys end in `.v1`. If a breaking schema change is needed, bump to `.v2` and add migration in `load()`.

**Naming:** camelCase for JS identifiers; kebab-case for HTML element IDs and CSS classes; Japanese for all user-visible labels, aria-labels, and button text.

**CSS variables:** Defined on `:root` — `--ink`, `--accent`, `--input`, `--active`, `--ok`, `--warn`, `--error`. Use these instead of hardcoded colors.

**PWA cache:** Named `level-book-vr0001` in `service-worker.js`. Increment this string when deploying breaking changes to force cache invalidation.
