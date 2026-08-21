# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Update this file whenever the project changes in a way that would make the notes below stale (new pages, restructured data model, new files) — do this before ending a session, not just when asked.**

## Project overview

A dashboard for "มนัสฟาร์ม" (Manas Farm), a shrimp farm in Krabi, Thailand, backed by a real Supabase (Postgres) project. There is no build step and no package manager — `index.html` holds all HTML/CSS/JS for the main dashboard, `app.js` holds the daily-log page + Leaflet map logic, both loaded as plain `<script>` tags (no bundler, no modules). `มนัส.jpg` is the farm logo, referenced by relative path. `SUPABASE.md` documents the database schema, RLS policy choice, and connection details — read it before touching anything data-related.

## Running / developing

There is no build, lint, or test tooling.

- Open `index.html` directly in a browser (double-click, or `Start-Process index.html` in PowerShell). Requires internet access (Supabase, Leaflet tiles, and the Supabase JS SDK are all loaded from CDNs/APIs) and requires logging in — see Auth below.
- There are no automated tests. Verify changes by opening the file, logging in, and clicking through the sidebar tabs, modals, and forms.
- `app.js` is fetched via a relative `<script src="app.js">` tag — this fails silently under `file://` in some sandboxed/embedded browser previews (works fine in a normal desktop browser). If a preview environment shows the login form but nothing in it responds, check whether `app.js` actually loaded before assuming the logic is broken.

## Auth (required — the dashboard is gated)

Row Level Security is enabled on every table with **no anon access at all** — every `select`/`insert`/`update`/`delete` requires a logged-in Supabase Auth session (email/password). This was a deliberate choice (see "option 2" in `SUPABASE.md`) since the page is static HTML with a public key baked in, so anon-level access would mean anyone with the URL could read/write real farm data.

- `#authOverlay` (top of `<body>`) is a full-screen login form, shown by default and whenever `supabaseClient.auth.onAuthStateChange` reports no session.
- On successful login, `initAppAfterLogin()` runs: fetches `ponds`/`cost_items`/`farm_settings`, calls `renderAll()`, and also calls `window.populatePondSelect()`/`window.renderDailyLog()` — two functions `app.js` exposes on `window` specifically so the main script can trigger them once real pond data exists (the daily-log page's pond dropdown is empty and useless before that).
- User accounts are managed manually in the Supabase dashboard (Authentication → Users) — there is no sign-up flow in the app itself.

## Architecture

No framework — plain DOM APIs and template-literal `innerHTML` rendering throughout.

### Layout shell

- `.sidebar` — dark navy, fixed-width nav. On screens ≤768px it becomes an off-canvas drawer (`transform: translateX`) toggled by `#menuToggle`, with `.overlay` behind it.
- `.main` > `.topbar` + `.content` — topbar shows the current page title plus the logged-in user's email and a logout button; `.content` is where the active page section renders.
- Seven `<section class="page" id="page-*">` blocks (`overview`, `ponds`, `production`, `cost`, `report`, `dailylog`, `settings`). Only one has `.active` at a time; nav links carry `data-page="<key>"` and clicking one hides all `.page` sections and shows `#page-<key>`.
- `page-overview` also embeds a Leaflet map (`#farmMap`, initialized in `app.js`'s `initFarmMap()`) with a single draggable-by-click marker — clicking anywhere on the map moves the pin there. Map init doesn't require auth.

### Data model — Supabase-backed, mirrored into in-memory arrays

Real persistence lives in Postgres (see `SUPABASE.md` for the full schema). The client keeps `PONDS`, `COST_ITEMS`, and `FARM_SETTINGS` as an in-memory cache/mirror of the DB, refetched after every mutation rather than patched locally — this keeps correctness simple at the cost of an extra round-trip per save:

- `PONDS`: array of pond objects, populated by `loadPonds()` from the `ponds` table via `pondFromDb()`. Each pond carries both identity/status fields (`code`, `status`, `size`, `depth`, `species`, `release`, water quality `ph/do/temp/salinity`) **and** production fields (`yieldKg`, `survival`, `fcr`, `harvest`, `grade`) — production is edited in place on the pond row, not as separate records.
- `COST_ITEMS`: array of `{id, pondId, category, desc, amount, createdAt}` line items, populated by `loadCostItems()` from `cost_items` via `costItemFromDb()`. `category` is one of the keys in `CATS` (seed/feed/utility/chem/labor). All cost totals are derived by filtering this array (`costTotal(pondId)`, `catTotalForPond(pondId, cat)`).
- `FARM_SETTINGS`: single-row object (`farm_name`, `owner_name`, `address`, `sell_price`) populated by `loadFarmSettings()` from the `farm_settings` table, applied to the DOM via `applyFarmSettingsToUI()`. Used for the report page's revenue calculation instead of a hardcoded price.
- **DB ↔ JS field mapping**: Postgres columns are snake_case and a few names differ from the JS shape the render functions expect (`do_level`↔`do`, `release_date`↔`release`, `harvest_date`↔`harvest`, `yield_kg`↔`yieldKg`, `description`↔`desc`, `pond_id`↔`pondId`). This mapping lives entirely in `pondFromDb`/`pondToDb`/`costItemFromDb` — the rest of the file (render functions, modals) only ever sees the JS-shaped names, so don't bypass these helpers when adding new fields.
- **Monthly trend** (report page): `buildTrend()` derives the last 6 calendar months' yield/cost/profit directly from `PONDS` (grouped by `harvest` month) and `COST_ITEMS` (grouped by `createdAt` month) — there is no separate trend table. If no pond has been harvested and no cost item exists yet, both trend charts render an empty-state message instead of a zeroed chart (see the `hasData` check in `renderReport`).

### Render pattern

Each page has a `render*()` function (`renderPonds`, `renderProduction`, `renderCost`, `renderReport`) that rebuilds its `<tbody>`/chart `innerHTML` from the current state of `PONDS`/`COST_ITEMS`/`FARM_SETTINGS`. There is no diffing. `renderAll()` calls all four and should be called after any local data refresh. The actual save/delete flow for every CRUD action is: **await the Supabase call → on success, re-`load*()` the affected table(s) → `renderAll()`** — never mutate `PONDS`/`COST_ITEMS` directly, since they're a cache of the DB, not the source of truth.

Charts (`.bar-chart`) are hand-rolled with `<div>` bars sized by inline `height`/`width` percentages computed against the max value in the series — no charting library.

### CRUD modals

Three modal pairs, each following the same shape: a hidden `<input id="*FormId">` holds the record id being edited (empty string = "add new"); `open*Form(id)` populates the fields (or clears them if `id` is null); the save button is an `async` click handler that builds a DB-shaped payload (via `pondToDb()` for ponds), awaits `supabaseClient.from(table).insert(...)` or `.update(...).eq('id', ...)`, alerts on error, otherwise closes the modal, re-`load*()`s, and calls `renderAll()`.

- Pond add/edit: `#pondFormModal`, `openPondForm(id)`
- Production edit only (no add/delete — it's fields on the pond record): `#productionModal`, `openProductionForm(id)`
- Cost item add/edit: `#costModal`, `openCostForm(itemId)`

Deletes (`deletePond`, `deleteCostItem`) use `confirm()`, then `await supabaseClient.from(table).delete().eq('id', id)`, then re-`load*()` + `renderAll()`. Deleting a pond cascades to its `cost_items` at the DB level (`on delete cascade`), so no manual cleanup is needed client-side.

A separate read-only `#pondModal` (`openPondDetail`) shows a formatted summary — don't confuse it with `#pondFormModal`.

### Daily log page (`app.js`)

`page-dailylog` lets the user log an arbitrary numeric value (e.g. weight) per pond per day, writing directly to the `daily_logs` table (`pond_id`, `log_date`, `value`, `note`). The pond `<select id="dlPond">` uses each pond's real `id` as the option value (not its code), since `daily_logs.pond_id` is a foreign key — `populatePondSelect()` must be re-run whenever `PONDS` changes (it's called from the main script's `initAppAfterLogin()`, not from `app.js`'s own `DOMContentLoaded`, since `PONDS` isn't loaded yet at that point). The date field defaults to today (`todayStr()`, using the browser's local clock) both on load and after each save.

### Styling conventions

- Colors/spacing driven by CSS custom properties in `:root` (`--blue-*`, `--ink`, `--muted`, `--line`, etc.) — reuse these rather than hardcoding hex values.
- Two font stacks via `@font-face` + `local()` (no downloaded font files): `DB Adman X` for the whole page (headings and body share one family so text doesn't visually "jump" between sections), falling back to `DB Heavent`, then `Sarabun`/system sans-serif if neither is installed locally.
- `.badge-*` classes map to pond `status` values via `STATUS_BADGE`; keep `STATUS_LABEL`/`STATUS_BADGE`/the `<select>` options in the pond form in sync if statuses ever change.
- `@media print` hides chrome (sidebar/topbar/buttons) — this is what the report page's "Export PDF" button relies on (`window.print()`). "Export Excel" instead builds a CSV client-side via `Blob`/`URL.createObjectURL` — it's a CSV, not a real `.xlsx`.
