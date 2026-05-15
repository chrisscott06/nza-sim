# Brief 28f — State 3: Systems (heating, cooling, DHW, mechanical ventilation)

**Status:** Parts 1–4 COMPLETE 2026-05-15 (engine validated, 142/142 tests). **Part 5 — State 3 UI integration — SCOPED 2026-05-15, awaiting Chris's review before code work.**

- Part 1 (contract update v2.4 → v2.5): commit `b69f092`
- Part 2 (engine skeleton + library-strict halt): commit `4cab01d` (40 tests)
- Part 3 (heating + cooling energy math): commit `518a6f7` (56 tests)
- Part 4 (DHW + ventilation + lighting/equipment + carbon): commit `79dfebc` (46 tests)
- State 3 validation + two findings: `docs/validation/state3_part4_findings_2026_05_15.md` (commit `09881f4`)

**After Part 5 lands:** measured-data ingest + comparison (next major piece). Calibration workflow follows. State 3 refinements (hourly HRE, persisted library schema for system_templates, ventilation schedules, HVAC-aware State 2 cooling, performance curves) queue behind calibration — measured data will reveal which are necessary.

**Queue beyond 28g (data ingester):**

- **Brief 28h — Carbon pathway library + selection + snapshot.** 505 Design HIX Decarb Pathways workbook (26002-NZA-XX-XX-CA-X-1000) curated seven pathways for asset trajectory analysis:
  - CRREM v2 UK Hotel EUI pathway (2026–2050, kWh/m²/yr)
  - UK NZCBS OE-2 Hotel Retrofit EUI pathway
  - CRREM CO₂-only GHG intensity pathway
  - CRREM CO₂e GHG intensity pathway (incl. F-gases)
  - CRREM v2 UK electricity carbon factor (year-by-year)
  - FES 2025 Holistic Transition (NESO V006)
  - FES 2025 Electric Engagement
  - FES 2025 Hydrogen Evolution

  Plus DESNZ 2025 current factors as fallback (gas 0.18316, elec 0.20493 kg CO₂e/kWh). Workbook ref: `C:\Users\ChrisScott\OneDrive - NZA Consultancy Ltd\01a - Live Projects\26002 - Zeal HIX CRREM Study\01 - WIP\CA_Calcs\26002-NZA-XX-XX-CA-X-1000 - HIX Decarb Pathways.xlsx`.

  Scope: `pathway_library.js` frontend constants (mirror system templates pattern — shape mappable to future backend table). `project.carbon_methodology = { eui_pathway_id, grid_factor_pathway_id, ghg_intensity_pathway_id }` schema addition. Methodology UI panel with library picker (description-in-option per the same pattern as system templates). "Current asset on pathway" snapshot chart (horizontal dot for current EUI vs selected EUI target pathway year-by-year). Methodology display footer on Energy & Carbon + future calibration + intervention views.

  Out of scope for 28h: building-side projection over time (current EUI assumed flat unless intervention applied — that's 28i), intervention library (28i), MAC curve (28i).

- **Brief 28i — Intervention library + full projection.** After 28h. Intervention catalogue from the workbook (Full MVHR, Extract rate reduction, DHW occupancy reduction, DHW ASHP increase, Washing machine removal, Electric panel heater removal — gas/electricity savings, capital cost, lifetime). Stacking logic with dual-impact handling. Projection chart with building's trajectory against the selected pathway target. MAC curve.

  28i depends on calibration being grounded (otherwise we're projecting against a wrong baseline). So order is firmly: **28g ingester → calibration → 28h pathways → 28i interventions**.

---

## Part 5 — State 3 UI integration (SCOPED 2026-05-15, HALT-FOR-REVIEW)

**Goal:** make State 3 testable in the browser. The engine (v2.5) is sound; it's currently opt-in via `options.engine: 'v2.5'` with no UI surface to drive it. Part 5 wires it up end-to-end so a user can configure systems, see the State 3 results, and verify everything visually before measured-data ingest starts.

**Halt discipline:** halt after each substantial sub-piece (engine changes vs UI work) so the visible behaviour can be sanity-checked. Six sub-pieces grouped into four halt-points:

### Sub-piece 5.1 — DHW formula parameters as inputs (engine change)

Surface the DHW formula parameters as project inputs instead of module-level constants:

| New input | Default | Path |
|---|---:|---|
| `systems.dhw.litres_per_person_per_day` | 80 | systems config |
| `systems.dhw.store_temperature_c` | 60 | systems config |
| `systems.dhw.cold_mains_temperature_c` | 10 | systems config |

Engine computes `kWh/person/hour = L_per_day × (T_store − T_cold) × 4.18 / 3600 / 24` from these. Byte-identical output when at defaults; scales correctly when changed. Test fixture stays at defaults to keep existing tests stable.

### Sub-piece 5.2 — Ventilation `schedule_ref` lookup (engine change)

Currently `schedule_ref` is decorative — engine hardcodes 8760 h. Wire it to the existing schedule infrastructure (same library/profile shape that lighting + equipment use in State 2). When `schedule_ref` resolves to a profile, compute `hours_active` from the profile's hourly fractions. When absent or `'always_on'`, keep 8760 h behaviour.

### Sub-piece 5.3 — Library `system_templates` data source

Add 7 starter library items matching Bridgewater (the test fixture templates become canonical library items):

| id | supports | efficiency | fuel |
|---|---|---|---|
| `vrf_heat_recovery_dual_function` | heating + cooling | heating_scop 5.12, cooling_seer 3.51 | electricity |
| `dx_split_cooling` | cooling | cooling_seer 5.62 | electricity |
| `electric_panel_heater` | heating | heating_scop 1.0 | electricity |
| `ashp_dhw_preheat` | dhw | dhw_seasonal_efficiency 2.8 | electricity |
| `gas_boiler_calorifier` | dhw | dhw_seasonal_efficiency 0.88 | gas |
| `mvhr_with_hr` | ventilation | hre 0.8 (sfp default 1.4 W/(l/s)) | electricity |
| `wc_extract_no_hr` | ventilation | hre 0.0 (sfp default 0.4 W/(l/s)) | electricity |

### Sub-piece 5.4 — Systems config UI (scope locked 2026-05-15 per Chris's browser review of legacy v2.4 UI)

The v2.5 UI is a **partial rewrite** of the existing `SystemsZones.jsx` workspace, not an extension. Several legacy-v2.4 UI elements that are now redundant (since Path C shipped the Energy & Carbon Results tab) or never wired must be dropped before the v2.5 inputs land. Final scope:

**Per-service editor (heating / cooling / DHW):**
- **(a)** Each service starts as **"not configured"** with a "+ Add" affordance. User clicks to add. Services that aren't configured are **absent from the engine input entirely** (e.g. `systems_config_v25.heating = null`). Engine already handles this gracefully (verified in Part 2 byte-identity tests).
- **(b)** Per-service **primary / optional secondary with `primary_pct` split**. Already in the engine; UI exposes it. Mirror the DHW partial UX already in legacy — make the pattern consistent across heating + cooling + DHW.
- Library picker dropdown with **description inline** (per earlier decision — Pablo design system pattern, name + provenance flag visible without hover).
- Numeric setpoint input per service (heating: 15–25 °C, cooling: 20–30 °C). Slider for `primary_pct`. DHW: circulation pump W field + DHW demand inputs (L/p/day, store_temp, cold_mains).

**Per-service ventilation array editor:**
- **(c)** Multiple independent ventilation systems with **add/remove/edit**. Bridgewater has at least two real ones (MVHR, WC extract) — the workbook mentions Public toilet extract + kitchen extract as further candidates. Per-system inline `flow_l_s`, `sfp_w_per_l_s`, `hre`, `schedule_ref` fields plus library template picker.

**Drops (legacy-v2.4 cruft):**
- **(d)** Drop the right-hand live results panel (`SystemsLiveResults`). Energy & Carbon tab (Path C, shipped) is the canonical v2.5 results display — two displays of similar data create confusion.
- **(e)** Drop the "Detailed / Ideal Loads" simulation-mode toggle — v2.4 concept that doesn't exist in v2.5.
- **(f)** Drop the non-interactive top-right pills ("Detailed / MEV / ASHP Preheat") on the Sankey — legacy placeholders, never wired.
- **(g)** Drop the placeholder schedules showing "100%" without controls — v2.4 stub UI.

**Centre canvas:**
- **(h)** Keep the `SystemSankey` concept, but drive it from v2.5 engine output. It's a good visualisation. Add tabs alongside for alternative views — bar chart of fuel split, per-system efficiency comparison (SCOP/SEER tiles), demand vs delivered vs fuel (Sankey-adjacent). Pablo-pattern.

**Architectural retentions:**
- **System-first model retained.** No equipment-vs-system separation in V1. Library templates are the unit of equipment specification. Future enhancement if needed.
- **MVHR is correctly a State 3 system, not a State 2 element.** Heat Balance at State 2 (fixed in Issue 3 commit) shows physical gains/losses only. MVHR recovery appears in State 3 Energy & Carbon tab through the ventilation system path. Brief 28j (hour-by-hour cap, shipped) makes the recovery-vs-heating interaction physically plausible.

**Validation feedback (per earlier decision):** Catch `MissingLibraryField` errors and surface inline next to the relevant input using `subSystemPath` + `fieldName`. Block save with inline error. Allow saving partial (null/absent) `systems_config_v25` so users can leave the page half-configured.

**Persistence (per earlier decision):** Existing `PUT /api/projects/{id}/building` accepts arbitrary new fields via deep-merge (verified during Path C plumbing); `systems_config_v25` lands nested in `building_config`. No new endpoint needed.

### Sub-piece 5.5 — State 3 results display

Energy use breakdown by fuel × service, total EUI, total carbon. Per-system breakdown showing delivered MWh, fuel MWh, COP/SEER. Probably a new tab.

### Sub-piece 5.6 — Wire `engine: 'v2.5'` into the live engine call site

So the UI actually invokes State 3 when v2.5 systems_config is present.

### Sub-piece 5.7 — Update Bridgewater project record

Per Chris's data share 2026-05-15 — updates land alongside 5.4 UI build so the canonical test project is correct from first interaction:

- **`num_floors`: 4 → 5** (4 storeys above + ground = 5 total in UK floor-counting convention; the fabric doc's "4-storey" refers to floors above ground only). Confirmed by Chris 2026-05-15 after a brief retract-and-restore loop. Result: 58.8 × 14.7 × 5 = **4,322 m²**, within 2.5% of consumption analysis's recorded 4,215 m² (difference attributable to footprint-not-rectangular and/or plant/circulation excluded from the 4,215 figure). **No dimension stretch needed.**
- **MVHR flow → 1,450 L/s** (per fabric doc: 5 × 270-310 L/s commissioned units).
- **`num_bedrooms` stays at 134** (already correct in project config; consumption analysis says 134 keys, supersedes the fabric doc's 138 beds — keys may have been consolidated post-opening).
- **Occupancy banner** flagging the design-peak vs annual-average mismatch (per State 3 validation finding 2). Will read "Bridgewater occupancy is configured at design peak (134 rooms × 100% × 1.5 ppr = 201). Measured operation 2023-2025 was 100% continuous Home Office accommodation. Calibration will ground-truth this once measured-data ingest lands."
- **DHW `litres_per_person_per_day` stays at default 80** for now (will tune during calibration; pre-calibration likely 150+ under Home Office regime per Chris's analysis).

---

## Measured-data context (2026-05-15) — calibration inputs, not engine work

Chris shared three years of half-hourly electricity (Apr 2024–Mar 2026) + 50 months of monthly gas/electricity/water/occupancy (Jan 2022–Feb 2026) plus a 505 Design consumption analysis note. **No engine fixes are warranted from this — these are calibration findings for the measured-data ingest brief.**

### Regime change (operational): two-mode calibration target

The building changed regime in Dec 2022:

| Period | Regime | Occupancy |
|---|---|---|
| Jan 2022 – Nov 2022 | Normal Holiday Inn Express | ~69% |
| Dec 2022 onwards | Refugee accommodation (Home Office) | 100% continuous |

| Metric | Pre-HO | Post-HO | Change |
|---|---:|---:|---|
| Electricity | 50.3 MWh/month | 37.5 MWh/month | -25% (variability suppressed, not total energy reduced) |
| Gas | 9.7 MWh/month | 14.8 MWh/month | +52% (DHW load multiplied) |
| Gas / HDD | 464 kWh/HDD | 1,549 kWh/HDD | ×3.3 (DHW dominance confirmed under continuous occupancy) |

Ultimate calibration target: two calibrated models — "Normal trading" (2022 data) and "Home Office continuous" (2023–2025 data). Same building, two operational profiles. **Calibrate against the recent stable period (2024-25, Home Office mode) first; add second mode after.**

### Headline modelled vs measured gaps (pre-calibration baseline)

These will be the visible findings the tool surfaces once ingest + comparison lands. Both are expected; neither is an engine bug:

| Fuel | Modelled (current, defaults) | Measured 2024-25 avg | Gap | Likely cause |
|---|---:|---:|---:|---|
| Electricity | 260 MWh | ~560 MWh | ~300 MWh missing | Back-of-house, lifts, refrigeration, exterior lighting, signage, BMS — none currently in `gains.{lighting,equipment}.profiles` |
| Gas | 139 MWh | ~205 MWh | ~70 MWh missing | DHW `litres_per_person_per_day` at default 80; real likely 150+ under continuous occupancy |

GIA correction (3,457 → 4,215 m²) drops modelled EUI from 115.6 → ~95 kWh/m² but doesn't close either gap (the gaps are absolute kWh, not normalisation issues). Measured EUI is 178–199 kWh/m².

### Data ingester (parallel work track — scope arriving separately)

Chris is reading the consumption analysis note and the half-hourly file structure; will send a scoping brief separately. Targets:
- Parser for half-hourly electricity (Apr 2024–Mar 2026) and monthly gas/electricity/water/occupancy (Jan 2022–Feb 2026)
- Storage + UI surface in the Consumption module
- Per-month + per-day + per-half-hour comparison against modelled
- NMBE / CV(RMSE) computation per service / per fuel / per period
- Regime-aware bucketing (pre-HO vs post-HO) so calibration can use the right slice

This brief can run **in parallel** with Part 5 sub-pieces 5.4–5.6 (UI work) since the data is independently visualisable and regression-analysable. Sub-pieces 5.1–5.3 (engine work) take precedence on the v2.5 path.

### Halt-points within Part 5 (re-ordered per Chris's steering 2026-05-15)

5.7 (Bridgewater config update) moved to land WITH 5.4 (Systems UI). Reason: opening Bridgewater in the new UI with empty v2.5 state would be misleading on the first interaction. Bridgewater must be the canonical-and-working test project from the moment the UI ships.

| After | Sanity-check | Sign-off needed |
|---|---|---|
| 5.1 + 5.2 (engine changes) | DHW formula + vent schedule work end-to-end via test fixtures; byte-identity at defaults preserved; existing 142 tests still green | YES |
| 5.3 (library frontend constants) | systemTemplatesLibrary.js shape mappable to future backend table; consumed by engine validation | YES |
| 5.4 + 5.7 (Systems UI + Bridgewater config) | Systems module renders Bridgewater outputs matching canonical values; v2.5 systems_config_v25 persists; occupancy banner visible | YES |
| 5.5 (Energy & Carbon tab) | New Results tab renders v2.5 outputs (energy_use breakdown by fuel × service, EUI, carbon, per-system perf) | YES |
| 5.6 (engine wire-up) | Live engine invokes v2.5 when `building.systems_config_v25` exists and is non-empty; legacy 'full' path still serves unmigrated projects | YES |

---

## Decisions approved 2026-05-15 (Chris)

1. **Persistence strategy:** (a) **Dual-format** — add `systems_config_v25` alongside legacy `systems_config`. Lowest risk.
2. **Library location:** (b) **Frontend constants** — single `frontend/src/data/systemTemplatesLibrary.js` file, shape mappable to future backend table for trivial migration.
3. **Systems UI strategy:** (a) **Replace** internals of existing HVACTab/DHWTab/VentilationTab with v2.5 inputs.
4. **Results display:** New 4th tab in Results module called **"Energy & Carbon"** alongside Overview / Heat Balance / CRREM.
5. **Bridgewater occupancy (Finding 2):** Flag in UI banner; defer fix until measured-data ingest grounds it.
6. **Ventilation schedule reuse:** (a) **Share** the schedule infrastructure that lighting + equipment use in State 2.

## Additional steering from Chris

7. **Results tab placement:** 4th tab under existing Results module. Name = "Energy & Carbon".
8. **Carbon factors:** stay hardcoded in `instantCalc.js` for V1. Grid factors are per-year-global, not per-project. Future CRREM pathway work needs per-year curves (different storage entirely). Pin `BEIS_2024_FACTORS` to its source publication year in a comment for traceability; document "update annually until grid-factor infrastructure lands."
9. **Setpoints UI:** per-service in Systems config, not bundled with comfort band. Heating setpoint in Heating config; cooling setpoint in Cooling config; DHW store temperature is the DHW setpoint (already exists in 5.1). Comfort band stays a State 1/2 concept in Heat Balance; setpoints are a State 3 concept. They answer different questions.
10. **5.7 moves to land with 5.4** (re-ordered above).
11. **Dispatcher (5.6):** `if building.systems_config_v25 exists and is non-empty → engine v2.5; else → legacy 'full'`. Graceful fallback for unmigrated projects.
12. **UI validation feedback:** catch `MissingLibraryField` errors and surface inline next to the relevant input using `subSystemPath` + `fieldName` properties. "Heating primary system needs a library template" beats a generic error toast. Users debug their own configs.
13. **Reactivity:** State 3 live-update on slider change should be sub-second. Same live-engine model as the rest of the tool. (Confirming, not aspirational — current `calculateInstant` returns in ~80ms for Bridgewater, well under sub-second.)

---

**Proceeding with sub-piece 5.1 (DHW formula params) and 5.2 (vent schedule_ref lookup). Halt after 5.2 for first sanity check.**

---

## Sub-piece 5.4 + 5.6 + 5.7 — UI integration + dispatcher wire + Bridgewater config (NEXT, after dimension question resolved)

**Approved 2026-05-15 by Chris with steering captured below. One blocker remains (dimension question) before code work starts.**

### Approved decisions for 5.4+ (Chris, 2026-05-15)

1. **Persistence:** lean (a) backend API. First confirm whether existing building-config save endpoint accepts arbitrary new fields. If yes, no new endpoint needed; save `systems_config_v25` through existing path. If not, build a generic PATCH endpoint now (will be needed for every future schema addition). **Don't write one-shot DB scripts.**
2. **Library picker:** dropdown for V1, BUT with description text visible in the dropdown options — not just template name. Users selecting "VRF heat recovery" should see the provenance inline ("SCOP 5.12, SEER 3.51 — BRUKL design intent, calibration likely lowers these"). If component library doesn't support description-in-option natively, use name + hover tooltip. **Don't lose the provenance flagging built into the library.**
3. **Setpoint input:** numeric input (not slider). Setpoints are discrete commissioned values, not exploration knobs. Validation bounds: heating 15–25 °C, cooling 20–30 °C. Sliders stay for `primary_pct` where exploration is the point.
4. **Validation:** block save with inline error. Invalid persisted configs cause confusing reload-time failures; database stays clean. **Exception:** allow saving partial (null/absent) `systems_config_v25` so users can leave the page half-configured. Discipline = "either complete and valid, or absent."
5. **Dispatcher (5.6):** `if building.systems_config_v25 exists and is non-empty → engine v2.5; else → legacy 'full'`. Graceful fallback for unmigrated projects.

### Additional steering

- **Bridgewater corrections to land in 5.7** (per 2026-05-15 consumption analysis + fabric docs):
  - `num_floors`: 4 → **5** (4 above + ground; UK floor-counting → 58.8 × 14.7 × 5 = 4,322 m², within 2.5% of target 4,215)
  - GIA: 3,457 → ~4,322 m² (derived; no explicit override needed)
  - Bedrooms: stays at 134 (already correct)
  - MVHR flow: 5000 → 1450 L/s (5 × 270-310 L/s commissioned units per fabric doc)
  - DHW litres/p/day: stays at default 80 (calibration will tune)
- **Validation feedback:** catch `MissingLibraryField` errors and surface inline next to the relevant input using `subSystemPath` + `fieldName` properties.
- **Reactivity:** State 3 live-update on slider/input change should be sub-second (already achieved in engine layer — ~80 ms for Bridgewater).
- **Screenshot walkthrough required** when 5.4 + 5.7 complete: per-service primary+secondary layout consistency, vent add-system pattern, library picker description visibility, occupancy banner placement + wording, validation error display. **Sanity check on UX coherence, not a halt gate** — proceed and ship, then post screenshots.

### Parallel track (Chris, 2026-05-15)

Chris is scoping the data-ingester brief in parallel. Don't wait for him on Part 5 — when 5.4+5.6+5.7 lands the ingester brief should be ready as the next major piece. No queue change.

**Predecessor:** Brief 28c (State 2 loss recompute on its own zone-T trace).
**Successor (queued):** Brief 28e (State 2.5 operable windows + doors).

---

## What State 3 is, in one paragraph

State 3 takes the State 2 zone trace (gains-warmed, free-running) and applies a building's HVAC + DHW + mechanical-ventilation systems to turn free-running demand into delivered energy by fuel. It's the first state where the building's fuel bills become inspectable. State 3 is **building-level**, not zone-level: one set of systems serves the whole building, with optional primary/secondary splits by percentage. It's also library-driven: every efficiency / SFP / HRE number comes from a `system_template` library item, never hardcoded.

---

## In scope

| System | Scope |
|---|---|
| **Heating** | Primary system (required) + optional secondary system, with `primary_pct` / `secondary_pct` split that sums to 100%. Each system has a library-driven seasonal efficiency / SCOP. Heat demand from State 2's heating-demand integral is divided per split and divided by efficiency to give delivered fuel kWh per system. |
| **Cooling** | Same shape as heating: primary + optional secondary with % split, library-driven SEER / SCOP_cool. Cooling demand from State 2's cooling-demand integral is divided per split and divided by COP. |
| **DHW** | Two systems with `system_a_pct` / `system_b_pct` split (no "primary vs secondary" framing — DHW is often dual-fuel by design, e.g. gas + electric immersion). Plus a separate **DHW circulation pump baseload** input (W continuous) that adds a constant 8760-hour electrical load. |
| **Mechanical ventilation** | Multiple independent systems (not just one). Each system has per-system: flow rate (l/s or ACH), SFP (W per l/s), HRE (heat recovery effectiveness, 0..1), schedule (profile ID, reuses existing schedule infrastructure). Sum across systems gives total fan energy + total heating offset from HRE. |

### Validation discipline (per Chris's standing instruction)

- **Hand-calc against spreadsheet** for each system. For Bridgewater: pick worked numbers from the operational data, compute by hand, match within ±2%.
- **Byte-identity across states for shared physics.** State 3 output for solar gains, internal gains, free-running T_op, conduction losses MUST equal State 2 outputs byte-for-byte. Same physics, same numbers.
- **Sensitivity tests pass.** A1 (double length), A2 (rotate 90°) on State 3 → outputs scale + redistribute consistently with State 2.

---

## Out of scope (explicitly NOT in 28f)

| Excluded | Reason / where it lands instead |
|---|---|
| Per-zone systems | Building-level only in 28f. Multi-zone is a much bigger refactor — not now. |
| Distribution losses | Not in scope. Library-driven efficiency is end-to-end (covers distribution implicitly per CIBSE TM54 convention). |
| Pumps beyond DHW circulation | No primary heating pumps, no cooling pumps, no zone valves. The DHW circulation pump is the only auxiliary load explicitly modelled. |
| Air curtain | Lands with **Brief 28e** (State 2.5 doors) — air curtain is door-attached. |
| Renewables (PV, solar thermal, wind) | Not in 28f. Future brief. |

---

## Files most affected (preliminary)

- `frontend/src/utils/instantCalc.js::_calculateState3` (new function, mirrors `_calculateState2` entry pattern)
- `frontend/src/components/modules/systems/` (UI for the three system groups)
- `frontend/src/contexts/ProjectContext.jsx` (systems_config shape)
- Library: existing `system_template` items — verify schema covers all the inputs above. Likely need to add HRE field if not present.
- `nza_engine/assemblers/systems.py` (EP side mirror for cross-validation against EnergyPlus)
- `docs/state_contracts.md` (State 3 contract)

---

## Halt gates

**Halt for review BEFORE starting State 3 build** (per Chris's standing instruction). Confirm scope, validation discipline, and out-of-scope list with Chris before any code work.

**Halt during build** if:
- Library schema doesn't cover an input (e.g. HRE missing) — flag and ask, don't extend library schema unilaterally.
- Hand-calc disagrees with engine by >5% on any system — stop, investigate.
- State 2 byte-identity breaks (e.g. solar gains drift) — stop, regression.

---

## Sketch of the work split (to be confirmed at brief activation)

| Part | Scope | Halt gate |
|---|---|---|
| Part 1 | State 3 contract update (`docs/state_contracts.md`) — output shapes, contract guarantees. | Chris approves contract before code. **DONE 2026-05-15** (v2.5 shipped with Chris's five clarifications + four additions a/b/c/d). |
| Part 2 | Engine: `_calculateState3` skeleton; consumes `_calculateState2` output verbatim, adds an empty system-overlay pass. Byte-identity test passes (no systems = no change). HALT before any actual energy-use calculation. **DONE 2026-05-15** (commit `4cab01d`, 40/40 tests). |
| Part 3 | Heating + cooling primary + secondary with % split. Hand-calc vs spreadsheet on Bridgewater. **DONE 2026-05-15** (52/52 tests inc. hand-calc ±2%, ideal-loads regression, A1 fuel_ratio==demand_ratio, A2 splits unchanged, per-fuel gas+electric split). | ±2% hand-calc match. |
| Part 4 | DHW two-system split + circulation pump + mech ventilation + lighting/equipment + carbon. Hand-calc on each. | **DONE 2026-05-15** (commit `79dfebc`, 46/46 tests inc. DHW ASHP/boiler/circulation hand-calc, vent fans + HRE recovery with cap, lighting/equipment byte-identity, carbon exact). |
| (no Parts 5–7 needed) | The original split had separate parts for mech vent and a UI build. Mech ventilation landed in Part 4 alongside DHW (clean cohesion). UI build is queued behind measured-data ingest — it's premature to build the Systems UI before we have calibration evidence shaping the inspector design. | Closed out via `docs/validation/state3_part4_findings_2026_05_15.md`. |

---

## What's next after 28f

- **Brief 28e (State 2.5 operable windows + doors).** Already scoped. Queued after 28f.
- **Brief 28b Parts 2 / 4 / 5** remain DEFERRED — return when use case demands.

---

## File pointers (read these before starting)

- `docs/briefs/active/28c_state_2_loss_recompute.md` — immediate predecessor, validation-evidence template
- `docs/briefs/active/28b_physics_overhaul.md` — Part 3 v3 ship doc, sets validation discipline
- `docs/validation/bridgewater_state1_engine_outputs_2026_05_post_part3_v3.md` — canonical State 1 baseline
- `docs/state_contracts.md` — current state contract
- `frontend/src/utils/instantCalc.js::_calculateState2` — pattern to mirror for State 3 entry
- Existing systems UI / templates — confirm shapes before touching
