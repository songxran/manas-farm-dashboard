# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Update this file whenever the project changes in a way that would make the notes below stale (new pages, restructured data model, new files) — do this before ending a session, not just when asked.**

## Project overview

A dashboard for "มนัสฟาร์ม" (Manas Farm), a shrimp farm in Krabi, Thailand, backed by a real Supabase (Postgres) project with two-tier role-based access (admin/staff). There is no build step and no package manager — `index.html` holds all HTML/CSS/JS for the main dashboard, `app.js` holds the daily-log page + Leaflet map logic, both loaded as plain `<script>` tags (no bundler, no modules). `มนัส.jpg` is the farm logo, referenced by relative path. `SUPABASE.md` documents the full database schema, RLS policy matrix, and the `security definer` recursion gotcha behind the role system — read it before touching anything data-related.

## Running / developing

There is no build, lint, or test tooling.

- Open `index.html` directly in a browser (double-click, or `Start-Process index.html` in PowerShell). Requires internet access (Supabase, Google Fonts, Bootstrap Icons, Leaflet tiles, and the Supabase JS SDK are all loaded from CDNs/APIs) and requires logging in — see Auth below.
- There are no automated tests. Verify changes by opening the file, logging in, and clicking through the sidebar tabs, modals, and forms — ideally once as an admin account and once as a staff account, since the two see materially different UI and data (see Roles below).
- `app.js` is fetched via a relative `<script src="app.js">` tag — this fails silently under `file://` in some sandboxed/embedded browser previews (works fine in a normal desktop browser). If a preview environment shows the login form but nothing in it responds, check whether `app.js` actually loaded before assuming the logic is broken.
- Deployed via Netlify, auto-deploying from the `main` branch on GitHub (`songxran/manas-farm-dashboard`) — pushing to `main` is the deploy step, there is no separate build/publish command.

## Auth + roles (required — the dashboard is gated)

Row Level Security is enabled on every table with **no anon access at all** — every `select`/`insert`/`update`/`delete` requires a logged-in Supabase Auth session, and non-admin users are further scoped to only the ponds assigned to them. See `SUPABASE.md` for the full policy matrix and the `is_admin()`/`has_pond_access()` helper functions (both `security definer` — do not remove that, it prevents an RLS infinite-recursion bug that was hit and fixed during development).

- `#authOverlay` (top of `<body>`) is a full-screen login form, shown by default and whenever `supabaseClient.auth.onAuthStateChange` reports no session. While logged out, `body.logged-out` also sets `.sidebar`/`.main` to `display:none` — without this the page becomes scrollable into empty space, since the dashboard markup is still in the DOM (just visually covered by the fixed-position overlay), which was a real bug hit and fixed.
- On successful login, `initAppAfterLogin()` runs: fetches the current user's `profiles` row (→ `CURRENT_USER_ROLE`), then `ponds`/`production_cycles`/`cost_items`/`farm_settings`/`profiles`, applies `renderAll()`, and calls `window.populatePondSelect()`/`window.renderDailyLog()`/`window.initFarmMap()` — three functions `app.js` exposes on `window` specifically so the main script can trigger them once real pond data exists and the dashboard is actually visible (Leaflet computes a broken view if initialized while its container is `display:none`, which was also a real bug hit and fixed — the map must only init post-login, never on `app.js`'s own `DOMContentLoaded`).
- `CURRENT_USER_ROLE` (`'admin'` or `'user'`) drives `applyRoleToUI()`, which toggles a `role-admin` class on `<body>`. Elements with the `admin-only` class (add/delete pond buttons, the user-management panel) are hidden via CSS (`body:not(.role-admin) .admin-only { display: none }`) for non-admins — this is UX only, the real enforcement is server-side RLS, so never rely on the class alone for anything security-sensitive.
- User accounts are created manually in the Supabase dashboard (Authentication → Users) — there is no sign-up flow in the app. A `handle_new_user` trigger auto-creates a matching `profiles` row (`role='user'`) for every new auth user; an admin then assigns them ponds via the pond edit form's "พนักงานที่รับผิดชอบ" dropdown, and can promote them to admin from **ตั้งค่า** page's user-management panel (hidden for non-admins).

## Architecture

No framework — plain DOM APIs and template-literal `innerHTML` rendering throughout.

### Layout shell

- `.sidebar` — dark navy, fixed-width nav. On screens ≤768px it becomes an off-canvas drawer (`transform: translateX`) toggled by `#menuToggle`, with `.overlay` behind it.
- `.main` > `.topbar` + `.content` — topbar shows the current page title, a notification bell with an unread-count badge (`#bellBadge`, water-quality alerts), the logged-in user's email, and a logout button; `.content` is where the active page section renders.
- Seven `<section class="page" id="page-*">` blocks (`overview`, `dailylog`, `ponds`, `production`, `cost`, `report`, `settings`). Only one has `.active` at a time; nav links carry `data-page="<key>"` and clicking one hides all `.page` sections and shows `#page-<key>`.
- `page-overview` also shows a water-quality alert panel (`#alertPanel`, populated by `renderAlerts()`) and embeds a Leaflet map (`#farmMap`, initialized by `app.js`'s `initFarmMap()`, guarded by a `mapInitialized` flag so repeat logins don't re-init the same div — Leaflet throws if you do) with a single draggable-by-click marker.

### Data model — Supabase-backed, mirrored into in-memory arrays

Real persistence lives in Postgres (see `SUPABASE.md` for the full schema + RLS). The client keeps `PONDS`, `CYCLES`, `COST_ITEMS`, `PROFILES`, and `FARM_SETTINGS` as an in-memory cache/mirror of the DB, refetched after every mutation rather than patched locally — this keeps correctness simple at the cost of an extra round-trip per save. RLS means a staff account's `PONDS`/`CYCLES`/`COST_ITEMS` naturally only ever contain rows they're allowed to see — the client does no additional filtering.

- `PONDS`: array of pond objects (`loadPonds()` / `pondFromDb()`), identity/status/water-quality fields only (`code`, `status`, `size`, `depth`, `species`, `ph/do/temp/salinity`, `assignedUserId`). Production data is **not** here anymore — see `CYCLES`.
- `CYCLES`: array of production-cycle records (`loadCycles()` / `cycleFromDb()`), one row per historical breeding cycle of a pond (`pondId`, `cycleNo`, `release`, `status` growing/harvested, `harvest`, `yieldKg`, `survival`, `fcr`, `grade`). A pond can have many cycles over time — starting a new one (`openStartCycleForm`) never overwrites an old one. `activeCycleForPond(pondId)` finds the current `status='growing'` cycle, if any; `cyclesForPond(pondId)` returns all of them.
- `COST_ITEMS`: array of `{id, pondId, cycleId, category, desc, amount, createdAt}` line items (`loadCostItems()` / `costItemFromDb()`). `cycleId` is nullable but should always be set from the UI (defaults to the pond's active cycle) so per-cycle profit in the report page is accurate. `category` is one of the keys in `CATS`. `costTotal(pondId)` sums a pond's entire history; `costTotalForCycle(cycleId)` scopes to one cycle — the report page uses the latter.
- `PROFILES`: array of `{id, role, fullName, email}` — only populated for admins (`loadProfiles()` no-ops to `[]` for non-admins, matching the RLS policy). Used both for the ponds page's "พนักงานที่รับผิดชอบ" display/dropdown and the settings page's user-management table.
- `FARM_SETTINGS`: single-row object (`farm_name`, `owner_name`, `address`, `sell_price`) populated by `loadFarmSettings()`, applied to the DOM via `applyFarmSettingsToUI()`.
- **DB ↔ JS field mapping**: Postgres columns are snake_case and a few names differ from the JS shape the render functions expect (`do_level`↔`do`, `assigned_user_id`↔`assignedUserId`, `cycle_no`↔`cycleNo`, `description`↔`desc`, `pond_id`↔`pondId`, `cycle_id`↔`cycleId`). This mapping lives entirely in `pondFromDb`/`pondToDb`/`cycleFromDb`/`costItemFromDb`/`profileFromDb` — the rest of the file only ever sees the JS-shaped names, so don't bypass these helpers when adding new fields.
- **Monthly trend** (report page): `buildTrend()` derives the last 6 calendar months' yield/cost/profit from `CYCLES` (grouped by `harvest` month) and `COST_ITEMS` (grouped by `createdAt` month). If nothing has been harvested and no cost item exists, both trend charts render an empty-state message instead of a zeroed chart (the `hasData` check in `renderReport`).
- **Water-quality alerts**: `computeWaterAlerts()` flags any pond with `ph < 7` or `do < 4` from the already-loaded `PONDS` cache — no separate query. `daily_logs` saves that include a water-quality reading also `UPDATE ponds SET ph=... ` (in `app.js`'s `handleSave`) specifically so this stays accurate without re-querying `daily_logs`.

### Render pattern

Each page has a `render*()` function (`renderPonds`, `renderProduction`, `renderCost`, `renderReport`, `renderAlerts`, `renderUsers`) that rebuilds its `<tbody>`/chart/panel `innerHTML` from current cache state. There is no diffing. `renderAll()` calls all of them and should be called after any data refresh. The save/delete flow for every CRUD action is: **await the Supabase call → on success, re-`load*()` the affected table(s) → `renderAll()`** — never mutate the cache arrays directly.

Charts (`.bar-chart`) are hand-rolled with `<div>` bars sized by inline `height`/`width` percentages against the max value in the series — no charting library.

### CRUD modals

Same shape throughout: a hidden `<input id="*FormId">` holds the record id being edited (empty = "add new"); `open*Form(id)` populates fields; the save button is an `async` click handler building a DB-shaped payload, awaiting `supabaseClient.from(table).insert(...)`/`.update(...).eq('id', ...)`, alerting on error, otherwise closing the modal, re-`load*()`ing, and calling `renderAll()`.

- Pond add/edit (admin-only in the UI; RLS enforces it regardless): `#pondFormModal`, `openPondForm(id)` — includes the "พนักงานที่รับผิดชอบ" assignment dropdown, populated by `populateAssignedUserSelect()` from `PROFILES`.
- Start a new production cycle: `#startCycleModal`, `openStartCycleForm(pondId)` — only offered (via a dynamically-inserted button row, `renderStartCycleButtons()`) for ponds with no currently-`growing` cycle. Computes the next `cycle_no` client-side as `max(existing) + 1`; a genuine concurrent-insert race is caught server-side by the `unique(pond_id, cycle_no)` constraint, not handled specially client-side (rare enough for a single-farm app not to bother).
- Edit an existing cycle's results: `#productionModal`, `openProductionForm(cycleId)` — note this takes a **cycle id**, not a pond id, unlike the old single-cycle-per-pond design.
- Cost item add/edit: `#costModal`, `openCostForm(itemId)` — includes a cycle dropdown (`populateCostCycleSelect()`) scoped to whichever pond is selected, defaulting to that pond's active cycle.

Deletes (`deletePond`, `deleteCostItem`) use `confirm()`, then `await supabaseClient.from(table).delete().eq('id', id)`, then re-`load*()` + `renderAll()`. `deletePond` specifically catches a foreign-key error and shows a friendly message — `production_cycles.pond_id` is `on delete restrict`, so a pond with any cycle history literally cannot be deleted (change its status to "ว่าง" instead); this is intentional, not a bug to work around.

A separate read-only `#pondModal` (`openPondDetail`) shows a formatted summary — don't confuse it with `#pondFormModal`.

### Daily log page (`app.js`)

`page-dailylog` records feed amount and/or water quality (pH/DO/temp/salinity) per pond per day, writing to `daily_logs` (`pond_id`, `log_date`, `feed_amount`, `ph`, `do_level`, `temp`, `salinity`, `note`) — at least one of feed/water fields is required per entry, all are independently optional. The pond `<select id="dlPond">` uses each pond's real `id` as the option value, populated by `populatePondSelect()` from the shared `PONDS` cache (only re-run after login, since `PONDS` isn't loaded yet at `app.js`'s own `DOMContentLoaded`). Saving a water-quality reading also mirrors it onto `ponds` (see Data model above) and triggers a `loadPonds()` + `renderAll()` so the rest of the app reflects it immediately.

### Styling conventions

- Colors/spacing driven by CSS custom properties in `:root` (`--blue-*`, `--ink`, `--muted`, `--line`, `--danger`, etc.) — reuse these rather than hardcoding hex values.
- Font: **Kanit** (Google Fonts, loaded via `<link>`, weights 300–700) is the base font for consistent rendering across every device — do not go back to `local()`-only fonts as the primary choice, since those only render correctly on machines that happen to have that font installed (this was tried and reverted). Body text is weight 400; headings/buttons/nav are weighted up for hierarchy. The old `local()` font stacks (`DB Adman X`, `DB Heavent`, `FC Mittraphap Rounded`, `Mitr`) remain only as fallback entries after Kanit in the `font-family` list.
- Icons: **Bootstrap Icons** (`<i class="bi bi-*">`, loaded via CDN `<link>`) throughout — not emoji. Emoji render inconsistently across OS/browsers; Bootstrap Icons don't. Follow this convention for any new icon rather than reaching for an emoji character.
- `.badge-*` classes map to pond/cycle `status` values via `STATUS_BADGE`; keep `STATUS_LABEL`/`STATUS_BADGE`/the `<select>` options in the pond form in sync if statuses ever change.
- `@media print` hides chrome (sidebar/topbar/buttons) — this is what the report page's "Export PDF" button relies on (`window.print()`). "Export Excel" instead builds a CSV client-side via `Blob`/`URL.createObjectURL` — it's a CSV, not a real `.xlsx`.
- Leaflet's internal panes/controls carry z-index values up to ~1000, which escaped past the sidebar's `z-index: 200` on mobile until `#farmMap` was given its own `position: relative; z-index: 1` stacking context — don't remove that rule, and be wary of the same issue if any other third-party widget with its own internal z-index gets embedded later.
