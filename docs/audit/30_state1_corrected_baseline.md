# Brief 30 — State 1 corrected baseline (checkpoint a)

**Status:** Captured 2026-05-18, immediately after the API binding fix (Phase 1.0 commit).
**Purpose:** Reference snapshot of what the **current** Brief 30 assembler + parser produce in State 1 when the API endpoint honours `mode=envelope-only`. Phase 1.1 (strip) and Phase 1.2 (parser rewrite) will move these numbers; the three checkpoint deltas are the diagnostic.

The three planned checkpoints:

| Label | When | Status |
|---|---|---|
| **(a) current State 1 correctly-invoked** | Pre-Phase-1.1, this document | Captured |
| **(b) post-strip State 1** | Post-Phase-1.1 (object removal per Brief 30 Principle 4) | Pending |
| **(c) post-parser-rewrite State 1** | Post-Phase-1.2 (parser consumes EP per-element) | Pending |

## Run details

| Field | Value |
|---|---|
| Run ID | `a3317388` |
| Invocation | `POST /api/projects/14b4a5b1-.../simulate` with body `{"mode":"envelope-only"}` (Phase 1.0 fix) |
| EnergyPlus | V26.1.0 |
| Weather | `GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw` |
| Comfort band | 21.0 – 24.0 °C |
| Building | HIX Bridgewater (4,322 m² GIA, 5 zones, q50 unset / legacy ach = 0.23) |

## EP objects emitted in current State 1 path

Confirms the state1 emission path actually ran (not the silently-dropped `mode="full"` from yesterday's baseline `b8db113e`):

| Object type | Count | Brief 30 §1.1 says |
|---|---|---|
| `ZoneHVAC:TerminalUnit:VariableRefrigerantFlow` | 0 | NOT emitted ✓ |
| `ZoneVentilation:DesignFlowRate` | 0 | NOT emitted ✓ |
| `DesignSpecification:OutdoorAir` | 0 | NOT emitted ✓ |
| `OutdoorAir:Node` | 0 | NOT emitted ✓ |
| `Sizing:Zone` / `SizingPeriod:DesignDay` | 0 / 0 | NOT emitted ✓ |
| `ZoneHVAC:IdealLoadsAirSystem` | 5 | **NOT emitted** — Phase 1.1 will strip |
| `ZoneHVAC:EquipmentList` / `EquipmentConnections` | 5 / 5 | **NOT emitted** — Phase 1.1 |
| `ZoneControl:Thermostat` / `ThermostatSetpoint:DualSetpoint` | 5 / 5 | **NOT emitted** — Phase 1.1 |
| `Schedule:Constant` (incl. `state1_heating_setpoint`, `state1_cooling_setpoint`) | 5 | Strip the state1 setpoint entries in Phase 1.1 (they exist only for the muted thermostat that's being removed) |
| `People` / `Lights` / `ElectricEquipment` | 5 / 5 / 5 | **NOT emitted** in Brief 30 §1.1 (currently zero density — Principle 4 says removal, not muting) — Phase 1.1 |
| `ZoneVentilation:WindandStackOpenArea` (louvres) | 5 | **NOT emitted** in Brief 30 §1.1 (no `ZoneVentilation:*`) — Phase 1.1 |
| `BuildingSurface:Detailed` / `FenestrationSurface:Detailed` | 30 / 20 | emitted ✓ |
| `Material` / `Material:NoMass` / `WindowMaterial:SimpleGlazingSystem` / `Construction` | 15 / 1 / 1 / 5 | emitted ✓ |
| `Zone` | 5 | emitted ✓ |
| `ZoneInfiltration:DesignFlowRate` | 5 | emitted ✓ — the **only** ventilation in State 1 per Brief 30 |

**Phase 1.1 deletion target:** 5 IdealLoads + 5 EquipList + 5 EquipConns + 5 ZoneControl:Thermostat + 5 ThermostatSetpoint:DualSetpoint + 5 People + 5 Lights + 5 ElectricEquipment + 5 ZoneVentilation:WindandStackOpenArea (louvres) + 2 state1 Schedule:Constant entries = **52 objects to delete**.

## Heat balance from current parser (`_get_heat_balance_state1`)

| Quantity | Value | Source / formula |
|---|---|---|
| Heating demand | **266.7 MWh/yr** | Parser re-derives via `Σ max(0, UA_total × (21°C − T_out) − Q_solar)` over hours where T_op < 21°C |
| Cooling demand | 8.9 MWh/yr | Parser counterpart, over hours where T_op > 24°C |
| Solar (gross annual) | 82.3 MWh/yr | Parser: `incident × g × area × frame` per face, summed |
| External wall (free-running loss) | 20.4 MWh | Parser: `U × A × (T_air − T_out)` per hour, only when T_air > T_out |
| Roof | 6.0 MWh | same |
| Ground floor | 7.3 MWh | same |
| Glazing | 24.2 MWh | same |
| Fabric leakage | 40.2 MWh | `UA_leakage × dT_air` |
| Permanent vents | 47.7 MWh | `UA_permanent(t) × dT_air`, wind-driven, **cross-flow topology with C_d = 0.6** (Brief 29 Issue #2) |
| Thermal bridging | **0.0 MWh** | `UA_bridging × dT`, where `UA_bridging = max(0, (u_envelope − u_clear_edge) × area)`. Constructions don't carry `u_clear_edge`, so UA_bridging is always 0. **Brief 29 Issue #11 confirmed.** |
| **Σ 7 envelope losses (free-running)** | **145.8 MWh** | sum |

Compare:
- Static State 1 heating demand (post Brief 29 door fix): 194.3 MWh
- Current State 1 (this checkpoint, post API fix): 266.7 MWh
- Pre-API-fix "Dynamic State 1" (actually mode=full): 209.8 MWh (different number entirely — parser interpreting a full-system simulation)

**The 72.4 MWh gap between Static (194.3) and current State 1 (266.7) is the new "+8% Δ" question, except it's now +37% Δ.** The mechanism is unclear pre-Phase-1.2 — both engines use the same demand formula family (max(0, UA·ΔT − solar)) but Static uses per-element max(0, T_set − T_driving) while the State 1 parser uses lumped `UA_total × max(0, T_set − T_out)`. **Per Brief 30 acceptable-defence rubric, this Δ is UNDEFENDED.** Phase 1.2 (parser reads EP per-element directly) will produce a new number that has a defensible mechanism (EP CTF + sky long-wave + sol-air).

## T_zone trace

| Statistic | Value |
|---|---|
| Mean T_air | **15.51 °C** |
| Stdev | 5.32 K |
| Min | 4.69 °C |
| Max | 28.80 °C |
| % near 21.0 ± 0.05 K | **0.4%** (noise floor — no clamping) |
| % near 24.0 ± 0.05 K | 0.3% |
| Comfort hours (T_op in band) | 1,375 / 8,760 (15.7%) |
| Winter min T_air | 6.3 °C |
| Summer max T_air | 27.4 °C |

The 15.51 °C mean closely matches the Brief 29 Issue #13 "genuinely-stripped" diagnostic (14.74 °C), confirming that the State 1 assembler path produces correctly-free-running zone temperatures when invoked. The 0.8 K difference between the current State 1 (15.51) and the diagnostic (14.74) is because:
- Diagnostic also stripped People/Lights/Equipment objects entirely (Brief 30 §1.1 target)
- Current State 1 emits them with zero density (current "muted" approach)
- EP processes the zero-density objects with non-zero overhead (small radiative/convective coupling artefacts)

After Phase 1.1 strip, T_air mean should converge to the diagnostic's 14.74 °C ± 0.5 K.

## Single-building validation flag

> **Validation scope: single building.** All numbers in this document are computed against HIX Bridgewater only. A second test building (single-zone ASHRAE 140 BESTest case, or CIBSE TM33 reference cube) is queued as a separate brief. Until then, Bridgewater-specific findings may not generalise.

## Reference for the deltas

| Engine / state | Heating demand | Mean T_air | Notes |
|---|---|---|---|
| Static post-door-fix (Brief 29) | 194.3 MWh | 16.1 °C | Lumped 2-node + per-element setpoint integral |
| Pre-API-fix "Dynamic State 1" (b8db113e — actually mode=full) | 209.8 MWh | 21.1 °C | Parser misread a full-system simulation |
| Issue #13 diagnostic (manually stripped) | n/a (no demand integral) | 14.7 °C | Closest approximation to a clean State 1 |
| **Checkpoint (a) — current State 1 correctly invoked** | **266.7 MWh** | **15.5 °C** | This document. Strip pending. |
| (b) post-strip — predicted | TBD (likely 200–260 MWh range) | TBD (likely 14.5–15.0 °C) | Phase 1.1 |
| (c) post-parser-rewrite — predicted | TBD (could move significantly when EP per-element supplants Python re-derivation) | unchanged from (b) | Phase 1.2 |

The deltas (a)→(b)→(c) will be documented in `30_state1_FINDINGS.md` at the end of Phase 1.
