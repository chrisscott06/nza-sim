# Brief 29: Building module completion

BEFORE DOING ANYTHING:
1. Read `CLAUDE.md`
2. Read `STATUS.md`
3. Read `docs/state_contracts.md` — particularly State 1
4. Read `docs/ui_principles.md` v1.0 + `docs/module_completion_checklist.md`
5. Read `docs/hardcoded_constants_audit.md` — the constants cleanup target
6. Read `docs/state_2_expected_ranges.md` — the BREDEM ranges to revise
7. Read this ENTIRE brief before writing a single line of code
8. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## Why this brief

Brief 26 + 26.1 + 26.2 shipped State 1 (envelope-only computation) and
closed at clean isolation regression + EP shading correctness. But the
Building module's UI surface still has gaps relative to the v1.0 UI
principles and the State 1 contract:

- The Heat Balance view (`/balance`) is the main diagnostic surface
  but Building has no first-class State 1 diagnostic tabs of its own.
  Brief 28 Part 5 consolidates Heat Balance into a shared component;
  Brief 29 surfaces the right tabs **inside Building** for the State 1
  views Brief 28 prepared.
- Building's left-panel section bounding boxes are the canonical
  pattern referenced by `ui_principles.md`, but the module itself
  hasn't been audited against its own principles. Brief 29 fixes
  whatever drifted.
- The cross-cutting constants cleanup (~10 duplicated values across
  `instantCalc.js` + `sql_parser.py` + `epjson_assembler.py`) belongs
  with Building because it's State 1 physics constants, primarily.
- The BREDEM building-type-aware phasing factor work also belongs here
  because the BREDEM ranges are State 1 + State 2 boundary objects and
  the Building module is where users dial in their building type.

This brief finishes what State 1 was meant to be: a complete, polished
module with the right diagnostic views, conformant UI, and clean
underlying constants.

Estimated effort: 5–6 parts.

---

## VERIFICATION RULES

- Module completion checklist (`docs/module_completion_checklist.md`)
  is mandatory. Brief 29 fills in `internal_gains_brief_27`'s carry-
  forward items for the Building module + a new
  `docs/module_checklists/building_brief_29.md` for Building specifically.
- Engine agreement (`scripts/state1_engine_agreement.mjs`) is the
  acceptance gate. Brief 28 Part 1 should already have it within ±5°C
  on Bridgewater; Brief 29 must not regress it.
- State 1 isolation regression: 40/40 byte-identical end-to-end.
- Bridgewater walkthrough at close-out per Section J.

---

## PART 1: State 1 diagnostic canvas views inside Building

**File(s):** `frontend/src/components/modules/building/BuildingDefinition.jsx`,
new `frontend/src/components/modules/building/canvas/FreeRunningTemperatureView.jsx`,
new `frontend/src/components/modules/building/canvas/HeatLossBreakdownView.jsx`,
new `frontend/src/components/modules/building/canvas/SolarGainView.jsx`

### Context

The Building module currently has a centre-canvas 3D viewer with
toggle to Heat Balance. After Brief 28's canvas restructure, Heat
Balance is a shared `DiagnosticCanvas` component. Brief 29 adds the
state-aware tab strip to Building (mirroring Internal Gains' pattern)
and surfaces three first-class diagnostic tabs:

1. **3D Model** (existing — keep, restructure slightly)
2. **Heat Balance** (shared `DiagnosticCanvas` showing State 1 fabric
   losses vs State 1 demand vs comfort band)
3. **Free-running Temperature** (shared `TimeSeriesCanvas` showing the
   8760-hour zone temperature trace + comfort band + winter min /
   summer max stats — same template as Internal Gains' Free-running
   view but State 1 only)
4. **Heat Loss Breakdown** — new canvas view showing per-element
   conduction losses (walls / roof / floor / glazing) split by facade
   for walls + glazing, with hover for hour-of-year peak loss + annual
   total. Uses ZoomNav + MonthJumpButtons from Brief 28's Pablo port.
5. **Solar Gain** — new canvas view showing per-facade solar gain over
   the year (the per-facade solar accumulator already exists in
   `_calculateEnvelopeOnly`'s output), with HDKR-corrected post-Brief-28
   values. Useful for users to sanity-check that their fabric / WWR /
   shading choices produce the expected solar profile.

### Fix

Restructure Building's centre canvas to use the same tab strip pattern
as Internal Gains. Tab list: 3D Model · Heat balance · Free-running ·
Heat loss · Solar gain. Default tab on landing: 3D Model (existing
behaviour preserved).

Each diagnostic view consumes the shared `DiagnosticCanvas` /
`TimeSeriesCanvas` components from Brief 28 Part 5. Engine toggle slot
on Heat balance + Free-running + Heat loss + Solar gain (all four
engine-dependent views), inheriting the EngineToggle from Brief 28
Part 3.

### Verify — Part 1

1. Open `/building`. Tab strip visible above the canvas.
2. All five tabs render with content.
3. 3D Model is the default landing tab (no regression).
4. Heat Balance tab matches the existing /balance route's output for
   Bridgewater (same numbers, same component).
5. Free-running view shows the temperature trace cleanly.
6. Heat Loss Breakdown lets users hover for per-element details.
7. Solar Gain shows the four facade traces.
8. Engine toggle visible on the four engine-dependent tabs.
9. State 1 isolation regression: 40/40 still byte-identical.

**Commit:** `Brief 29 Part 1: Building module diagnostic canvas tabs`

---

## PART 2: Building UI principles conformance audit + fix

**File(s):** `frontend/src/components/modules/building/BuildingDefinition.jsx`
and helpers, possibly `frontend/src/index.css`

### Context

UI principles v1.0 is canonical for every module from Brief 27
onwards. The Building module pre-dates the principles. Some patterns
may have drifted (card widths, spread layouts, missing section
boxes).

### Fix

Audit Building module against the five principles + common patterns.
Specifically check:
- Card widths match content (no single-stat cards spanning the canvas)
- Related items grouped in single cards (no spread across the screen)
- Section bounding boxes used consistently on the left panel (this is
  already strong — GEOMETRY / GLAZING / SHADING / FABRIC / AIRTIGHTNESS
  is the canonical pattern referenced by `ui_principles.md`)
- Vertical stacking is the default
- Tab strip pattern matches Internal Gains' (after Part 1's
  introduction)

Make minimal fixes to bring Building into conformance. Document any
deviations + rationale in the close-out report.

### Verify — Part 2

1. Walk through Building module on Bridgewater at 1440 × 900.
2. Console clean, no visual regression.
3. UI principles checklist (module completion Section G) passes for
   Building.

**Commit:** `Brief 29 Part 2: Building UI principles conformance`

---

## PART 3: Cross-cutting constants cleanup

**File(s):** new `nza_engine/constants.py`,
new `frontend/src/utils/physicsConstants.js`,
multi-file refactor across `instantCalc.js`, `sql_parser.py`,
`epjson_assembler.py`, new `scripts/verify_constants_agree.py`

### Context

`docs/hardcoded_constants_audit.md` catalogued ~10 numeric constants
duplicated across three calculation files with identical values. The
single biggest magic-number risk in the codebase. Brief 29 promotes
them to single sources of truth + verifies JS and Python agree at CI
time.

### Fix

1. Create `nza_engine/constants.py` with the canonical Python values
   (well-commented citations).
2. Create `frontend/src/utils/physicsConstants.js` with the canonical
   JS values (identical to Python).
3. Refactor `instantCalc.js`, `sql_parser.py`, `epjson_assembler.py`
   to import from the constants modules.
4. New `scripts/verify_constants_agree.py` that parses both files +
   asserts every key in `physicsConstants.js` has an identical value
   in `constants.py`. Run in CI (Brief 34's pre-merge gate target).

Constants to consolidate (per the audit):
- `Cd` (discharge coefficient, 0.6)
- `Cw` site exposure dict ({ sheltered: 0.05, normal: 0.10, exposed: 0.20 })
- `FRAME_FRACTION` (0.20)
- `DEFAULT_U_VALUES` (external_wall 0.28, roof 0.18, ground_floor 0.22, glazing 1.4)
- `AIR_HEAT_CAPACITY` (0.33 Wh/m³K)
- `DEFAULT_G_VALUE` (0.4)
- `_VENT_M3_PER_S_PER_PERSON` (0.008)
- `H_AM_W_PER_M2K` (4.5 — zone-to-mass convective coefficient)

Configurable-but-defaulted promotions (audit category 3):
- `GRID_INTENSITY_2026` → project-level year/region table
  (`nza_engine/library/grid_intensity.py` or similar — yearly UK +
  region-specific values)
- `GAS_CARBON_KG_KWH` → fuel-emissions table by year
- `DHW_LITRES_PER_M2_DAY` → building-type table (hotel 1.1 / office
  0.2 / residential 0.8 / etc.)
- `DHW_SETPOINT` / `DHW_COLD_TEMP` → read from systems config
  consistently (already exists as `systems.dhw.setpoint_c`; just
  thread through)

Bug-adjacent fix:
- `T_cool_setpoint = 24` hard-code in the degree-day fallback path
  (`instantCalc.js:1946`) — read from `comfortBand.upper_c` instead.

### Verify — Part 3

1. `verify_constants_agree.py` runs clean.
2. `engine_agreement` script output unchanged (same physics, refactored).
3. State 1 + State 2 isolation regressions byte-identical (constants
   moved, values unchanged).
4. Bridgewater Live + Sim numbers post-Brief-28 unchanged after the
   refactor.

**Commit per category:**
- `Brief 29 Part 3a: Physics constants — single source of truth`
- `Brief 29 Part 3b: Configurable-defaulted constants promotion`
- `Brief 29 Part 3c: T_cool_setpoint bug fix + final cleanup`

---

## PART 4: Building-type-aware BREDEM phasing factors

**File(s):** `docs/state_2_expected_ranges.md` revision, no code changes

### Context

`docs/state_2_part2_verification.md` documented that BREDEM's uniform-
phasing "30% of gains offset heating" heuristic under-states the
offset for hotel-type buildings (90% overnight presence concentrates
gains in heating hours, giving a 4.15× overnight-vs-daytime gain ratio).

### Fix

Add a building-type-aware phasing table to `state_2_expected_ranges.md`
covering hotel / office / school / retail / residential / mixed-use.
For each, give the expected heating-offset and cooling-add ratios
based on schedule patterns:

| Building type | Heating offset % of gain | Cooling add % of gain | Notes |
|---|---|---|---|
| Hotel | 60–80% | 15–30% | High overnight phasing (gains land in cold hours) |
| Office | 25–35% | 30–45% | Standard BREDEM uniform-phasing — Mon-Fri 8-6 schedule peaks during day |
| School | 30–40% | 35–50% | Term pattern, vacation gaps; daytime occupancy |
| Retail | 30–45% | 35–50% | Open hours pattern; some always-on baseload |
| Residential | 45–60% | 20–35% | Morning + evening peaks; overnight presence with low gains |
| Mixed-use | 35–50% | 30–45% | Default fallback |

Re-derive Bridgewater expected ranges with hotel-specific phasing.
Expected heating reduction range should now bracket the actual ~130
MWh delta rather than BREDEM's 30–60 MWh prediction (which was the
miss documented in Brief 27 Part 2 verification).

Update `state_2_expected_ranges.md`'s State 2 ranges block to
parameterise by building type, and add a small section explaining how
the ranges are derived per type.

### Verify — Part 4

1. New phasing table in `state_2_expected_ranges.md`.
2. Bridgewater current State 2 numbers fall within revised ranges for
   hotel building type.
3. Office walkthrough scenario: set occupancy preset to office_workday,
   run live engine, confirm output in office-range.

**Commit:** `Brief 29 Part 4: Building-type-aware BREDEM phasing`

---

## PART 5: Walkthrough on Bridgewater + module completion checklist

**File(s):** `docs/module_checklists/building_brief_29.md` (new)

### Context

Brief 26 + 26.1 + 26.2 closed without a Building-specific module
completion checklist (the format hadn't yet been established). Brief 29
backfills.

### Fix

1. Run engine agreement script + verify against post-Brief-28 baseline.
2. Walkthrough Bridgewater in `/building`:
   - Every section in the left panel touched + verified responsive
   - Every diagnostic tab visited + renders (3D / Heat balance /
     Free-running / Heat loss / Solar gain)
   - Engine toggle works on the four engine-dependent tabs
   - Save + reload — all values preserved
   - Console clean
   - Cross-module isolation tested visually
3. Fill in `docs/module_checklists/building_brief_29.md` against the
   canonical template.
4. Confidence target: **9+/10**.

### Verify — Part 5

- Walkthrough done, checklist filled in honestly.
- State 1 isolation 40/40 byte-identical after all Brief 29 work.
- State 2 isolation 21/21 byte-identical.
- engine_agreement summer-max gap on Bridgewater within ±5°C
  (post-Brief 28 + 29).

**Commit:** `Brief 29 close-out: Building module 9+/10`

---

## Out of scope for Brief 29

- Operation v2 / State 2.5 — Brief 30
- Weather module redesign — Brief 31
- Systems Inspectors / State 3 — Brief 32–33
- CI for state contracts — Brief 34
- State 4 reconciliation — Brief 35+
- 3D zone gain heatmap (multi-zone) — separate brief

---

## Sequencing

Parts 1 → 2 → 3 → 4 → 5 in order. Part 1 sets up the diagnostic
canvas tabs. Part 2 audits Building UI conformance. Part 3 does the
constants cleanup (refactor — must not affect engine output). Part 4
is docs-only. Part 5 is the walkthrough + close-out.

Brief 29 closes State 1 (Building module) as a complete, polished
module. After Brief 29, focus moves to State 2.5 (Operation v2,
Brief 30).
