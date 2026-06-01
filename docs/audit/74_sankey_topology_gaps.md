# Brief 74 audit — Energy Flows auxiliary + Heat Balance mech vent loss ribbon

Companion to `docs/briefs/active/74_sankey_topology_gaps.md`. Each section updated at the close of its corresponding brief Part.

Tip at brief land: `b9a9bd6` (Brief 73 close).

---

## §1 — Bridgewater clean anchor (Part 1, 2026-06-01)

Captured via `node scripts/_brief74_p1_anchor.mjs` against live API (project `3561c5a6-9a3f-4b5c-9e3d-72b449658d9a`). Output cached at `docs/audit/74_p1_anchor_output.json`.

### §1.1 Building metadata

| Field | Value |
| --- | ---: |
| num_bedrooms | 138 |
| occupancy.density | 3 per_room |
| occupancy.occupancy_rate | 1.0 |
| reported_gia_m2 (EUI denominator) | 4125 |
| weather_file | `GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw` |
| comfort_band_c | 21 / 24 |

### §1.2 Headline anchor — captured vs brief-expected

| Metric | Captured | Brief expected | Δ |
| --- | ---: | ---: | ---: |
| EUI (kWh/m²·yr) | **133.6** | ~133.6 | ✓ matches |
| Σ electricity (MWh) | **346.438** | ~346.4 | ✓ matches |
| Σ gas (MWh) | **204.698** | ~204.7 | ✓ matches |
| Vent fan total (MWh) | **41.962** | ~42 | ✓ matches |
| Heat Balance Σ gains (MWh) | **488.011** | ~488 | ✓ matches |
| Heat Balance Σ losses (MWh) | **221.398** | ~472 | ✗ diverges (see §1.4) |
| Heat Balance Net residual (MWh) | **+266.613** | ~+16 | ✗ diverges |

EUI / fuel splits / vent fan / Σ gains all match. The Σ losses divergence is the headline of this brief — investigated in §1.4.

### §1.3 Per-service

| Service | Demand (MWh) | Delivered (MWh) |
| --- | ---: | ---: |
| Heating | 0 | 0 |
| Cooling | 302.1 | 302.1 |
| DHW | 263.183 | 263.183 |
| Vent fans (per-system: mvhr_gf_public 22.6 / bedroom_extract 16.0 / public_toilet_extract 3.4) | — | 41.962 (total) |

Heat demand = 0 — auxiliary heat gains (Chris's authored profiles) plus people / equipment / lighting saturate above heating setpoint. Cooling at 302 MWh is large and dominates the loss side.

### §1.4 Σ losses / Net residual divergence from brief expectation

`heat_balance.annual.losses` keys present in the engine emit: **`[external_wall, roof, ground_floor, glazing, thermal_bridging, fabric_leakage, permanent_vents]`** — envelope-only. The engine's `totals.losses_kwh = 221.398` is this envelope total. No `ventilation` / `mechanical_ventilation` / `cooling` keys are present on the loss block.

This is the bug Brief 74 P5 closes:
- Cooling (302 MWh) likely synthesises onto the loss side at display time via `BalanceSankey.jsx` / `HeatBalance.jsx` flatten functions reading `data.demand.cooling_demand_mwh` (same pattern as the synthetic heating ribbon on the gain side — seen at `BalanceSankey.jsx:92-126` in the Brief 73 review). That's why the brief expects Σ losses ~472 = envelope 221 + cooling 302 + … some bookkeeping.
- Mech vent heat loss is computed somewhere in the engine (otherwise heating demand would be miscounted — but heating demand = 0 here, so the engine may not be exposing the field even if it's internally computed). P4 will identify the field.

The brief's anchor (Σ losses ~472, residual ~+16) was captured on a rendered Sankey view that synthesises cooling onto the loss side. The engine's `totals.losses_kwh` is envelope-only and excludes synthesised entries. **The engine-emit number (221) and the rendered-Sankey number (472) are both "correct" for what they measure — they're just different fields on different code paths.**

P4 will read the source to:
1. Identify where cooling is synthesised onto the loss side at display time.
2. Identify where (if anywhere) mech vent loss is computed.
3. Reconcile from first principles against the engine number.

### §1.5 systems_flow status (P2 diagnostic preview)

| Field | Result |
| --- | --- |
| `result.systems_flow` (top level) | **MISSING** |
| `result.consumption.systems_flow` | **MISSING** |
| Result top-level keys | `[state, mode, inputs_used, comfort_band_used, gains, losses, losses_at_setpoint, daily_profiles, free_running, demand, bypass_reconciliation_s2, state1_delta, occupancy_summary, heat_balance, metadata, energy_use, system_performance, consumption, results, carbon_kg_co2_per_m2]` |

**Confirmed:** `_calculateState3` does not emit `systems_flow`. SystemSankey.jsx has no data to render for Bridgewater (the v40 path is the default for any project with `systems_config_v40`). This is exactly the pre-existing v40 gap flagged in Brief 73 P5 §5.2 — Brief 74 P2/P3 fixes it.

### §1.6 Auxiliary engine rollups — sanity (brief gates a-e)

From `heat_balance.annual.gains.internal.auxiliary`:
- kwh (gain side): **53,251** kWh
- electricity_kwh (carrier): **70,500** kWh

Brief 72 P5 boundary discipline intact (gain ≤ electricity, ratio reflects per-profile gain_fraction average). The numbers Chris was looking at on the Heat Balance Sankey in Brief 73 walkthrough — these are the live values. P3 will route them through the new `systems_flow` block onto the Energy Flows Sankey.

---

## §2-diagnostic — `systems_flow` port (Part 2, pending)

To be filled in Part 2.

---

## §4-diagnostic — Mech vent heat loss ribbon (Part 4, pending)

To be filled in Part 4.

---

## §6-walkthrough — Code self-verification + handoff (Part 6, pending)

To be filled at Part 6.

---

## §future — Tier-3 notes for next brief

- **EnergyFlowsTab on Results** — different code path (`ae.lighting_kWh`-shape aggregation, not `consumption.heat_balance.annual.gains.internal`). Out of Brief 74 scope. Carried forward from Brief 73 §future.
- **DHW load-shape toggle no-op** — Brief 72 P9 follow-on. Stub at `docs/audit/72_p9_dhw_load_shape_followup.md`.
