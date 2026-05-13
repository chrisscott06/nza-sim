# Brief 28: Post-Brief-27 cleanup pass

BEFORE DOING ANYTHING:
1. Read `CLAUDE.md`
2. Read `STATUS.md` (Brief 27 close-out + Brief 28 scope queue)
3. Read `docs/state_contracts.md` v2.4 (the canonical contract Brief 27 closed at)
4. Read `docs/state_1_engine_divergence_investigation.md` — the solar
   model fix scope and rationale
5. Read `docs/hardcoded_constants_audit.md` — the constants cleanup scope
6. Read this ENTIRE brief before writing a single line of code
7. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## Why this brief

Brief 27 (Internal Gains) closed at 9/10 with six follow-up items queued
to Brief 28. This brief lands all six in priority order. The 1/10
holdback in Brief 27 close-out is the engine-toggle wiring, which is
item #2 below; item #1 (solar model) is the bigger fidelity win and
must land first so the toggle compares accurate Live to Sim.

---

## VERIFICATION RULES

- Module completion checklist (`docs/module_completion_checklist.md`)
  is mandatory. Brief 28 affects the Building module (State 1) primarily
  but also the Internal Gains module's engine toggle. Both modules'
  checklists need to be filled in or referenced.
- Engine agreement (`scripts/state1_engine_agreement.mjs`) is the
  acceptance gate for the solar model fix. Headline divergence (summer
  max, total solar gain) should drop to ≤5°C / ≤10% after the fix on
  Bridgewater's current asymmetric-WWR config.
- State 1 + State 2 isolation regressions must continue to pass byte-
  identical on both engines after every part.

---

## PART 1: Live engine solar model — switch from isotropic to Perez

**File(s):** `frontend/src/utils/solarCalc.js`

### Context

`docs/state_1_engine_divergence_investigation.md` documents the current
Live vs Sim State 1 gap on Bridgewater (15°C summer max, 38% solar
over-count by Live, 95% cooling divergence). Root cause is the live
engine's isotropic sky assumption — diffuse radiation treated as
uniformly spread across the sky dome — which over-counts diffuse on
non-south facades in northern latitudes.

EnergyPlus uses Perez (anisotropic) — diffuse concentrated near the
circumsolar region. The two engines agree well on south-facing
surfaces; they diverge sharply on N/E/W. Bridgewater's WWR of 0.55 on
the rotated-N facade hits the worst case.

### Fix

Replace the isotropic diffuse term in `computeHourlySolarByFacade` with
HDKR (Hay, Davies, Klucher, Reindl) or Perez. HDKR is the cleaner choice
for a JS port — closed-form, doesn't need lookup tables, gets within
~2-5% of Perez for most cases.

HDKR equations:
- Anisotropy index: `A = I_b / I_o` where `I_b` is beam normal, `I_o`
  is extraterrestrial normal
- Modulating factor: `f = sqrt(I_b / I_h)` where `I_h` is total horizontal
- Diffuse on tilted surface:
  ```
  I_dt = I_d × [(1 - A) × (1 + cos(β)) / 2 × (1 + f × sin³(β/2)) + A × R_b]
  ```
  where `β` is surface tilt, `R_b` is beam tilt factor (cos(θ_i) / cos(θ_z))

The existing isotropic code is:
```
I_dt_isotropic = I_d × (1 + cos(β)) / 2
```

HDKR reduces to isotropic when `A = 0` (no beam, fully overcast), so the
fully-overcast behaviour is preserved. The fix only matters when there's
direct sun (which is the case driving the over-count).

### Verify — Part 1

1. Run `scripts/state1_engine_agreement.mjs` against Bridgewater.
2. **Summer max gap** between Live and Sim should drop from 15°C to ≤5°C.
3. **Total solar gain divergence** should drop from −27% (Live high) to
   within ±10%.
4. **Cooling demand divergence** should drop from −95% (Sim 5 MWh vs Live
   109 MWh) to within ±30%.
5. State 1 isolation regression (`scripts/state1_isolation_live.mjs`) still
   passes 40/40 byte-identical (the math change is universal, not input-
   gated).
6. SCREENSHOT before/after engine_agreement output for the audit doc.

**Commit:** `Brief 28 Part 1: Live engine solar — isotropic → HDKR (or Perez)`

---

## PART 2: Engine toggle wiring on Internal Gains canvas views

**File(s):** `frontend/src/components/modules/gains/canvas/useStateComparison.js`,
`nza_engine/parsers/sql_parser.py`, new
`frontend/src/components/modules/gains/canvas/EngineToggle.jsx`,
update DeltaView / FreeRunningView / HeatBalanceView

### Context

Brief 27 close-out shipped an `EngineBadge` chip labelling the engine
behind each view. The next step is a SEGMENTED CONTROL — Live |
Simulation — that flips the view between engines. The placeholder slot
is already wired in the canvas tab strip (right edge of the tab strip).

Prerequisite: State 2 EP results plumbing. The SQL parser currently
emits aggregate gain totals; for the toggle to show per-profile attribution
in the Delta view, the parser needs to read per-profile EP output.

### Sub-parts

**2a — SQL parser per-profile breakdown.**
EnergyPlus emits Output:Variable for each `Lights` / `ElectricEquipment`
object by zone+name. The Part 10 EP assembler creates objects named
`Floor_N_Lights_<profile_id>` and `Floor_N_Equip_<profile_id>_{baseload,active}`.
The SQL parser's `_get_heat_balance_state2` should sum by profile_id
across zones and return `gains.lighting.profiles[]` and
`gains.equipment.profiles[]` matching the v2.4 contract output shape.

**2b — Results-fetch hook in the gains module.**
The simulation runs are stored in `simulation_runs` table; the
backend's heat-balance endpoint returns the contract-shaped output.
Add a `useSimulationResult(projectId, runId, mode)` hook to the
canvas folder that fetches and caches the most recent State 2 EP run.

**2c — `EngineToggle` segmented control.**
Two-state pill (Live | Simulation), bound to a session-local state in
InternalGainsModule. Pass `engine` prop down to the canvas views that
need it. Each view's `useStateComparison` either reads from the live
calc or from the most-recent EP run results.

**2d — Replace EngineBadge with EngineToggle in canvas views.**
DeltaView, FreeRunningView, HeatBalanceView. Annual breakdown and
Hourly profile stay live-only (they're input-side previews; no Sim
equivalent makes sense).

**2e — Disabled state.**
When there's no recent EP simulation run for the project, the Simulation
side of the toggle is disabled with a tooltip ("Run a simulation to
compare engines"). User can navigate to /building or run sim from there.

### Verify — Part 2

1. Run Bridgewater simulation in /building.
2. Open `/gains` → State 1 → State 2 tab.
3. Engine toggle reads "Live | Simulation" — both clickable.
4. Live shows current Brief 27 numbers (people 70k, lighting 45k, equipment 138k).
5. Switch to Simulation — numbers come from the EP run, shown alongside.
   Per-profile breakdown intact.
6. Heat balance + Free-running tabs also toggle.
7. With no recent sim run (delete sim history), Simulation side disabled
   with tooltip.
8. State 1 + State 2 isolation regressions still 40/40 + 21/21.

**Commit (per sub-part):**
- `Brief 28 Part 2a: SQL parser emits per-profile breakdown`
- `Brief 28 Part 2b: useSimulationResult hook`
- `Brief 28 Part 2c-e: EngineToggle wiring on Internal Gains canvas`

---

## PART 3: Building-type-aware BREDEM phasing factors

**File(s):** `docs/state_2_expected_ranges.md` revision, no code changes

### Context

`docs/state_2_part2_verification.md` documents that BREDEM's uniform-
phasing "30% of gains offset heating" heuristic under-states the offset
for hotel-type buildings (90% overnight presence concentrates gains in
heating hours, giving 4.15× overnight-vs-daytime gain ratio).

### Fix

Add a building-type-aware phasing table to `state_2_expected_ranges.md`
covering at least hotel / office / school / retail. For each, give the
expected heating-offset and cooling-add ratios based on schedule
patterns. Hotel = 60-80% of gain energy offsets heating (high overnight
phasing); office = 25-35% (BREDEM-standard); school = 30-40% (term
patterns); retail = 30-45%.

Re-derive Bridgewater expected ranges with hotel-specific phasing.
Expected heating drop should land near actual 130 MWh delta rather than
BREDEM's 30-60 MWh prediction.

### Verify — Part 3

1. New ranges in `state_2_expected_ranges.md`.
2. Bridgewater current numbers fall within revised ranges for hotel.
3. Office walkthrough scenario: set occupancy preset to office_workday,
   run live engine, confirm output in office-range.

**Commit:** `Brief 28 Part 3: Building-type-aware BREDEM phasing`

---

## PART 4: Cross-cutting constants cleanup

**File(s):** Multiple — see `docs/hardcoded_constants_audit.md`

### Context

Brief 27's hardcoded constants audit catalogued ~10 numeric constants
duplicated across `frontend/src/utils/instantCalc.js`,
`nza_engine/parsers/sql_parser.py`, `nza_engine/generators/epjson_assembler.py`
with identical values. Single biggest magic-number risk.

### Fix

Promote each duplicate to a single source:
- `nza_engine/constants.py` (Python physics constants module)
- `frontend/src/utils/physicsConstants.js` (JS physics constants module)
- Module-load assertion that JS and Python versions agree (a small
  test script that diffs the two and fails loud if they drift)

Duplicates to consolidate (per the audit doc):
- Cd (discharge coefficient, 0.6)
- Cw site exposure dict ({ sheltered: 0.05, normal: 0.10, exposed: 0.20 })
- FRAME_FRACTION (0.20)
- DEFAULT_U_VALUES (external_wall 0.28, roof 0.18, ground_floor 0.22, glazing 1.4)
- AIR_HEAT_CAPACITY (0.33 Wh/m³K)
- DEFAULT_G_VALUE (0.4)
- _VENT_M3_PER_S_PER_PERSON (0.008)

Configurable-but-defaulted promotions:
- GRID_INTENSITY_2026 → project-level year/region table
- GAS_CARBON_KG_KWH → fuel/year table
- DHW_LITRES_PER_M2_DAY → building-type table
- DHW_SETPOINT, DHW_COLD_TEMP → read from systems config (already exists, just thread through)
- T_cool_setpoint hardcode (24°C) → read from comfortBand.upper_c (bug-adjacent)

### Verify — Part 4

1. Diff script confirms JS + Python physics constants agree.
2. Isolation regressions still byte-identical (constants moved, values
   unchanged).
3. Engine agreement script output unchanged (same physics, refactored).

**Commit per category:** physics constants, configurable defaults,
T_cool_setpoint bug fix.

---

## PART 5: State 2 engine agreement script

**File(s):** New `scripts/state2_engine_agreement.mjs`

### Context

`scripts/state1_engine_agreement.mjs` is the canonical Live vs Sim
comparison for State 1. State 2 needs the equivalent — running both
engines and comparing the v2.4 contract output shape (gains.lighting.profiles[],
state1_delta, etc.).

### Fix

Mirror state1_engine_agreement.mjs structure:
1. Load project from API
2. Run live engine in envelope-gains mode
3. Trigger EP simulation, fetch state2 heat balance
4. Compare contract-significant metrics (per-category gain totals,
   per-profile breakdown, heating/cooling demand, free-running stats)
5. Output the same three-tier disagreement table (silent/soft/hard) the
   State 1 script uses
6. Print headline divergences with their flags

### Verify — Part 5

1. Script runs cleanly on Bridgewater.
2. Bridgewater's State 2 output sits within ±10% on aggregate metrics
   between Live and Sim (after Part 1's solar fix). Per-profile metrics
   within ±15% (more variance because EP uses Schedule:Compact with daily
   resolution where Live uses hourly).

**Commit:** `Brief 28 Part 5: State 2 engine agreement script`

---

## PART 6: Re-baseline state_2_expected_ranges.md + checklist close-out

**File(s):** `docs/state_2_expected_ranges.md`,
`docs/module_checklists/internal_gains_brief_27.md` (post-Brief-28 update)

### Context

After Parts 1-5 land, Bridgewater's State 2 output will have shifted
(Live's isotropic over-count gone, building-type-aware ranges updated).
Re-record the baseline so future work has the correct reference.

### Fix

1. Re-run engine agreement scripts.
2. Update `state_2_expected_ranges.md` with new Bridgewater post-Brief-28
   baseline.
3. Update `internal_gains_brief_27.md` module completion checklist
   Section J (walkthrough) with the new walkthrough results and bump
   confidence to 10/10 if the engine toggle now works end-to-end on
   Bridgewater.

### Verify — Part 6

Full walkthrough on Bridgewater. All seven Internal Gains canvas tabs
load without errors. Engine toggle works on Delta + Heat balance + Free-
running. State 1 → State 2 numbers within revised expected ranges.
Console clean.

**Commit:** `Brief 28 close-out: re-baseline + module checklist 10/10`

---

## Out of scope

- 3D zone gain heatmap (multi-zone modelling — future brief).
- Engine agreement CI script in pre-merge checks (queued as future Brief
  30 per STATUS.md).
- Brief 27's parked PARKED_Systems_Inspectors brief (future State 3
  work).
- Brief 27's parked PARKED_Solar_Diagnostics brief (some scope subsumed
  by Part 1 above; remainder deferred).
- UI tool-wide design system pass (deferred per
  `docs/ui_principles.md` v1.0 "out of scope" section).
