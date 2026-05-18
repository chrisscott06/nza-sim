# Brief 30 Phase 0.1 — Current EP `Output:Variable` baseline

**Scope:** What `nza_engine/generators/epjson_assembler.py` currently requests from EnergyPlus, and which of those variables `nza_engine/parsers/sql_parser.py` currently consumes. This is the input to Phase 0.2's required-variables list and the strip work in Phase 1.

**Audit date:** 2026-05-18.
**Source files:** `epjson_assembler.py::_output_variables` (lines 648–700), `epjson_assembler.py::_output_meters` (lines 703–725), `sql_parser.py` (grep across all `_sum_annual` / `_monthly_sums` / `_read_hourly_*` calls).
**EnergyPlus version target:** V26.1.0 (per Chris call 2026-05-18 — supersedes CLAUDE.md V25-2-0 default).

---

## A. `Output:Variable` requests (all at Hourly frequency)

Every entry in this table is emitted by `_output_variables()` for **every** EnergyPlus run regardless of state mode — there is currently no state-aware filtering of output requests. Object emission IS state-gated (Brief 29 Commit A); output requests are NOT.

| # | EP Output:Variable name | Reporting frequency | Consumed by which parser path? | Notes |
|---|---|---|---|---|
| 1 | `Zone Mean Air Temperature` | Hourly | ✓ `_get_heat_balance_state1:1521` via `_read_hourly_zone_temp` | The only EP-derived input to the State 1 demand integral. State 2 path also reads it. |
| 2 | `Zone Operative Temperature` | Hourly | ✓ `_get_heat_balance_state1:1522` (comfort hours) | Used for comfort-hour counts; T_air drives the demand integral. |
| 3 | `Zone Ideal Loads Supply Air Total Heating Energy` | Hourly | ✓ `_sum_annual` in multiple State 3 paths (lines 276, 330, 406, 472); `_has_ideal_loads()` line 247 also uses this variable's presence as a "is this an IdealLoads run?" flag | Discarded by State 1 + State 2 paths (IdealLoads is supposed to be muted). |
| 4 | `Zone Ideal Loads Supply Air Total Cooling Energy` | Hourly | ✓ `_sum_annual` State 3 (lines 277, 331, 407, 473) | Same scope as #3. |
| 5 | `Zone People Occupant Count` | Hourly | ✗ **NOT CONSUMED** by any parser path | Diagnostic value (verify schedule decoded correctly). Currently unused. |
| 6 | `Zone People Total Heating Energy` | Hourly | ✓ State 2 (line 1072), State 2 alt (line 1850) | Sum across all zones × hours gives annual people sensible+latent. State 1 does NOT read this. |
| 7 | `Zone Lights Electricity Energy` | Hourly | ✓ State 3 (lines 272, 332, 402, 474); fallback at lines 1079, 1853 if Total Heating Energy missing | Delivered electrical input to lights (≈ heat gain since 100% becomes heat). |
| 8 | `Zone Lights Total Heating Energy` | Hourly | ✓ State 2 (lines 1077, 1851) | The heat actually delivered to the zone air balance. |
| 9 | `Zone Electric Equipment Electricity Energy` | Hourly | ✓ State 3 (lines 273, 333, 403, 475); fallback at lines 1076, 1856 | Delivered electrical input to equipment. |
| 10 | `Zone Electric Equipment Total Heating Energy` | Hourly | ✓ State 2 (lines 1074, 1854) | Heat delivered to zone — accounts for fraction-radiant/visible/convective splits. |
| 11 | `Zone Hot Water Equipment Electricity Energy` | Hourly | ✗ **NOT CONSUMED** | Intended for DHW heat-gain accounting but never read. |
| 12 | `Zone Infiltration Sensible Heat Loss Energy` | Hourly | ✓ Brief 28-IM consumption block (line 634), State 2 (line 2023) — **but State 1 path does NOT read it**, instead recomputes `UA_leakage × dT_air` in Python | This is the Brief 29 Issue #8 finding in one line. |
| 13 | `Zone Infiltration Sensible Heat Gain Energy` | Hourly | ✓ Brief 28-IM consumption block (line 635), State 2 (line 2024) — State 1 does NOT read | Same scope as #12. |
| 14 | `Zone Ventilation Sensible Heat Loss Energy` | Hourly | ✓ State 2 (line 1094) — **State 1 does NOT read; recomputes in Python** | Lumps louvre + operable openings + mechanical vent into one number. |
| 15 | `Zone Ventilation Sensible Heat Gain Energy` | Hourly | ✗ **NOT CONSUMED** | Counterpart to #14 — emitted but no parser path reads the gain side. |
| 16 | `Fan Electricity Energy` | Hourly | ✗ **NOT CONSUMED directly** (covered by `Fans:Electricity` meter, see Meters below) | Per-fan-object data discarded; meter-level aggregate is read instead. |
| 17 | `Surface Inside Face Conduction Heat Transfer Energy` | Hourly | ✓ Brief 28-IM consumption block (line 645) — **State 1 + State 2 paths do NOT read; recompute `U×A×dT_air` in Python** | The most important "emitted-but-unused-by-State-1" variable. This IS EnergyPlus's per-element conduction loss with full CTF + sky long-wave + sol-air boundary conditions. The whole reason Brief 30 exists. |
| 18 | `Surface Outside Face Sunlit Fraction` | Hourly | ✗ **NOT CONSUMED** | Intended for the Brief 23 shading audit; never wired up. Still useful for Phase 1's diagnostic. |
| 19 | `Surface Outside Face Incident Solar Radiation Rate per Area` | Hourly | ✓ `_get_heat_balance_state1:1527` via `_read_hourly_solar_by_face` (line 1373) | State 1 parser converts this to "transmitted solar" by multiplying by g × area × frame — re-derives what EP already computes (see #21). |
| 20 | `Zone Windows Total Transmitted Solar Radiation Energy` | Hourly | ✓ Brief 28-IM consumption block fallback (line 643) | The zone-aggregated transmitted solar EP itself computes via SimpleGlazingSystem with incidence-angle adjustment. State 1 does NOT read this — uses #19 + Python multiplication instead. |
| 21 | `Surface Window Transmitted Solar Radiation Energy` | Hourly | ✓ Brief 28-IM consumption block (line 640) | Per-window transmitted solar (rolls up to #20). Same "EP knows it, parser ignores it in State 1" pattern. |
| 22 | `Zone Ideal Loads Heat Recovery Total Heating Energy` | Hourly | ✗ **NOT CONSUMED** | Intended for MVHR heat-recovery accounting; never wired. |
| 23 | `Zone Ideal Loads Heat Recovery Total Cooling Energy` | Hourly | ✗ **NOT CONSUMED** | Counterpart to #22. |
| 24 | `Baseboard Gas Energy` | Hourly | ✗ **NOT CONSUMED** | For gas-baseboard heating systems; no project uses these yet. |
| 25 | `Baseboard Total Heating Energy` | Hourly | ✗ **NOT CONSUMED** | Same scope as #24. |
| 26 | `Baseboard Electricity Energy` | Hourly | ✗ **NOT CONSUMED** | Same scope as #24. |

**Total: 26 variables requested. 19 consumed by at least one parser path. 7 emitted but unused (#5, #11, #15, #16, #18, #22, #23, #24, #25, #26 — count is higher when including #16 which is superseded by the meter).**

The State 1 parser path (`_get_heat_balance_state1`) consumes **only #1, #2, and #19** — 3 of 26 variables. Per Brief 29 Issue #8.

## B. `Output:Meter` requests (all at Hourly frequency)

| # | EP meter name | Consumed by which parser path? | Notes |
|---|---|---|---|
| 1 | `Electricity:Facility` | ✓ State 3 KPI (lines 299, 420, 479, 555) | Facility-level total electricity. |
| 2 | `Gas:Facility` | ✗ **NOT CONSUMED** | Legacy name; superseded by #3 in EP 22+. Kept emitted for backward compatibility. **V25→V26 note:** still valid in V26.1 but `NaturalGas:Facility` is the modern name. |
| 3 | `NaturalGas:Facility` | ✓ State 3 KPI (lines 301, 421, 480, 556) | Facility-level natural gas. |
| 4 | `Heating:EnergyTransfer` | ✓ State 3 KPI (lines 292, 418, 539) + peak (line 424) + monthly (line 337) | "Energy transfer" = energy delivered to zone, exclusive of system losses. Used as headline heating demand on non-IdealLoads systems. |
| 5 | `Cooling:EnergyTransfer` | ✓ State 3 KPI (lines 293, 419, 540) + peak (line 425) + monthly (line 338) | Same scope as #4. |
| 6 | `InteriorLights:Electricity` | ✓ State 3 consumption block (line 552) | Lighting end-use. |
| 7 | `InteriorEquipment:Electricity` | ✓ State 3 consumption block (line 553) | Equipment end-use. |
| 8 | `Fans:Electricity` | ✓ State 3 KPI (line 297) + monthly (line 339) + consumption (line 551) | Fan parasitic energy. |
| 9 | `Cooling:Electricity` | ✓ State 3 KPI (line 296) + consumption (line 544) | Electricity for cooling. |
| 10 | `Heating:Electricity` | ✓ State 3 KPI (line 295) + consumption (line 542) | Electricity for heating (heat pumps). |
| 11 | `WaterSystems:Electricity` | ✓ Consumption block (line 548) | DHW electricity. |
| 12 | `WaterSystems:NaturalGas` | ✓ Consumption block (line 549) | DHW gas. |

Plus the parser reads `Heating:NaturalGas` at line 543 — **this is not requested in `_output_meters` but is presumably available via the facility-level emission**. Flag for Phase 0.3 schema lock.

**Total: 12 meters requested. 11 consumed. 1 unused (#2, superseded by #3).**

## C. `Output:SQLite` + `Output:VariableDictionary`

- `Output:SQLite` — option_type = `SimpleAndTabular`. This is what creates `eplusout.sql`. Required, kept.
- `Output:VariableDictionary` — emits `eplusout.rdd` listing every Output:Variable EP knows how to produce. Diagnostic-only; doesn't affect simulation.

## D. State-mode emission gating in the current code

There is currently **NO** state-aware filtering of `Output:Variable` requests. `_output_variables()` returns the same dict regardless of mode. State gating happens only at object emission (People density 0 in State 1, operable openings suppressed in State 1+2 per Commit A `39a828c`, etc.).

This is fine for output requests — EP silently emits zeros for variables that have no source object (e.g. `Zone People Total Heating Energy` is 0 when there are no `People` objects). But it does mean the SQL contains many zero columns in State 1, which slows the SQLite write slightly and clutters the rdd.

Phase 1's `should_emit_for_state(object_type, state)` helper per Brief 30 Principle 4 governs OBJECT emission. Whether `Output:Variable` requests should also be state-gated is a Phase 0.2 design decision; I will recommend gating them too for clarity and SQL hygiene.

## E. Implications for Phase 1

The State 1 parser (`_get_heat_balance_state1`) ignores 23 of 26 emitted variables and recomputes their physical meaning in Python from #1, #2, #19 plus the building config. Per Brief 30 Principle 1 ("Dynamic computes its own answer"), this whole pattern is replaced. State 1's new parser path consumes:

- #1 `Zone Mean Air Temperature` (display only — not for re-derivation)
- #2 `Zone Operative Temperature` (comfort hours)
- #12 `Zone Infiltration Sensible Heat Loss Energy` (replaces Python `UA_leakage × dT_air`)
- #13 `Zone Infiltration Sensible Heat Gain Energy` (gain side)
- #17 `Surface Inside Face Conduction Heat Transfer Energy` (replaces Python per-element conduction)
- #20 or #21 `Zone Windows Total Transmitted Solar Radiation Energy` / `Surface Window Transmitted Solar Radiation Energy` (replaces Python `incident × g × area × frame`)

Plus diagnostic-only: #18 `Surface Outside Face Sunlit Fraction`, `Site Outdoor Air Drybulb Temperature` (need to add to `_output_variables`).

Phase 0.2 details the full required list per state.

## F. Variables to ADD in Phase 0.2

Per Brief 30 §0.2, State 1 also needs:

- `Site Outdoor Air Drybulb Temperature` — **NOT currently requested**. Adds to `_output_variables`.
- `Surface Outside Face Conduction Heat Transfer Energy` (per surface, for the inside-vs-outside energy balance diagnostic) — **NOT currently requested**.
- `Surface Window Heat Loss Energy` and `Surface Window Heat Gain Energy` — **NOT currently requested**. Currently the parser uses `Surface Inside Face Conduction Heat Transfer Energy` for windows too, which works but lumps conduction with frame/edge effects.

For Phase 0.2 details per state, see `30_ep_outputs_required.md`.
