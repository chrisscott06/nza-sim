# Brief 24: Building Module — State 1 Envelope-Only Heat Balance

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read docs/briefs/00_project_brief.md
4. Read docs/briefs/Brief_21_Heat_Balance.md (canonical heat balance contract)
5. Read this ENTIRE brief before writing a single line of code
6. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## VERIFICATION RULES

**Browser verification is mandatory.** After completing each part, you MUST open the application in a real browser and visually confirm it works. Take screenshots. Report what you actually see. Check browser DevTools console for red errors. If anything is broken, fix it before committing.

**This brief deletes UI and restructures schema.** Some elements (Live Results Panel, operable window inputs, `/profiles` editor link from Building module) are being removed. Do not preserve them "just in case" — delete them cleanly and let the State 1 view stand alone.

**Three strikes rule.** If a particular State 1 calculation doesn't match between live engine and EnergyPlus within 5% after 3 attempts, isolate the divergence in a minimal test case and document it. Do not commit code where the two engines disagree by more than 5% on State 1 numbers.

---

## Context

We're restructuring the application around a **progressive heat balance** that evolves through five modules:

1. **Building** *(this brief)* — fabric, geometry, glazing, shading, permanent openings. State 1: naked building, no occupancy, no systems.
2. **Internal Gains** *(next brief)* — people, equipment, lighting with schedules attached. State 2.
3. **Ventilation & Operation** *(future brief)* — operable windows, purge, night cooling. State 2.5.
4. **Systems** *(existing, to be refactored later)* — heating, cooling, MVHR, DHW with control schedules. State 3.
5. **Results / Calibration** *(existing, to be extended later)* — full picture with layer toggles, comparison to actuals.

Currently the Building module:
- Shows a "Live Results Panel" with EUI, fuel split, monthly bars — premature at this stage because no systems or gains are defined
- Has operable windows under Openings — these are a control strategy, not envelope geometry, and belong in Ventilation & Operation
- Has Permanent Openings inputs that don't compute equivalent area or pressure-driven flow
- Centre canvas only toggles between 3D Model and Energy Flow — no fabric-specific diagnostics

After this brief, the Building module:
- Has no Live Results Panel — the right column is pure input properties
- Has operable windows removed — only permanent vents remain in the Openings section
- Has a proper permanent vent input (equivalent area, count, optional Cd and reference pressure)
- Has a centre canvas with four views: **3D Model**, **Heat Balance (State 1)**, **Free-running Temperature**, **Per-element Heat Loss**
- Has a `mode: 'envelope-only'` path in `instantCalc.js` that zeroes all internal gains and bypasses systems
- The `/balance` endpoint and `_buildHeatBalance` helper both support State 1 mode

**Target outcome:** A user on the Building module sees only what the envelope is doing. No premature EUI, no fuel split, no system efficiency — just gains vs losses through the fabric, free-running temperature, and where heat is leaving. The Holiday Inn Express Bridgewater will show summer overheating hours (since sealed windows + trickle vents only) — that's a true and useful finding that the Systems module then justifies the VRF against.

12 parts. Do them in order.

---

## PART 1: Remove Live Results Panel from Building module

**File(s):** `frontend/src/components/modules/BuildingDefinition.jsx`, `frontend/src/components/panels/LiveResultsPanel.jsx`

Remove the Live Results Panel from the Building module's right column. The right column becomes pure input properties — only the `CollapsibleSection` components for Geometry, Glazing, Shading, Openings, Fabric.

**Do not delete `LiveResultsPanel.jsx`** — it's still used in other modules (Systems, Profiles editor pre-deletion). Just remove its mount point from `BuildingDefinition.jsx`.

Adjust the layout: with the right panel gone, the centre canvas should expand to fill the freed width. Use the same `grid-cols` pattern as `/results` if helpful — left sidebar (collapsible sections, ~288px wide as today), centre canvas (everything else).

Clean up any imports, hooks, or context reads that were only used to feed `LiveResultsPanel` from `BuildingDefinition.jsx`. Do not break the Systems module's continued use of the panel.

**Commit message:** "Part 1: Remove Live Results Panel from Building module"

**Verify:**
1. Navigate to `/building` — confirm no Live Results Panel on the right
2. The centre canvas (3D model / energy flow) should now be wider than before
3. Navigate to `/systems` — confirm LiveResultsPanel still appears there
4. Check console for zero errors
5. **SCREENSHOT:** /building with no right panel, centre canvas expanded
6. Report: "Live Results Panel removed from /building. Centre canvas widened by approximately [X] px. Panel preserved for use in /systems. Zero console errors."

---

## PART 2: Remove operable windows from Openings section

**File(s):** `frontend/src/components/modules/building/Openings.jsx` (or wherever the openings UI lives), `frontend/src/data/defaultParams.js`, `nza_engine/generators/geometry.py`

Remove all UI inputs related to operable windows from the Building module. This includes:
- Any "operable area" or "openable fraction" inputs per façade
- The "louvres or operable windows" choice — louvres stay, operable windows go
- Any 3D viewer rendering of operable sashes (if present)
- Any related fields in `building_config` schema

Operable windows will be reintroduced in the future **Ventilation & Operation** module as a control strategy with a schedule. For now they don't exist on the envelope.

In `defaultParams.js`, remove `operable_*` keys from the Bridgewater defaults. In `geometry.py`, remove any epJSON object generation that emitted operable window control (e.g. `AirflowNetwork:MultiZone:Component:DetailedOpening` tied to user-operated windows). Do not break trickle vent emission.

Update the `PUT /api/projects/{id}/building` request validator to reject operable window fields with a clear error message during this transition (so old saved projects don't silently break).

**Commit message:** "Part 2: Remove operable window inputs from Building module"

**Verify:**
1. Navigate to /building → Openings section
2. Confirm only permanent vent / louvre inputs remain
3. Load the Bridgewater project — should load cleanly without operable window data
4. Check `building_config` saved to the DB — no `operable_*` keys
5. Run a simulation — no AirflowNetwork operable opening objects in the generated epJSON
6. Report: "Operable windows removed from Building module UI and schema. [N] inputs removed. Bridgewater loads clean. epJSON generation no longer emits operable opening objects. Permanent vents and louvres preserved."

---

## PART 3: Permanent Openings input section

**File(s):** `frontend/src/components/modules/building/PermanentOpenings.jsx` (new or rename existing), `nza_engine/generators/geometry.py`, `frontend/src/utils/instantCalc.js`

Rebuild the Permanent Openings section to capture vent equivalent area properly.

**UI inputs:**
- Vent preset dropdown: `["custom", "renson_invisivent_evo", "renson_invisivent_evo_ak", "generic_trickle"]` — populates default equivalent area per metre
- Vent width (mm) — for presets, EA per vent is computed from width × EA/metre
- Number of vents (count) — defaults to N where N is the number of windows from glazing inputs, user-overridable
- Equivalent area per vent (mm²) — auto-filled from preset+width, editable for "custom"
- Reference pressure (Pa) — default 1 Pa (Part F convention), with tooltip explaining 4 Pa is typical in-service
- Discharge coefficient Cd — default 0.61, behind an "Advanced" disclosure
- Optional: distribution across façades — equal split by default, or per-façade override

**Live computation displayed below the inputs:**
```
Total equivalent area:     [X] m²    (sum of N vents × EA each)
Reference flow @ 1 Pa:     [X] L/s   (Q = Cd × A_total × √(2 × 1 / ρ))
Typical in-service @ 4 Pa: [X] L/s   (same equation at 4 Pa)
Equivalent ACH @ 4 Pa:     [X] ACH   (using building volume from geometry)
```

**Preset library — embed in `frontend/src/data/ventPresets.js`:**
```js
export const VENT_PRESETS = {
  custom: { name: "Custom", ea_per_m: null },
  renson_invisivent_evo: { name: "Renson Invisivent EVO", ea_per_m: 9500 },        // mm² per metre width
  renson_invisivent_evo_ak: { name: "Renson Invisivent EVO AK (acoustic)", ea_per_m: 5200 },
  generic_trickle: { name: "Generic trickle vent", ea_per_m: 6000 },
};
```

Document in a comment: these are rough working figures; users should override from the actual product datasheet for the project record.

**Schema additions to `building_config`:**
```json
"permanent_openings": {
  "vent_preset": "renson_invisivent_evo_ak",
  "vent_width_mm": 1344,
  "vent_count": 138,
  "ea_per_vent_mm2": 7000,
  "reference_pressure_pa": 1.0,
  "discharge_coefficient": 0.61,
  "distribution": "equal"
}
```

**epJSON generation:**
Replace the previous Openings emission with `ZoneInfiltration:FlowCoefficient` using AIM-2 coefficients derived from the total equivalent area. Approach:
- c (flow coefficient) derived from EA: c = Cd × A_total × √(2 / ρ) × (1/ΔP_ref)^n where n = 0.65, ΔP_ref = 1 Pa
- Cs (stack coefficient) ≈ 0.001 — typical for orifice-type openings
- Cw (wind coefficient) ≈ 0.0008 — typical
- n = 0.65

This is in addition to the fabric leakage infiltration (which keeps its own `ZoneInfiltration:DesignFlowRate` from the airtightness input).

**Live engine support in `instantCalc.js`:**
Add a function `computePermanentVentFlow(building, weather_hour)` that returns L/s at the current hour:
- Reference flow Q_ref = Cd × A_total × √(2 × ΔP_ref / ρ)
- Pressure modulation by weather: ΔP_effective = max(ΔP_ref, Cs × |T_in - T_out| + Cw × wind_speed²)
- Q_hour = Q_ref × √(ΔP_effective / ΔP_ref)

This feeds the live readout and the State 1 heat balance.

**Commit message:** "Part 3: Permanent Openings — equivalent area input with weather-modulated flow"

**Verify:**
1. Navigate to /building → Permanent Openings
2. Select preset "Renson Invisivent EVO AK", set width 1344mm, count 138 — confirm EA per vent populates to ~7000 mm²
3. Total EA should display ~0.97 m²
4. Reference flow @ 1 Pa should display ~760 L/s
5. Typical @ 4 Pa should display ~1520 L/s
6. Equivalent ACH @ 4 Pa should display ~0.48 ACH (using Bridgewater volume)
7. Save the project — confirm `permanent_openings` block in DB
8. Run simulation — confirm `ZoneInfiltration:FlowCoefficient` in generated epJSON, no fatal errors
9. **SCREENSHOT:** Permanent Openings section with all values populated and live readout visible
10. Report: "Permanent Openings rebuilt. Holiday Inn Express vent figures: 138 × Renson EVO AK 1344mm, total EA 0.97 m², ref flow 760 L/s @ 1 Pa, typical 1520 L/s @ 4 Pa, 0.48 ACH. epJSON emits FlowCoefficient infiltration with c=[X], Cs=[X], Cw=[X]. Live engine `computePermanentVentFlow` returns weather-modulated L/s — winter average [X], summer average [X], annual average [X]."

---

## PART 4: Fabric section — show leakage and vent flow as distinct contributors

**File(s):** `frontend/src/components/modules/building/Fabric.jsx`, `frontend/src/utils/instantCalc.js`

The Fabric section currently has airtightness as a single input. Keep the input the same (q50 in m³/h·m²@50Pa, or ACH50), but add a readout below that splits total building ventilation into its two physical contributors.

**UI readout below the airtightness input:**
```
Total ventilation (annual average):

   Fabric leakage:        [X] ACH   ([X] L/s, [X] MWh/yr heat loss in winter)
   Permanent vent flow:   [X] ACH   ([X] L/s, [X] MWh/yr heat loss in winter)
   ─────────────────────────────
   Total:                 [X] ACH   ([X] L/s)
```

Fabric leakage in service is derived from q50 using the divide-by-20 rule for low-rise, or a configurable divisor. Permanent vent flow comes from Part 3.

The MWh/yr heat loss is from the live engine: 0.33 × ACH × volume × HDD-weighted ΔT (or a simpler 0.33 × ACH × volume × 18°C for a rough number — be explicit which).

This is purely a readout. No new inputs. The point is to make the two contributors physically visible so users understand what they're calibrating and what they're not.

**Commit message:** "Part 4: Fabric section shows leakage vs vent flow as distinct contributors"

**Verify:**
1. Navigate to /building → Fabric section
2. Confirm split readout appears below airtightness input
3. Adjust airtightness from 5 to 10 m³/h·m²@50Pa — fabric leakage row should approximately double, vent flow row should be unchanged
4. Adjust vent count in Permanent Openings — vent flow row should change, fabric leakage row unchanged
5. **SCREENSHOT:** Fabric section showing the split with Bridgewater values
6. Report: "Fabric ventilation split working. Bridgewater: fabric leakage [X] ACH ([X] MWh winter heat loss), vent flow [X] ACH ([X] MWh), total [X] ACH. Inputs cleanly separated — calibrating one doesn't affect the other."

---

## PART 5: Live engine — `envelope-only` mode (State 1)

**File(s):** `frontend/src/utils/instantCalc.js`

Add an `envelope-only` mode to the live engine that produces State 1 numbers — naked building, no occupancy, no systems.

**Mode flag:**
```js
calculateInstant(building, weather, { mode: 'envelope-only' | 'with-gains' | 'full' })
calculateInstantDegreeDay(building, weather, { mode: 'envelope-only' | 'with-gains' | 'full' })
```

Default mode (when called without options) remains the existing behaviour (`full`) for backward compatibility.

**In `envelope-only` mode:**
- Internal gains zeroed: `people_density = 0`, `lighting_w_per_m2 = 0`, `equipment_w_per_m2 = 0`
- No system efficiencies applied — output is **demand against a setpoint band**, not consumption
- Setpoint band defaults to 20°C heating / 26°C cooling (configurable via `comfort_band` param)
- Returns: heating demand (MWh), cooling demand (MWh), solar gain by orientation, fabric loss by element, ventilation loss split into fabric vs vent
- Also returns `free_running_temperature` — an 8760-array of zone temperature with no setpoint enforcement, just the envelope responding to weather

**Free-running temperature calculation:**
For each hour, compute zone temperature from an energy balance:
- Heat in: solar through glazing (post-shading), [no internal gains]
- Heat out: conduction through walls/roof/floor/glazing × (T_in - T_out), infiltration losses × (T_in - T_out)
- Thermal mass damping: weight current hour temperature with previous hour using a time constant derived from heat capacity and overall heat loss coefficient

A simple lumped-capacitance model is fine for the live engine (this is `instantCalc`, not EnergyPlus). Target: produces a plausible diurnal swing matching EP free-running mode within ±2°C.

**Heat balance shape returned in `envelope-only` mode:**
```js
heat_balance: {
  mode: 'envelope-only',
  gains: {
    solar: { F1: X, F2: X, F3: X, F4: X, roof: X, total: X },
    // NO people, equipment, lighting in this mode
  },
  losses: {
    conduction: { walls: X, roof: X, floor: X, glazing: X },
    ventilation: { fabric_leakage: X, permanent_vents: X },
  },
  demand: {
    heating: X,  // MWh, against 20°C
    cooling: X,  // MWh, against 26°C
    overheating_hours: X,  // hours above 26°C with no system
    underheating_hours: X, // hours below 20°C with no system
  },
  free_running: {
    annual_mean: X,
    winter_min: X,
    summer_max: X,
    hourly: [...8760 values],
  }
}
```

**Commit message:** "Part 5: Live engine envelope-only mode with free-running temperature"

**Verify:**
1. In dev tools console, call `calculateInstant(building, weather, { mode: 'envelope-only' })` with Bridgewater
2. Confirm `heat_balance.gains` has no people/equipment/lighting fields
3. Confirm `heat_balance.demand` has heating, cooling, overheating_hours, underheating_hours
4. Confirm `heat_balance.free_running.hourly` has 8760 entries
5. Check free-running winter min temp is below 12°C and summer max is above 26°C for Bridgewater (lightweight, leaky-ish UK hotel will swing)
6. The same call without `mode` option should return the existing full result (backward compat preserved)
7. Report: "envelope-only mode working. Bridgewater State 1: heating demand [X] MWh, cooling demand [X] MWh, overheating hours [X], underheating hours [X]. Free-running: annual mean [X]°C, winter min [X]°C, summer max [X]°C. Full mode unchanged."

---

## PART 6: Backend `/balance` endpoint — envelope-only support

**File(s):** `nza_engine/parsers/sql_parser.py`, `api/routers/simulations.py`

Extend `get_heat_balance(sql_path, mode='full')` to support `mode='envelope-only'`.

For EnergyPlus to give us State 1 numbers, we need a separate simulation run with internal gains zeroed and systems set to ideal loads with very wide setpoints (or ideally, no system at all — pure free-running). Two options:

**Option A (preferred):** Add a `state1_simulation` flag to the simulation runner. When set, the assembler emits the building with `People = 0`, `Lights = 0`, `ElectricEquipment = 0`, and `ZoneHVAC:IdealLoadsAirSystem` with very wide setpoints (heating 5°C, cooling 50°C). This effectively gives free-running temperature plus an ideal heating/cooling demand against the wide band, which we then post-process against the user's actual comfort band.

**Option B:** Run two EnergyPlus simulations per project save — one full, one State 1 — and cache both. Heavier but cleaner.

Pick Option A unless it produces issues — it's one simulation run with a flag, easy to gate.

**API endpoint shape:**
```
GET /api/projects/{id}/simulations/{run_id}/balance?mode=envelope-only
```

Returns the same shape as the live engine's `envelope-only` heat balance (matches the contract from Part 5 exactly). The "engine toggle" in the UI will compare these like-for-like.

**Commit message:** "Part 6: Backend /balance endpoint supports envelope-only mode"

**Verify:**
1. Trigger a simulation with `state1_simulation: true` flag — confirm the generated epJSON has zero people/lights/equipment and wide-setpoint ideal loads
2. Simulation runs without fatal errors
3. Call `GET /api/projects/{id}/simulations/{run_id}/balance?mode=envelope-only` — returns the envelope-only heat balance shape
4. Numbers within 5% of the live engine's envelope-only output for the same project
5. Report: "Backend State 1 working. Approach: [Option A / B]. Bridgewater EP-side State 1: heating [X] MWh, cooling [X] MWh, overheating hours [X]. Compared to live engine: heating delta [X]%, cooling delta [X]%. Within 5% tolerance."

---

## PART 7: Centre canvas — four-view tab strip

**File(s):** `frontend/src/components/modules/BuildingDefinition.jsx`, `frontend/src/components/modules/building/CanvasViews.jsx` (new)

Replace the current `[3D Model | Energy Flow]` toggle in the Building module's centre canvas with a four-view tab strip:

```
[3D Model]  [Heat Balance]  [Free-running Temp]  [Heat Loss Breakdown]
```

The 3D Model view is the existing `BuildingViewer3D.jsx` — no change.

The Heat Balance view is the existing `HeatBalance.jsx` from `/results`, but mounted in the Building module with `mode='envelope-only'` forced on. Show the "Fabric only — no occupancy, no systems" badge prominently. The engine toggle (Live | Simulation) stays. The unit toggle (kWh | kWh/m²·a) stays.

The Free-running Temperature view and the Heat Loss Breakdown view are new — Parts 8 and 9 build them.

Use a CSS approach consistent with the rest of the module — the same tab strip styling you used for `/results` tabs (accent colour, underline indicator, etc.).

Lifted state in `BuildingDefinition.jsx`:
```js
const [canvasView, setCanvasView] = useState('3d'); // '3d' | 'balance' | 'temperature' | 'loss-breakdown'
```

**Commit message:** "Part 7: Centre canvas four-view tab strip in Building module"

**Verify:**
1. Navigate to /building — confirm tab strip with four tabs visible at top of centre canvas
2. Click each tab — confirm view switches cleanly
3. The 3D Model tab shows the existing viewer
4. The Heat Balance tab shows the existing component with envelope-only mode badge
5. The other two tabs are placeholders for now (or empty containers — Parts 8 and 9 fill them)
6. **SCREENSHOT:** Tab strip with each of the four tabs active in turn (4 shots)
7. Report: "Four-view tab strip working. Default view: 3D Model. Heat Balance view mounted with envelope-only mode badge visible. Free-running Temp and Heat Loss Breakdown tabs scaffolded as empty for next parts."

---

## PART 8: Free-running Temperature view

**File(s):** `frontend/src/components/modules/building/FreeRunningTemp.jsx` (new)

Build the Free-running Temperature view. This shows what the building does on its own with no system, no occupancy — just envelope responding to weather.

**Layout (top to bottom):**

1. **Winter week panel** — a line chart for a representative winter week (use the coldest week in the EPW, or fixed Jan 15–21). Lines:
   - Outdoor temperature (grey)
   - Free-running indoor temperature (navy)
   - Comfort band 20–26°C shaded
   - X-axis: hours, with day boundaries marked
   - Y-axis: °C

2. **Summer week panel** — same layout for the hottest week (or fixed Jul 15–21). Same lines.

3. **Annual statistics row** — four metric cards:
   - Annual mean indoor temperature (°C)
   - Hours below 20°C (and percentage of year)
   - Hours above 26°C (and percentage of year)
   - Maximum indoor temperature reached (°C)

4. **Engine toggle** — Live | Simulation. Live pulls from `instantCalc envelope-only`. Simulation pulls from `GET /balance?mode=envelope-only` (uses `free_running.hourly` array).

Use `recharts` LineChart with `ReferenceArea` for the comfort band.

**Diagnostic interpretation note** at the bottom (a small info pill, not a paragraph):
> Free-running temperature shows what the envelope does on its own. A well-insulated building stays within the comfort band most of the year. Excursions reveal where fabric or ventilation strategy will need to compensate.

**Commit message:** "Part 8: Free-running Temperature view with winter/summer weeks and annual stats"

**Verify:**
1. Navigate to /building → Free-running Temp tab
2. Both winter and summer week charts render with all three lines (OAT, indoor, comfort band)
3. The four annual stat cards populate
4. Toggle Live/Simulation — values change but stay within ~5% of each other
5. For Bridgewater with sealed windows and trickle vents only, expect: indoor min in winter ~10–14°C, indoor max in summer 28–32°C, overheating hours 100–500 (lightweight UK hotel with internal gains zeroed and only vents for ventilation)
6. **SCREENSHOT:** The full Free-running Temp view with Bridgewater data
7. Report: "Free-running Temperature view working. Bridgewater envelope-only: annual mean [X]°C, hours below 20°C: [X] ([X]%), hours above 26°C: [X] ([X]%), max indoor temp [X]°C. Winter week min [X]°C, summer week max [X]°C. Live vs Simulation within [X]%."

---

## PART 9: Heat Loss Breakdown view

**File(s):** `frontend/src/components/modules/building/HeatLossBreakdown.jsx` (new)

Build the Heat Loss Breakdown view — a focused, large-format presentation of where heat leaves through the envelope annually.

**Layout:**

1. **Large horizontal stacked bar** — annual heat loss split by element, MWh/yr:
   - Walls (split by orientation if useful)
   - Roof
   - Floor
   - Glazing (split by orientation)
   - Fabric leakage
   - Permanent vent flow
   - Thermal bridging (if non-zero)
   - Each segment with its kWh value, percentage of total, and colour matching `balanceColours.js`

2. **Per-element table below the bar** — sortable by contribution:
   ```
   Element             | Area (m²) | U-value | Annual loss (MWh) | % of total | Loss per m²
   Wall — N (F1)       | X         | 0.28    | X                 | X%         | X kWh/m²
   Wall — E (F2)       | X         | 0.28    | X                 | X%         | X kWh/m²
   ...
   Glazing — S (F3)    | X         | 1.43    | X                 | X%         | X kWh/m²
   Roof                | X         | 0.18    | X                 | X%         | X kWh/m²
   Floor               | X         | 0.22    | X                 | X%         | X kWh/m²
   Fabric leakage      | —         | (q50)   | X                 | X%         | —
   Permanent vents     | —         | (EA)    | X                 | X%         | —
   ```

3. **Element selection** — clicking a row highlights the corresponding segment in the bar, and ideally highlights the corresponding surface in a small 3D preview (use the existing `BuildingViewer3D` in a compact embedded form, or skip the 3D preview for v1 and just highlight the bar).

4. **Engine toggle** — Live | Simulation. Live from `instantCalc envelope-only`. Simulation from `/balance?mode=envelope-only`.

**Unit toggle:** kWh ↔ kWh/m²·a (consistent with Heat Balance view).

This view answers: "Which single element costs me the most?" It's the diagnostic prioritisation tool — if the user is going to retrofit, this tells them where to start.

**Commit message:** "Part 9: Heat Loss Breakdown view with per-element annual loss"

**Verify:**
1. Navigate to /building → Heat Loss Breakdown tab
2. Stacked bar renders with all envelope elements
3. Table shows each element with area, U-value, annual loss, % of total
4. Total at bottom of table equals sum of bar segments (sanity check)
5. Click a table row — corresponding bar segment highlights
6. Toggle Live/Simulation — values change within ~5%
7. For Bridgewater, expect glazing and ventilation (vents + leakage) to be the top contributors (typical for UK hotel)
8. **SCREENSHOT:** Heat Loss Breakdown view with Bridgewater data showing the table sorted by contribution
9. Report: "Heat Loss Breakdown view working. Bridgewater envelope-only annual loss: total [X] MWh. Top contributor: [element] at [X] MWh ([X]%). Next: [element] at [X] MWh ([X]%). Glazing total: [X] MWh ([X]%). Ventilation total (leakage + vents): [X] MWh ([X]%). Live vs Simulation within [X]%."

---

## PART 10: Heat Balance view — envelope-only mode visual treatment

**File(s):** `frontend/src/components/modules/balance/HeatBalance.jsx`

The existing Heat Balance component is good but was built assuming State 3 (full picture). In envelope-only mode mounted from the Building module, it should:

1. **Hide internal gains elements** entirely from the gains side (no zero-height bars for people/equipment/lighting — just hide them)
2. **Show a prominent badge** at the top: "Fabric only — no occupancy, no systems"
3. **Use a heating/cooling demand label** rather than "consumption" or "fuel" — the State 1 numbers are demand against the comfort band, not energy used
4. **Stacked layout** stays the same, gains-vs-losses balance presentation
5. **Drill-down (Rows view)** should hide internal gain rows in envelope-only mode

The DrillDown component (`balance/DrillDown.jsx`) compares first-principles, instantCalc, and EnergyPlus values. In envelope-only mode, only the rows relevant to State 1 should appear. The same divergence-flagging logic applies.

Accept a `mode` prop:
```jsx
<HeatBalance projectId={X} runId={Y} mode="envelope-only" />
```

When `mode === 'envelope-only'`, the component fetches `/balance?mode=envelope-only` and from `instantCalc` calls with `{ mode: 'envelope-only' }`.

The component as mounted in `/results` continues to default to full mode — no regression there.

**Commit message:** "Part 10: Heat Balance component supports envelope-only mode with visual treatment"

**Verify:**
1. Navigate to /building → Heat Balance tab
2. Confirm "Fabric only" badge visible
3. Confirm gains side shows only solar (split by orientation) — no people, lighting, equipment elements
4. Confirm losses side shows fabric elements + ventilation split (leakage and vents distinct)
5. Demand row shows heating MWh, cooling MWh (or overheating hours if no cooling system context)
6. Toggle Stacked ↔ Rows — Rows view hides internal gain rows
7. Navigate to /results → Heat Balance tab — full mode unchanged, all elements visible
8. **SCREENSHOT:** /building Heat Balance tab in envelope-only mode, and /results Heat Balance tab in full mode side-by-side
9. Report: "Heat Balance component supports envelope-only mode. Building module: fabric-only badge visible, internal gains hidden, demand labelling used. /results full mode regression-tested clean."

---

## PART 11: Unify file structure and clean up dead code

**File(s):** Various

After Parts 1–10 the Building module has new components. Tidy up:

1. Move all Building-module specific components into `frontend/src/components/modules/building/`:
   - `Openings.jsx` → `PermanentOpenings.jsx`
   - `Fabric.jsx` (existing)
   - `Geometry.jsx` (existing)
   - `Glazing.jsx` (existing)
   - `Shading.jsx` (existing)
   - `CanvasViews.jsx` (new, from Part 7)
   - `FreeRunningTemp.jsx` (new, from Part 8)
   - `HeatLossBreakdown.jsx` (new, from Part 9)

2. Remove dead `SolarBars` function in `LiveResultsPanel.jsx` (noted as dead code in STATUS.md known issues)

3. Update `frontend/src/data/moduleThemes.js` if any colour token needs adjusting for new tabs

4. Ensure all new components use shared utilities:
   - `frontend/src/utils/facadeLabel.js` (from Brief 22) for orientation-aware labels
   - `frontend/src/data/balanceColours.js` for the heat balance palette
   - `frontend/src/utils/instantCalc.js` for live engine

5. Update `STATUS.md`:
   - Mark Brief 24 complete with all 12 parts
   - Note that the Building module now follows the State 1 pattern and Internal Gains module (Brief 25) will follow the same pattern at State 2

**Commit message:** "Part 11: Clean up Building module file structure and dead code"

**Verify:**
1. All Building-module components live under `components/modules/building/`
2. No dead `SolarBars` function in `LiveResultsPanel.jsx`
3. `npm run build` clean — no warnings about unused imports
4. Module loads cleanly
5. Report: "File structure unified under building/ directory. [N] components moved. Dead SolarBars removed. Clean build."

---

## PART 12: Full integration test

Run the complete Building module walkthrough on Bridgewater.

1. Open the app, load Bridgewater project
2. Navigate to /building
3. Confirm no Live Results Panel on right
4. Geometry section: confirm dimensions, no operable window inputs
5. Glazing section: confirm WWR per façade
6. Shading section: confirm overhang/fin inputs per façade
7. Permanent Openings section:
   - Select preset Renson Invisivent EVO AK
   - Width 1344mm, count 138
   - Confirm EA ~7000 mm² per vent, total EA ~0.97 m²
   - Confirm reference flow @ 1 Pa ~760 L/s
   - Confirm typical @ 4 Pa ~1520 L/s, ~0.48 ACH
8. Fabric section:
   - Set q50 to 7 m³/h·m²@50Pa
   - Confirm split readout shows fabric leakage and vent flow distinctly
9. Centre canvas — cycle through all four tabs:
   - 3D Model
   - Heat Balance (envelope-only badge visible, no internal gains rendered)
   - Free-running Temp (winter and summer weeks, four stat cards)
   - Heat Loss Breakdown (stacked bar, sortable table)
10. Run a State 1 simulation
11. Reload — values persist
12. Browser console: zero red errors

**SCREENSHOTS:**
1. /building with no right panel, Permanent Openings section open with Renson preset
2. /building Fabric section showing leakage/vent split
3. /building Heat Balance tab in envelope-only mode
4. /building Free-running Temp tab with Bridgewater winter and summer weeks
5. /building Heat Loss Breakdown tab with element table

**Commit message:** "Part 12: Building module full integration test — State 1 verified end-to-end"

**Verify — final report:**
- Live Results Panel removed from /building: ✓/✗
- Operable windows removed from envelope inputs: ✓/✗
- Permanent Openings with Renson preset working: ✓/✗
- Bridgewater vent figures: 138 vents × 7000 mm² EA = 0.97 m² total, ~0.48 ACH at typical pressure
- Fabric section split readout: fabric leakage [X] ACH, vent flow [X] ACH
- Centre canvas four views all working: ✓/✗
- State 1 free-running temp: annual mean [X]°C, hours below 20°C [X], hours above 26°C [X]
- State 1 envelope-only demand: heating [X] MWh, cooling [X] MWh, overheating hours [X]
- Top heat loss contributor: [element] at [X]% of total
- Live vs Simulation engine agreement: within [X]% on all State 1 numbers
- Browser console: zero red errors across walkthrough

---

## After all 12 parts are complete

Update STATUS.md with:
- All 12 parts completed
- The five-module architecture explicitly named (Building State 1, Internal Gains State 2, Ventilation & Operation State 2.5, Systems State 3, Results/Calibration)
- The envelope-only mode added to `instantCalc.js` and `/balance` endpoint
- Holiday Inn Express Bridgewater State 1 numbers as reference (free-running temp range, envelope demand, overheating hours)
- Known limitations: e.g. free-running temperature uses lumped-capacitance in live engine (not multi-zone aware yet), permanent vent flow assumes equal distribution across façades
- Suggestions for Brief 25 (Internal Gains module — kill /profiles editor, schedules-as-property, State 2 view, gains delta from State 1)

Push to GitHub. Confirm push succeeded.

Tell Chris: "Brief 24 complete. Building module restructured around State 1 envelope-only heat balance. Live Results Panel removed. Operable windows removed (will return in Ventilation & Operation module). Permanent Openings now takes Renson-style equivalent area input — Bridgewater's 138 trickle vents quantified at 0.97 m² total EA, 0.48 ACH typical, ~30 kW winter heat loss. Centre canvas now has 3D Model, Heat Balance (envelope-only badge), Free-running Temperature (winter/summer weeks + annual stats), and Heat Loss Breakdown (per-element table). State 1 envelope-only mode added to live engine and EnergyPlus path. Bridgewater free-running shows summer overheating of [X] hours and winter min indoor temp [X]°C — defensible reason the building needs the VRF system. Next brief: Internal Gains module, kills /profiles editor, schedules become properties of the gains they describe, State 2 view shows demand shift from State 1."
