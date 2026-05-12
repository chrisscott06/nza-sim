# Brief 26: Systems Inspectors — per-system editing pattern

BEFORE DOING ANYTHING:
1. Read `CLAUDE.md`
2. Read `STATUS.md`
3. Read `docs/briefs/SYSTEMS_AUDIT.md` — end-to-end audit of how each system is wired today. This brief addresses the gaps listed there.
4. Read this brief in full before writing code.
5. Look at `frontend/src/components/library/ConstructionInspector.jsx` and `GlazingInspector.jsx` — the **reference pattern** every Inspector should follow.
6. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## VERIFICATION RULES

**Browser verification is mandatory.** After each part, open the app at `http://localhost:5176`, hit the Systems page, open the Inspector you just built, and exercise every field. Take a screenshot. Check DevTools console for red errors. If a field doesn't propagate to the live calc or the EP emit, fix it before committing.

**Number-checks for each system (HIX Bridgewater baseline):** run a real EnergyPlus simulation before and after a change, confirm the delta is in the expected direction with the expected magnitude (`docs/briefs/SYSTEMS_AUDIT.md` has the baseline run output). Smooth curves, perfectly round numbers, or no change when there should be one = bug.

**Three strikes then escalate.** If an Inspector field can't be wired through to both engines after 3 attempts, document what you tried and what blocked you. Do not commit a field that the user can edit but EnergyPlus ignores — that's exactly the bug Brief 25 fixed.

---

## Context

The Construction Inspector is the gold-standard interactivity pattern in NZA Sim: clickable U-value badge → side-panel slides in from the right → editable layer build-up + Y-factor preset → "Save as copy" creates a custom library item; "Save changes" updates a custom item in place; built-in items lock with a hint. The Glazing Inspector follows the same pattern for `WindowMaterial:SimpleGlazingSystem`. Both are at `frontend/src/components/library/`.

Systems have nothing equivalent. The Systems page (`SystemsZones.jsx`) is a left-accordion / centre-Sankey / right-Live-Results layout where each system collapses to: a `<select>` of library templates, an efficiency-override slider, a single-line schedule sparkline, and a Detail/Ideal mode toggle. There is **no way to inspect or edit the internals** (curves, defrost, fan SFP breakdown, frost protection, recirculation losses, etc.). The library-browser modal (`SystemEditor.jsx`) lets you see the raw `config_json` and duplicate a template, but it's a flat form, not an Inspector.

**This brief introduces an Inspector per system family**, in increasing order of internal complexity. The pattern is reusable: one shared `SystemInspector.jsx` shell, six per-system content panels that render the right fields for the right system type.

### Scope limits
- **Holiday Inn Express systems first.** HIX uses gas boiler heating, VRF cooling, gas boiler + ASHP preheat DHW, MVHR ventilation, LED lighting at 8 W/m², standard plug loads. Inspectors for these are non-negotiable.
- **Other system types (ASHP heating, electric heating, MEV, electric immersion DHW, solar thermal) get minimum-viable Inspectors** in the same shells — fewer fields but the same UX shape. Avoid forking the shells.
- **Out of scope for this brief:** the System on/off toggles, monthly stacked bar chart, donut, system-by-system "with vs without" view. Those land in Brief 27.

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
- `frontend/src/components/library/SystemInspector.jsx` (new) — generic side-panel: header (display name, lock icon if built-in, ✕ close), sticky save bar (Save changes / Save as copy / Cancel), body slot.
- `frontend/src/components/modules/systems/SystemsZones.jsx` — replace the inline efficiency slider + system `<select>` row with a clickable summary that opens the Inspector. The slider stays for quick-tweak but moves into the Inspector body.

**Pattern requirements:**
1. Side-panel slides in from the right, `fixed inset-0` overlay with `pointer-events-auto` panel, click-outside or `Esc` to close.
2. Header: system display name + small library badge ("built-in" / "custom"); lock icon next to display name for built-ins.
3. Sticky bottom bar:
   - **Built-in:** "Save as new copy" (primary, navy) + "Cancel". No "Save changes" button — built-ins are read-only.
   - **Custom:** "Save changes" (primary) + "Save as new copy" + "Delete" + "Cancel".
4. Body: rendered from a per-system content component (`HVACInspectorBody`, `DHWInspectorBody`, …) passed in as a child or prop.
5. API: PUT to `/api/library/systems/{name}` for in-place updates of custom items; POST to `/api/library/systems` for save-as-copy. The library router (`api/routers/library.py`) already supports these for system items — check it before adding new endpoints.

**Commit message:** `Systems Inspectors: shared SystemInspector shell + Systems page entry points`

**Verification:** Open `/systems`, click any system row, confirm the Inspector slides in, has the right header, save-bar shows the right buttons for built-in vs custom. No content yet — the body slot is empty. Console clean.

---

## Part 1: Equipment Inspector

Smallest scope — gets the pattern in.

**Fields exposed:**
- `equipment_power_density` (W/m²) — slider 0–30, step 0.5
- Schedule reference — read-only label (`hotel_bedroom_equipment` for HIX); click → opens the schedule editor in the right pane (existing component).
- Peak factor (W/person) — read-only display, calculated from `epd × gia × occupancy_rate / num_bedrooms`. Sanity-check the value lands in CIBSE TM54 range (40–80 W/person typical hotel).
- Fraction radiant / fraction latent / fraction lost — three small inputs, defaults 0.30 / 0.00 / 0.00. These do reach EP (already in `_build_equipment_objects`).

**What stays hidden:** zone_type, design_level_calculation_method, the raw schedule contents (use the schedule editor).

**Wiring check:**
- The EPD override now reaches `_build_equipment_objects` via `epd_override` (Brief 25). Verify EPD 15 → 5 still drops `annual_equipment_kWh` to ~1/3 baseline.
- Live calc `instantCalc.js` already reads `systems.equipment_power_density`. Should not need changes.

**Files:**
- `frontend/src/components/library/inspectors/EquipmentInspectorBody.jsx` (new)
- `nza_engine/generators/epjson_assembler.py` — add `fraction_radiant_override`, `fraction_latent_override`, `fraction_lost_override` to `_build_equipment_objects` (currently hardcoded).
- `SystemsZones.jsx` — wire the click on the Equipment row.

**Commit:** `Equipment Inspector + fraction override fields`

**Verification:** EPD 15→8 + fraction_latent 0→0.05: rerun sim, latent fraction shows in EP output, EUI changes both from EPD drop and the latent reallocation.

---

## Part 2: Lighting Inspector

**Fields exposed:**
- `lighting_power_density` (W/m²) — slider 0–20, step 0.5. Show LPD presets (LED 4 / Fluor 8 / Incan 16) as quick-pick buttons.
- `lighting_control` — three-way segmented control (Manual / Occupancy sensing / Daylight dimming). Show the multiplier inline ("×1.20", "×0.80", "×0.60") so the user knows what each option costs.
- Schedule reference — read-only label, click to schedule editor.
- Fraction radiant / fraction visible — two inputs, defaults 0.32 / 0.25.
- **Stretch goal:** Daylight reference checkbox — "Add proper Daylighting:Controls" — gated, off by default. When on, emit `Daylighting:Controls` per zone with a single reference point at zone centre, illuminance setpoint 500 lux, glare index 22, daylight stepped control. Drop the scaling multiplier when this is on.

**What stays hidden:** return_air_fraction (0.0), design_level_calculation_method.

**Wiring check:**
- Brief 25 wired the control multiplier to both engines. Verify lighting=manual still gives 1.5× the occupancy_sensing baseline for `annual_lighting_kWh`.
- If the Daylighting:Controls stretch is built, verify south-facing zones show lower lighting demand in shoulder seasons than north-facing zones.

**Files:**
- `frontend/src/components/library/inspectors/LightingInspectorBody.jsx`
- (stretch) `nza_engine/generators/epjson_assembler.py` — emit `Daylighting:Controls` when the flag is set.

**Commit:** `Lighting Inspector + LPD presets + control multiplier surfaced`

**Verification:** Switch through Manual / Sensing / Dimming, confirm sparkline scales and EUI changes 1.5× / 1.0× / 0.75× lighting kWh.

---

## Part 3: Ventilation Inspector

**Fields exposed:**
- System type — radio: MEV / MVHR.
- Specific fan power (W/L/s) — slider 0.5–3.0, step 0.1. Default: library template's `specific_fan_power`. Show CIBSE Part L benchmark (1.5 W/L/s) as a reference line.
- Heat recovery efficiency (%) — slider 60–95, step 1. **Greyed out and locked at 0% for MEV.**
- Control schedule — three-way segmented (Continuous / Occupied / Timer). Show small sparkline of the schedule shape so the user sees what they're picking.
- **Stretch:** frost protection threshold (°C, MVHR only) — when outdoor air drops below this, MVHR routes around the heat exchanger or applies pre-heat. Default -5°C. Emit as `HeatExchanger:AirToAir:SensibleAndLatent` `threshold_temperature` field.
- **Stretch:** summer bypass schedule — schedule reference, MVHR only.

**What stays hidden:** node names (autocalculated), fan motor inputs (Fan:SystemModel `motor_efficiency` etc.), NodeList plumbing.

**Wiring check:**
- Brief 25 wired the control schedule. Verify vent=timer still drops EUI ~1 kWh/m² vs continuous.
- HRE override goes through `mvhr_eff` in the assembler — already wired.
- SFP override is in `sfp_override` — verify it reaches EnergyPlus `Fan:SystemModel.design_pressure_rise`.

**Files:**
- `frontend/src/components/library/inspectors/VentilationInspectorBody.jsx`
- (stretch) `nza_engine/generators/hvac_ventilation.py` — frost protection threshold field, summer bypass schedule.

**Commit:** `Ventilation Inspector with SFP, HRE, control schedule`

**Verification:** Toggle MEV→MVHR, HRE 85→0, SFP 1.5→2.5 — each should change `annual_heating_kWh` or `annual_ventilation_kWh` measurably.

---

## Part 4: DHW Inspector

DHW has two-stream complexity (primary + secondary preheat). This Inspector is more elaborate than the others.

**Fields exposed:**

*Primary system:*
- System type — dropdown filtered to `serves === 'dhw'`. HIX = `gas_boiler_dhw`.
- Efficiency / COP — slider, label switches between "Seasonal efficiency" (gas/oil, 0.7–0.99) and "COP" (electric, 1.5–4.0).
- Fuel — read-only badge (gas / electricity / oil) from the library template.

*Secondary preheat:*
- "Add preheat" toggle. When on:
  - System type dropdown — ASHP / solar thermal / none.
  - COP slider (ASHP) — 1.5–4.5, default 2.8.
  - Max heating temperature (°C) — slider 35–60, default 45. ASHP shuts off above this, primary takes over.
  - Share — read-only display (`100% × ASHP_capacity_share`) calculated from the temperature crossover.

*Building-wide:*
- DHW setpoint (°C) — slider 50–65, default 60.
- Preheat setpoint (°C) — slider 35–50, default 45.
- **Stretch:** Recirculation losses (% of DHW demand) — slider 0–30, default 15 (CIBSE TM13 for hotel). Emits as additional `WaterHeater:Mixed.off_cycle_loss_coefficient_to_ambient_temperature` adjustment.
- **Stretch:** Tank volume (L) — slider 200–5000. Default 1000 for 134-bedroom hotel. Affects thermal mass and standby losses.

**What stays hidden:** plant loop topology (we use the two-tank cascade trick), pump power (0 W), node names.

**Wiring check:**
- Verify changing ASHP COP from 2.8 → 3.5 reduces electricity consumption.
- Verify max heating temperature 45 → 50 increases ASHP share of total DHW.
- Recirculation losses should appear as a new DHW-side loss line item in the heat balance (similar to how openings now break out).

**Files:**
- `frontend/src/components/library/inspectors/DHWInspectorBody.jsx`
- `nza_engine/generators/hvac_dhw.py` — recirculation loss field, tank volume override.

**Commit:** `DHW Inspector with primary + ASHP preheat + recirculation`

**Verification:** HIX baseline DHW demand ~12 kWh/m². Add 15% recirculation → demand goes to ~14 kWh/m². ASHP cuts gas use roughly proportionally to its share.

---

## Part 5: Cooling Inspector

VRF is the main concern for HIX. Heating + cooling sometimes share the same VRF unit (combined heat pump), so Cooling and Heating Inspectors must be aware of each other.

**Fields exposed:**
- System type — dropdown: VRF / split system / none. Filtered to `serves === 'cooling' || 'heating_and_cooling'`.
- Nominal EER — slider 2.0–5.0, default 3.2.
- "Combined with heating" — read-only badge when same template serves both demands. Cooling Inspector then shares the SCOP slider with Heating.
- Condenser type — radio: Air-cooled / Water-cooled / Evaporative. Default Air-cooled.
- Defrost strategy — radio: Resistive / Timed / Reverse-cycle. Default Resistive (matches the library).
- Defrost time fraction — slider 0–0.20, default 0.058 (= 1 hour / day at -5°C). Only visible when defrost is on.
- Cooling setpoint — slider 22–28°C, default 24. Changes the `hotel_cooling_setpoint` schedule reference.
- **Stretch:** Capacity-vs-temperature curve — read-only sparkline showing rated cooling capacity at 5°C / 25°C / 35°C outdoor. Pulled from `hvac_vrf.py` curves. Visually demonstrates that capacity drops in extreme heat.

**What stays hidden:** Performance curve coefficients (biquadratic / quadratic / cubic), master thermostat zone (autocalculated), refrigerant type, crankcase heater power.

**Wiring check:**
- EER 3.2 → 4.5: confirm `annual_cooling_kWh` drops (~1/1.4 ≈ 70% of baseline electricity for the same thermal output).
- Cooling setpoint 24 → 22: confirm cooling demand increases.

**Files:**
- `frontend/src/components/library/inspectors/CoolingInspectorBody.jsx`
- `nza_engine/generators/hvac_vrf.py` — wire defrost strategy + time fraction as overrides.

**Commit:** `Cooling Inspector with EER, defrost, condenser type, setpoint`

**Verification:** EER 3.2 → 4.5, setpoint 24 → 22: combined sim, EUI delta both positive and negative as expected.

---

## Part 6: Heating Inspector

The biggest. Handles three families: boiler / ASHP / VRF (combined heat-pump).

**Fields exposed:**

*Common:*
- System type — dropdown filtered to `serves === 'heating' || 'heating_and_cooling'`.
- Efficiency / SCOP — label switches between "Seasonal efficiency" (boiler) and "SCOP" (heat pump). Slider range adapts.
- Heating setpoint (°C) — slider 18–24, default 21. Changes `hotel_heating_setpoint` schedule.
- Setback (°C) — slider 12–20, default 18. The overnight/unoccupied setback temperature.
- **Stretch:** weather compensation — toggle. When on, surface a flow temperature schedule that drops as outdoor air rises (boiler) or as outdoor air drops (heat pump).

*Boiler-specific (only when system type is boiler):*
- Condensing threshold (°C return temp) — slider 40–55, default 50. Below this the boiler runs in condensing mode at full efficiency; above, efficiency drops 5–8%. Stretch.
- Modulation range (%) — slider 10–100, default 20. The minimum firing fraction before the boiler cycles. Stretch.

*Heat-pump-specific (ASHP or VRF heating):*
- Defrost strategy + time fraction — same controls as Cooling Inspector. Stretch.
- Minimum outdoor temperature (°C) — slider -25 to 0, default -15. Below this the heat pump shuts off and backup heat takes over. Stretch.
- Backup heat — when min-outdoor-temp is reached, what fills in? Dropdown: None / Electric resistance / Gas boiler. Stretch.

**What stays hidden:** Performance curve coefficients, fraction radiant for gas baseboard (0.30), sizing factors.

**Wiring check:**
- Boiler efficiency 0.92 → 0.85: heating gas use rises ~8%.
- SCOP 3.5 → 4.5: heating electricity drops ~22%.
- Heating setpoint 21 → 19: heating demand drops sharply.

**Files:**
- `frontend/src/components/library/inspectors/HeatingInspectorBody.jsx`
- `nza_engine/generators/hvac_heating_boiler.py` — wire weather compensation, condensing threshold (if built).
- `nza_engine/generators/hvac_vrf.py` — defrost overrides (if built — shared with Part 5).

**Commit:** `Heating Inspector with type-specific fields per family`

**Verification:** boiler efficiency 92→85% gives ~8% gas-use bump; setpoint 21→19 gives clearer EUI drop.

---

## Part 7: Cross-system sanity + commit final

After all six Inspectors are in, do an end-to-end pass:

1. Open each Inspector on its own row in `/systems`. Confirm:
   - Header is right
   - Built-in lock icon present
   - "Save as new copy" works (creates a custom library item, refreshes the dropdown, switches selection to the new item)
   - "Save changes" works on custom items
   - Esc + click-outside close cleanly
   - No layout collision with the Sankey on the centre pane

2. Confirm the parity table from `SYSTEMS_AUDIT.md` is now closed for the systems we built — every "missing" row has either landed or been explicitly de-scoped here.

3. Run one full HIX Bridgewater simulation with everything at defaults. Compare the result to `SYSTEMS_AUDIT.md`'s baseline EUI. If they disagree by more than 2%, investigate.

**Commit:** `Systems Inspectors complete: 6 system families, parity with Construction Inspector pattern`

**Push.** Update `STATUS.md` with what landed.

---

## What this brief does NOT do

For clarity, here's what's deliberately out of scope:

- **System on/off toggles** (lighting off / heating off / cooling off): Brief 27.
- **Monthly stacked bar of end-use** + **annual donut**: Brief 27.
- **System-by-system with/without bar pair**: Brief 27.
- **Profiles split** (Occupancy section vs Schedules section): Brief 28.
- **AirflowNetwork** (multi-zone crossflow / stack ventilation): future Brief.
- **Real `Daylighting:Controls`** with reference points and glare calcs: stretch in Part 2, otherwise future.
- **Per-zone overrides** (different LPD per floor, different schedule per zone): future. All zones treated as `hotel_bedroom` for HIX.

---

## Notes for the implementer

- Each Inspector body should read from `systems.{demand}.{stream}` (the new demand-based shape) AND fall back to the flat keys (`hvac_type`, `dhw_primary`, `ventilation_type`, `sfp_override`, `dhw_setpoint`, `lighting_power_density`, `equipment_power_density`). Both are kept in sync by `ProjectContext.jsx`'s `updateSystem`. Write to whichever; the other will update.
- Every Inspector field that lands in the saved library item should also reach the live calc (`instantCalc.js`) — otherwise we recreate the Brief 25 cosmetic-bug class. After wiring an inspector field, do an A/B live-vs-simulation comparison.
- The Construction Inspector saves builtins-as-copy via POST to `/api/library`, in-place updates via PUT to `/api/library/{name}`. The systems router (`api/routers/library.py`) supports the same — verify before touching it.
- The reference pattern is `ConstructionInspector.jsx`. When in doubt, mirror its structure rather than invent a new layout.

---

## Estimated effort

| Part | Effort | Why |
|---|---|---|
| 0 — shell | M | Side-panel mechanics, save-as-copy plumbing, click-handlers in SystemsZones |
| 1 — Equipment | S | Few fields, EPD already wired |
| 2 — Lighting | M | Daylighting:Controls stretch is non-trivial — drop if running long |
| 3 — Ventilation | M | Frost / bypass stretch; SFP/HRE already wired |
| 4 — DHW | L | Two-stream UI; recirculation + tank-volume are net-new |
| 5 — Cooling | M | Most fields already exist; defrost wiring new |
| 6 — Heating | L | Three families to handle; weather compensation + condensing threshold new |
| 7 — final pass | S | Sanity check, doc updates |

Total: ~5–7 sessions if no surprises.
