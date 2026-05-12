# Brief 26: Systems Inspectors — per-system editing pattern (State 3)

BEFORE DOING ANYTHING:
1. Read `CLAUDE.md`
2. Read `docs/state_contracts.md` — **the canonical state contract**. When this brief and the contract disagree, the contract wins.
3. Read `STATUS.md`
4. Read `docs/briefs/SYSTEMS_AUDIT.md` — end-to-end audit of how each system is wired today.
5. Read this brief in full before writing code.
6. Look at `frontend/src/components/library/ConstructionInspector.jsx` and `GlazingInspector.jsx` — the **reference pattern** every Inspector should follow.
7. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## State Contract Compliance

**This brief implements State 3 per `docs/state_contracts.md` § State 3 — Full.**

### Inputs honoured (per the State 3 contract)
Inspectors edit the following paths. Note current code uses a slightly different shape — see § "Path migration" below for the mapping.

| Contract path | Inspector |
|---|---|
| `systems.heating.{type, cop, efficiency, fuel}` | Heating |
| `systems.heating.setpoint_c` | Heating (+ surfaces setpoint cross-state dependency) |
| `systems.cooling.{type, eer, fuel}` | Cooling |
| `systems.cooling.setpoint_c` | Cooling (+ surfaces setpoint cross-state dependency) |
| `systems.ventilation.{type, sfp, heat_recovery, control}` | Mechanical Ventilation |
| `systems.dhw.{type, primary, preheat, efficiencies}` | DHW |
| `systems.*.control_schedule` | All (per-system) |
| `systems.*.performance_curves` | All (read-only, library-template-swap to change) |

### Outputs (per the State 3 contract)
After any Inspector save, the State 3 output shape (`consumption`, `end_use`, `eui_kwh_per_m2`, `system_performance`, etc.) must remain valid. No Inspector field may drop a contract output.

### Cross-cutting contract requirements (apply to every Inspector)

1. **Setpoint cross-state dependency.** Heating and Cooling setpoints override the comfort band for State 2 / 2.5 demand calculation (contract § Setpoint cross-state dependency). The Inspector must surface this explicitly: *"Heating setpoint 21°C — used as lower bound for State 2.5 demand calculation. Drives demand to X MWh, served by this system at COP Y to give Z MWh fuel."*

2. **Inferred vs specified vs defaulted vs what reaches EnergyPlus.** Per the contract's State 3 UI rules, every Inspector must show, for each field, where its value came from: user-entered, spec-sheet, vintage-default, benchmark, or inferred. A small badge next to each field. The Inspector also surfaces the **effective value that reaches EnergyPlus** (e.g., LPD × control multiplier = effective LPD emitted), so the user knows what the engine actually saw.

3. **Provenance metadata** (contract § Input provenance). Each input the Inspector writes must record a `provenance` field: `user_entered` (default when user types/picks), `spec_sheet` (if user marked it as documented), `vintage_default`, `benchmark`, or `inferred`. State 4 reconciliation depends on this metadata. Inspectors record it; they do not yet need to consume it.

4. **Honest model simplifications.** Per the contract's State 3 UI rules: *"Inspectors must surface model simplifications honestly."* If a field is a coarse approximation (e.g. daylight dimming applied as a 0.6× LPD scalar instead of `Daylighting:Controls`), say so inline.

5. **Engine agreement.** Per the contract's Engine agreement section, when an Inspector field changes and live vs. simulation diverge by more than 5%, surface a soft flag (clickable → per-line-item breakdown). Don't block. Inspectors don't render the breakdown themselves — they trigger the Heat Balance view's flag.

---

## VERIFICATION RULES

**Browser verification is mandatory.** After each part, open the app at `http://localhost:5176`, hit the Systems page, open the Inspector you just built, and exercise every field. Take a screenshot. Check DevTools console for red errors. If a field doesn't propagate to the live calc or the EP emit, fix it before committing.

**Number-checks for each system (HIX Bridgewater baseline):** run a real EnergyPlus simulation before and after a change, confirm the delta is in the expected direction with the expected magnitude (`docs/briefs/SYSTEMS_AUDIT.md` has the baseline). Smooth curves, perfectly round numbers, or no change when there should be one = bug.

**Three strikes then escalate.** If an Inspector field can't be wired through to both engines after 3 attempts, document what you tried and what blocked you. Do not commit a field that the user can edit but EnergyPlus ignores — that's exactly the bug class Brief 25 fixed.

**Setpoint regression test.** Each commit on Heating + Cooling Inspectors must verify the setpoint cross-state dependency: change `systems.heating.setpoint_c` from 21°C to 22°C, confirm State 2/2.5 demand increases, confirm State 3 fuel consumption follows.

---

## Context

The Construction Inspector is the gold-standard interactivity pattern in NZA Sim: clickable U-value badge → side-panel slides in from the right → editable layer build-up + Y-factor preset → "Save as copy" creates a custom library item; "Save changes" updates a custom item in place; built-in items lock with a hint. The Glazing Inspector follows the same pattern for `WindowMaterial:SimpleGlazingSystem`. Both are at `frontend/src/components/library/`.

Systems have nothing equivalent. The Systems page (`SystemsZones.jsx`) is a left-accordion / centre-Sankey / right-Live-Results layout where each system collapses to: a `<select>` of library templates, an efficiency-override slider, a single-line schedule sparkline, and a Detail/Ideal mode toggle. There is **no way to inspect or edit the internals** (curves, defrost, fan SFP breakdown, frost protection, recirculation losses, etc.). The library-browser modal (`SystemEditor.jsx`) lets you see the raw `config_json` and duplicate a template, but it's a flat form, not an Inspector.

**This brief introduces an Inspector per State 3 system family**: Heating, Cooling, Mechanical Ventilation, DHW. (Lighting and Equipment are State 2 inputs per the contract and move to the future Internal Gains brief — see § Out of scope.) The pattern is reusable: one shared `SystemInspector.jsx` shell, four per-system content panels.

### Scope limits
- **Holiday Inn Express systems first.** HIX uses gas boiler heating, VRF cooling, gas boiler + ASHP preheat DHW, MVHR ventilation. Inspectors for these are non-negotiable.
- **Other system types** (ASHP heating, electric heating, MEV, electric immersion DHW, solar thermal) get minimum-viable Inspectors in the same shells — fewer fields but the same UX shape. Avoid forking the shells.

### Path migration (current code → contract)

The current code uses a demand-based shape (`systems.space_heating.primary.{system, share, efficiency_override}`). The State 3 contract uses simpler keys (`systems.heating.{type, cop, efficiency, fuel}`). The contract is the target; getting there is a separate schema migration brief. Inspectors written here:

- **Read from both shapes** — prefer demand-based, fall back to the contract shape, fall back to flat aliases.
- **Write to the demand-based shape** (current code's source of truth), so the existing `updateSystem` path stays valid. The flat aliases stay in sync automatically.
- **Surface the contract shape in any output / API response** that's contract-bound.

When the schema-migration brief lands, Inspectors stop reading the demand-based shape. Keeping the read order in one helper (e.g. `getSystemField('heating', 'cop')`) makes that swap cheap.

### What stays hidden (don't expose)
Some EnergyPlus inputs are too low-level for the consultant audience. Keep them behind the library template (swap template to change them):
- Refrigerant type (always R-410A or library default)
- Crankcase heater power (15 W default fine)
- Sizing factors (1.25 heating, 1.15 cooling)
- Performance curve coefficients themselves (biquadratic / cubic). Show the curve **shape** as a small read-only sparkline if useful, but coefficients live in the library file only.
- Min/max condenser inlet temps (defaults are EP-realistic)

---

## Part 0: Inspector pattern foundation

Build the shared shell first so each per-system Inspector is a thin content component.

**Files:**
- `frontend/src/components/library/SystemInspector.jsx` (new) — generic side-panel: header (display name, lock icon if built-in, ✕ close, provenance badge), sticky save bar (Save changes / Save as copy / Cancel), body slot.
- `frontend/src/components/library/inspectors/` (new directory)
- `frontend/src/components/library/inspectors/_helpers.js` (new) — `getSystemField`, `setSystemField`, `recordProvenance`, `effectiveValueLabel`. These wrap the path migration so individual Inspectors don't repeat read-order logic.
- `frontend/src/components/modules/SystemsZones.jsx` — replace the inline efficiency slider + system `<select>` row with a clickable summary that opens the Inspector. The slider stays for quick-tweak but moves into the Inspector body.

**Pattern requirements:**
1. Side-panel slides in from the right, `fixed inset-0` overlay with `pointer-events-auto` panel, click-outside or `Esc` to close.
2. Header: system display name + small library badge ("built-in" / "custom"); lock icon next to display name for built-ins; provenance badge per field (small text, `text-mid-grey`).
3. Sticky bottom bar:
   - **Built-in:** "Save as new copy" (primary, navy) + "Cancel". No "Save changes" button — built-ins are read-only.
   - **Custom:** "Save changes" (primary) + "Save as new copy" + "Delete" + "Cancel".
4. Body: rendered from a per-system content component (`HeatingInspectorBody`, `CoolingInspectorBody`, `DHWInspectorBody`, `VentilationInspectorBody`) passed in as a child or prop.
5. API: PUT to `/api/library/systems/{name}` for in-place updates of custom items; POST to `/api/library/systems` for save-as-copy. The library router (`api/routers/library.py`) already supports these — check it before adding new endpoints.
6. **Provenance default:** when the user edits a field via the Inspector, provenance is auto-set to `user_entered`. A small "Mark as spec-sheet" or "Mark as benchmark" tag-editor on each field lets the user upgrade provenance (out of scope for this part — for now, default to `user_entered`).

**Commit message:** `Systems Inspectors: shared SystemInspector shell + Systems page entry points`

**Verification:** Open `/systems`, click any system row, confirm the Inspector slides in, has the right header, save-bar shows the right buttons for built-in vs custom. No content yet — the body slot is empty. Console clean.

---

## Part 1: Mechanical Ventilation Inspector

The simplest of the four State 3 systems — gets the pattern in.

**Fields exposed:**
- System type — radio: MEV / MVHR. Maps to contract `systems.ventilation.type`.
- Specific fan power (W/L/s) — slider 0.5–3.0, step 0.1. Default: library template's `specific_fan_power`. Show CIBSE Part L benchmark (1.5 W/L/s) as a reference line. Maps to `systems.ventilation.sfp`.
- Heat recovery efficiency (%) — slider 60–95, step 1. **Greyed out and locked at 0% for MEV.** Maps to `systems.ventilation.heat_recovery`.
- Control schedule — three-way segmented (Continuous / Occupied / Timer). Show small sparkline of the schedule shape. Maps to `systems.ventilation.control`.
- **Stretch:** frost protection threshold (°C, MVHR only) — when outdoor air drops below this, MVHR routes around the heat exchanger or applies pre-heat. Default -5°C. Emit as `HeatExchanger:AirToAir:SensibleAndLatent` `threshold_temperature` field.
- **Stretch:** summer bypass schedule — schedule reference, MVHR only.

**Inferred vs specified vs defaulted (contract requirement):**
- For each field, a small badge next to the value: `user-entered` / `spec-sheet` / `vintage-default` / `benchmark` / `inferred`. Default `user-entered` when the user changes it.
- Effective-value label at the bottom: *"What EnergyPlus sees: SFP 1.5 W/L/s, HRE 85%, schedule `hotel_ventilation_continuous`."*

**What stays hidden:** node names (autocalculated), fan motor inputs (Fan:SystemModel `motor_efficiency` etc.), NodeList plumbing.

**Wiring check:**
- Brief 25 wired the control schedule. Verify vent=timer still drops EUI ~1 kWh/m² vs continuous.
- HRE override goes through `mvhr_eff` in the assembler — already wired.
- SFP override is in `sfp_override` — verify it reaches `Fan:SystemModel.design_pressure_rise` in EnergyPlus.

**Files:**
- `frontend/src/components/library/inspectors/VentilationInspectorBody.jsx`
- (stretch) `nza_engine/generators/hvac_ventilation.py` — frost protection threshold field, summer bypass schedule.

**Commit:** `Ventilation Inspector with SFP, HRE, control schedule + provenance`

**Verification:** Toggle MEV→MVHR, HRE 85→0, SFP 1.5→2.5 — each should change `annual_heating_kWh` or `annual_ventilation_kWh` measurably. Provenance badge shows `user-entered` after each edit.

---

## Part 2: DHW Inspector

DHW has two-stream complexity (primary + secondary preheat). This Inspector is the most elaborate of the four.

**Fields exposed:**

*Primary system:*
- System type — dropdown filtered to `serves === 'dhw'`. Maps to `systems.dhw.primary`.
- Efficiency / COP — slider, label switches between "Seasonal efficiency" (gas/oil, 0.7–0.99) and "COP" (electric, 1.5–4.0). Maps to `systems.dhw.efficiencies.primary`.
- Fuel — read-only badge (gas / electricity / oil) from the library template.

*Secondary preheat:*
- "Add preheat" toggle. When on:
  - System type dropdown — ASHP / solar thermal / none. Maps to `systems.dhw.preheat`.
  - COP slider (ASHP) — 1.5–4.5, default 2.8.
  - Max heating temperature (°C) — slider 35–60, default 45. ASHP shuts off above this, primary takes over.
  - Share — read-only display (`100% × ASHP_capacity_share`) calculated from the temperature crossover.

*Building-wide:*
- DHW setpoint (°C) — slider 50–65, default 60.
- Preheat setpoint (°C) — slider 35–50, default 45.
- **Stretch:** Recirculation losses (% of DHW demand) — slider 0–30, default 15 (CIBSE TM13 for hotel). Emits as additional `WaterHeater:Mixed.off_cycle_loss_coefficient_to_ambient_temperature` adjustment.
- **Stretch:** Tank volume (L) — slider 200–5000. Default 1000 for 134-bedroom hotel.

**Inferred vs specified vs defaulted:**
- Per-field provenance badge as in Part 1.
- Effective-value summary: *"What EnergyPlus sees: gas boiler 92% efficient, 60°C delivery; ASHP preheat COP 2.8 to 45°C; 15% recirculation loss."*

**What stays hidden:** plant loop topology (we use the two-tank cascade trick), pump power (0 W), node names.

**Wiring check:**
- Verify changing ASHP COP from 2.8 → 3.5 reduces electricity consumption.
- Verify max heating temperature 45 → 50 increases ASHP share of total DHW.
- Recirculation losses should appear as a new DHW-side loss line item in the heat balance (similar to how openings now break out).

**Files:**
- `frontend/src/components/library/inspectors/DHWInspectorBody.jsx`
- `nza_engine/generators/hvac_dhw.py` — recirculation loss field, tank volume override.

**Commit:** `DHW Inspector with primary + ASHP preheat + recirculation + provenance`

**Verification:** HIX baseline DHW demand ~12 kWh/m². Add 15% recirculation → demand goes to ~14 kWh/m². ASHP cuts gas use roughly proportionally to its share.

---

## Part 3: Cooling Inspector (+ setpoint cross-state surface)

VRF is the main concern for HIX. Heating + cooling sometimes share the same VRF unit (combined heat pump), so Cooling and Heating Inspectors must be aware of each other.

**Fields exposed:**
- System type — dropdown: VRF / split system / none. Filtered to `serves === 'cooling' || 'heating_and_cooling'`. Maps to `systems.cooling.type`.
- Nominal EER — slider 2.0–5.0, default 3.2. Maps to `systems.cooling.eer`.
- "Combined with heating" — read-only badge when same template serves both demands. Cooling Inspector then shares the SCOP slider with Heating.
- Condenser type — radio: Air-cooled / Water-cooled / Evaporative. Default Air-cooled.
- Defrost strategy — radio: Resistive / Timed / Reverse-cycle. Default Resistive (matches the library).
- Defrost time fraction — slider 0–0.20, default 0.058. Only visible when defrost is on.
- **Cooling setpoint** — slider 22–28°C, default 24. Maps to `systems.cooling.setpoint_c`. **Surfaces setpoint cross-state dependency** (see below).
- **Stretch:** Capacity-vs-temperature curve — read-only sparkline showing rated cooling capacity at 5°C / 25°C / 35°C outdoor. Pulled from `hvac_vrf.py` curves.

### Setpoint cross-state surface (contract requirement)

The cooling setpoint affects State 2.5 demand calculation. The Inspector must show this. Pattern:

```
Cooling setpoint: [slider 22–28°C — 24°C]
└─ Drives State 2.5 cooling demand of X.X MWh
   Served by this system at EER 3.2 = Y.Y MWh electricity
```

The State 2.5 demand value updates live as the slider moves (using `instantCalc.js`'s state-2.5 path). The "served by" line surfaces the State 3 conversion. If neither value is available (model not run, demand not computed), show `—` with a small "Run simulation to see" link.

**Inferred vs specified vs defaulted:**
- Per-field provenance badge.
- Effective-value summary: *"What EnergyPlus sees: VRF EER 3.2, cooling setpoint 24°C, defrost Resistive at 5.8% time fraction."*
- Honest disclaimer: *"Performance curves loaded from library template `vrf_standard`. Defrost time fraction is a fixed approximation — true frost-coil dynamics not modelled."*

**What stays hidden:** Performance curve coefficients, master thermostat zone (autocalculated), refrigerant type, crankcase heater power.

**Wiring check:**
- EER 3.2 → 4.5: confirm `annual_cooling_kWh` drops (~1/1.4 ≈ 70% of baseline electricity for the same thermal output).
- Cooling setpoint 24 → 22: confirm cooling demand increases (State 2.5 → State 3 chain re-runs).
- Verify setpoint cross-state surface updates live as the slider moves.

**Files:**
- `frontend/src/components/library/inspectors/CoolingInspectorBody.jsx`
- `nza_engine/generators/hvac_vrf.py` — wire defrost strategy + time fraction as overrides.

**Commit:** `Cooling Inspector with EER, defrost, setpoint + cross-state surface + provenance`

**Verification:** EER 3.2 → 4.5, setpoint 24 → 22: combined sim, EUI delta both positive and negative as expected. Setpoint surface shows live State 2.5 demand and State 3 electricity.

---

## Part 4: Heating Inspector (+ setpoint cross-state surface)

The biggest. Handles three families: boiler / ASHP / VRF (combined heat-pump).

**Fields exposed:**

*Common:*
- System type — dropdown filtered to `serves === 'heating' || 'heating_and_cooling'`. Maps to `systems.heating.type`.
- Efficiency / SCOP — label switches between "Seasonal efficiency" (boiler) and "SCOP" (heat pump). Slider range adapts. Maps to `systems.heating.{efficiency, cop}`.
- **Heating setpoint** (°C) — slider 18–24, default 21. Maps to `systems.heating.setpoint_c`. **Surfaces setpoint cross-state dependency.**
- Setback (°C) — slider 12–20, default 18. Overnight/unoccupied setback temperature.
- **Stretch:** weather compensation toggle. When on, surface a flow temperature schedule that drops as outdoor air rises (boiler) or as outdoor air drops (heat pump).

*Boiler-specific:*
- Condensing threshold (°C return temp) — slider 40–55, default 50. Stretch.
- Modulation range (%) — slider 10–100, default 20. Stretch.

*Heat-pump-specific (ASHP or VRF heating):*
- Defrost strategy + time fraction — same controls as Cooling Inspector. Stretch.
- Minimum outdoor temperature (°C) — slider -25 to 0, default -15. Stretch.
- Backup heat — None / Electric resistance / Gas boiler. Stretch.

### Setpoint cross-state surface (contract requirement)

Same pattern as Cooling Inspector:

```
Heating setpoint: [slider 18–24°C — 21°C]
└─ Drives State 2.5 heating demand of X.X MWh
   Served by this system at SCOP 0.92 = Y.Y MWh gas
```

State 2.5 demand updates live with the slider.

**Inferred vs specified vs defaulted:**
- Per-field provenance badge.
- Effective-value summary: *"What EnergyPlus sees: gas boiler 92% efficient, heating setpoint 21°C, no weather compensation."*
- Honest disclaimer if relevant: *"Weather compensation curve not modelled — flow temperature constant. Real system likely modulates with outdoor temp."*

**What stays hidden:** Performance curve coefficients, fraction radiant for gas baseboard (0.30), sizing factors.

**Wiring check:**
- Boiler efficiency 0.92 → 0.85: heating gas use rises ~8%.
- SCOP 3.5 → 4.5: heating electricity drops ~22%.
- Heating setpoint 21 → 19: heating demand drops sharply; setpoint surface reflects.
- **Setpoint regression** (mandatory per Verification Rules): setpoint 21 → 22, confirm State 2/2.5 demand increases, confirm State 3 fuel follows.

**Files:**
- `frontend/src/components/library/inspectors/HeatingInspectorBody.jsx`
- `nza_engine/generators/hvac_heating_boiler.py` — weather compensation, condensing threshold (if built).
- `nza_engine/generators/hvac_vrf.py` — defrost overrides (if built — shared with Part 3).

**Commit:** `Heating Inspector with type-specific fields + setpoint cross-state surface + provenance`

**Verification:** Boiler efficiency 92→85% gives ~8% gas-use bump; setpoint 21→19 gives clearer EUI drop. Setpoint cross-state surface reflects live State 2.5 demand.

---

## Part 5: Cross-system sanity + commit final

After all four Inspectors are in, do an end-to-end pass:

1. Open each Inspector on its own row in `/systems`. Confirm:
   - Header is right
   - Built-in lock icon present
   - "Save as new copy" works (creates a custom library item, refreshes the dropdown, switches selection to the new item)
   - "Save changes" works on custom items
   - Esc + click-outside close cleanly
   - No layout collision with the Sankey on the centre pane

2. **Contract compliance check:**
   - Heating + Cooling Inspectors surface setpoint cross-state dependency live.
   - Every Inspector field shows a provenance badge.
   - Every Inspector shows the "what EnergyPlus sees" effective-value summary.
   - Every Inspector calls out model simplifications honestly where applicable.

3. Confirm the parity table from `SYSTEMS_AUDIT.md` is now closed for the four systems we built — every "missing" row has either landed or been explicitly de-scoped here.

4. Run one full HIX Bridgewater simulation with everything at defaults. Compare the result to `SYSTEMS_AUDIT.md`'s baseline EUI. If they disagree by more than 2%, investigate.

**Commit:** `Systems Inspectors complete: 4 State 3 system families, parity with Construction Inspector pattern`

**Push.** Update `STATUS.md` with what landed.

---

## What this brief does NOT do

For clarity, here's what's deliberately out of scope:

- **Lighting and Equipment Inspectors** — these are **State 2 (gains)** per the contract, not State 3 (systems). They move to the Internal Gains brief (Brief 27 or later). The existing LPD/EPD/control sliders in `SystemsZones.jsx` stay where they are until that brief lands; they just don't get an Inspector here.
- **System on/off toggles** (heating off / cooling off / ventilation off): future brief.
- **Monthly stacked bar of end-use** + **annual donut** + **with/without bar pair**: future brief.
- **Profiles → Internal Gains migration** (deprecating `/profiles` per State 2 UI rules): future brief.
- **Path migration** (current `systems.space_heating.primary.*` → contract `systems.heating.*`): own schema brief.
- **AirflowNetwork** (multi-zone crossflow / stack ventilation): future brief.
- **Real `Daylighting:Controls`** with reference points and glare calcs: future, owned by the Internal Gains brief.
- **Per-zone overrides** (different schedule per zone): future. All zones treated as `hotel_bedroom` for HIX.

---

## Notes for the implementer

- Each Inspector body should read via the `getSystemField` helper (Part 0) which knows the demand-based shape AND the contract shape AND the flat aliases. Writes go through `setSystemField` to the demand-based shape (the current source of truth). When the schema-migration brief lands, the helper is the only place that changes.
- Every Inspector field that lands in the saved library item should also reach the live calc (`instantCalc.js`) — otherwise we recreate the Brief 25 cosmetic-bug class. After wiring an Inspector field, do an A/B live-vs-simulation comparison.
- Provenance defaults to `user_entered` when an Inspector field is edited. A future brief adds the UI to upgrade provenance to `spec_sheet` / `benchmark` etc. For now, just record `user_entered` so State 4 has the metadata when it lands.
- The Construction Inspector saves builtins-as-copy via POST to `/api/library`, in-place updates via PUT to `/api/library/{name}`. The systems router supports the same — verify before touching it.
- The setpoint cross-state surface (Heating + Cooling) requires the live engine to expose a State 2.5 demand number. `instantCalc.js` already produces an annual heating/cooling demand — read from there. If it doesn't separate setpoint-driven demand from comfort-band demand, add the path: when `systems.{heating, cooling}.setpoint_c` is set, use it as the lower/upper bound for the State 2.5 demand calculation.

---

## Estimated effort

| Part | Effort | Why |
|---|---|---|
| 0 — shell + helpers | M | Side-panel mechanics, save-as-copy plumbing, click-handlers in SystemsZones, getSystemField/setSystemField helpers, provenance recording |
| 1 — Ventilation | S | Few fields, most already wired |
| 2 — DHW | L | Two-stream UI; recirculation + tank-volume are net-new |
| 3 — Cooling | M | Most fields exist; defrost wiring new; setpoint cross-state surface new |
| 4 — Heating | L | Three families; weather compensation + setpoint surface new |
| 5 — final pass | S | Sanity check, doc updates |

Total: ~4–6 sessions if no surprises. Smaller than the previous v1 of this brief (which had 6 Inspectors) because Lighting + Equipment moved to the Internal Gains brief.
