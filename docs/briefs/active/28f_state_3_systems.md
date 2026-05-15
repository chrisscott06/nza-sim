# Brief 28f — State 3: Systems (heating, cooling, DHW, mechanical ventilation)

**Status:** Parts 1–4 COMPLETE 2026-05-15 (engine validated, 142/142 tests). **Part 5 — State 3 UI integration — SCOPED 2026-05-15, awaiting Chris's review before code work.**

- Part 1 (contract update v2.4 → v2.5): commit `b69f092`
- Part 2 (engine skeleton + library-strict halt): commit `4cab01d` (40 tests)
- Part 3 (heating + cooling energy math): commit `518a6f7` (56 tests)
- Part 4 (DHW + ventilation + lighting/equipment + carbon): commit `79dfebc` (46 tests)
- State 3 validation + two findings: `docs/validation/state3_part4_findings_2026_05_15.md` (commit `09881f4`)

**After Part 5 lands:** measured-data ingest + comparison (next major piece). Calibration workflow follows. State 3 refinements (hourly HRE, persisted library schema for system_templates, ventilation schedules, HVAC-aware State 2 cooling, performance curves) queue behind calibration — measured data will reveal which are necessary.

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

### Sub-piece 5.4 — Systems config UI

Extend the existing Systems module (`frontend/src/components/modules/systems/`). Per service:
- **HVACTab** (heating + cooling): primary library_id picker + `primary_pct` slider + optional secondary toggle/picker + setpoint.
- **DHWTab**: same pattern + circulation pump W field + the three DHW demand inputs from 5.1.
- **VentilationTab**: add-new-system button; per-system inline `flow_l_s`, `sfp_w_per_l_s`, `hre`, `schedule_ref` fields.

### Sub-piece 5.5 — State 3 results display

Energy use breakdown by fuel × service, total EUI, total carbon. Per-system breakdown showing delivered MWh, fuel MWh, COP/SEER. Probably a new tab.

### Sub-piece 5.6 — Wire `engine: 'v2.5'` into the live engine call site

So the UI actually invokes State 3 when v2.5 systems_config is present.

### Sub-piece 5.7 — Update Bridgewater project record

- MVHR flow → 1450 L/s (per State 3 validation finding 1)
- Flag occupancy assumption visibly (per finding 2)

### Halt-points within Part 5

| After | Sanity-check | Sign-off needed |
|---|---|---|
| 5.1 + 5.2 (engine changes) | DHW + vent schedule work end-to-end via test fixtures; byte-identity at defaults preserved; existing 142 tests still green | YES |
| 5.3 + 5.7 (library + Bridgewater config) | Library items render; Bridgewater project record persists v2.5 config with MVHR 1450 | YES |
| 5.4 + 5.5 (UI build) | Systems module + new Results tab render Bridgewater outputs matching canonical values from validation doc | YES |
| 5.6 (engine wire-up) | Live engine invokes v2.5 when v2.5 systems_config is present; legacy 'full' path still serves projects without v2.5 config | YES |

---

## Open questions before Part 5 starts (need Chris's decisions)

1. **Persistence strategy for v2.5 `systems_config`** during transition. Legacy v2.4 systems_config is what the project DB holds today and is what the legacy 'full' UI consumes. Options:
   - (a) **Dual format** — add a new field `systems_config_v25` alongside legacy `systems_config`. v2.5 engine reads the new field; legacy UI keeps reading the old. Migrate later.
   - (b) **Replace** — migrate Bridgewater's `systems_config` to v2.5 shape now; legacy UI breaks until 5.4 lands.
   - (c) **Migrate everything in one shot** — schema migration script converts legacy → v2.5, legacy UI ports to v2.5 in 5.4, no transition period.
   - **Recommend (a).** Lowest-risk; keeps existing UI working until 5.4 lands.

2. **Library `system_templates` location**:
   - (a) **Backend library API** — new `/api/library/system_templates` endpoint, persisted in DB, treated like constructions.
   - (b) **Frontend constants** — stub in a `data/systemTemplatesLibrary.js` file for V1; backend persistence later.
   - **Recommend (a)** if you want library items to be user-editable in the UI eventually; **(b)** if V1 is "engineer-supplied, user-pickable but not user-editable" and you want to ship faster.

3. **Systems UI strategy** — extend existing tabs vs replace:
   - (a) **Replace** existing HVACTab/DHWTab/VentilationTab internals with v2.5 inputs. Cleaner final state.
   - (b) **Side-by-side v2.5 section** within each tab. Allows comparison during transition.
   - **Recommend (a)** — given v2.5 supersedes v2.4 conceptually, side-by-side adds confusion.

4. **State 3 results display** — new tab vs replace legacy Results:
   - (a) **New tab** called "State 3" or "Energy & Carbon" in Results module. Legacy Results untouched.
   - (b) **Replace** existing Overview / Sankey / CRREM tabs with v2.5 outputs.
   - **Recommend (a)** — keeps legacy outputs accessible for cross-reference during transition; users can compare side-by-side while we're validating.

5. **Bridgewater occupancy** — what action on Finding 2?
   - (a) Just flag in `STATUS.md` / a UI banner; defer fix.
   - (b) Update `building.occupancy_rate` from 1.0 → ~0.7 (UK hotel industry average).
   - (c) Update the occupancy schedule profile to a more realistic shape.
   - **Recommend (a)** — measured-data ingest is the natural place to ground-truth this. Don't fudge inputs preemptively.

6. **Ventilation schedule reuse**:
   - (a) **Share** the same `schedule_assignments` / profile library that lighting + equipment use in State 2.
   - (b) **Separate** namespace for ventilation schedules.
   - **Recommend (a)** — one schedule infrastructure is simpler. State 2's gains profile shape already covers what ventilation needs.

---

**Awaiting Chris's decisions on the six questions before Part 5 sub-piece 5.1 starts.**

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
