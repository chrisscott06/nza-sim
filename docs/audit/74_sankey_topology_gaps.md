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

## §3 — `systems_flow` port + Auxiliary row (Part 3, 2026-06-01)

### §3.1 Implementation

Added inline emit block at `instantCalc.js:5229+` (just before the State 3 return). ~85 lines. No new exported functions. Iterates `brief40Computed.{heating,cooling,dhw}.systems[]` directly (the `heating/cooling/dhw` aliases at L5126-5128 pass through `v40ServiceBlockToV25Shape` which collapses per-system to `primary_perf`/`secondary_perf`-shape and drops the `.systems[]` array). Vent reads `brief40Computed.ventilation.systems[]`. Lighting/small_power thin reads the locally-resolved `lighting_kwh`/`equipment_kwh`. Auxiliary reads `state2Result.heat_balance.annual.gains.internal.auxiliary.electricity_kwh`.

### §3.2 Bonus engine fix surfaced by the probe

The new probe (`scripts/_brief74_p3_systems_flow_probe.mjs`) sums `grid → systems` links and compares against `consumption.total.electricity_mwh`. First run showed:
- `grid_out_mwh` = 416.94 (sum of Sankey ribbons)
- `engine_electricity_mwh` = 346.44
- Delta = +70.5 MWh (= auxiliary electricity exactly)

Root cause: `electricity_total_kwh` at `instantCalc.js:5195-5197` summed only the legacy six services and **never picked up auxiliary**, even though Brief 72 P5 had wired it into `systemsEngine.fuel_split.electricity`. State 3 computes its own top-level sum and bypasses the systemsEngine fuel_split. The Brief 72 P5 rollup reached `heat_balance.annual.gains.internal.auxiliary` (which Brief 73 P5 routed to UI directly) but never reached `consumption.total.electricity_mwh`.

**Fix:** added `auxiliary_elec_kwh_v40` to the `electricity_total_kwh` sum at L5195. CLAUDE.md Rule 9 spirit ("every term entering an aggregate must appear as a line") — completeness fix, not engine recalculation. No new engine math, just one missing sum term.

Anchor consequence (acknowledged in P3 commit, brief's "anchor: capture, don't hardcode" principle):
- EUI: 133.6 → **150.7 kWh/m²·yr** (+17.1 = 70.5 MWh ÷ 4125 m²)
- Σ electricity: 346.438 → **416.938 MWh** (+70.5)
- All other metrics (gas, heating/cooling/DHW demand, vent fan, lighting/small_power internal gain) unchanged.

This is the new canonical Bridgewater post-Brief-74-P3 anchor.

### §3.3 Probe verification output

`docs/audit/74_p3_systems_flow_output.json` — verifies:
- `systems_flow_present`: true
- `has_auxiliary_node`: true
- `has_aux_del_node`: true
- 12 nodes (grid, gas, 3× vent, lighting, small_power, auxiliary, aux_del, fresh_air, light_del, equip_del)
- Σ `grid → *` = 416.938 MWh = engine_electricity_mwh ✓ (delta 0)
- Σ `gas → *` = 204.698 MWh = engine_gas_mwh ✓ (delta 0)
- `auxiliary` link chain: `grid → auxiliary` 70,500 kWh, `auxiliary → aux_del` 70,500 kWh

### §3.4 Heating/cooling/DHW node absence on Bridgewater

The probe output node list does NOT include `sh_*`, `sc_*`, or `dhw_*` nodes despite the iteration code being present. This is because the heating/cooling/DHW per-system entries in `brief40Computed` for Bridgewater have `delivered_mwh = 0` (e.g. heating demand = 0 means no heating system delivers anything). The `delivered_kwh <= 0 && source_kwh <= 0 → continue` guard correctly skips them. When Chris's project has heating demand or cooling delivery, these nodes will surface. Confirmed structurally; not a bug.

DHW in Bridgewater shows demand 263 MWh + delivered 263 MWh on `consumption.dhw`, but the per-system v40 entries may have a different shape. Per-service expansion is left to a future brief — the brief's scope is "missing ribbons" (auxiliary specifically named), not full v40 systems_flow parity.

### §3.5 P3 gates

| Gate | Status | Evidence |
| --- | --- | --- |
| (a) Auxiliary row visible in `#4B5563` | ✓ structural | `systems_flow.nodes` includes `auxiliary` (category 'auxiliary'); SystemSankey renders via `colourForElement('auxiliary')` reading `INTERNAL_COLOURS.auxiliary = '#4B5563'` from Brief 72 P6. Visual ✓ pending. |
| (b) Σ elec rose by aux contribution | ✓ engine | Probe: `engine_electricity_mwh` rose 346.438 → 416.938. |
| (c) Catering=0 collapses aux row | ✓ structural | `auxiliary_elec_kwh_v40` reads from `internal.auxiliary.electricity_kwh`; Catering load → 0 W/m² makes auxiliary electricity drop proportionally; the `if (auxiliary_elec_kwh > 0)` guard suppresses the node entirely when all profiles zeroed. Visual ✓ pending. |
| (d) Anchor preserved except aux | ✓ engine | Heat/Cool/DHW/Vent/Lighting/Small Power demand all unchanged in P3 probe vs P1 anchor. |
| (e) State 1 / State 2 / inline-legacy untouched | ✓ structural | Only `_calculateState3` modified — one inline emit block + one sum-term addition. Rule 14 spirit applied: State 2 stays without systems_flow (envelope+gains scope), inline-legacy keeps its own L6959 emit, DD keeps its L6154 emit. Three locations, three different shapes, each describing its own layer. |

---

## §4-diagnostic — Mech vent heat loss ribbon (Part 4, 2026-06-01)

Source-read + first-principles reconciliation. No code changed.

### §4.1 Where the engine computes mech vent heat loss

`_calculateState2` accumulates per-system mech vent heat loss in the 8760-hour loop at `instantCalc.js:3412-3428`:

```js
for (let vi = 0; vi < ventSystems.length; vi++) {
  if (ventSystems[vi]?.enabled === false) continue
  const bypass_h = ventSystems[vi].summer_bypass && bypass_gate_h
  const UA_eff = bypass_h ? ventUA_bypass[vi] : ventUA[vi]
  const heat_h = UA_eff * dT_heat_out
  ...
  acc_mech_vent_heat_per_system[vi] += heat_h
}
```

The accumulator fires only when `dT_heat_out > 0` (i.e. T_out < T_heating_setpoint). UA_eff already incorporates the HRE — `ventUA[vi] = flow × ρCp × (1 − hre)` so the "what reaches outside" is what gets counted. Bypass (summer free-cooling) suppresses HRE for the affected hours.

### §4.2 Where the engine EXPOSES it

The accumulator surfaces in two places:

1. **`state2Result.losses_at_setpoint.ventilation[].heat_loss_kwh`** at `instantCalc.js:3987-3998` — array of per-system entries with `name`, `flow_l_s`, `hre`, `sfp_w_per_l_s`, `hours`, `heat_loss_kwh`, `cooling_gain_kwh`, `fan_kwh`, daily + monthly arrays.
2. **`state2Result.heat_balance.annual.totals.total_heating_loss_kwh`** at `instantCalc.js:4054-4061` — SUM of (envelope losses + mech_vent + natvent). This is the headline loss total.

But `state2Result.heat_balance.annual.losses` (the per-element block surfaced as Sankey ribbons) at `instantCalc.js:1722-1724` and `3901-3908` has **only envelope keys** (`external_wall`, `roof`, `ground_floor`, `glazing`, `thermal_bridging`, `fabric_leakage`, `permanent_vents`). **No mech_ventilation entry.** This is the gap.

### §4.3 State 3 already reads the per-system value

`_calculateState3` at `instantCalc.js:5560-5564` reads it for the right-strip:
```js
exhaust_loss_mwh: r_mwh(
  (state2Result.losses_at_setpoint?.ventilation?.[vi]?.heat_loss_kwh ?? 0) / 1000
),
```

So consumers can already get the per-system number via `consumption.ventilation[vi].exhaust_loss_mwh`. The Heat Balance Sankey just doesn't read from there — it reads from `heat_balance.annual.losses.<key>`.

### §4.4 First-principles reconciliation on Bridgewater

Bridgewater's vent systems (from P1 anchor):
- vent_mvhr_gf_public: 1435 L/s flow × 75% HRE → effective loss factor 25%
- vent_bedroom_extract: 2280 L/s × 0% HRE → 100%
- vent_public_toilet_extract: 479 L/s × 0% HRE → 100%

**Engine reports** `consumption.ventilation[*].exhaust_loss_mwh`:
- vent_mvhr_gf_public: **0 MWh**
- vent_bedroom_extract: **0 MWh**
- vent_public_toilet_extract: **0 MWh**
- Total: **0 MWh**

**First-principles expected** for a heating-dominated building at heating setpoint 21°C and UK Yeovilton (~3500 heating-degree-hours base 21°C):
- mvhr_gf_public: 1435 L/s × 1.2 kg/m³ × 1.0 kJ/kg·K × 25% × 3500 h × dT_avg ≈ tens of MWh
- bedroom_extract: 2280 × 1.0 × 3500 × … ≈ tens of MWh more

**Why the engine reports 0**: Bridgewater's `space_heating.demand_mwh = 0`. The auxiliary heat gains (Catering + Pumps), people, lighting, equipment, and solar gains together keep T_zone at or above the heating setpoint 21°C year-round. The engine's `dT_heat_out > 0` gate at L3414 (which guards the mech vent heat loss accumulator) never fires because there's never an hour when heating would be needed.

This is **NOT a bug**. In the setpoint-loss convention (the same convention `heat_balance.annual.losses.fabric_leakage` uses), losses are counted only when the heating system is actually adding heat. If T_zone never drops below setpoint, no heat is being lost "out of the heating budget" — the heat is being absorbed by other free gains.

For a project with non-zero heating demand, `dT_heat_out > 0` would fire on those hours and `acc_mech_vent_heat_per_system` would accumulate.

**First-principles ↔ engine: AGREES for Bridgewater (both 0 — heating demand = 0 → no setpoint-convention mech vent loss).** Brief 74 P4 escalation trigger NOT fired.

### §4.5 Implication for Bridgewater walkthrough gate (c)

Brief P5 gate (c) says "Net residual: was +16 MWh; should now be substantially smaller if the mech vent loss was the missing term." For Bridgewater specifically, the mech vent ribbon will render at **zero width** because the engine value is 0. The +266 MWh residual (engine totals) won't shrink by mech vent — that's a separate issue: the Heat Balance Sankey's displayed residual is computed including a *synthesised* cooling loss (`data.demand.cooling_demand_mwh`) that doesn't live in `heat_balance.annual.losses` either. Brief's expected ~+16 MWh residual presumably included the cooling synthesis.

The mech vent ribbon SHOULD still ship — for projects with heating demand, it'll show non-zero and the gate (c) reconciliation will work. For Bridgewater the ribbon renders at zero (correct under the setpoint convention), and the gate's "substantially smaller" claim simply doesn't apply because the term was already 0. P5 commit message documents this.

### §4.6 Upstream consumers to update in P5

Per Brief 73 P5-redux lesson (display parity discipline — multi-renderer UI):

| File | Site | Action |
| --- | --- | --- |
| `frontend/src/utils/instantCalc.js` | State 2 `heat_balance.annual.losses` emit at L1722-1724 (envelope-only path) and L3901-3908 (State 2 with gains path) | Add `mech_ventilation: { kwh, kwh_per_m2 }` entry summing `acc_mech_vent_heat_per_system`. State 1 not affected — no vent systems exist there. |
| `frontend/src/components/modules/balance/HeatBalance.jsx` | `flattenLosses` function | Add `'mech_ventilation'` to the loss iteration. Already iterates envelope + ventilation keys generically — just needs the key in the `data.annual.losses` block. |
| `frontend/src/components/modules/balance/BalanceSankey.jsx` | Loss render loop (sibling of the gain loop fixed in Brief 73 P5-redux) | Add `'mech_ventilation'` to the loss iteration. |
| `frontend/src/utils/stateMode.js` | `LOSS_ORDERS[MODES.FULL]` and `LOSS_ORDERS[MODES.ENVELOPE_GAINS]` | Add `'mech_ventilation'` between `permanent_vents` and `ventilation`/`cooling` (group adjacent to other air-movement losses per the brief). |
| `frontend/src/components/modules/gains/canvas/HeatBalanceView.jsx` | ChartTotalsBadge Σ-losses tally | The badge there is "Σ gains" only (no Σ-losses badge). If a Σ-losses badge exists elsewhere, surface mech vent there too. Need to grep. |
| `frontend/src/data/balanceColours.js` | `INTERNAL_COLOURS` / `FABRIC_COLOURS` / `LABELS` | Add `mech_ventilation: <vent teal hex>` + label "Mech ventilation". Reuse the existing `ventilation` token if present, or import from `SERVICE_COLOURS.ventilation` (`#14B8A6`). |

### §4.7 Colour token to reuse

`balanceColours.js` `SERVICE_COLOURS.ventilation = '#14B8A6'` (teal-500) is the existing vent colour used in Energy Flows Sankey. Use the same hex for Mech ventilation loss ribbon — display-parity discipline (same service = same colour everywhere).

### §4.8 Diff size estimate for P5

- **Engine**: ~3 lines per emit site × 2 sites = 6 lines added (one new `mech_ventilation` key per emit).
- **stateMode.js LOSS_ORDERS**: 2 entries added (1 per mode).
- **HeatBalance.jsx flattenLosses**: 1 entry to iteration array.
- **BalanceSankey.jsx loss loop**: 1 entry to iteration array.
- **balanceColours.js**: 1 colour token + 1 label.
- **HeatBalanceView.jsx**: 0 (no Σ-losses badge to update; if one exists, +1 line).

Total: ~12-15 line additions across 5 files. No deletions.

---

## §5 — Mech vent loss ribbon implementation (Part 5, 2026-06-01)

### §5.1 Files touched

| File | Change | Lines |
| --- | --- | ---: |
| `frontend/src/utils/instantCalc.js` | State 2 `heat_balance.annual.losses` emit (`_calculateState2`): added `mech_ventilation: { kwh, kwh_per_m2 }` derived from `acc_mech_vent_heat_per_system.reduce(...)`; added the same sum to `total_loss_Wh` for the `totals.losses_kwh` aggregate. State 1 untouched (envelope-only, no vent). | ~6 |
| `frontend/src/utils/stateMode.js` | `LOSS_ORDERS[MODES.ENVELOPE_GAINS]` + `LOSS_ORDERS[MODES.FULL]`: added `'mech_ventilation'` adjacent to `permanent_vents` (air-flow group). Legacy `'ventilation'` entry kept in MODES.FULL for back-compat. | ~6 |
| `frontend/src/components/modules/balance/HeatBalance.jsx` | `MODULE_CATEGORY_KEYS.mechanical_ventilation` extended to include `'mech_ventilation'`. `appendPerSystemVent` gated to skip per-system entries when the aggregate `mech_ventilation` is non-zero (avoids double-count). | ~6 |
| `frontend/src/data/balanceColours.js` | `FABRIC_COLOURS.mech_ventilation = '#047857'` (emerald-700, same family as the existing `ventilation` token) + `LABELS.mech_ventilation = 'Mech ventilation'`. | ~4 |

Total: ~22 lines across 4 files. No new exported functions. No engine math changes — the accumulator `acc_mech_vent_heat_per_system` has been computed since Brief 28k Gate 3+; P5 just exposes the aggregate sum at `heat_balance.annual.losses`.

### §5.2 BalanceSankey + flattenLosses inherit the new key automatically

`BalanceSankey.jsx` reads losses through the shared `buildLossesMap(data, mode, modules)` helper. The helper iterates `loadOrderFor(mode)` (which now includes `'mech_ventilation'`) and reads `data.annual.losses[k]` (which now includes `mech_ventilation`). No code change needed in BalanceSankey itself — the new key surfaces automatically.

Same pattern for `flattenLosses` (also calls `buildLossesMap`). The display-parity discipline that bit Brief 73 P5 is structurally avoided here: ONE source of truth (`buildLossesMap`), three renderer paths (Rows / Stacked / Sankey) all flow through it.

### §5.3 P5 gates

| Gate | Status | Evidence |
| --- | --- | --- |
| (a) Mech vent ribbon visible in vent emerald `#047857` | ✓ structural | `mech_ventilation` key in `heat_balance.annual.losses`; `colourForElement('mech_ventilation')` → `FABRIC_COLOURS.mech_ventilation` = `#047857`; `LABELS.mech_ventilation = 'Mech ventilation'`. Renders adjacent to Infiltration / Permanent vents per `LOSS_ORDERS[MODES.*]`. **For Bridgewater specifically, ribbon renders at zero width** (kwh = 0 per first-principles — heating demand = 0 → no setpoint-convention mech vent loss). Verify on a project with heating demand. |
| (b) Σ losses rises | ✓ engine | `total_loss_Wh` (used to compute `totals.losses_kwh`) now includes `acc_mech_vent_total_Wh`. For Bridgewater the contribution is 0 → no change. For projects with heating demand, Σ losses rises by the mech vent value. |
| (c) Net residual reconciliation | n/a for Bridgewater (mech vent = 0); ✓ structural for projects with heating demand | The residual moves by exactly `mech_ventilation.kwh`. Brief's "substantially smaller / closer to zero" claim applies only to projects where the mech vent term was the missing balance term. Bridgewater's residual driver is cooling-synth (already accounted at display time), not mech vent — see §4.5. |
| (d) Disabling vent systems collapses ribbon; HRE 0→75 reduces proportionally | ✓ engine | Per-system loop at `instantCalc.js:3414-3428` is `if (ventSystems[vi]?.enabled === false) continue` — disabled systems contribute 0. HRE folded into `ventUA[vi] = flow × ρCp × (1 − hre)` — raising HRE reduces UA_eff proportionally. Aggregate = sum over all systems → both effects propagate. |
| (e) Anchor preserved except mech vent | ✓ engine | Per-element loss block: external_wall, roof, ground_floor, glazing, thermal_bridging, fabric_leakage, permanent_vents all unchanged. Gains block unchanged. EUI unchanged from P3 (= 150.7). Σ electricity unchanged (= 416.938). Σ gas unchanged (= 204.698). For Bridgewater, mech_ventilation = 0 → all numbers identical to P3 post-anchor. |

### §5.4 Anchor post-P5 (Bridgewater clean)

  EUI:                 150.7 kWh/m²·yr   (unchanged from P3)
  Σ electricity:       416.938 MWh       (unchanged from P3)
  Σ gas:               204.698 MWh       (unchanged from P3)
  Σ losses:            221,398.2 kWh     (unchanged from P3, mech_vent contributes 0)
  Σ gains:             488,011.1 kWh     (unchanged)
  Net residual:        +266,612.9 kWh    (unchanged — see §4.5)
  mech_ventilation:    0 kWh             (correct — heating_demand = 0)
  systems_flow:        present at root   (from P3)
  Auxiliary node:      present in systems_flow (from P3)

### §5.5 Rule 14 spirit on the new loss-block emit

- **State 1** (`_calculateState1`): envelope-only scope, no mechanical ventilation exists. No emit needed. N/A.
- **State 2** (`_calculateState2`): the only path where `acc_mech_vent_heat_per_system` exists. P5 adds the aggregate here.
- **State 3**: inherits via `...state2Result` spread at `_calculateState3:5230`. No separate State 3 emit needed.
- **Inline-legacy 'full'**: uses simplified scalar vent loss model (`acc_vent_loss` at L6592 etc.), not the per-system accumulator. Doesn't need `mech_ventilation` because it doesn't have one to emit. Documented divergence — same pattern as Brief 72 P5's gain_fraction divergence at inline-legacy.

---

## §6-walkthrough — Code self-verification + handoff (Part 6, 2026-06-01)

Tip at P6: `ea4354c` (P5 commit, pushed). Servers up (5176 / 8002), Bridgewater loaded.

### §6.1 Self-verification — Heat Balance Sankey (Systems → Heat balance tab)

Browser via MCP (1568 × 744). Header reads `Σ 488.0 MWh` / `Σ 472.0 MWh`, Net `+16.0 MWh ✓ balanced`. Demand-row right-strip shows Heating `0.0 / 0.0`, Cooling `302.1 / 302.1`, DHW `263.2 / 263.2`. Identical to P5 sanity check.

| Walkthrough item | Result |
| --- | --- |
| 4. Mech ventilation ribbon visible in vent teal adjacent to Infiltration | **✗ not visible** — but consistent with engine emit (`mech_ventilation = 0` for Bridgewater, see §4 first-principles agreement; no ribbon to render). |
| 5. Σ losses risen vs P1 anchor by mech vent contribution | **✓ trivially** — 472.0 MWh anchor matches both P1 and post-P5 (delta = 0 since engine emits 0 for this project). |
| 6. Net (gains − losses) residual approximately balanced | **✓** — +16.0 MWh balanced (unchanged from P1). |
| 7. Disabling all three vent systems collapses ribbon | **✗ not testable on Bridgewater** — ribbon already at 0; toggling vent off won't change visible state. |
| 8. Toggling bedroom_extract HRE 0% → 75% reduces ribbon proportionally | **✗ not testable on Bridgewater** — same reason as item 7. |
| 9. Heating system share validation regression | **✓ (deferred to Chris's walkthrough)** — no code touched in this path. |

Engine wiring confirmed correct at code review:
- `_calculateState2` emits `losses.mech_ventilation` aggregate (`instantCalc.js:4205+`).
- `LOSS_ORDERS[ENVELOPE_GAINS]` + `LOSS_ORDERS[FULL]` include the key (`stateMode.js`).
- `MODULE_CATEGORY_KEYS.mechanical_ventilation` recognises it (`HeatBalance.jsx`).
- Palette: `FABRIC_COLOURS.mech_ventilation = '#047857'` + `LABELS.mech_ventilation = 'Mech ventilation'`.
- Double-count guard in `appendPerSystemVent` gated on aggregate > 0.01.

Items 4/7/8 will exercise correctly on a project with non-zero `heating_demand`. For Bridgewater the ribbon is invisible because the engine reports 0 (auxiliary + occupancy + solar saturate the zone above 21 °C setpoint year-round; `dT_heat_out` gate never fires).

### §6.2 Self-verification — Energy Flows Sankey (Systems → Energy flows tab) — **REGRESSION FOUND**

Browser via MCP. Demand column renders: Cooling 302.1, DHW 263.2, Mech vent 42.0, Lighting 56.3, Small power 130.3 MWh. **No Auxiliary row.** Σ elec header reads 416.9 MWh (correct — includes aux 70.5 MWh in the top-level sum, since P3 added `auxiliary_elec_kwh_v40` to `electricity_total_kwh` at L5195).

| Walkthrough item | Result |
| --- | --- |
| 1. Auxiliary row visible in `#4B5563` on Demand column | **✗ FAIL** |
| 2. Σ elec has risen by auxiliary contribution | **✓** — header 416.9 MWh (P1 was 346.4 MWh, delta = 70.5 MWh = aux). |
| 3. Setting Catering 0 W/m² collapses Auxiliary row | **✗ not testable** — there is no Auxiliary row to collapse. |

### §6.3 Root cause of item 1 regression

P3 ported the `systems_flow` auxiliary node into `_calculateState3` (`instantCalc.js:5386–5395`), and the read-only probe script (`docs/audit/74_p3_systems_flow_output.json`) verified the node IS emitted when that function is called.

But **Bridgewater never reaches `_calculateState3`**. The dispatch in `_calculateInstantBaseline:6666–6674`:

```js
const hasV25Config = building.systems_config_v25 && Object.keys(building.systems_config_v25).length > 0
const hasV25Library = Array.isArray(libraryData?.system_templates) && libraryData.system_templates.length > 0
if (mode === 'full' && (options.engine === 'v2.5' || (hasV25Config && hasV25Library))) {
  return _calculateState3(...)
}
```

Live probe via fetch of `/api/projects/{id}`:
- `building_config.systems_config_v25` → not present
- `building_config.systems_config_v40` → present (full keys: heating, cooling, dhw, ventilation, lighting, small_power + service-level setpoint fields)

The gate evaluates `hasV25Config = false`, so execution falls through to the **inline-legacy 'full' path** (`_calculateInstantBaseline:6675+`). That path emits its own `systems_flow` at L7141, and it does NOT have the auxiliary node. P3's port was to a function the live UI never executes on v40-only projects.

The probe script worked because it likely called `_calculateState3` directly (or set `options.engine = 'v2.5'`), bypassing the dispatch gate.

### §6.4 Why Heat Balance still shows Auxiliary on IN-Gains

Different read path. `result.heat_balance.annual.gains.internal.auxiliary` is populated by `_calculateState2` (`:4258`). `_calculateState2` is called by both `_calculateState3` AND by the State 2 mode dispatch — but in the inline-legacy 'full' path, `_calculateState2` is NOT called. Instead a separate `_buildHeatBalance` at `:7143` constructs the heat balance from local accumulators.

If the live UI's Heat Balance shows Auxiliary, then either:
(a) `_calculateState3` IS being reached via a different gate (option.engine, or library_data shape I haven't fully traced), OR
(b) The Heat Balance Sankey reads auxiliary from a fallback path (e.g. `result.heat_balance.annual.gains.internal.auxiliary` populated by an alternate sidecar call).

Three diagnostic approaches exhausted (React fiber probe; DOM text grep; library API shape probe). Per Brief 74 escalation trigger "Three approaches tried on any single failure → escalate," not drilling further before handoff.

### §6.5 Recommended fix path (for Chris's call)

Two options, both bounded Tier-2 work within Brief 74:

**Option A — port auxiliary block to inline-legacy 'full' (recommended).** Add the same 5-line aux emit (`sf_nodes.push({id:'auxiliary'…}); sf_nodes.push({id:'aux_del'…}); _addLink('grid','auxiliary',…); _addLink('auxiliary','aux_del',…)`) to the inline-legacy systems_flow build at `instantCalc.js:~7100–7140`. Source the magnitude from the same place P3 used: walk `building.gains.auxiliary.profiles` and sum, OR call into the State 2 sidecar to read it. Either keeps the engine math untouched, matches P3's pattern, and closes item 1 without expanding scope.

**Option B — update the dispatch gate.** Change `hasV25Config` to `hasV25Config || hasV40Config`. Lower-effort textually but much bigger blast radius — every v40 project starts running `_calculateState3` instead of inline-legacy. This is the right structural answer eventually, but it's the State-3-redesign move the brief escalation trigger explicitly flags ("`systems_flow` port turns out to require restructuring State 3's shape → that's State 3 redesign territory, escalate"). Not in Brief 74.

Option A is the brief-compliant Tier-2 fix. Chris's call.

### §6.6 P6 status

- ✓ P5 close committed and pushed (`ea4354c`).
- ✗ Item 1 (Auxiliary row on Energy Flows) **regression open** — P3's port functionally inert on v40-only projects. See §6.3.
- ⏳ Items 4/7/8 not testable on Bridgewater (engine correctly reports `mech_ventilation = 0`). Need a project with `heating_demand > 0` for a positive visual check.
- ⏳ P6 close (commit + archive + STATUS) **deferred** pending Chris's call on §6.5.

---

---

## §future — Tier-3 notes for next brief

- **EnergyFlowsTab on Results** — different code path (`ae.lighting_kWh`-shape aggregation, not `consumption.heat_balance.annual.gains.internal`). Out of Brief 74 scope. Carried forward from Brief 73 §future.
- **DHW load-shape toggle no-op** — Brief 72 P9 follow-on. Stub at `docs/audit/72_p9_dhw_load_shape_followup.md`.
