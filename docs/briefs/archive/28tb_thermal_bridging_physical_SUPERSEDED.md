# Brief 28-ThermalBridgingPhysical — replace SBEM α convention with junction-based thermal bridging

**Status:** Draft
**Author:** Chris (with Claude Chat)
**Date opened:** 2026-05-16
**Builds on:** Brief 28k (heat loss setpoint convention), Brief 28L (BRUKL ingestion), Brief 28e (operable openings). All engine briefs CLOSED.
**Supersedes:** Brief 28L's thermal bridging implementation (`fabric.thermal_bridging_alpha_pct` × area-UA).
**Trigger:** Chris's review 2026-05-16 of Bridgewater BRUKL Technical Data Sheet revealed the SBEM α convention does not match the engine's interpretation, and the resulting thermal bridging number is dramatically over-counted (engine 237 MWh/yr vs BRUKL bottom-line whole-building heating demand of 98 MWh/yr).

---

## Background

Brief 28L Gate 3+ added thermal bridging via:

```
effective_fabric_UA = area_UA × (1 + α/100)
TB_loss_h = area_UA × (α/100) × max(0, T_setpoint - T_out)
```

with Bridgewater's `fabric.thermal_bridging_alpha_pct = 200` sourced from BRUKL Technical Data Sheet "Alpha value [%]: 200.31".

Validation at Brief 28L confirmed the engine implemented this formula correctly (hand-calc Python matched engine output byte-identically at 237,813 kWh/yr) and that the formula was preserved across State 1 ↔ State 2.

The formula is implemented correctly. **The formula is wrong.**

### What the BRUKL Technical Data Sheet actually says

Page 26 of Bridgewater's BRUKL:

| Parameter | Actual | Notional |
|---|---:|---:|
| External area [m²] | 4034.9 | 4034.9 |
| Average conductance [W/K] | **1134.63** | 2113.7 |
| Average U-value [W/m²K] | 0.28 | 0.52 |
| Alpha value [%] | **200.31** | 18.06 |

Alpha is defined in the footnote as: *"Percentage of the building's average heat transfer coefficient which is due to thermal bridging."*

The total HTC of 1134.63 W/K already includes thermal bridging. The Alpha value reports what fraction of that total is due to bridges.

The engine's interpretation (multiply area-UA by 2.0 to add bridges on top) produces:

```
Engine area_UA computed from BRUKL U-values × engine geometry:
  walls 0.14 × 1712 m²    = 240 W/K
  roof  0.15 × 864 m²     = 130 W/K
  floor 0.13 × 864 m²     = 112 W/K
  glazing 1.40 × 640 m²   = 896 W/K  (engine WWR over-counts; see note)
  Total area-UA           = 1378 W/K
  TB (α=200%)             = 2756 W/K
  Engine total HTC        = 4134 W/K
```

**BRUKL says 1134.63 W/K. Engine produces 4134 W/K. Off by 3.6×.**

### Additionally — bottom-line heating demand comparison

Page 26 BRUKL also reports:
- Actual heating demand: **23.35 kWh/m² × 4189.6 m² = 97.8 MWh/yr**
- Notional heating demand: 24.07 kWh/m² × 4189.6 m² = 100.8 MWh/yr

Engine post-Brief 28k Gate 3 + BRUKL + Brief 28e:
- Static envelope-only heating demand: 470 MWh/yr → 598 with operable door
- Static State 2 heating demand: 577 MWh/yr → 711 with operable door

Engine is producing **~6× the BRUKL heating demand.** Major contributors to the over-count:

1. **Thermal bridging over-count** (the focus of this brief) — likely 3-5× over by itself
2. **Glazing WWR over-count on NE facade** — engine 517 m² vs real 339 m² (see Chris's geometry sheet)
3. **Engine geometry uses 16m height vs real 16.4m** — minor (~2.5%)
4. **Permanent vents BS5925 vs BRUKL convention** — known INFO from Brief 28k Gate 1 (~70 MWh/yr difference)

This brief addresses #1. Items #2 and #4 are separate briefs (Brief 28-PerFacadeGlazingArea, Brief 28-PermanentVentsConvention). Item #3 is too small to warrant its own brief but should be corrected when geometry is revised.

### How EnergyPlus computes thermal bridging

EnergyPlus does not have a native α concept. Practitioners typically use one of:

**(1) Inflated construction U-values.** Compute bridging contribution as Σ(ψ × L) per junction, then inflate the wall/roof/floor U-values to absorb the bridge UA. Surface conduction in EP then includes bridging implicitly.

**(2) Explicit bridge surfaces.** Model each bridge geometrically as a thin strip with low resistance.

**(3) Linear thermal transmittance via SurfaceProperty:HeatTransferAlgorithm.** Newer EP versions allow this; rarely used in practice.

All three are compatible with EnergyPlus's hourly heat balance physics. The α-multiplier approach is specific to SBEM's monthly compliance methodology and does not have a clean EnergyPlus equivalent (Brief 28L documented this as one of the four convention differences).

### What the standard physics actually is

SBEM thermal bridging (per BR443 / Approved Document L 2013):

```
Total_TB_HTC = Σ_junctions (ψ_j × L_j)

where:
  ψ_j = linear thermal transmittance of junction j  [W/m·K]
  L_j = total linear length of junction j in the building  [m]
```

Junction types include:
- Wall-to-floor (intermediate slab edges)
- Wall-to-roof
- Wall-to-ground floor
- Window heads, jambs, sills
- Door perimeters
- External corners (vertical edges)
- Internal partition-to-external-wall

Each junction type has either:
- A project-specific calculated ψ (from THERM or similar 2D heat flow software), or
- An Approved Document L Table 4 default (typically 0.05-0.15 W/m·K)

When project-specific ψ values aren't calculated, SBEM defaults to assuming poor performance — which for Bridgewater appears to have been the case (α = 200% suggests the worst-case default was applied broadly).

The Y-value reported in some BRUKL documents is:
```
Y = Total_TB_HTC / A_external
```
where A_external is total exposed envelope area. Y-values typically range 0.05-0.20 W/m²K for compliance projects.

---

## Scope

### In scope

**Part A — Replace engine's α multiplier with junction-based computation**

1. Remove `fabric.thermal_bridging_alpha_pct` from primary use as a multiplier.
   Keep the field temporarily as a derived diagnostic output (engine computes `derived_alpha_pct = TB_UA / area_UA * 100` for comparison against BRUKL reporting), but don't consume it as input.

2. New schema field on `building_config`:
   ```
   building_config.thermal_bridges: {
     mode: 'computed' | 'manual' | 'absent',
     manual_total_psi_L_W_per_K: number,   // if mode='manual', user-set total ψ×L
     junctions: [
       { id, type, psi_W_per_mK, length_m, source: 'computed' | 'override' | 'default' }
     ],
     y_value_W_per_m2K_derived: number,    // diagnostic, computed from total
   }
   ```

3. Junction types supported (V1):
   - `wall_to_intermediate_floor` — slab edges at each intermediate floor level
   - `wall_to_roof` — perimeter at top
   - `wall_to_ground_floor` — perimeter at base
   - `external_corner` — vertical edges between facades
   - `window_head` — top edge of each glazing
   - `window_jamb` — vertical edges of each glazing
   - `window_sill` — bottom edge of each glazing
   - `door_perimeter` — full perimeter of each operable door

4. Auto-computed junction lengths from existing geometry (mode='computed'):
   - `wall_to_intermediate_floor`: 2 × (length + width) × (num_floors - 1)
   - `wall_to_roof`: 2 × (length + width)
   - `wall_to_ground_floor`: 2 × (length + width)
   - `external_corner`: 4 × total_height
   - `window_head/jamb/sill`: derived from glazing area + assumed window aspect ratio (V1 uses 1.2:1 default ratio; future brief can use per-window data from Chris's geometry sheet)
   - `door_perimeter`: 2 × (door.area_m2 / door.height_m + door.height_m) for each entry in `operable_openings` where `opening_type === 'door'`

5. Default ψ values from Approved Document L 2013 Table 4 (loaded from a new library module):
   - `wall_to_intermediate_floor`: 0.08 W/m·K (typical compliance value)
   - `wall_to_roof`: 0.08
   - `wall_to_ground_floor`: 0.16 (uninsulated slab edge default; high)
   - `external_corner`: 0.05
   - `window_head`: 0.04 (insulated lintel)
   - `window_jamb`: 0.05 (insulated jamb)
   - `window_sill`: 0.04 (insulated sill)
   - `door_perimeter`: 0.10

   **For Bridgewater specifically** (per BRUKL α=200% suggesting no detailed psi calc): use Approved Document L Table 4 "default" column values (~2-3× the compliance values above) to reflect the worst-case assumption SBEM applied. Specifics to be determined when SBEM Technical Manual is referenced.

6. Engine math:
   ```
   total_TB_HTC = Σ (junction.psi_W_per_mK × junction.length_m)  [W/K]
   per hour:
     TB_loss_h = total_TB_HTC × max(0, T_setpoint - T_out)
     TB_cool_h = total_TB_HTC × max(0, T_out - T_setpoint_cooling)
   include in H_weather / C_weather for shoulder gate (T_out-driven loss, same convention as glazing)
   ```

7. Output schema:
   ```
   losses_at_setpoint.thermal_bridging: {
     heating_loss_kwh: number,
     cooling_gain_kwh: number,
     total_TB_HTC_W_per_K: number,
     y_value_W_per_m2K_derived: number,
     derived_alpha_pct: number,    // diagnostic: matches BRUKL convention when correctly computed
     junctions: [
       { id, type, psi_W_per_mK, length_m, contribution_kwh }
     ]
   }
   ```

**Part B — Bridgewater seed update**

8. Seed `building_config.thermal_bridges` for Bridgewater with `mode: 'computed'` and per-junction psi values matching BRUKL design intent. Three candidate psi-value profiles to test:

   **Profile A — Compliance-typical (AD L Table 4 "with calculated psi")**: psi values 0.05-0.10 → TB_HTC ~150-200 W/K
   **Profile B — Default poor detailing (AD L Table 4 "default" column)**: psi values 0.15-0.30 → TB_HTC ~400-600 W/K
   **Profile C — Reverse-engineered to match BRUKL**: pick psi values that produce a TB_HTC consistent with BRUKL's reported α=200.31% of average HTC

   Document all three profiles and their resulting heating demand impacts. Seed Bridgewater with **Profile C** (the one that matches BRUKL design intent) — this is the canonical reference for Bridgewater modelling.

9. Remove `fabric.thermal_bridging_alpha_pct: 200` from Bridgewater seed (replaced by `thermal_bridges` block). Field stays in schema as deprecated/inert.

**Part C — Validation**

10. **Hand-calc validation** against `Bridgewater_Bottom_Up_Energy_Model.xlsx`:
    - Add new `06_Thermal_Bridges` tab with per-junction-type psi × length table
    - `05_Heat_Loss` thermal bridging line replaces engine's α-based number with junction-based
    - Engine vs hand-calc: per-junction-type within ±5%

11. **BRUKL bottom-line cross-check**:
    - With Profile C seeded, compute engine total HTC including bridges
    - Compare against BRUKL Average conductance 1134.63 W/K
    - Target: within ±10%
    - If engine total HTC matches BRUKL, the convention is now correctly implemented even if the absolute heating demand still differs from BRUKL's 98 MWh (because we use hourly weather + setpoint convention, BRUKL uses monthly methodology)

12. **EnergyPlus comparison**:
    - Assembler emits inflated wall/roof/floor U-values to incorporate Profile C thermal bridges (EP-native approach per option 1 above)
    - Bridge UA from `total_TB_HTC` distributed across surface areas proportionally to area-UA contribution
    - Per-surface conduction outputs from EP should include bridge contribution
    - Static engine reports bridge as separate line; EP reports as part of surface conduction. Sum should match within ±15%.

13. **Brief 28L convention differences preserved**:
    - Sky long-wave radiation — still queued for separate brief
    - Glazing variable — unchanged
    - T_ground — unchanged
    - Permanent vents — unchanged
    - The thermal bridging difference is RESOLVED by this brief: both engines now use a junction-based approach.

### Out of scope (deferred to other briefs)

- **Project-specific psi calculation via THERM or similar** — V1 uses Approved Document L Table 4 defaults or Profile C reverse-engineering. Detailed 2D heat flow analysis per junction is project-specific design work.
- **Per-window geometric breakdown** (replacing engine's WWR with per-window dimensions from Chris's geometry sheet) — separate brief `Brief 28-PerFacadeGlazingArea`. Window perimeter junctions in V1 use WWR-derived approximation.
- **Permanent vents convention** (BS 5925 vs SBEM) — separate brief.
- **Sky long-wave radiation correction** — separate brief `Brief 28-SolAirSkyRadiation` (already queued).
- **Display layer rewire** — separate brief `Brief 28-DisplayLayer` (already queued; depends on this brief landing first to avoid wiring UI to the wrong TB number).
- **Brief 28e Gate E5b** (3D viewer UI extension) — already queued; depends on this brief.

### Not changing

- Brief 28k convention math (setpoint convention, sol-air on opaque, T_out on glazing, T_ground on floor)
- Brief 28L per-project U-value override mechanism
- Brief 28e operable openings physics
- Brief 28j hourly MVHR recovery cap

---

## Engine changes

### Files modified

**`frontend/src/utils/instantCalc.js`**

- Replace `fabric.thermal_bridging_alpha_pct` consumption with `thermal_bridges` block reader
- New module-scope helper `computeThermalBridgeJunctions(building, geometry)` that:
  - In `mode: 'computed'`: derives lengths from geometry, looks up psi values from library defaults
  - In `mode: 'manual'`: uses user-provided psi × length values
  - In `mode: 'absent'`: returns zero
- New module-scope helper `loadDefaultPsiValues()` returning AD L Table 4 defaults
- Per-hour TB loss accumulator changes from `area_UA × α × ΔT` to `total_TB_HTC × ΔT`
- Output schema updated to new `losses_at_setpoint.thermal_bridging` shape with junction breakdown
- Mirrored in `_calculateState2`
- Backward compat: if `building.thermal_bridges` is absent but `fabric.thermal_bridging_alpha_pct` is present, log a deprecation warning and compute total_TB_HTC = (alpha/100) × area_UA as a fallback (preserves Brief 28L behaviour for any project not yet migrated)

**`frontend/src/data/thermalBridgesLibrary.js`** (NEW)

- AD L Table 4 default psi values per junction type
- Multiple profiles (compliance-typical, default-poor, custom)
- Exported as `THERMAL_BRIDGES_LIBRARY`

**`scripts/seed_bridgewater_v25_systems.mjs`**

- Remove `BRIDGEWATER_FABRIC.thermal_bridging_alpha_pct`
- Add `BRIDGEWATER_THERMAL_BRIDGES` block with Profile C psi values
- Update console log

**Assembler — `nza_engine/generators/epjson_assembler.py`**

- New function `_apply_thermal_bridges_to_constructions(epjson, thermal_bridges, geometry)`:
  - Computes total bridge UA distributed across wall/roof/floor surfaces
  - Inflates each construction's effective U-value to absorb its share
  - Method: scale Material:NoMass thermal_resistance values
- Wired into the main assembly flow

**Validation scripts:**

- `scripts/_check_28tb_gate1_junction_handcalc.mjs` — junction-based hand-calc
- `scripts/_check_28tb_gate2_brukl_htc.mjs` — total HTC vs BRUKL Average conductance
- `scripts/_check_28tb_gate3_dynamic.py` — Static vs EP with inflated constructions

### Files not changed

- `frontend/src/utils/wallModel.js`
- `frontend/src/utils/scheduleLibrary.js`
- Brief 28k convention code
- Brief 28L per-project override mechanism
- Brief 28e operable openings code

---

## Validation targets

To be computed from `Bridgewater_Bottom_Up_Energy_Model.xlsx` (new `06_Thermal_Bridges` tab) and the BRUKL Technical Data Sheet.

### Gate TB1 — junction-based hand-calc

For Profile C (BRUKL-matching), per-junction-type table:

| Junction type | Length m | Psi W/m·K | TB UA W/K |
|---|---:|---:|---:|
| Wall to intermediate floor | TBD | TBD | TBD |
| Wall to roof | TBD | TBD | TBD |
| Wall to ground floor | TBD | TBD | TBD |
| External corner | TBD | TBD | TBD |
| Window head | TBD | TBD | TBD |
| Window jamb | TBD | TBD | TBD |
| Window sill | TBD | TBD | TBD |
| Door perimeter | TBD | TBD | TBD |
| **Total** | | | **Target: see Gate TB2** |

Engine vs hand-calc per-junction: ±5%.

### Gate TB2 — BRUKL total HTC cross-check

Target: engine `total_TB_HTC + area_UA` within ±10% of BRUKL Average conductance 1134.63 W/K.

If on Profile C this comes out too far off, Profile C psi values need adjustment. Document final calibrated profile.

Acceptable bounds:
- Lower: 1020 W/K (BRUKL minus 10%)
- Upper: 1250 W/K (BRUKL plus 10%)

### Gate TB3 — Dynamic engine validation

Static vs EP with inflated constructions: per-surface conduction within ±15%, demand-level within convention-adjusted ±15%.

### Bottom-line BRUKL comparison (informational, not pass/fail)

- Engine post-fix State 2 heating demand for Bridgewater
- BRUKL heating demand 97.8 MWh/yr
- Expected delta: still substantial because (a) different physics framework (hourly setpoint vs monthly utilisation), (b) WWR over-count on NE, (c) permanent vents methodology, (d) BRUKL's internal gains assumptions
- Document the gap honestly. **Not the validation target.** Validation target is convention consistency with documented standard physics.

---

## Halt gates

Five gates, each requires code review.

### Gate TB1 — schema + junction computation helpers

Implement:
- `building_config.thermal_bridges` schema
- `THERMAL_BRIDGES_LIBRARY` with AD L Table 4 defaults + Profile C for Bridgewater
- `computeThermalBridgeJunctions` helper
- Bridgewater seed update
- Backward-compat fallback for legacy α field

**Halt and report:**
- Diff of engine changes
- Diff of thermalBridgesLibrary.js
- Diff of seed script
- Junction breakdown for Bridgewater (table)
- Total TB_HTC for Bridgewater
- No engine math consumption yet (helpers exposed but unused)

PASS: schema clean, junction table produces sensible numbers, backward-compat works.

### Gate TB2 — engine math + total HTC cross-check

Replace α-based TB calculation in `_calculateEnvelopeOnly` and `_calculateState2`. Update output schema. Validate total HTC vs BRUKL.

**Halt and report:**
- Diff of engine changes
- New `losses_at_setpoint.thermal_bridging` output for Bridgewater (both states)
- Per-element fabric loss invariance State 1 ↔ State 2 still holds
- Total HTC (area + bridges) vs BRUKL Average conductance 1134.63 W/K
- Brief 28k invariants still hold (solar buckets, gain buckets)

PASS: total HTC within ±10% of BRUKL, all invariants preserved, no regression on existing rows.

### Gate TB3 — hand-calc validation

Update `Bridgewater_Bottom_Up_Energy_Model.xlsx` with new `06_Thermal_Bridges` tab. Engine validator script compares per-junction.

**Halt and report:**
- Updated spreadsheet
- Per-junction-type comparison table
- All within ±5%

PASS: hand-calc agreement, no regression on Brief 28k/L/e rows.

### Gate TB4 — Dynamic engine validation

Implement `_apply_thermal_bridges_to_constructions` in assembler. Run EP. Compare.

**Halt and report:**
- Diff of assembler
- Per-surface conduction from EP vs Static surface + bridge contribution
- Demand-level Static vs Dynamic
- Honest accounting of which Brief 28L convention differences are now resolved vs remaining

PASS: per-surface ±15%, demand-level ±15% convention-adjusted, four Brief 28L convention differences updated (thermal bridging resolved).

### Gate TB5 — validation documentation

Write `docs/validation/brief_28tb_validation.md`.

Structure:
- TL;DR (convention replaced, BRUKL HTC matched, EP comparison)
- TB1-TB4 results
- BRUKL bottom-line comparison (informational gap explanation)
- Convention differences updated (Brief 28L's four → four with TB resolved)
- Outstanding work queued (Brief 28-PerFacadeGlazingArea, Brief 28-DisplayLayer, Brief 28e Gate E5b)

---

## PASS/FAIL browser scenarios (deferred to Brief 28-DisplayLayer)

This brief produces correct engine output. Display layer rewire is a separate brief. Browser smoke-testing the new thermal bridging output is therefore deferred to Brief 28-DisplayLayer.

---

## Out of scope reminders

These remain parked until Brief 28-ThermalBridgingPhysical closes:

- Brief 28-DisplayLayer (UI rewire)
- Brief 28e Gate E5b (3D viewer extension)
- Brief 28-PerFacadeGlazingArea (replace WWR with itemised window areas)
- Brief 28-PermanentVentsConvention (BS 5925 vs SBEM)
- Brief 28-SolAirSkyRadiation
- Brief 28M (LPD calibration)
- Brief 28-AssemblerAudit
- Brief 28g (measured data ingester)

---

## File pointers

**Engine:**
- `frontend/src/utils/instantCalc.js::_calculateEnvelopeOnly` (TB accumulator replacement)
- `frontend/src/utils/instantCalc.js::_calculateState2`
- New module-scope: `computeThermalBridgeJunctions`, `loadDefaultPsiValues`

**Library:**
- `frontend/src/data/thermalBridgesLibrary.js` (NEW)

**Seed:**
- `scripts/seed_bridgewater_v25_systems.mjs`

**Assembler:**
- `nza_engine/generators/epjson_assembler.py::_apply_thermal_bridges_to_constructions` (NEW)

**Validation:**
- `Bridgewater_Bottom_Up_Energy_Model.xlsx` — new `06_Thermal_Bridges` tab
- `scripts/_check_28tb_gate1_junction_handcalc.mjs` (NEW)
- `scripts/_check_28tb_gate2_brukl_htc.mjs` (NEW)
- `scripts/_check_28tb_gate3_dynamic.py` (NEW)

**Briefs:**
- `docs/briefs/active/28tb_thermal_bridging_physical.md` (this brief)
- `docs/validation/brief_28tb_validation.md` (Gate TB5)

**Supersedes:**
- Brief 28L's `fabric.thermal_bridging_alpha_pct` mechanism (deprecated, fallback for back-compat)

---

## Acknowledgement

Brief 28-ThermalBridgingPhysical is the discipline correction Chris's instinct on the 237 MWh number triggered. The previous formula (α × area-UA) was internally consistent and validated against itself, but it interpreted SBEM's α convention incorrectly. SBEM's α reports "% of total HTC attributable to thermal bridging," not "additional fraction of area-UA," and the underlying physics is `Σ(ψ × L) × ΔT` — junction-based, not area-multiplier-based.

This brief replaces the convention with the physical underlying methodology. It also brings our engine into alignment with how EnergyPlus computes thermal bridging (inflated constructions, junction-based or psi-based), resolving one of Brief 28L's four documented Static-vs-EP convention differences.

The bottom-line BRUKL heating demand (97.8 MWh) will still differ from our engine's hourly setpoint-anchored output. That's expected: BRUKL uses monthly utilisation methodology, we use hourly heat balance. The remaining gap, once thermal bridging is fixed, will be attributable to: NE WWR over-count (separate brief), permanent vents methodology (separate brief), and the irreducible monthly-vs-hourly framework difference (not fixable; documented).

Validation discipline: same as Brief 28L. Code review at each gate. Chris reviews diffs before approving subsequent gates. No drift.

---

**End of Brief 28-ThermalBridgingPhysical.**
