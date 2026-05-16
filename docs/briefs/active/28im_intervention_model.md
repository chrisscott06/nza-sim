# Brief 28-IM — Intervention Model: end-to-end working physics platform

**Status:** Final draft, ready for Claude Code
**Author:** Chris (with Claude Chat — drafted 2026-05-17, after Chris's full-platform critique)
**Builds on:** Brief 28k, 28L, 28e Phase 1, Brief 28-TB-Simple V1/V1b — all CLOSED. Engine layer validated. This brief is about turning the engine into a working product.
**Supersedes:** Brief 28e Gate E5b scope (3D viewer extension — pulled into IM-M3), prior "Brief 28-DisplayLayer" thoughts (dissolved into per-module gates), prior "Brief 28-SystemsConsumption" sketch (now IM-M4).
**Primary target: STATIC engine.** Dynamic engine output is shown side-by-side per module for verification, but Dynamic is NOT in the critical path. We are not blocked by Dynamic.
**Discipline:** Visible-at-every-gate. UI quality IS gate criteria. Engine + display land together. Pre-screenshot magnitude assertions enforce sanity. Module ownership enforced.

---

## 0. Read this section first

### 0.1 What this brief is for

The physics engine works. The product does not.

Chris opened the dev instance tonight and found:
- Fabric tab construction dropdowns reading "— select —" despite engine using correct BRUKL U-values
- Airtightness slider producing nonsensical heat losses at 1.8 ACH (~1 GWh/yr) because the engine treats the slider input as continuous infiltration when it should derive from a permeability pressurisation result
- Operable entrance door appearing in the Building tab's Heat Balance — wrong module
- Operation tab has lost the consistent left-input / centre-viz / right-3D layout
- Systems tab has "Detailed / Ideal Loads" toggle Chris asked to remove twice
- Systems Sankey has natural-gas flow line crossing through the Lighting node
- Systems Sankey top-right buttons unlabelled ("Detailed / MEV / ASHP Preheat")
- No demand-vs-energy visible separation
- No per-system on/off
- No DHW fuel-mix slider (gas / electric / heat pump blend)
- No baseline-vs-scenario comparison
- No carbon trajectory (today + 2038)
- No monthly energy view
- No profiles in Building / Operation / Systems modules (Internal Gains has them; the rest don't)

This brief lands a working product where Chris can:
1. See every domain rendering correctly across five modules.
2. Edit any input and see Static recompute live.
3. Run interventions (turn systems on/off, swap fuels, change SCOPs, change occupancy, etc.).
4. See baseline vs scenario side-by-side with energy / carbon / EUI deltas.
5. See carbon today and at 2038 with UK grid decarbonisation trajectory.
6. See monthly energy balance (bar chart) for the year.

### 0.2 Reading order for Claude Code

This brief is long. Read in order:

1. §1 — Multi-agent task structure (how to organise the work)
2. §2 — Design principles (non-negotiable across every module)
3. §3 — Module ownership rules (what each tab owns; do not violate)
4. §4 — Bugs to fix (most have a clear engineering answer)
5. §5–§9 — Per-module gate specifications (IM-M1 through IM-M5), in dependency order
6. §10 — Interventions surface (baseline-vs-scenario, IM-M6)
7. §11 — Carbon module (IM-M7)
8. §12 — Validation discipline (pre-screenshot magnitude assertions, halt criteria, dynamic verification per module)
9. §13 — Out-of-scope reminders

Do NOT skim. Brief 28-ThermalBridgingPhysical (drafted earlier today, then archived) was over-scoped because it didn't surface module ownership. Brief 28k Gate 3+ baked in the α=200% bug because nobody questioned the magnitude. This brief enforces both at every gate.

### 0.3 What this brief deliberately does NOT do

- **Calibration against real-life energy data.** Out of scope. The engine shows what physics says.
- **Match BRUKL outputs.** BRUKL inputs (U-values, areas, ventilation flows, airtightness) are used. BRUKL outputs (α, kWh/m²·yr, total HTC) are diagnostics only, not validation targets. Discrepancies are shown and explained, not "fixed" by adjusting physics.
- **Fix the Dynamic engine.** Dynamic must produce a number per module and the number must render correctly side-by-side with Static. If Dynamic differs by 50%, document it; don't block. A separate brief later resolves Dynamic accuracy.
- **Replace the 3D viewer engine.** Use the existing one. Extend it with facade highlighting and per-opening rectangles.
- **Add new physics.** Engine math is complete (or close enough) for fabric / gains / ventilation / thermal bridging / operable openings / systems demand. The systems-demand-to-energy conversion needs implementing (IM-M4) but uses standard `demand / efficiency` math; no novel physics.

---

## 1. Multi-agent task structure

This brief is too large for a single linear pass. Claude Code must internally split into three roles, applied per module gate. This is **internal task discipline**, not literal separate agents.

### Role A — Interpreter

For each module gate (IM-M1 through IM-M7):
- Read the relevant section of this brief.
- Read the current engine code (`frontend/src/utils/instantCalc.js`, `nza_engine/generators/epjson_assembler.py`) and current UI components for the module.
- Identify exactly which engine outputs the module should consume.
- Identify which schema fields are touched, and confirm allowlist plumbing in `ProjectContext._applyProject` (recurring orphan bug — see §4 Bug 7).
- Produce a small diff plan before writing code: which files change, which functions added/modified, which new components, which removed.
- Identify any ambiguities and resolve them by re-reading the brief; do NOT halt and ask Chris unless something is genuinely unresolvable.

### Role B — Builder

- Implement engine math changes (where any).
- Implement UI components per §2 design principles, mechanically.
- Wire the assertion script for the gate's check.
- Run `npm run build` after every commit to confirm it compiles.

### Role C — Verifier

- Run the Playwright helper.
- Capture AFTER screenshots paired against BASELINEs already in the repo.
- Run pre-screenshot magnitude assertions (each module has specific ones — see per-module sections).
- Apply the **design self-check** from §2.6 to every captured screenshot.
- If any screenshot violates a design principle from §2, REJECT and send back to Role B for rework.
- If any magnitude violates physics sanity (see §12), REJECT.
- If any module ownership rule from §3 is violated, REJECT.
- Only halt for Chris review once all three roles have signed off internally.

### Roles applied at the brief level

In addition to per-gate role split, Claude Code should think of the **overall brief** as three concurrent concerns:

- **Interpret** the brief (read, understand, plan)
- **Visualise** (build the UI, make the physics legible)
- **Verify** (numbers right, magnitudes sensible, modules clean, dynamic-vs-static side-by-side present)

Each gate's halt report must show evidence of all three.

---

## 2. Design principles (non-negotiable)

Apply these mechanically. The Verifier role rejects any screenshot that breaks them.

### 2.1 Three-column layout — every module

Every module follows the same shape:

- **Left column (220–280 px)**: inputs only. Sliders, dropdowns, toggles, text inputs.
- **Centre column (flex-fill)**: primary visualisation for this module's physics. View-switcher tabs at the top: *Heat Balance / Sankey / Profiles / Schedule / Monthly / Summary* (as relevant per module).
- **Right column (380–480 px)**: secondary visualisation — 3D model OR Live Results panel OR Dynamic-vs-Static comparison panel.

**Exception**: Results tab is full-width because it's aggregation.

If a module currently violates the three-column rule, fix it. Operation tab specifically (Gate E5a's two-column shape) gets restructured per §7.

### 2.2 View switcher pattern — every module has the same tabs

Every non-trivial module (Building, Internal Gains, Operation, Systems) has a view switcher with these tabs (use only the ones that apply to that module):

- **Heat Balance** — annual gains and losses as Sankey / Rows / Stacked toggleable
- **Sankey** — for Systems specifically: demand-to-energy flow
- **Profiles** — hourly trace of the relevant quantity (loads, gains, system output, temperatures)
- **Schedule** — 24h × 7d schedule grid (occupancy, equipment, lighting, system on/off, opening control)
- **Monthly** — bar chart of energy demand / energy use / temperatures by month (new — see §2.7)
- **Summary** — table of headline numbers with comparisons (Static vs Dynamic, current vs BRUKL where relevant for diagnostic)

Internal Gains already has Schedule / Summary / Heat Balance / Profiles — closest to target. Apply this pattern to Building, Operation, Systems.

### 2.3 Information hierarchy

- **No narrative paragraphs in the visualisation area.** The "Static engine — agreement with Dynamic..." text currently under the Building heat balance is wrong. Move to a collapsible "Diagnostics" panel hidden behind a small (i) info icon.
- **Every chart must have**: title, subtitle (units), axes labelled, legend, units.
  - Example: "Heat Balance · annual gains and losses (MWh/yr) · GIA 4,322 m²" not just "Heat Balance".
  - Example: "Hourly heat loss profile · 2024 TMYx Yeovilton · kW" not just "Profile".
- **No buttons whose function is unclear.** If a button can't be labelled in 1–3 words that say what it does, remove it or rename it.
- **Specifically remove from Systems tab:**
  - "Detailed / Ideal Loads" simulation-mode toggle (Chris asked to remove twice — this is non-negotiable)
  - Unlabelled top-right toggle buttons ("Detailed" / "MEV" / "ASHP Preheat" — replace with proper view-switcher tabs in centre)
  - Right-hand "Live Results / Schedule" panel as currently rendered — replace with the standard Live Results format (consistent across all modules) and move Schedule to a centre-column view
- **Empty states**: If a field reads "— select —" because the engine uses a value via a non-obvious path (e.g. `construction_choices` object form with `u_value_override`), the UI MUST show the value being used. Never silently empty when a value is in fact active.

### 2.4 Static is primary, Dynamic shown side-by-side per module

Chris is not blocked by Dynamic. **Static recompute drives the live UI** (Sefaira pattern: no run button for Static, every input change → recompute ≤ 1s → UI updates).

Dynamic keeps its explicit "Re-run Dynamic" button at top right (already exists). When Dynamic is stale, dot indicator + tooltip "inputs have changed — re-run to refresh".

Within each module, the **Heat Balance / Profiles / Monthly / Summary** views have a Static ↔ Dynamic toggle. When Static is selected (default), the chart renders Static engine output. When Dynamic is selected:
- If Dynamic results are fresh: render Dynamic output, with a thin Static-trace overlay for comparison
- If Dynamic stale: render last available Dynamic output greyed out, with "Re-run Dynamic to refresh" message

This means: **the user can see Dynamic on every module view tab**. If Dynamic disagrees with Static by 50%, that disagreement is visible at every per-module view, and the user can investigate where. This is the "see the workings" principle.

### 2.5 Module ownership enforced at display layer

Every visualisation passes a `modules` prop (or equivalent filter) to the `HeatBalance` rendering component. The component only renders categories belonging to those modules.

- Building tab: `modules={['fabric', 'thermal_bridging', 'fabric_leakage', 'permanent_vents']}`
- Internal Gains tab: adds `'internal_gains'`
- Operation tab: adds `'natural_ventilation'` (operable openings)
- Systems tab: adds `'mechanical_ventilation'` (per-system)
- Results: all modules

Violations show up in screenshots. Verifier rejects.

### 2.6 Design self-check before halt

Before Verifier halts for review, look at each captured screenshot and answer:

- Is this what a building services engineer would expect to see for this module?
- Is the visualisation clear, or cluttered?
- Are there orphaned UI elements (panels, buttons, sliders) whose purpose isn't immediately obvious?
- Does this module clearly answer "what physics am I editing here?"
- Are the magnitudes shown sensible (no 1 GWh from fabric leakage, no zero where there should be a value)?

If any answer is "no" or "unclear", **REJECT and rework**. Do not halt for Chris with a screenshot the team itself thinks is poor.

### 2.7 Monthly view — new across every module

A new universal view tab: **Monthly**. Bar chart of energy demand / energy use by month for the year. 12 bars.

- **Building tab Monthly**: heat loss per month (fabric / TB / leakage / permanent vents stacked), solar gain per month, net demand per month
- **Internal Gains tab Monthly**: gains per month (people / lighting / equipment stacked), net heating demand after gains per month
- **Operation tab Monthly**: net effect of operable openings per month (heat loss / cooling gain bars)
- **Systems tab Monthly**: energy use per month per fuel (electricity / gas stacked) + demand per category line overlay
- **Results Monthly**: total energy / total carbon by month

For Static: the engine already produces hourly traces — aggregate to monthly trivially.
For Dynamic: EP outputs include monthly aggregates by default.

This is one of the most important views. Add it everywhere.

### 2.8 Recompute behaviour

Static: no run button, ≤ 1s recompute, UI updates on every input change.
Dynamic: explicit re-run button (existing), staleness indicator.

---

## 3. Module ownership rules

Strict. Violations cause confusion and get flagged at the visual checkpoint.

### 3.1 Building tab

**Owns:**
- Geometry (footprint, height, orientation, floors)
- Glazing fraction per facade (WWR) and shading
- Construction U-values (wall, roof, ground floor, glazing) and g-values
- Permanent always-open louvre vents (`openings.{face}.louvre_area_m2`)
- Airtightness (`q50` permeability → operational ACH)
- Thermal bridging (`thermal_bridges` from Brief 28-TB-Simple)

**Heat Balance shows:**
- IN-Gains: Solar per facade
- OUT-Losses: External wall · Roof · Ground floor · Glazing · Thermal bridging · Fabric leakage · Permanent vents

**Does NOT show:**
- Operable openings (those are Operation)
- Internal gains (those are Internal Gains)
- Mechanical ventilation (those are Systems)
- System energy consumption (those are Systems)

### 3.2 Internal Gains tab

**Owns:**
- Occupancy density, sensible/latent heat per person
- Lighting power density and schedule
- Equipment power density and schedule
- Weekly / annual / day-type schedules

**Heat Balance shows:**
- IN-Gains: Solar (read-only from Building) + People + Equipment + Lighting
- OUT-Losses: same as Building (read-only display)

**The only place gains+losses appear together** because this is where "what's the net thermal effect of internal use" is answered.

**Does NOT show:**
- Operable openings (Operation)
- System interventions (Systems)

### 3.3 Operation tab

**Owns:**
- Operable openings: doors / windows / vents — each with control mode (always / scheduled / temperature)
- Heat loss / gain through these under their control schedules

**Heat Balance shows:**
- Internal Gains heat balance (read-only) PLUS each operable opening as its own line item

**3D viewer (right column):**
- Building model with facade highlighting when an opening is selected
- Click facade → selects it as parent for next "+ Door / + Window / + Vent" action
- Selected opening shows coloured rectangle on appropriate facade

**Does NOT show:**
- Permanent louvre vents (those are Building — always-open envelope features)
- Mechanical ventilation (Systems)

### 3.4 Systems tab

**Owns:**
- Mechanical ventilation systems (MEV / MVHR): flow, SFP, HRE
- Space heating: type, SCOP, capacity, schedule, on/off toggle
- Space cooling: type, SEER, capacity, on/off toggle
- DHW: type, fuel mix (gas / electric / heat pump blend), on/off toggle
- Auxiliary (pumps, controls)

**Sankey shows demand → systems → energy carriers:**
- Left: demand categories (Space heating · Space cooling · DHW · Vent fans · Lighting · Small power)
- Middle: serving systems (with efficiency annotation: SCOP / SEER / η)
- Right: energy carriers (Grid electricity · Natural gas · etc.) AND waste streams going to the outside (heat rejection / vent exhaust / flue loss)

**Live results (right column, consistent format across modules):**
- EUI (kWh/m²·yr) with CRREM target comparison
- Energy by demand (demand MWh + delivered MWh per category — making demand-vs-energy visible)
- Fuel split %

**Per-system editor (left column):**
- Each system: on/off toggle
- When OFF: demand still calculated but no energy flows to it (shown as "unserved" in Sankey)
- DHW: fuel-mix sliders (e.g. 70% ASHP, 30% gas) summing to 100%

**Does NOT show:**
- Fabric losses (Building / Internal Gains)
- Operable openings (Operation)

### 3.5 Results tab

**Owns:**
- Aggregation across all modules
- Carbon (today + 2038 trajectory + UK grid decarbonisation)
- EUI breakdown
- CRREM benchmark
- Baseline vs scenario comparison

**Does NOT introduce new physics.** Final aggregation view.

---

## 4. Bugs to fix (each with clear engineering answer)

### Bug 1 — Fabric construction dropdowns show "— select —"

**Symptom:** Building tab External Wall / Roof / Ground Floor / Glazing dropdowns read "— select —" despite engine using BRUKL U-values correctly.

**Cause:** Seed sets `construction_choices.external_wall = { library_id: 'cavity_wall_enhanced', u_value_override: 0.14 }` (object form). The dropdown component expects a string `library_id`.

**Fix:**
- Update construction selector to handle string (legacy) AND object (Brief 28L+) forms.
- Display selected library entry's name as the dropdown value.
- When `u_value_override` set: badge "✏️ U=0.14 (override)".
- When no override: badge "U=0.18 (library)".
- Clicking the badge expands a popover comparing layer-stack U vs override.

### Bug 2 — Airtightness slider produces nonsense

**Symptom:** Setting ACH = 1.8 produces ~700 MWh/yr fabric leakage. Engine math is correct (`UA = 0.33 × ACH × V`); the input semantics are wrong.

**Cause:** UI exposes `infiltration_ach` directly as a continuous infiltration rate. Real buildings are characterised by air permeability `q50` (m³/h·m² @ 50Pa, pressurisation test result). Operational infiltration ≈ `n50 / 20` where `n50 = q50 × A_envelope / V` (ATTMA convention; "divide-by-20 rule").

For Bridgewater: q50 = 4.64 → n50 = 1.93 ACH @ 50Pa → operational ≈ 0.097 ACH.

**Fix:**
- New schema field: `building_config.fabric.air_permeability_q50` (m³/h·m² @ 50Pa, range 1–25).
- Engine helper:
  ```javascript
  function deriveOperationalACH(building, geometry) {
    const q50 = building?.fabric?.air_permeability_q50
    if (Number.isFinite(q50) && q50 > 0) {
      const A_env = geometry.total_wall + geometry.roof_area + geometry.ground_area
      const n50 = q50 * A_env / geometry.volume
      return { n_op: n50 / 20, n50, q50, source: 'q50' }
    }
    const legacy = building?.infiltration_ach
    if (Number.isFinite(legacy) && legacy >= 0) {
      return { n_op: legacy, n50: legacy * 20, q50: null, source: 'legacy_ach' }
    }
    return { n_op: 0.5, n50: 10, q50: null, source: 'default' }
  }
  ```
- Replace `const ach = Number(building.infiltration_ach ?? 0.5)` (instantCalc.js line 752 and other occurrences) with call to this helper.
- Seed Bridgewater with `fabric.air_permeability_q50 = 4.64` (from BRUKL Page 1 air permeability test result).
- UI input: "Air permeability q₅₀ (m³/h·m² @ 50 Pa)" with allowed range 1–25.
- Derived badges below input: "→ n₅₀ = 1.93 ACH @ 50Pa" and "→ n_operational = 0.097 ACH".
- Slider has labelled bands: "Best practice (≤ 3)", "Typical (3–10)", "Leaky (> 10)".
- Legacy `infiltration_ach` stays in schema, deprecated. Engine prefers `q50` when present.

### Bug 3 — Operable door appears in Building tab Heat Balance

**Symptom:** `losses_at_setpoint.natural_ventilation[0]` (entrance door) renders in Building tab heat balance.

**Cause:** `HeatBalance.jsx` renders all categories in `losses_at_setpoint`. Module ownership not enforced at display.

**Fix:**
- `HeatBalance.jsx` accepts `modules` prop (array of category keys).
- Each tab passes the appropriate modules array per §3.
- Component filters categories before rendering.

### Bug 4 — Operation tab layout doesn't match the three-column pattern

**Symptom:** Gate E5a's two-column layout (list editor + 3D) doesn't follow left-input / centre-viz / right-3D.

**Fix:** Rewrite to three-column per §2.1 and §7. Centre column gets the view-switcher with Heat Balance / Profiles / Schedule / Monthly / Summary.

### Bug 5 — Systems tab UI noise

**Symptom:** "Detailed / Ideal Loads" toggle not removed despite explicit request. Top-right unlabelled buttons ("Detailed / MEV / ASHP Preheat"). Right-hand panel non-conformant. DHW Sankey green dotted line confusing. Natural gas crosses through Lighting node in Sankey routing.

**Fix:**
- Remove "Detailed / Ideal Loads" toggle entirely.
- Top-right buttons → replace with proper view-switcher tabs in centre column: Sankey / Profiles / Schedule / Monthly / Summary. ASHP Preheat toggle moves to DHW system configuration in left column.
- Right-column panel → replace with standard Live Results format (consistent across modules). Schedule is a centre-column view.
- DHW Sankey: ASHP preheat flow renders **red** (energy carrier from electricity grid), not green-dotted. Green is reserved for recovered/free energy (vent heat recovery, etc.).
- Sankey routing: use d3-sankey `nodeSort` to place natural gas and DHW boiler vertically adjacent so the flow doesn't cross Lighting. If d3-sankey insists on a crossing, force a curved path that visibly arcs around the intervening node — not a straight line through it.

### Bug 6 — 3D model facade selection / opening rectangles missing

**Fix in Operation tab per §7:**
- Hover a facade in 3D → that facade glows (outline / fill colour shift).
- Click → that facade selected for next "+ Door / + Window / + Vent" action.
- Each opening rendered as coloured rectangle at approximate position on facade (door = blue, window = cyan, vent = green).
- Selected opening in left list → its rectangle pulses or shows thicker outline.

### Bug 7 — Recurring orphan plumbing pattern

**Symptom:** Three separate instances where engine persists a field, ProjectContext allowlist drops it, UI silently broken:
1. `weatherCtx.hourlySolar` (TB-V1)
2. `operable_openings` and `thermal_bridges` (TB-V1b)
3. `BalanceTestPage` libraryData passed as `{}` (TB-V1b)

**Fix:**
- Add to every gate's pre-screenshot assertion script: "every field in the persisted `building_config` API response is present in `params` (the ProjectContext-exposed shape)".
- New file `docs/discipline/context_allowlist_check.md` documenting this pattern.

### Bug 8 — Missing view tabs in Building / Operation / Systems

**Fix per §5–§8:**
- Building gets: Heat Balance / Profiles / Monthly / Summary (no Schedule needed)
- Operation gets: Heat Balance / Profiles / Schedule / Monthly / Summary
- Systems gets: Sankey / Profiles / Schedule / Monthly / Summary
- Internal Gains already has Heat Balance / Profiles / Schedule / Summary — add Monthly

---

## 5. Module: Building (Gate IM-M1)

### 5.1 Engine changes

**Schema additions:**
```javascript
building_config.fabric.air_permeability_q50: number    // m³/h·m² @ 50Pa, range 1-25
building_config.fabric.infiltration_ach: number        // DEPRECATED — back-compat
```

**Engine math:** Replace `const ach = Number(building.infiltration_ach ?? 0.5)` at lines 752, 1925, 3459, 4151 of `instantCalc.js` with call to `deriveOperationalACH(building, geometry)` (per Bug 2). Use the returned `n_op` in the `UA_leakage` calc. Also expose the derived `n50` and `q50` values in the engine output for the UI badges.

Engine output additions:
```javascript
losses_at_setpoint.fabric_leakage: {
  heating_loss_kwh: number,
  cooling_gain_kwh: number,
  operational_ach: number,           // n_op
  n50_ach: number,                   // n50
  q50_m3_per_h_m2: number,           // q50 input
  source: 'q50' | 'legacy_ach' | 'default'
}
```

**Bridgewater seed update:**
- Add `fabric.air_permeability_q50 = 4.64` (BRUKL Page 1).
- Keep `infiltration_ach` for back-compat but engine prefers q50.

### 5.2 UI changes — Building tab

**Left column inputs:**
1. **Geometry** (collapsible) — name, length, width, floors, floor height, orientation, GIA / volume readout
2. **Glazing (WWR)** per facade — sliders + win-count display
3. **Shading** per facade — collapsed by default
4. **Fabric** — fix Bug 1:
   - External Wall: dropdown shows selected library name, with badge "U=0.14 ✏️ (override)" or "U=0.18 (library)"
   - Roof, Ground Floor, Glazing: same pattern
   - g-value for glazing: small slider beneath glazing dropdown
5. **Airtightness** — fix Bug 2:
   - Input: "Air permeability q₅₀ (m³/h·m² @ 50 Pa)", range 1–25, current 4.64
   - Read-only badge: "→ n₅₀ = 1.93 ACH @ 50Pa"
   - Read-only badge: "→ n_operational = 0.097 ACH"
   - Slider zones labelled "Best practice (≤ 3)", "Typical (3–10)", "Leaky (> 10)"
6. **Permanent openings** (louvres) — existing UI (keep)
7. **Thermal bridges**:
   - Mode dropdown (ISO 14683 auto / Manual H_TB / Absent) — default `iso14683_auto`
   - Multiplier slider 0.5–3.0, default 1.0
   - Read-only badge: "→ H_TB = 92.94 W/K"
   - Expandable per-junction breakdown table

**Centre column — view switcher tabs:**

**Heat Balance** (default):
- Title: "Heat Balance · annual gains and losses (MWh/yr) · GIA 4,322 m²"
- Subtitle: "Envelope only — no occupancy, no systems, no operable openings"
- View toggle (top-right of centre): Rows / Stacked / Sankey + Static / Dynamic + kWh / kWh/m²·a
- Categories shown per §3.1 (no operable openings, no internal gains, no mech vent)
- Below chart: Comfort band slider + Heating demand / Cooling demand badges + Comfort hours strip
- **Remove** narrative paragraph; move to (i) icon at top-right that opens a Diagnostics popover

**Profiles** (new):
- Title: "Hourly heat loss / gain profile · 2024 TMYx Yeovilton · kW"
- 8760-hour trace with line toggles: Total fabric loss / Per-element / Solar per facade
- X-axis: day of year (1–365) with month markers
- Y-axis: kW
- Static/Dynamic toggle: when Dynamic selected, render Dynamic trace with Static as thin overlay
- Hover tooltip: hour, day, dominant element, value

**Monthly** (new):
- Title: "Monthly heat loss vs solar gain · MWh"
- 12 bars per month:
  - Negative direction (losses): fabric / TB / leakage / vents stacked
  - Positive direction (gains): solar per facade stacked
  - Net heating demand: line overlay
- Static/Dynamic toggle

**Summary** (new):
- Table:
  - Total fabric UA (W/K) with per-element breakdown
  - Area-weighted average U-value (for BRUKL diagnostic comparison)
  - Peak heat loss hour (date, time, value, dominant element)
  - Peak solar gain hour
  - Annual heating demand (Static · Dynamic · Δ)
  - Annual cooling demand (Static · Dynamic · Δ)
  - Hours under 21°C / in band / over 25°C (free-running)
- Static-vs-Dynamic comparison panel at bottom:
  - Per-element annual losses Static · Dynamic · Δ% with conventional-difference annotation where known (e.g. "sky long-wave radiation difference — documented Brief 28L convention")

**Right column:**
- View toggle: 3D Model / Live Results
- **3D Model** (default): existing viewer with solar heatmap overlay
- **Live Results**: compact KPI panel
  - Heating demand (MWh)
  - Cooling demand (MWh)
  - Annual mean temp (free-running)
  - Total fabric UA
  - Total H_TB

### 5.3 Gate IM-M1 PASS criteria

Pre-screenshot assertions:
```
engine: demand.heating_demand_mwh between 400 and 550 (Bridgewater expected ~488)
engine: losses_at_setpoint.thermal_bridging.heating_loss_kwh between 6000 and 15000
engine: losses_at_setpoint.fabric_leakage.operational_ach between 0.05 and 0.15 for q50=4.64
engine: losses_at_setpoint.fabric_leakage.n50_ach between 1.5 and 2.5
ui: External Wall dropdown shows "Cavity wall enhanced" with badge "U=0.14 ✏️ (override)"
ui: Roof / Ground Floor / Glazing dropdowns show selected library item + badges
ui: Airtightness section shows q₅₀ input AND both derived ACH badges
ui: Heat Balance has lines for: External wall, Roof, Ground floor, Glazing, Thermal bridging, Fabric leakage, Permanent vents
ui: Heat Balance does NOT have lines for: Operable openings, Internal gains, Mech ventilation
ui: View switcher in centre column shows tabs: Heat Balance / Profiles / Monthly / Summary
ui: Profiles tab renders a chart with hourly traces
ui: Monthly tab renders 12 bars
ui: Summary tab renders Static-vs-Dynamic comparison table
ui: No paragraph of narrative text under any chart
ui: Right column 3D viewer renders with WWR.north = 35%
context_allowlist: 'fabric.air_permeability_q50' present in params shape
```

Screenshots:
- `im_M1_building_heat_balance.png`
- `im_M1_building_profiles.png`
- `im_M1_building_monthly.png`
- `im_M1_building_summary.png`
- `im_M1_building_3d.png`

---

## 6. Module: Internal Gains (Gate IM-M2)

### 6.1 Engine changes

None — Brief 28k internal gains already work.

### 6.2 UI changes

Internal Gains is closest to target pattern. Audit and apply:

**Left column:** existing Occupancy / Lighting / Small power / Hot water / Profiles sections — keep. Verify each shows current value + units clearly.

**Centre column — view switcher (verify all five present):**
- **Schedule** (existing weekly grid) — keep
- **Summary** (existing table) — keep
- **Heat Balance** — apply Bug 3 fix: pass `modules` prop including internal gains
- **Profiles** (existing) — keep
- **Monthly** (new per §2.7) — bars: gains per month (people / lighting / equipment stacked) + net heating demand line

**Right column:**
- Live Results panel (consistent format)
- Scoped to State 2 outputs: Heating demand (with gains), Cooling demand (with gains), Annual internal gains total, Net heating offset from gains

### 6.3 Gate IM-M2 PASS criteria

```
ui: Heat Balance IN-Gains has lines: Solar (F1-F4), People, Equipment, Lighting
ui: Heat Balance OUT-Losses has same 7 Building categories (NO door, NO mech vent)
ui: Schedule grid shows occupancy from seed
ui: Summary table includes Static-vs-Dynamic comparison
ui: Profiles tab renders hourly gain trace
ui: Monthly tab renders 12 bars with gains + heating demand line
ui: All 5 view tabs present and clickable
ui: Static/Dynamic toggle present on Heat Balance / Profiles / Monthly / Summary
```

Screenshots:
- `im_M2_internal_gains_heat_balance.png`
- `im_M2_internal_gains_schedule.png`
- `im_M2_internal_gains_summary.png`
- `im_M2_internal_gains_profiles.png`
- `im_M2_internal_gains_monthly.png`

---

## 7. Module: Operation (Gate IM-M3)

This is the most UI work. Gate E5a's two-column layout becomes three-column.

### 7.1 Engine changes

None for operable openings (Brief 28e Phase 1 done).

Schema audit: confirm `operable_openings[]` per-item fields include facade designation (`parent_facade` or `parent_glazing_face`). 3D viewer needs this to draw the rectangle.

### 7.2 UI changes — Operation tab full rewrite

**Left column:**
- Section: "Operable openings" with counter
- Per-opening compact row (collapsed by default):
  - Mode badge ([Scheduled] / [Permanent] / [Temperature])
  - Name + facade
  - Geometry summary "4.00 m² × 2.00 m"
  - Expand chevron
- Expanded row shows full editor from Gate E5a (mode, name, facade dropdown, opening_type, geometry, control mode parameters with hysteresis / require_outside_cooler / etc.)
- "+ Door / + Window / + Vent" buttons below the list
- When clicked: 3D viewer enters facade-select mode (centre/right column responds)
- Legacy conversion CTA (Gate E5a) — keep behaviour

**Centre column — view switcher tabs:**

**Heat Balance:**
- Same shape as Internal Gains Heat Balance, but pass `modules` including `'natural_ventilation'`
- Each operable opening rendered as own line item (already in engine output: `losses_at_setpoint.natural_ventilation[]`)

**Profiles:**
- Title: "Hourly opening flow and heat loss · kg/s · kW"
- Per-opening line toggles
- Flow rate (m³/s) and heat loss (kW) on twin Y-axes
- Schedule overlay (open hours highlighted)
- Static/Dynamic toggle

**Schedule:**
- 24h × 7d × month grid for each scheduled opening's control schedule
- Temperature-mode openings show "open above T_zone > X°C" as a banded threshold view, not a grid

**Monthly:**
- 12 bars: net heat loss / cool gain per month, per opening stacked

**Summary:**
- Per-opening table: open hours, avg flow rate, total annual heat loss, total cool gain
- Static-vs-Dynamic comparison: Brief 28e Gate E4 already surfaced ±34% delta on the door — show this in the comparison column with annotation "wind-angle convention difference (BS 5925 vs EP F_w autocalc) — see Brief 28-WindAngleNaturalVentilation"

**Right column:**
- **3D Model** (default):
  - Building model rendered
  - Hover facade → outline glows
  - Click facade → selected for next "+ Door / + Window / + Vent"
  - Opening as coloured rectangle (door = blue, window = cyan, vent = green)
  - Selected opening pulses
  - Solar heatmap overlay (existing) — keep
- View toggle: 3D / Live Results

### 7.3 Gate IM-M3 PASS criteria

```
engine: losses_at_setpoint.natural_ventilation.length === 1 (Bridgewater door)
engine: losses_at_setpoint.natural_ventilation[0].heating_loss_kwh between 100000 and 200000
ui: Three-column layout (not two-column)
ui: Left column shows door entry from seed
ui: Heat Balance shows door as line item
ui: Heat Balance does NOT show mech ventilation (Systems territory)
ui: Profiles tab renders door flow rate trace
ui: Schedule tab renders door's business_hours_09_18_weekdays schedule
ui: Monthly tab renders 12 bars
ui: Summary tab shows door's open hours (~2349) and Static-vs-Dynamic Δ annotation
ui: 3D viewer in right column shows building with door rectangle on south facade
ui: All 5 view tabs present
ui: "+ Door / + Window / + Vent" buttons present
```

Screenshots:
- `im_M3_operation_heat_balance.png`
- `im_M3_operation_profiles.png`
- `im_M3_operation_schedule.png`
- `im_M3_operation_monthly.png`
- `im_M3_operation_summary.png`
- `im_M3_operation_3d_selected.png` (with the door selected, rectangle visible)

---

## 8. Module: Systems (Gate IM-M4)

The biggest engine work in this brief — demand-to-energy conversion not yet implemented.

### 8.1 Engine changes — demand to energy

**Engine math:**
For each demand category, compute energy consumed:
```javascript
// Space heating
electricity_heating_kwh = heating_demand_kwh / SCOP_heating       (for ASHP / VRF / electric resistance with SCOP=1)
gas_heating_kwh = heating_demand_kwh / efficiency_heating         (for gas boiler)

// Space cooling
electricity_cooling_kwh = cooling_demand_kwh / SEER_cooling

// DHW (fuel mix)
dhw_demand_kwh = annual_dhw_litres_per_person × num_people × delta_T × specific_heat
dhw_electricity_kwh = dhw_demand_kwh × dhw_fuel_mix.heat_pump / SCOP_ashp_dhw
                    + dhw_demand_kwh × dhw_fuel_mix.electric_resistance / 1
dhw_gas_kwh = dhw_demand_kwh × dhw_fuel_mix.gas / efficiency_dhw_boiler

// Ventilation fans
fan_kwh_per_system = SFP_W_per_l_per_s × flow_rate_l_per_s × annual_runtime_hours / 1000

// Lighting (existing)
// Small power / equipment (existing)
```

**System on/off**: when a system is OFF (`enabled: false`):
- demand category still calculated (e.g. there's still a heating demand the building has)
- but `electricity_heating_kwh = 0` and the demand shows as "unserved" in the Sankey
- This makes the impact visible: "turn off heating → see what the building demand was without it being met"

**Schema additions** on `systems_config_v25`:
```javascript
heating: {
  enabled: boolean,        // NEW
  type: 'vrf' | 'ashp' | 'gas_boiler' | 'electric_resistance' | 'district_heating',
  scop_heating: number,
  efficiency_gas: number,
  schedule_ref: string,
  // ... existing fields
}
cooling: { enabled, type, seer, schedule_ref, ... }
dhw: {
  enabled: boolean,
  fuel_mix: {              // NEW — must sum to 1.0
    gas: number,
    electric_resistance: number,
    heat_pump: number,
  },
  scop_ashp_dhw: number,
  efficiency_gas_dhw: number,
  annual_demand_kwh: number,
  schedule_ref: string,
}
ventilation: [             // existing per-system (Brief 28L) — add `enabled` boolean per system
  { id, enabled, type, flow_l_per_s, sfp_W_per_l_per_s, hre_efficiency, hre_enabled, schedule_ref, ... }
]
```

**Engine output additions:**
```javascript
consumption: {
  space_heating: { demand_mwh, delivered_mwh, electricity_mwh, gas_mwh, district_heat_mwh, scop_effective },
  space_cooling: { demand_mwh, delivered_mwh, electricity_mwh, seer_effective },
  dhw: { demand_mwh, delivered_mwh, electricity_mwh, gas_mwh, fuel_mix_applied },
  ventilation: [{ id, fan_electricity_mwh, hre_recovery_mwh, exhaust_loss_mwh }],
  lighting: { electricity_mwh },
  small_power: { electricity_mwh },
  total: { electricity_mwh, gas_mwh, district_heat_mwh, kwh_per_m2_yr }
}
```

**Bridgewater seed update:**
- Add `enabled: true` to all existing systems
- DHW: `fuel_mix: { gas: 1.0, electric_resistance: 0.0, heat_pump: 0.0 }` (current BRUKL is gas-fired DHW per Page 27)
- Heating: type VRF, SCOP 5.12 from BRUKL Page 2 "VRF bedrooms" (the largest of the four)
- Cooling: type VRF, SEER 3.51 from same row

### 8.2 UI changes — Systems tab full rewrite

**Left column inputs:**

Section per system type:
1. **Heating** section:
   - On/off toggle at top
   - Type dropdown (VRF / ASHP / Gas boiler / Electric resistance / District heat)
   - SCOP slider (range depends on type: ASHP 2.0-5.0, VRF 2.0-6.0, electric 1.0 fixed, gas boiler 0.7-0.95 efficiency)
   - Schedule reference dropdown
2. **Cooling** section: same shape — on/off, type, SEER, schedule
3. **DHW** section:
   - On/off toggle
   - **Fuel mix** — three sliders summing to 100%: Gas / Electric resistance / Heat pump
   - SCOP for heat pump (if mix > 0): slider
   - Efficiency for gas (if mix > 0): slider
   - Annual demand input (litres/person/day or equivalent)
4. **Ventilation** section (list of systems, Brief 28L existing):
   - Per system: on/off toggle, type (MEV/MVHR/Natural), flow rate (l/s), SFP, HRE on/off, HRE efficiency
5. **Lighting** section (existing): LPD slider, schedule
6. **Small Power** section (existing): EPD slider, schedule

**Centre column — view switcher tabs:**

**Sankey** (default):
- Demand → systems → energy carriers (per §3.4)
- Three node columns:
  - Demand (left): Space heating · Space cooling · DHW · Vent fans · Lighting · Small power
  - System (middle): named systems with SCOP/SEER/η annotated
  - Energy carriers (right): Grid electricity · Natural gas · (district heat if applicable)
  - Waste streams going to right edge: Heat rejection (cooling) · Vent exhaust loss · Flue loss (gas)
- Sankey routing: prevent flows from crossing unrelated nodes (Bug 5 fix)
- DHW ASHP preheat shows as red flow (grid → ASHP → DHW boiler preheat), not green
- Title: "Energy flow — demand to system to fuel · MWh/yr"

**Profiles:**
- Title: "Hourly system output and energy use · kW"
- Per-system line toggles (heating output, cooling output, DHW output, fan power, total electricity, total gas)
- Static/Dynamic toggle

**Schedule:**
- 24h × 7d × month grid per system showing when each runs
- For schedule-driven systems: shows the actual schedule
- For demand-driven systems: shows "on whenever demand > 0"

**Monthly:**
- Bars per month: electricity use (stacked: heating / cooling / DHW / fans / lighting / small power) + gas use (stacked: heating / DHW)
- Line overlay: heating demand line, cooling demand line, DHW demand line (so demand-vs-energy is visible)

**Summary:**
- Table:
  - Per category: demand (MWh) → delivered (MWh) → consumed by carrier (MWh) → effective SCOP
  - Total electricity (MWh, kWh/m²·yr)
  - Total gas (MWh, kWh/m²·yr)
  - Total EUI (kWh/m²·yr) with CRREM target comparison
  - Static-vs-Dynamic comparison for each category

**Right column — Live Results panel** (standard format per §2):
- EUI (kWh/m²·yr) big number + CRREM target bar
- Energy by demand: each category showing DEMAND MWh and DELIVERED MWh side-by-side (the demand-vs-energy distinction visible)
- Fuel split: Elec / Gas / DH bars with percentages
- Total waste / recoverable
- All instant-recompute as the user changes inputs

### 8.3 Removals from Systems tab

- Delete the "Detailed / Ideal Loads" simulation mode toggle
- Delete the unlabelled top-right buttons (Detailed / MEV / ASHP Preheat) — replaced with proper view switcher
- Remove the right-hand "Live Results / Schedule" panel — replaced with standard Live Results (and Schedule becomes a centre-column view)

### 8.4 Gate IM-M4 PASS criteria

```
engine: consumption.total.kwh_per_m2_yr between 60 and 120 (Bridgewater expected ~80-100)
engine: consumption.space_heating.delivered_mwh > 0 when heating enabled
engine: consumption.space_heating.delivered_mwh === 0 when heating disabled
engine: consumption.dhw.fuel_mix_applied matches input fuel_mix
engine: consumption.ventilation.length === 3 (Bridgewater seed)
engine: consumption.total.electricity_mwh + consumption.total.gas_mwh > 0
ui: Heating section has on/off toggle + SCOP slider
ui: Cooling section has on/off toggle + SEER slider
ui: DHW section has fuel-mix sliders summing to 100%
ui: Each Ventilation system has on/off + HRE on/off toggles
ui: Sankey shows demand → systems → carriers (NO unlabelled buttons)
ui: Sankey does NOT have "Detailed / Ideal Loads" toggle anywhere
ui: Sankey routing — no flow crosses through unrelated node
ui: DHW ASHP preheat (if mix > 0) renders red, not green-dotted
ui: All 5 view tabs present (Sankey / Profiles / Schedule / Monthly / Summary)
ui: Live Results panel shows demand-vs-delivered for each category
ui: Toggling Heating off → Sankey shows space_heating demand unserved
```

Screenshots:
- `im_M4_systems_sankey.png` (baseline state — VRF + gas DHW)
- `im_M4_systems_sankey_heating_off.png` (heating toggled off, unserved demand visible)
- `im_M4_systems_sankey_dhw_blend.png` (DHW set to 50% gas / 50% ASHP, fuel split visibly changes)
- `im_M4_systems_profiles.png`
- `im_M4_systems_schedule.png`
- `im_M4_systems_monthly.png`
- `im_M4_systems_summary.png`

---

## 9. Module: Results (Gate IM-M5)

### 9.1 Engine changes

Aggregation only. New output block:
```javascript
results: {
  energy: {
    total_mwh, kwh_per_m2_yr,
    by_category: { heating, cooling, dhw, ventilation, lighting, small_power },
    by_carrier: { electricity, gas, district_heat }
  },
  carbon: {
    today: { kgCO2_per_m2_yr, total_tCO2 },
    by_carrier: { electricity, gas },
    grid_intensity_today_kgCO2_per_kWh: number,
    trajectory: [               // 2024-2050
      { year, kgCO2_per_m2_yr, grid_intensity }
    ]
  },
  crrem: {
    target_2030: number,        // kgCO2/m²/yr from CRREM dataset
    target_2050: number,
    current_kgCO2_per_m2: number,
    year_of_exceedance: number  // year when current trajectory exceeds CRREM target
  }
}
```

### 9.2 UI changes — Results tab full-width

(Single-column-friendly: this is aggregation, not editing.)

**Top: KPIs row**
- EUI (kWh/m²·yr) + CRREM target arrow indicator
- Annual carbon today (kgCO2/m²/yr + total tCO2)
- Annual carbon 2038 (projected with grid decarbonisation)
- Year of CRREM target exceedance (if any)

**Centre: view switcher**

**Energy** (default):
- Sankey — same as Systems Sankey but full-width
- Bar chart: Energy by category (heating / cooling / DHW / vent / lighting / SP)
- Bar chart: Energy by carrier (electricity / gas)

**Carbon**:
- Line chart: kgCO2/m²/yr trajectory 2024–2050
- Overlay: CRREM target line (1.5°C-aligned for relevant building type)
- Visual marker: today's value, 2038's value, year of exceedance
- Breakdown: contribution by carrier (electricity following grid decarb trajectory, gas flat)

**Monthly:**
- 12 bars: Total electricity + Total gas stacked per month
- Overlay: outdoor temperature line (to show heating/cooling drivers)

**Summary:**
- Headline numbers in tabular form
- Static-vs-Dynamic Δ% per category

### 9.3 UK grid carbon trajectory data

Use BEIS / DESNZ grid carbon factors:
- 2024: ~190 gCO2/kWh
- 2030: ~50 gCO2/kWh (committed)
- 2035: ~10 gCO2/kWh (target — note uncertainty)
- 2050: ~5 gCO2/kWh (net zero scenario)

Linear interpolation between these points for any year. Hardcode the trajectory in a new file `frontend/src/data/ukGridCarbonTrajectory.js` with a comment citing the BEIS Green Book Supplementary Guidance and noting the values are projected and should be updated when newer official forecasts are published.

Gas factor: 184 gCO2/kWh (DESNZ, stable — gas combustion emissions don't decarbonise).

### 9.4 Gate IM-M5 PASS criteria

```
engine: results.energy.kwh_per_m2_yr between 60 and 120
engine: results.carbon.today.kgCO2_per_m2_yr > 0
engine: results.carbon.trajectory.length >= 27 (2024-2050)
engine: results.carbon.trajectory[2038-2024].grid_intensity < 30 (gCO2/kWh by 2038)
engine: results.crrem.year_of_exceedance is a year or null
ui: Top row shows 4 KPIs
ui: Energy view shows full-width Sankey
ui: Carbon view shows trajectory line chart 2024-2050
ui: Carbon trajectory has CRREM target overlay
ui: Monthly view shows 12 bars with elec + gas stacked
ui: Summary view shows Static-vs-Dynamic comparison table
```

Screenshots:
- `im_M5_results_energy.png`
- `im_M5_results_carbon_trajectory.png`
- `im_M5_results_monthly.png`
- `im_M5_results_summary.png`

---

## 10. Interventions surface — Retrofit Roadmap (Gate IM-M6)

This is the core product story. Chris's project is: "does an intervention roadmap get this building to its EUI and GHG targets for CRREM, and when?"

The intervention surface is therefore NOT a baseline-vs-single-scenario comparison. It is a **sequenced, dated roadmap** of interventions where each intervention reads the state of the building AFTER all prior interventions, on top of a UK grid carbon trajectory that's decarbonising independently.

### 10.1 Conceptual model

A **Roadmap** is an ordered list of **Interventions**. Each Intervention has:
- A type (e.g. "Replace gas boiler with ASHP", "Add MVHR to extract systems", "Reduce LPD", "Upgrade glazing U-value")
- A year of implementation (e.g. 2027)
- Parameters specific to its type (e.g. for ASHP swap: new SCOP, new capacity; for MVHR add: new SFP, HRE efficiency)
- An applied state once placed on the timeline

The engine computes the building's energy and carbon **per year** from 2026 to 2050:
- For each year Y: take Baseline + all Interventions with `year ≤ Y` applied in order
- Run the full physics engine once per year-state
- Multiply electricity consumption by that year's grid carbon intensity (from `ukGridCarbonTrajectory.js`)
- Multiply gas consumption by its constant gas factor
- Sum to get `kgCO2/m²·yr` for that year
- Output a `yearly_trajectory[]` array

This produces a trajectory like:
```
2026 (Baseline):                       kgCO2/m²·yr = 35.2,   EUI = 95
2027 (after I1 - LED upgrade):         kgCO2/m²·yr = 32.1,   EUI = 87
2027 (after I2 - airtightness):        kgCO2/m²·yr = 29.4,   EUI = 78    [I1+I2 in same year]
2030 (after I3 - ASHP replaces gas):   kgCO2/m²·yr = 18.7,   EUI = 64    [grid decarb 50 gCO2/kWh]
2035 (after I4 - MVHR adds HRE):       kgCO2/m²·yr = 12.3,   EUI = 56
2038 (no new intervention):            kgCO2/m²·yr = 8.5,    EUI = 56    [grid decarb continues]
2050 (no new intervention):            kgCO2/m²·yr = 6.2,    EUI = 56
```

### 10.2 Sequential application — the key behaviour

**Interventions must read the state AFTER all prior interventions, not from Baseline.**

Example sequence Chris described:
- **Intervention 1 (2027)**: Fabric improvements → heating demand drops from 488 MWh to 320 MWh
- **Intervention 2 (2030)**: Replace gas boiler with ASHP → must use the **reduced 320 MWh demand**, not the original 488 MWh. ASHP energy = 320 MWh / SCOP, not 488 MWh / SCOP.
- **Intervention 3 (2030, same year)**: Replace extract fan with MVHR → must read I1+I2's state. MVHR brings:
  - Heat recovery benefit (reduces heating demand further from 320 → say 280 MWh)
  - Additional electricity cost (dual-fan MVHR vs single extract fan)
  - Both reflected in I3's delta
- **Intervention 4 (2032)**: Reduce occupancy density → reads I1+I2+I3's state. Lower occupancy means lower internal gains, which can INCREASE heating demand slightly (gains were offsetting heating). Must show this honestly, not just "less occupancy = less energy."

**Implementation:** The engine runs N times for N interventions: once per intervention-applied state. The order is determined by year, then by within-year sequence (user can re-order interventions within the same year by drag-drop in the UI).

Each intervention's "saving" delta is computed as the difference between its applied state and the immediately prior state, **not** vs Baseline. The cumulative effect vs Baseline is shown separately.

### 10.3 UX — Roadmap module

New top-level module / tab: **Roadmap** (sits alongside Building / Internal Gains / Operation / Systems / Results).

**Layout (full-width):**

**Top:**
- Year slider: 2026 ←→ 2050. Slider position controls "show me the building state as it would be in year X."
- KPI strip: current year EUI, kgCO2/m²·yr, vs CRREM 2030 target, vs CRREM 2050 target, "next intervention in N years"

**Middle: Trajectory chart**
- X-axis: years 2026–2050
- Y-axis (left): kgCO2/m²·yr — Building line + CRREM target line
- Y-axis (right): kWh/m²·yr — EUI line
- Vertical step markers at each intervention year, labelled with intervention name
- Hover any year → tooltip shows applied interventions, EUI, kgCO2, fuel split

**Bottom-left: Interventions timeline**
- Horizontal timeline 2026–2050
- Each intervention rendered as a card on its year position:
  - Title (e.g. "Replace gas DHW with ASHP")
  - Year (editable inline)
  - Quick stats: "−18 MWh/yr, −12 kgCO2/m²·yr at year of install"
  - Drag to re-order or change year
- "+ Add intervention" button → opens intervention picker

**Bottom-right: Intervention picker / editor (modal or side panel)**
- Type dropdown:
  - Fabric: Upgrade walls / Upgrade roof / Upgrade ground floor / Upgrade glazing / Improve airtightness / Reduce thermal bridging
  - Systems: Replace heating / Replace cooling / Replace DHW / Add HRE to ventilation / Replace ventilation system / Add district heating
  - Operation: Reduce LPD / Reduce EPD / Reduce occupancy / Adjust setpoint / Modify operable openings
  - Renewables: Add PV / Add solar thermal (future — flag as out of scope for V1 but reserve type)
- Per-type editor with current value (read from prior state) → new value
- Year picker
- Save button → adds to roadmap, trajectory re-computes

### 10.4 Engine changes

**New schema** on project:
```javascript
project.roadmap: {
  interventions: [
    {
      id: string,
      year: number,            // 2026-2050
      sequence_in_year: number, // for ordering when same year
      type: 'fabric_walls' | 'fabric_roof' | 'fabric_glazing' | 'fabric_airtightness'
          | 'systems_heating' | 'systems_cooling' | 'systems_dhw'
          | 'ventilation_add_hre' | 'ventilation_replace'
          | 'operation_lpd' | 'operation_epd' | 'operation_occupancy' | 'operation_setpoint',
      name: string,            // user-friendly e.g. "Replace gas boiler with ASHP"
      overrides: {             // type-specific patch to building_config
        // examples by type:
        // walls: { construction_choices.external_wall.u_value_override: 0.20 }
        // ashp_swap: { systems_config_v25.heating.type: 'ashp', systems_config_v25.heating.scop_heating: 3.5 }
        // mvhr_add: { systems_config_v25.ventilation[i].hre_enabled: true, ... }
      }
    }
  ]
}
```

**New engine output:**
```javascript
roadmap_trajectory: [
  {
    year: 2026,
    applied_intervention_ids: [],
    eui_kwh_per_m2: number,
    kgCO2_per_m2_yr: number,
    grid_intensity_gCO2_per_kWh: number,
    total_electricity_mwh: number,
    total_gas_mwh: number,
    crrem_target_kgCO2_per_m2: number,
    delta_vs_prior_year: { eui: number, carbon: number },
    delta_vs_baseline: { eui: number, carbon: number },
  },
  // ... one entry per year 2026 to 2050
]
```

**Computation:**
```
For each year Y in 2026..2050:
  // determine which interventions are active
  active_interventions = interventions.filter(i => i.year <= Y)
                                      .sort((a, b) => a.year - b.year || a.sequence_in_year - b.sequence_in_year)

  // apply overrides in order
  state = clone(baseline_building_config)
  for each intervention in active_interventions:
    state = applyOverrides(state, intervention.overrides)

  // run physics on the resulting state
  result = engine.compute(state, weather, library)

  // grid carbon for this year
  grid_intensity = ukGridTrajectory(Y)
  carbon = result.consumption.total.electricity_mwh * grid_intensity
         + result.consumption.total.gas_mwh * GAS_FACTOR

  trajectory.push({ year: Y, ...result.summary, kgCO2_per_m2_yr: carbon / gia, ... })
```

**Performance:** 25 years × ~50ms per Static engine run = ~1.25 seconds total. Acceptable for live-update.

For Dynamic: do NOT run 25 EnergyPlus simulations. Dynamic shows only on the Baseline state and on the Final state (year 2050 with all interventions applied) — two runs maximum, triggered explicitly by user clicking "Run Dynamic on roadmap endpoints" button.

### 10.5 Sequenced delta visibility

In the timeline view, each intervention card shows TWO deltas:

- **Incremental delta** (this intervention alone, applied to prior state): "−45 MWh/yr"
  - This is the saving the user can attribute to choosing this intervention given the prior state of the roadmap
- **Cumulative delta vs Baseline**: "−203 MWh/yr cumulative"
  - The total saving since 2026

Same for carbon.

This is critical for stakeholder communication: "Intervention 3 saves you X" must mean "X given what came before," not "X if you did this in isolation."

### 10.6 Stuck-points and fallbacks for IM-M6

If anything in this section is too complex to build in reasonable time, fall back to:
- **Drag-and-drop timeline**: replace with a numeric year input per intervention. Same functionality, simpler UI.
- **Per-intervention editor modal**: replace with inline form fields below the timeline. Less polished, still works.
- **Trajectory chart with step markers**: render as plain line chart with intervention markers as vertical dotted lines + labels. d3 or Recharts.
- **Dynamic on roadmap endpoints**: if EnergyPlus integration time-pressed, skip Dynamic on the roadmap entirely. Static-only roadmap is fine for V1.

**Build the trajectory logic regardless.** Even with the crudest UI, the sequenced-state computation in §10.4 is the core capability. Flag any UI compromises in the halt report.

### 10.7 Gate IM-M6 PASS criteria

```
engine: project.roadmap.interventions schema present and persisted
engine: engine.compute accepts an interventions array and returns roadmap_trajectory[]
engine: roadmap_trajectory.length === 25 (years 2026-2050 inclusive)
engine: applying 2 interventions in sequence shows I2 reading I1's state (test: I1 reduces heating demand, I2 ASHP swap uses reduced demand for its energy calc)
engine: cumulative_delta_vs_baseline at final year matches sum of (incremental_delta where Y >= year_of_intervention)
ui: Roadmap module/tab accessible from top nav
ui: Year slider 2026-2050 present
ui: Trajectory chart shows kgCO2/m²·yr line + CRREM target line + EUI line
ui: Intervention timeline shows at least one intervention with year, name, incremental delta, cumulative delta
ui: "+ Add intervention" button opens picker
ui: Adding an intervention re-computes trajectory and the chart updates
ui: Each intervention's "incremental delta" reflects state of prior interventions, not baseline
ui: User can change intervention year and trajectory updates
ui: Removing an intervention re-computes
demonstration: "I1=walls upgrade 2027; I2=ASHP 2030; I3=add HRE 2030" all stack, trajectory shows step-changes, final 2050 state shows cumulative savings; intervention card for I2 shows its energy calc using I1's reduced heating demand
```

Screenshots:
- `im_M6_roadmap_baseline.png` (empty roadmap, just baseline trajectory + CRREM target)
- `im_M6_roadmap_one_intervention.png` (single fabric upgrade in 2027)
- `im_M6_roadmap_full_stack.png` (4+ interventions stacked across years, trajectory dipping below CRREM)
- `im_M6_roadmap_intervention_editor.png` (the edit modal for an intervention)
- `im_M6_roadmap_trajectory_to_2050.png` (final state showing full trajectory + grid decarb effect)

---

## 11. Validation discipline and halt criteria

### 11.1 Per-gate halt criteria

Each gate halts with:
1. Diff of all changes (git diff)
2. Pre-screenshot assertions all PASS (script output)
3. Required screenshots captured AND paired against BASELINEs already in repo
4. Design self-check signed off per §2.6
5. Magnitude sanity: every number within physical range listed in §11.2
6. Module ownership: §3 rules not violated (Verifier checks)

If any of 1–6 fails: Verifier rejects internally and sends back to Builder.

### 11.2 Magnitude sanity ranges (for assertions)

**Building tab (envelope only):**
- `demand.heating_demand_mwh`: 400–550 (Bridgewater post-fix)
- `losses_at_setpoint.thermal_bridging.heating_loss_kwh`: 6,000–15,000
- `losses_at_setpoint.fabric_leakage.operational_ach`: 0.05–0.15 (for q50=4.64)
- Any single loss line > 50% of total → SUSPICIOUS (Verifier flags for review)

**Internal Gains (State 2):**
- `demand.heating_demand_mwh`: 600–800
- `demand.cooling_demand_mwh`: 50–100
- Internal gains total: 250–400 MWh/yr (Bridgewater)

**Operation:**
- `losses_at_setpoint.natural_ventilation[door].heating_loss_kwh`: 100,000–200,000 (the entrance door)

**Systems (full):**
- `consumption.total.kwh_per_m2_yr`: 60–120
- `consumption.space_heating.electricity_mwh / consumption.space_heating.demand_mwh`: 0.15–0.45 (SCOP 2.2-6.7 effective range)
- `consumption.dhw.gas_mwh + consumption.dhw.electricity_mwh`: > 50 MWh (DHW is significant for a hotel)

**Results:**
- `results.carbon.today.kgCO2_per_m2_yr`: 15–60 (sensible range for UK building)
- `results.carbon.trajectory[2038-2024].kgCO2_per_m2_yr` < `results.carbon.today.kgCO2_per_m2_yr` (grid decarb reduces electric carbon)

Any value outside these ranges → halt with FAIL annotation, do not proceed.

### 11.3 BRUKL discrepancy handling

Per Chris's explicit instruction:
- **Do NOT block on BRUKL discrepancies.**
- Engine shows what physics says.
- Where Static engine output disagrees with BRUKL (e.g. heating demand 488 MWh engine vs 98 MWh BRUKL), the **Summary view** of the relevant module includes a small diagnostic annotation:
  - "Static engine: 488 MWh/yr · BRUKL: 98 MWh/yr · Δ explained by: monthly utilisation vs hourly setpoint methodology, BRUKL operational vs design intent gap, etc."
- Do not change physics to match BRUKL. Document the gap.

### 11.4 Dynamic-vs-Static handling

Per Chris's instruction:
- Dynamic must run and produce a number on each module's view (Heat Balance, Profiles, Monthly, Summary).
- The Static-vs-Dynamic Δ% shown in Summary view is informational. Not a block.
- If Dynamic differs by 50%+, document with annotation referencing the relevant Brief 28L convention difference (sky long-wave, glazing variable, T_ground, permanent vents, wind-angle natural ventilation).
- Dynamic does NOT need to match Static within ±15%. It needs to render and be visible.

### 11.5 Context allowlist check (Bug 7 mitigation)

Every gate's assertion script must include this check:
```javascript
// Verify ProjectContext exposes every field present in API response
const apiState = await fetch(`/api/projects/${id}`).then(r => r.json())
const contextParams = await getProjectContextParamsShape()
const missingFields = []
for (const field of Object.keys(apiState.building_config)) {
  if (!(field in contextParams)) missingFields.push(field)
}
assert(missingFields.length === 0,
  `Context allowlist missing fields: ${missingFields.join(', ')}`)
```

---

## 12. Out of scope (deliberately, by Chris's direction)

- Calibration against real-life energy data
- Matching BRUKL outputs
- Fixing Dynamic engine accuracy (only verifying it renders per module)
- Replacing the 3D viewer engine
- Per-zone modelling (single-zone cube still)
- Multi-scenario (3+) comparison (baseline + one only for now)
- New physics beyond demand-to-energy conversion
- Per-window itemised glazing schema (NE WWR remains at 35% from TB-V1)
- BRUKL ingestion of additional fields beyond what's already used
- Compliance / Part L / SBEM output generation

---

## 13. File pointers

**Engine:**
- `frontend/src/utils/instantCalc.js` — `deriveOperationalACH` helper, `consumption.*` block computation
- `frontend/src/utils/thermalBridges.js` (from Brief 28-TB-Simple)
- `frontend/src/utils/scheduleLibrary.js` (existing)
- `nza_engine/generators/epjson_assembler.py` — verify Dynamic consumption output matches Static structure

**Data:**
- `frontend/src/data/thermalBridgesLibrary.js` (existing)
- `frontend/src/data/ukGridCarbonTrajectory.js` (NEW)
- `frontend/src/data/crremTargets.js` (NEW or existing — verify)

**UI components — Building (IM-M1):**
- `frontend/src/components/modules/BuildingDefinition.jsx` — three-column rewrite
- `frontend/src/components/modules/building/HeatBalance.jsx` — accept `modules` prop, render Static+Dynamic toggle
- `frontend/src/components/modules/building/Profiles.jsx` (NEW or existing — verify)
- `frontend/src/components/modules/building/Monthly.jsx` (NEW)
- `frontend/src/components/modules/building/Summary.jsx` (NEW)
- `frontend/src/components/modules/building/LiveResultsPanel.jsx` (consistent format across modules — NEW)
- `frontend/src/components/inputs/AirPermeabilityInput.jsx` (NEW)
- `frontend/src/components/inputs/ConstructionSelector.jsx` (rewrite to handle object form)

**UI components — Internal Gains (IM-M2):**
- `frontend/src/components/modules/InternalGains.jsx` — add Monthly view
- Existing Schedule / Summary / HeatBalance / Profiles components — verify alignment with target pattern

**UI components — Operation (IM-M3):**
- `frontend/src/components/modules/OperationModule.jsx` — three-column rewrite (was two-column from Gate E5a)
- `frontend/src/components/viewer/BuildingViewer3D.jsx` — extend with facade highlight + opening rectangle overlay
- Operation tab Profiles / Schedule / Monthly / Summary views (NEW or existing — verify)

**UI components — Systems (IM-M4):**
- `frontend/src/components/modules/SystemsZones.jsx` — full rewrite per §8
- `frontend/src/components/modules/systems/Sankey.jsx` — d3-sankey with crossing-prevention routing
- `frontend/src/components/modules/systems/SystemEditor.jsx` (NEW or existing — verify)
- Systems Profiles / Schedule / Monthly / Summary views (NEW)

**UI components — Results (IM-M5):**
- `frontend/src/components/modules/Results.jsx` — full-width view per §9
- `frontend/src/components/modules/results/CarbonTrajectory.jsx` (NEW)

**UI components — Scenarios (IM-M6):**
- `frontend/src/components/scenarios/ScenariosPanel.jsx` (NEW)
- `frontend/src/components/scenarios/InterventionList.jsx` (NEW)
- `frontend/src/components/scenarios/Comparison.jsx` (NEW)

**Context:**
- `frontend/src/context/ProjectContext.jsx` — allowlist must include all `building_config` fields (Bug 7 fix)
- `frontend/src/context/UIContext.jsx` (existing)

**Seeds:**
- `scripts/seed_bridgewater_v25_systems.mjs` — add `air_permeability_q50: 4.64`, `enabled: true` on systems, `dhw.fuel_mix: { gas: 1.0, electric_resistance: 0, heat_pump: 0 }`

**Validation:**
- `scripts/_visual_gate_screenshot.mjs` — extend for all M1–M6 gates
- `scripts/_check_28im_assertions.mjs` (NEW) — magnitude assertions per §11.2

**Briefs:**
- `docs/briefs/active/28im_intervention_model.md` (THIS BRIEF, drop here)
- `docs/discipline/context_allowlist_check.md` (NEW)

---

## 14. Gate sequence

Land in order. Each gate halts for Chris review.

1. **IM-M1** Building tab (fabric, airtightness q50, thermal bridges, view tabs, monthly view) — bugs 1, 2, 3, 8 fixed
2. **IM-M2** Internal Gains tab (verify pattern, add Monthly) — Bug 3 enforcement
3. **IM-M3** Operation tab (three-column, view tabs, 3D facade highlighting) — bugs 4, 6, 8 fixed
4. **IM-M4** Systems tab (full rewrite, demand-to-energy engine math, all view tabs, on/off, DHW fuel mix) — Bug 5 fixed
5. **IM-M5** Results tab (carbon trajectory, EUI, full Sankey)
6. **IM-M6** Scenarios / Interventions surface (baseline vs scenario)

Total: 6 visible gates. Each ends with comprehensive screenshots covering all view tabs for that module.

Bug 7 (context allowlist) fix: gets baked into every gate via the assertion check.

---

## 15. The discipline statement

This brief lands a working product. The discipline corrections from earlier today (visible-at-every-gate, module ownership, no BRUKL chasing, magnitude sanity) are now embedded in every gate's PASS criteria.

### 15.1 BUILD THROUGH UNCERTAINTY — the most important instruction

**If something looks uncertain or slightly off, build the logic anyway. Do not halt to debug foundations.**

Chris's explicit instruction: "energy balance is not hard and intervention calculations are not hard. Build the whole thing and flag anything at the end that doesn't sound right that we can come in and fix ourselves."

The previous failure mode was getting stuck on individual numbers (α=200% three-day rabbit hole, BRUKL convention research, etc.) instead of building. The cost of that pattern was four days with no working product.

**The new pattern:**
1. If a magnitude looks wrong (e.g. ventilation electricity comes out 10× expected), **build the calculation anyway**, flag the magnitude in the halt report, move to next gate. Chris will tell you which to fix.
2. If a schema field looks weird (e.g. `parent_glazing_face` vs `parent_facade` naming), **pick one and move on**. Document the choice. Don't propose a refactor.
3. If a UI design choice is ambiguous between two acceptable options, **pick one consistent with §2 design principles** and proceed. Don't ask.
4. If an engine output is missing for a UI you're about to build, **add it with a sensible default value**, build the UI against the default, flag in halt report. Don't block the UI work.
5. If you discover a bug in a different module while building your current one, **flag it but DO NOT FIX IT IN THIS GATE**. Create an entry in `docs/discipline/im_followups.md` and continue. The exception is Bug 7 (context allowlist) which must be fixed in-gate per its own discipline.

**The only things that should cause an actual halt:**
- Pre-screenshot magnitude assertion fails AND the calculation produces NaN / negative / absurdly large value (>10× expected) — pause and report the calculation chain.
- Module ownership violation (showing wrong content in wrong tab) — fix or report.
- Three orphan-plumbing bugs in one gate (suggests a systemic issue) — pause and report.

Otherwise: **build the full sequence M1 → M2 → M3 → M4 → M5 → M6, flag imperfections per gate in halt reports, let Chris triage at the end.**

### 15.2 Stuck-point fallbacks (use these instead of stopping)

If any of these specific things take longer than estimated, fall back to the simpler version listed:

| Original target | Simpler fallback if stuck |
|---|---|
| 3D facade raycast click-select (M3) | Render facade buttons (F1/F2/F3/F4) below 3D viewer; selected facade gets coloured fill in 3D |
| d3-sankey crossing prevention (M4) | Leave crossings; render offending flows as curved arcs |
| Per-zone-to-system mapping (M4) | Single aggregate system per category, use dominant SCOP from seed |
| Drag-and-drop intervention timeline (M6) | Numeric year input per intervention card |
| Dynamic engine on every module view (§2.4) | Dynamic shown on Heat Balance + Summary only; Profiles/Monthly/Schedule Static-only with note "Dynamic profile view in follow-up" |
| Sankey for Carbon Trajectory in Results (M5) | Stacked bar chart 2026/2030/2040/2050 + line chart trajectory; no Sankey if too complex |
| Per-intervention modal editor (M6) | Inline form fields below the intervention card |

The fallback is explicit permission to ship a simpler version. Flag the fallback used in the halt report so Chris can decide whether to upgrade later.

### 15.3 Carbon trajectory data — quick reference

Use these UK grid carbon factors (linear interpolation between, hardcoded in `frontend/src/data/ukGridCarbonTrajectory.js`):

```javascript
export const UK_GRID_TRAJECTORY = [
  { year: 2024, gCO2_per_kWh: 190 },
  { year: 2026, gCO2_per_kWh: 150 },
  { year: 2030, gCO2_per_kWh: 50 },
  { year: 2035, gCO2_per_kWh: 15 },
  { year: 2040, gCO2_per_kWh: 8 },
  { year: 2050, gCO2_per_kWh: 5 },
]
// Linear interpolation between waypoints
// Source: DESNZ Green Book / National Grid ESO Future Energy Scenarios
// Comment: values are projections; update when newer official forecasts available

export const GAS_CARBON_FACTOR_gCO2_per_kWh = 184  // DESNZ, stable
```

CRREM targets — for hotel (CAR / Hospitality):
```javascript
export const CRREM_HOTEL_KGCO2_PER_M2_YR = [
  { year: 2024, target: 33.0 },
  { year: 2030, target: 17.5 },
  { year: 2040, target: 8.2 },
  { year: 2050, target: 2.8 },
]
// Source: CRREM Global Pathways v2.04, Hotel - International
```

### 15.4 Halt reports — required structure

Each gate's halt report must include:

1. **PASS / FAIL summary** for all assertions in §11.2 + the gate-specific ones in the module section
2. **Screenshots committed** (paths, paired with BASELINEs)
3. **Magnitude sanity check** for every number in the relevant outputs — explicit "expected range Y, got X, ✓ in range" / "✗ out of range, flagging for Chris"
4. **Design self-check sign-off** per §2.6 — Verifier's three-sentence "this looks like a building services engineer would expect" / "this looks cluttered because..."
5. **Stuck-point fallbacks used** (if any) — explicit list with reason
6. **Followups flagged for Chris** — any bugs / oddities discovered but not fixed in this gate

Halt reports are NOT a place to ask questions. They are a record of "here's what I built, here's what I flagged, here's what I deferred."

### 15.5 The discipline in one line

**Build the whole thing. Flag what's wrong. Don't get stuck.**

**End of Brief 28-IM.**
