# Brief 28-TB-Simple — pragmatic thermal bridging, visible at every gate

**Status:** Draft
**Author:** Chris (with Claude Chat)
**Date opened:** 2026-05-16
**Builds on:** Brief 28k, Brief 28L, Brief 28e Phase 1 (all CLOSED)
**Supersedes:** Brief 28L's `fabric.thermal_bridging_alpha_pct` mechanism
**Discipline correction:** Every gate produces a visible UI number, not just a code review

---

## The discipline correction

Previous briefs split engine work and display work across separate gates and separate briefs. Result: Chris couldn't see actual numbers in the UI until after multi-day engine cycles had closed, and when the numbers finally appeared they were obviously wrong (e.g. heating demand showing 270 MWh because the display layer was still reading legacy free-running output blocks while the engine had moved to `losses_at_setpoint.*`).

This brief fixes that. **Every gate ends with a screenshot of the working number in the UI.** No "code review approves, display rewire comes later." Engine output and display path land together.

Practical consequence: this brief includes the display-layer rewire for the components affected. It's not deferred to a separate "Brief 28-DisplayLayer." Two gates, both produce visible results in the browser.

> **TB-V1 update (inline, 2026-05-16):** brief was originally drafted against the pre-Brief 24 component layout. `FabricSankey.jsx` and `LiveResultsPanel.jsx` named in the original TB-V1 file list were Brief 24 casualties — neither is mounted today (`LiveResultsPanel` explicitly removed per `BuildingDefinition.jsx:13` comment; `FabricSankey.jsx` has zero importers). The actually-mounted Heat Balance view on the Building tab is `balance/HeatBalance.jsx` (the same component as `/balance-test`), so rewiring `HeatBalance.jsx` lights both routes up in one change. File list updated below to reflect this. Dead `FabricSankey.jsx` and `LiveResultsPanel.jsx` left in tree for now (queued as a separate housekeeping commit). Pre-existing 4 HTTP 500s on baseline captures (visible on both routes before any TB-V1 change) are surveillance noise unrelated to TB; queued as `Brief 28-Console500s`. **PASS criteria refined: "no NEW console errors introduced by this commit"** — the helper's console-error capture logs them as warnings without failing the gate.

---

## Background

Brief 28L set `fabric.thermal_bridging_alpha_pct = 200` for Bridgewater. The engine treated this as `H_TB = area_UA × (α/100)` which produced 237 MWh/yr of thermal bridging — about 3× the entire building's actual BRUKL-reported HTC. The SBEM α convention is non-standard and version-dependent. We've spent enough time on it.

Pragmatic resolution: **use standard ISO 14683 physics directly. Ignore the SBEM α reporting. Produce a defensible TB number with reasonable defaults, editable by users.**

We are not replicating BRUKL. We use BRUKL inputs (fabric U-values, areas, g-values, ventilation flows) where they help. For thermal bridging, BRUKL's own number is uncertain (α convention ambiguous), so we use ISO 14683 default ψ values × auto-computed junction lengths.

Order-of-magnitude expectation: ISO 14683 defaults applied to Bridgewater geometry produce H_TB ≈ 100-130 W/K, which gives annual TB loss ≈ 10-15 MWh/yr at Yeovilton. That's roughly 10% of area-element fabric loss — exactly where Part L compliant buildings typically land. Defensible.

Users can override:
- Set `multiplier: 1.5` or `2.0` for "this building has worse-than-typical detailing"
- Switch to `mode: 'manual_h_tb'` and enter H_TB in W/K directly
- (Future) per-junction ψ overrides

---

## Scope

### Part A — Engine math

```
H_TB = Σ (psi_j × length_j)              [W/K, computed once at engine init]
TB_loss_h = H_TB × max(0, T_setpoint − T_out)
TB_gain_h = H_TB × max(0, T_out − T_setpoint_cooling)
```

Included in `H_weather` / `C_weather` shoulder gate (T_out-driven, same as glazing convention).

**Schema:**
```javascript
building_config.thermal_bridges: {
  mode: 'iso14683_auto' | 'manual_h_tb' | 'absent',
  h_tb_W_per_K: number,        // used when mode='manual_h_tb'
  multiplier: number,           // default 1.0; multiplies the auto-computed H_TB
}
```

**Junction types** (V1, auto-computed from existing geometry):

| Junction | Length formula | Default ψ (W/m·K, ISO 14683 Table A.2 typical) |
|---|---|---:|
| Wall-to-roof | 2 × (L + W) | 0.08 |
| Wall-to-ground-floor | 2 × (L + W) | 0.16 |
| Wall-to-intermediate-floor | 2 × (L + W) × (num_floors − 1) | 0.08 |
| External corner (vertical) | 4 × total_height | 0.05 |
| Window perimeter | 4 × √(total_glazing_area_per_facade) × num_facades_with_glazing (V1 approx) | 0.05 |
| Door perimeter (per operable door) | 2 × (door.area_m2 / door.height_m + door.height_m) | 0.10 |

V1 window perimeter approximation acknowledges we don't have itemised window dimensions; future brief can use real per-window data when needed.

**Output structure** (`losses_at_setpoint.thermal_bridging`):
```javascript
{
  heating_loss_kwh: number,
  cooling_gain_kwh: number,
  total_H_TB_W_per_K: number,
  mode: 'iso14683_auto' | ...,
  multiplier: number,
  junctions: [
    { type, psi_W_per_mK, length_m, contribution_W_per_K }
  ],
}
```

**Backward compat:** if `building.thermal_bridges` is absent but legacy `fabric.thermal_bridging_alpha_pct` is present, engine logs a deprecation warning and treats as `mode: 'manual_h_tb'` with `h_tb_W_per_K = (alpha/100) × area_UA`. Preserves Brief 28L behaviour for any project that hasn't been re-seeded.

### Part B — Bridgewater seed

- `building_config.thermal_bridges: { mode: 'iso14683_auto', multiplier: 1.0 }`
- Remove `fabric.thermal_bridging_alpha_pct: 200` (field stays in schema as deprecated)
- **WWR.north: 0.55 → 0.35** (geometry reality correction per Chris's geometry sheet; engine currently overstates NE glazing by 178 m²)

Expected post-seed Bridgewater results:
- H_TB ≈ 100-130 W/K
- Annual TB heat loss ≈ 10-15 MWh/yr
- Total post-fix State 2 heating demand should drop substantially from the current 711 MWh — the over-counted TB (237 MWh) and over-counted NE glazing (~20 MWh) together remove ~250 MWh of phantom load

### Part C — Display layer rewire (this is the crucial bit)

**Components rewired to read `losses_at_setpoint.*` instead of legacy blocks** (file list updated per the TB-V1 inline note — see "Discipline correction" section):

| Gate | File | Currently reads from | Rewire to |
|---|---|---|---|
| **TB-V1** | `frontend/src/components/modules/balance/HeatBalance.jsx` | `data.annual.losses` | `data.losses_at_setpoint.{external_wall, roof, ground_floor, glazing, fabric_leakage, permanent_vents, thermal_bridging, ventilation[], natural_ventilation[]}` — covers both **Building tab Heat Balance toggle** (via `BuildingDefinition.jsx`) AND **`/balance-test` route** (via `BalanceTestPage.jsx`) in one rewire |
| **TB-V2** | `frontend/src/components/modules/balance/DrillDown.jsx` | `annual.losses` | same shape as above |
| **TB-V2** | `frontend/src/components/modules/building/GainsLossesChart.jsx` | `result.gains_losses.{heating,cooling}_side` | `losses_at_setpoint.*` + `gains_bucketed` |
| **TB-V2** | `frontend/src/components/modules/building/ExpandedSankeyOverlay.jsx` | same as GainsLossesChart | same |

**Removed from the file list** (dead code after Brief 24, not mounted):
- ~~`frontend/src/components/modules/building/FabricSankey.jsx`~~ — no importers
- ~~`frontend/src/components/modules/building/LiveResultsPanel.jsx`~~ — explicitly removed per `BuildingDefinition.jsx:13` comment

These two files stay in the tree as dead code; flagged for a separate housekeeping commit later (NOT in scope for TB-V1).

Each rewired component renders new lines for: **thermal bridging** (ISO 14683 H_TB, not α convention), **per-system mechanical ventilation** (3 lines for Bridgewater), **operable openings / natural ventilation** (door line).

Legacy output blocks stay in the engine response (transition diagnostic) but display layer no longer reads them.

### Part D — Validation

**Spreadsheet** (`Bridgewater_Bottom_Up_Energy_Model.xlsx`):
- New `06_Thermal_Bridges` tab with per-junction-type breakdown
- `05_Heat_Loss` thermal bridging row updated to engine's ISO 14683 number
- All existing rows preserved within ±5%

**Hand-calc agreement**: engine H_TB vs spreadsheet within ±5%.

**EnergyPlus comparison**: assembler inflates wall/roof/floor U-values to absorb H_TB. Per-surface conduction from EP includes bridge contribution. Aggregate fabric+TB Static vs Dynamic within ±15%.

**No BRUKL comparison.** We are not validating against SBEM α. We are validating against (a) hand-calc of the same ISO 14683 formula and (b) EnergyPlus implementing the equivalent physics via inflated constructions.

### Out of scope

- SBEM α convention interpretation (deliberately abandoned)
- BRUKL bottom-line heating demand matching
- Per-facade itemised glazing schema (NE WWR fix is a one-line seed change, deferring schema rewrite)
- Per-junction ψ override UI (could be added later)
- THERM/HEAT2 2D heat flow analysis
- Sky long-wave radiation correction (Brief 28-SolAirSkyRadiation, separately queued)
- Permanent vents methodology (separately queued)

---

## Gates

### Gate TB-V1 — Engine math + Building tab display rewire

Land all of the following in one push:

1. Engine math (Part A)
2. Default ψ library (`frontend/src/data/thermalBridgesLibrary.js` new file)
3. Bridgewater seed update (Part B)
4. Display rewire: `HeatBalance.jsx` (covers Building tab Heat Balance toggle AND `/balance-test` route — same component on both)

**Halt produces:**

- Diff of all changes (code review)
- **Two screenshots** comparing BEFORE/AFTER state (the captures in `docs/validation/screenshots/tbv1_BASELINE_*.png` provide BEFORE):
  - `tbv1_AFTER_building_tab.png` — Building tab Heat Balance view
  - `tbv1_AFTER_balance_page.png` — `/balance-test` route Heat Balance view
- Both AFTER screenshots showing:
  - All Brief 28k/L/e fabric+ventilation lines visible
  - **Thermal bridging line at expected ~10-15 MWh/yr**
  - Operable door line at ~140 MWh/yr (Brief 28e `gf_entrance_door`)
  - Per-system mechanical ventilation lines (3 for Bridgewater)
  - Heating demand showing a sensible number (expected ~450-550 MWh range, much lower than current 711 because TB over-count and NE glazing over-count are both fixed)
- Pre-screenshot assertion-script output verifying engine numbers in expected ranges (see `scripts/_check_28tb_v1_assertions.mjs`)
- Console-error log from screenshot helper

**PASS criteria:**
- All lines render in the Heat Balance view
- Engine assertions pass (TB heat loss 8,000–18,000 kWh, 1 natural_ventilation entry, 3 ventilation entries, heating demand 400–600 MWh)
- **No NEW console errors introduced by this commit** (the 4 pre-existing HTTP 500s visible on baseline captures are acknowledged as background — queued as `Brief 28-Console500s`, not gating)
- Heating demand looks sensible vs BASELINE 711 MWh

**FAIL:**
- Any expected line missing, NaN, or wildly out of asserted range
- New console errors introduced by this commit (i.e., errors that weren't present on the BASELINE captures)
- Demand still showing pre-fix 711 MWh (indicates display not actually rewired)

### Gate TB-V2 — Validation + remaining display consumers

Land:

1. Spreadsheet `06_Thermal_Bridges` tab + `05_Heat_Loss` update
2. Hand-calc validation script `scripts/_check_28tb_handcalc.mjs`
3. EnergyPlus assembler `_apply_thermal_bridges_to_constructions` + comparison script
4. Display rewire: `DrillDown.jsx`, `GainsLossesChart.jsx`, `ExpandedSankeyOverlay.jsx` (`HeatBalance.jsx` already landed in TB-V1)

**Halt produces:**

- Diff of all changes
- Hand-calc vs engine table (per-junction, ±5%)
- Static vs Dynamic table (aggregate fabric+TB, ±15%)
- **Screenshot of Heat Balance page** (`/balance-test` route — note `/balance` is not a registered route; rename to `/balance` is a future cleanup, out of scope here) showing correct numbers
- **Screenshot of Building tab gains/losses chart** showing the rewired output

**PASS criteria:**
- Hand-calc agreement within tolerance
- Dynamic agreement within tolerance
- All affected UI pages render correct numbers
- No console errors

**FAIL:**
- Any tolerance breach
- UI shows wrong numbers despite engine being right (indicates rewire incomplete)

### Gate TB-V3 — Validation doc

Write `docs/validation/brief_28tb_validation.md` capturing both gates with screenshots referenced.

---

## Visual checkpoint discipline (the discipline correction)

This is the key procedural change. **Every gate from now on ends with a visible UI confirmation, not just a code review.**

- Engine work that changes outputs → display path updated in same gate → screenshot in halt report
- Engine work that doesn't surface visibly (e.g. internal refactor) → keeps numerical halt only
- Briefs touching the UI explicitly cannot defer display work to "follow-up briefs"

If Claude Code can't produce the screenshot at a halt, the gate doesn't pass. Discipline is enforced at the visibility boundary.

---

## File pointers

**Engine:**
- `frontend/src/utils/instantCalc.js::_calculateEnvelopeOnly` (TB accumulator replacement)
- `frontend/src/utils/instantCalc.js::_calculateState2`
- New: `frontend/src/utils/thermalBridges.js` (junction computation helper)

**Library:**
- New: `frontend/src/data/thermalBridgesLibrary.js` (ISO 14683 Table A.2 default ψ values)

**Display:**
- `frontend/src/components/modules/building/FabricSankey.jsx` (V1 rewire)
- `frontend/src/components/modules/building/LiveResultsPanel.jsx` (V1 rewire)
- `frontend/src/components/modules/balance/HeatBalance.jsx` (V2 rewire)
- `frontend/src/components/modules/balance/DrillDown.jsx` (V2 rewire)
- `frontend/src/components/modules/building/GainsLossesChart.jsx` (V2 rewire)
- `frontend/src/components/modules/building/ExpandedSankeyOverlay.jsx` (V2 rewire)

**Seed:**
- `scripts/seed_bridgewater_v25_systems.mjs` (thermal_bridges block + WWR.north fix)

**Assembler:**
- `nza_engine/generators/epjson_assembler.py::_apply_thermal_bridges_to_constructions` (V2)

**Validation:**
- `Bridgewater_Bottom_Up_Energy_Model.xlsx` — new `06_Thermal_Bridges` tab
- `scripts/_check_28tb_handcalc.mjs`
- `scripts/_check_28tb_dynamic.py`

**Briefs:**
- `docs/briefs/active/28tb_thermal_bridging_simple.md` (this brief)
- `docs/validation/brief_28tb_validation.md` (Gate TB-V3)

---

## Acknowledgement

This brief is the discipline correction for two related issues:

1. **Engine-vs-display drift**: previous briefs let engine output evolve while display layer stayed on legacy fields. Chris couldn't see real numbers until weeks of engine work had landed. Going forward, no engine change ships without its display path.

2. **SBEM α agonising**: we spent a day debating BRUKL convention interpretations. The pragmatic answer was always to use standard ISO 14683 physics directly. We use BRUKL inputs where they help; we don't try to replicate BRUKL.

Brief 28-TB-Simple closes thermal bridging credibly in two gates, with both gates producing visible UI confirmation. Then we move on.

---

**End of Brief 28-TB-Simple.**
