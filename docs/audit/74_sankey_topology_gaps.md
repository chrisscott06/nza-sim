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

## §2-diagnostic — `systems_flow` port (Part 2, 2026-06-01)

Source-read only. No code changed.

### §2.1 The gap (one sentence)

`_calculateState3` (`instantCalc.js:4898`) — the v40 code path that runs for any project with `systems_config_v40` populated, including Bridgewater — returns a result object spread from `state2Result` plus v40-specific blocks (`consumption`, `energy_use`, `metadata`, etc.), but **never assigns `result.systems_flow`**. State 2's output doesn't carry `systems_flow` either (it's emitted by inline-legacy / DD-fallback only). So the field is structurally absent on the v40 path, and downstream consumers see `undefined`.

### §2.2 The two existing emit sites

| File:line | Function | Notes |
| --- | --- | --- |
| `instantCalc.js:6154` + L6251 | `calculateInstantDegreeDay` (DD fallback when weatherData absent) | Builds `sf_nodes` + `sf_links`, returns `{…, systems_flow}`. Limited use — only hit when `weatherData == null`. |
| `instantCalc.js:6959` + L7058 | `_calculateInstantBaseline` ('full' inline-legacy path) | Same `sf_nodes`/`sf_links` construction at L5998–6155 (DD) and L6850–6959 (inline). Path is bypassed for v40 projects at `_calculateInstantBaseline:6486` which dispatches to `_calculateState3` BEFORE building sf_nodes. |
| `instantCalc.js:6281` | `_empty()` fallback | Returns `systems_flow: { nodes: [], links: [] }`. |

### §2.3 The three downstream consumers

| File:line | Consumer | Behaviour when `systems_flow` absent |
| --- | --- | --- |
| `SystemSankey.jsx:129` | Reads `result.systems_flow`; `buildGraph` at L50 returns `null` if `nodes?.length` or `links?.length` is falsy. | Sankey renders blank — exactly what Chris sees on Bridgewater. |
| `SystemsLiveResults.jsx:299` | `const sf = result.systems_flow` then enumerates links for diagnostics. | Silent degradation — no links shown. |
| `PopOutResults.jsx:140` | `if (!instantResult?.systems_flow) return null` then `buildSankeyGraph(...)`. | Pop-out result Sankey renders nothing. |

All three converge on `result.systems_flow` at the top level.

### §2.4 Data shape contract (from existing emit sites + SystemSankey consumer)

```js
systems_flow: {
  nodes: [
    { id: <string>, label: <string>, type: 'source'|'system'|'end_use'|'building'|'waste'|'recovered'|'unserved',
      category?: 'hvac'|'dhw'|'ventilation'|'lighting'|'equipment'|'auxiliary',
      metric?: <string display>,        // 'SCOP 3.2', '92% eff', '8 W/m²', etc.
      recovery_hint?: <string>,         // tooltip for waste nodes
    },
    …
  ],
  links: [
    { source: <node.id>, target: <node.id>, value_kWh: <number>, style: 'electricity'|'gas'|'heating'|'cooling'|'dhw'|'air'|'waste'|'recovered'|'unserved' },
    …
  ],
}
```

`SystemSankey.buildGraph` filters out links where `value_kWh <= 0` — so a zero-magnitude link is a clean no-op (renders nothing, no error). `nodes` should always include a node referenced by some non-zero link, but stray unused nodes don't fail rendering.

### §2.5 Node-ID conventions (for click-to-expand at `SystemSankey.jsx:355–368`)

| Section accordion | Node-ID pattern |
| --- | --- |
| `space_heating` | `sh_<sys_key>` (or legacy `vrf`, `heating`) |
| `space_cooling` | `sc_<sys_key>` |
| `dhw` | `dhw_<key>`, `dhw_sec_<key>`, or `dhw_del` |
| `ventilation` | `vent_<id>` (or legacy `mvhr`) |
| `lighting` | exactly `lighting` |
| `small_power` (Equipment in UI) | exactly `small_power` |

New for Brief 74 P3: `auxiliary` system node + `aux_del` end-use node (no accordion mapping needed for now; future brief can add one when AuxiliarySection becomes a sub-tab of Systems).

### §2.6 Why _calculateState3 doesn't emit it — historical / decision context

Reading the State 3 emit at `_calculateState3:5229+` shows the function returns:
```js
return {
  ...state2Result,
  state: 3, mode: 'full',
  metadata, energy_use, consumption, results, carbon_kg_co2_per_m2,
  // (no systems_flow)
}
```

There's no comment explaining the omission. Best guess: when Brief 40 introduced the v40 systems pipeline and `_calculateState3` was written, `systems_flow` wasn't ported because the per-system data lived in a different shape (`brief40.{service}.systems[]`) than the inline-legacy single-system-key model the sf_node IDs were built around. The legacy emit hardcoded keys like `sh_<sys_key>` from a single `sys.heating.primary` resolved key; v40 has `consumption.brief40.heating.systems[]` with per-system entries. Porting required mapping the array shape to the sf_node convention — non-trivial.

Brief 73 P5 §5.2 flagged this gap and deferred it as "needs its own brief". Brief 74 is that brief.

### §2.7 Minimum `systems_flow` emission shape for State 3

Reading from v40 data available in `_calculateState3` scope at the return point:

**Sources (always):**
- `grid` (when `electricity_total_kwh > 0`) — type 'source'
- `gas` (when `gas_total_kwh > 0`) — type 'source'

**Systems (per service, iterating brief40 arrays):**
- For each enabled heating system in `brief40Computed.heating.systems`: `sh_<sys.id>`, category 'hvac', metric from `sys.efficiency_metric` (flat Number — SCOP or eff%) + `sys.source_fuel`.
- For each enabled cooling: `sc_<sys.id>`, category 'hvac', metric SEER/EER from `sys.efficiency_metric`.
- For each enabled DHW: `dhw_<sys.id>` (or `dhw_sec_<sys.id>` for secondary), category 'dhw', metric COP/eff.
- For each enabled vent: `vent_<sys.id>`, category 'ventilation', metric from `sys.sfp_w_per_lps` + `sys.recovery_sensible_pct`.
- `lighting` if `lighting.total_delivered_electrical_mwh > 0`, category 'lighting', metric LPD from a profile read.
- `small_power` if `small_power.total_delivered_electrical_mwh > 0`, category 'equipment'.
- **`auxiliary` if `auxiliary.electricity_kwh > 0`**, category 'auxiliary', metric — total auxiliary W/m² or "n auxiliary loads".

**End-uses (per service):**
- `space_heat` (heating thermal delivered)
- `space_cool` (cooling thermal delivered)
- `dhw_del` (DHW thermal delivered)
- `fresh_air` (vent fan electricity)
- `light_del`, `equip_del`, **`aux_del`**

**Links:**
- Source → System: `grid → sh_<id>` with `value_kWh = sys.source_energy_mwh × 1000` when electric, `gas → sh_<id>` when gas. Same for cooling / DHW / vent / lighting / small_power / **auxiliary**.
- System → End-use: `sh_<id> → space_heat` with `value_kWh = sys.delivered_thermal_mwh × 1000`. Etc.
- **Auxiliary chain**: `grid → auxiliary` with `value_kWh = internal.auxiliary.electricity_kwh`; `auxiliary → aux_del` with the same value.

Optional (Brief 74 scope = "missing ribbons", not redesign):
- MVHR recovery node + cascade link — defer to a future brief unless trivial.
- Heating/DHW flue waste — defer.
- Heat rejection from cooling — defer.

### §2.8 Rule 14 spirit on data-shape emissions

The brief calls out: "Rule 14 check — same applies to data-shape emissions, not just integration loops." So:

- **State 1 (`_calculateEnvelopeOnly`)**: no systems_flow needed — no systems exist. N/A.
- **State 2 (`_calculateState2`)**: doesn't emit systems_flow today; the legacy fallback paths emit it because they bypass State 2/3 entirely. Brief 74 P3 adds systems_flow to **State 3 only** because that's where the v40 systems live. **State 2 stays without systems_flow** (consistent with its scope — it's envelope + gains, no system layer to flow through). Document the divergence in the P3 commit message.
- **Inline-legacy `_calculateInstantBaseline`**: keeps its existing emit (L6959). Untouched by P3.
- **DD fallback `calculateInstantDegreeDay`**: keeps its existing emit (L6154). Untouched.

Net: P3 adds ONE emit site at the end of `_calculateState3`. No deletions. No modifications to the three existing paths.

### §2.9 Estimated diff size for P3

- **New helper function** `buildSystemsFlowV40(...)`: ~80–120 lines, mirrors `_calculateInstantBaseline:5998–6155` shape but reads from v40 arrays.
- **One-line wiring** at `_calculateState3` return point: `systems_flow: buildSystemsFlowV40(brief40Computed, …)`.
- **Auxiliary node** addition: an early-return-style block guarded by `auxiliary_elec_kwh > 0`.

No engine math changes. Pure read-from-existing-fields, build-shape-out.

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
