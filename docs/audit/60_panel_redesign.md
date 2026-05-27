# Brief 60 Part A1 — Breakdown-panel redesign audit (read-only)

**Status:** read-only; data availability confirmed for every row in the new design; no engine change required.
**Anchor:** Bridgewater clean 110.30 EUI. Must not move under Part A (UI-only). Engine git diff target: **0 lines**.
**Mode:** read-only. Verification DB backup at `data/nza_sim_cc.db.brief60_pre_A1.20260527_093636.bak`.

---

## §1 What the new design needs

Per Brief 60 §Part A — Design (locked with Chris):

**3 summary cards (top):** Heat demand Δ, Cooling Δ, Electricity Δ — colour-coded.

**Band 1 — DEMAND** (baseline / after / Δ): Heat needed, Cooling needed, Hot water needed.

**Band 2 — DELIVERED ÷ EFFICIENCY = FUEL** (per service, inline arithmetic): Heating, Cooling, Hot water, Ventilation/fans, Lighting, Small power, Auxiliary (Part B).

**Band 3 — FUEL TOTALS** (by carrier): Total electricity, Total gas.

**Headline:** EUI, Carbon.

**Rows CUT/DEMOTED:**
- ❌ "After heat recovery" (duplicate of "Heat needed" post the Brief 50 fix — `heating_demand_mwh` is already post-MVHR via the `(1-HRE)` factor on vent UA inside `_calculateState2`).
- ⤓ "Heat recovered by MVHR" — demoted out of the default headline view. Optional informational line clearly labelled "airstream recovery (informational)".

**Rows ADDED:**
- ✓ Ventilation/fans row in Band 2 with `SFP × flow = fan_kwh` arithmetic — currently absent from BreakdownPanel.
- ✓ Lighting row in Band 2 — gain == electricity (1:1, Brief 58 Part C coupling).
- ✓ Small power row in Band 2 — gain == electricity (1:1).
- ✓ Auxiliary row in Band 2 — placeholder until Brief 60 Part B lands the data model.

---

## §2 Existing panel row → engine field map (BreakdownPanel.jsx today)

| Existing row | Engine deltaPath | Engine source | Action for redesign |
|---|---|---|---|
| Heat the building needs | `heating_raw_demand_mwh` | `consumption.space_heating.demand_mwh` (already post-MVHR per Brief 50 P4) | **KEEP** as Band 1 "Heat needed" — relabel for clarity |
| Heat recovered by MVHR | `heating_recovery_offset_mwh` | informational integral — NOT subtracted | **DEMOTE** to optional informational line |
| After heat recovery | `heating_post_mvhr_demand_mwh` | equals `heating_raw_demand_mwh` by construction | **CUT** (duplicate) |
| Cooling demand | `cooling_demand_mwh` | `consumption.space_cooling.demand_mwh` | **KEEP** as Band 1 "Cooling needed" |
| Hot water demand | `per_service.dhw.demand_mwh` | `consumption.dhw.demand_mwh` (tap-mix corrected; Brief 58 B3 headcount basis) | **KEEP** as Band 1 "Hot water needed" |
| Heating delivered | `per_service.heating.delivered_mwh` | `consumption.space_heating.delivered_mwh` | **KEEP** as Band 2 numerator |
| Heating efficiency | `per_service.heating.efficiency` | blended SCOP/η across enabled heating systems | **KEEP** as Band 2 divisor (full-strength) |
| Cooling delivered | `per_service.cooling.delivered_mwh` | `consumption.space_cooling.delivered_mwh` | **KEEP** as Band 2 numerator |
| Cooling efficiency | `per_service.cooling.efficiency` | blended SEER/EER across enabled cooling systems | **KEEP** as Band 2 divisor |
| Hot water delivered | `per_service.dhw.delivered_mwh` | `consumption.dhw.delivered_mwh` | **KEEP** as Band 2 numerator (need to add DHW efficiency divisor) |
| Total electricity | `per_fuel.electricity_mwh` | `consumption.total.electricity_mwh` | **KEEP** as Band 3 |
| Total gas | `per_fuel.gas_mwh` | `consumption.total.gas_mwh` | **KEEP** as Band 3 |
| Heating electricity / gas | `per_service.heating.{electricity,gas}_mwh` | per-service fuel splits | **KEEP** as Band 2 fuel result (the `=` side) |
| DHW electricity / gas | `per_service.dhw.{electricity,gas}_mwh` | per-service fuel splits | **KEEP** as Band 2 fuel result |
| Cooling electricity | `per_service.cooling.electricity_mwh` | per-service fuel split | **KEEP** as Band 2 fuel result |
| EUI | `eui_kwh_per_m2` | `consumption.total.eui_kwh_per_m2` | **KEEP** as Headline |
| Operational carbon | `carbon_kgco2_per_m2` | `consumption.total.carbon_kgco2_per_m2` | **KEEP** as Headline |

---

## §3 New rows — data availability check (the Brief 60 Part A "add fan energy" + Part C coupling rows)

### §3.1 Ventilation / fans (Band 2 — currently missing)

**Required arithmetic:** `SFP × flow × hours / 1000 = fan_kwh` per system, summed.

**Engine source:** `consumption.brief40.ventilation`

```js
brief40.ventilation = {
  systems: [
    { id, label, sfp_w_per_lps, flow_rate, flow_rate_basis,
      fan_electrical_mwh, recovery_sensible_pct, ... },
    ...
  ],
  total_fan_electrical_mwh,
  ...
}
```

**Confirmed availability** (Brief 59 trace harness `docs/audit/trace_example.md` baseline shows for Bridgewater):

| system | SFP (W/(l·s⁻¹)) | flow (l/s) | hours | fan_kwh |
|---|---|---|---|---|
| mvhr_gf_public | 1.4 | 1425 | 8760 | 17,476 |
| bedroom_extract | 0.4 | 2208 | 8760 | 7,737 |
| public_toilet_extract | 0.4 | 210 | 8760 | 736 |
| **total_fan_electrical_mwh** | — | — | — | **25.95 MWh** |

For the intervention-delta context the panel renders, the equivalent live deltas are computable from `brief40.ventilation.systems[*].fan_electrical_mwh` per system (or the rolled-up total). For Part A the existing `consumption.total.electricity_mwh` already INCLUDES fan electricity, so the panel can render the row by summing `brief40.ventilation.systems[*].fan_electrical_mwh` directly — no engine change, just read what's already there.

**Inline arithmetic for the row:**
- Per-system row: `SFP × flow × 8760 / 1000 = fan_kwh` (multiplicative form, no "efficiency" divisor — fans are 100% electrical).
- Aggregate row: `Σ(per-system fan_kwh) = total fan electricity`.

Render option: aggregate row with the arithmetic shown for the largest contributor + a "view systems" expander for the per-system breakdown. (UI decision; A2 implementation.)

### §3.2 Lighting (Band 2 — currently missing)

**Required arithmetic:** `gain (post v40 modulation) = electricity` (1:1 since Brief 58 Part C coupled them).

**Engine source:** `consumption.brief40.lighting`

```js
brief40.lighting = {
  systems: [
    { id, label, share_pct, control_factor, control_mechanism,
      gain_from_internal_gains_mwh,
      delivered_electrical_mwh },
    ...
  ],
  total_delivered_electrical_mwh
}
```

Plus `heat_balance.annual.gains.internal.lighting.kwh` is the same gain (post-Brief-58-C scalar).

**Confirmed availability** (Bridgewater current baseline post Brief 58 Part C):
- `brief40.lighting.systems[0].control_factor` = 0.86
- `brief40.lighting.total_delivered_electrical_mwh` = 65.821
- `heat_balance.annual.gains.internal.lighting.kwh` = 65,822 (Brief 58 C couples — same number)

**Inline arithmetic for the row:**

```
gain (post v40 modulation) = electricity (1:1)
e.g. 65.8 MWh (gain @ cf=0.86) = 65.8 MWh (electricity)
```

For the per-system breakdown (if a project has multiple lighting systems with different control_factors), the row can show: `Σ delivered_electrical per system = total electricity`.

### §3.3 Small power (Band 2 — currently missing)

Identical pattern to lighting (Brief 58 C couples small_power gain ↔ electricity too via `effectiveSystemScalar(systems_config_v40.small_power)`).

**Engine source:** `consumption.brief40.small_power.total_delivered_electrical_mwh` + `heat_balance.annual.gains.internal.equipment.kwh`.

**Confirmed availability** (Bridgewater): 78.864 MWh on both (1:1).

### §3.4 Auxiliary (Band 2 — placeholder until Brief 60 Part B)

Will be populated by Part B's auxiliary-energy loads (external lighting, catering, pumps, other small power), each with `consumption + gain_fraction`. Until then: row shown as "no auxiliary loads configured" with em-dash placeholders.

### §3.5 DHW row — add the efficiency divisor

Existing panel has `dhw.delivered_mwh` but no `dhw.efficiency` row. The engine surfaces `brief40.dhw.blended_efficiency` — Bridgewater: blended efficiency across 65% gas @ 0.9 + 35% HP @ 2.5 = **harmonic mean ≈ 1.13** (`1 / (0.65/0.9 + 0.35/2.5)`).

**Inline arithmetic for the DHW row:**

```
delivered ÷ blended_efficiency = fuel
e.g. 204.4 MWh ÷ 1.13 = 180.9 MWh (split: 148.1 gas + 28.7 electricity per fuel mix)
```

The fuel split itself comes from `per_service.dhw.{electricity,gas}_mwh`. Confirmed in current engine output.

---

## §4 3 Summary cards — data availability

| Card | Δ source | Sign convention |
|---|---|---|
| Heat demand Δ | `marginal_delta.heating_post_mvhr_demand_mwh.delta` | negative = green (saving) |
| Cooling Δ | `marginal_delta.cooling_demand_mwh.delta` | negative = green |
| Electricity Δ | `marginal_delta.per_fuel.electricity_mwh.delta` | negative = green |

All three already exist in the engine's delta shape (used by the existing Level 1 headline at BreakdownPanel.jsx L224-230). No change needed.

---

## §5 Self-verifying arithmetic identity (Band 2 — the headline gate)

**Identity must hold on screen per service:**

```
delivered ÷ efficiency = fuel
```

Per service:
- Heating: `delivered_mwh ÷ heating.efficiency = (heating.electricity_mwh + heating.gas_mwh + heating.oil_mwh + …)`
- Cooling: `delivered_mwh ÷ cooling.efficiency = cooling.electricity_mwh` (cooling is electricity-only on Bridgewater; future projects may use other carriers)
- DHW: `delivered_mwh ÷ blended_efficiency = (dhw.electricity_mwh + dhw.gas_mwh + …)`
- Ventilation: no efficiency divisor — multiplicative form `SFP × flow = fan_kwh`
- Lighting / Small power: gain == electricity (Brief 58 C); shown as identity with the v40 control_factor visible

**Reconciliation check post-A2 implementation:** for each system row, the displayed `delivered`, `efficiency`, and `fuel` numbers MUST satisfy the equation to displayed precision. If they don't, a boundary is wrong — the panel surfaces it visibly (the brief's "boundary mismatches become visible on screen" principle).

The current engine output ALREADY guarantees this identity by construction (the per-service fuel_mwh fields are computed as `delivered / efficiency × share_per_carrier` inside `_computeHeatingOrCooling` / `_computeDhw` in `systemsEngine.js`). So Part A's job is purely to RENDER the identity — no engine math change needed.

---

## §6 Footnote / narrative line — data availability

Plain-English story footnote per Brief §Part A: e.g. *"Heat demand fell X, cooling rose Y — MVHR retains heat the building wants to dump; SCOP unchanged so heating fuel tracks the demand drop."*

The footnote is composed at render-time from the same Δ records already in scope. No additional engine data needed. A2 / A3 implementation will pick the dominant Δ direction and render a 1-2 sentence template:

```
"<heating_direction>, <cooling_direction>: <MVHR / SCOP / control narrative>."
```

UI decision deferred to A3.

---

## §7 Per-row plan for A2

| Band | Row | Engine source | Arithmetic to display | New vs existing |
|---|---|---|---|---|
| Summary cards | Heat Δ / Cooling Δ / Elec Δ | `marginal_delta.{heating_post_mvhr_demand_mwh, cooling_demand_mwh, per_fuel.electricity_mwh}.delta` | `Δ value, colour-coded` | New cards, existing data |
| Band 1 | Heat needed | `heating_raw_demand_mwh` | baseline / after / Δ | existing |
| Band 1 | Cooling needed | `cooling_demand_mwh` | baseline / after / Δ | existing |
| Band 1 | Hot water needed | `per_service.dhw.demand_mwh` | baseline / after / Δ | existing |
| Band 2 | Heating | `per_service.heating.{delivered_mwh, efficiency, electricity_mwh, gas_mwh}` | `D ÷ η = F` | new format, existing data |
| Band 2 | Cooling | `per_service.cooling.{delivered_mwh, efficiency, electricity_mwh}` | `D ÷ η = F` | new format, existing data |
| Band 2 | Hot water | `per_service.dhw.{delivered_mwh, blended_efficiency, electricity_mwh, gas_mwh}` | `D ÷ η = F` | new (efficiency divisor surfaced) |
| Band 2 | Ventilation / fans | `brief40.ventilation.systems[*].{sfp_w_per_lps, flow_rate, fan_electrical_mwh}` | `SFP × flow / 1000 = fan_kwh` | **NEW row** |
| Band 2 | Lighting | `brief40.lighting.{systems[*].{control_factor, delivered_electrical_mwh}, total_delivered_electrical_mwh}` + `gains.internal.lighting.kwh` | `gain (post cf modulation) = electricity` | **NEW row** |
| Band 2 | Small power | `brief40.small_power.{systems[*].{control_factor, delivered_electrical_mwh}, total_delivered_electrical_mwh}` + `gains.internal.equipment.kwh` | `gain = electricity` | **NEW row** |
| Band 2 | Auxiliary | placeholder (Part B) | em-dash | **NEW row, no data yet** |
| Band 3 | Total electricity | `per_fuel.electricity_mwh` | baseline / after / Δ | existing |
| Band 3 | Total gas | `per_fuel.gas_mwh` | baseline / after / Δ | existing |
| Headline | EUI | `eui_kwh_per_m2` | baseline / after / Δ | existing |
| Headline | Carbon | `carbon_kgco2_per_m2` | baseline / after / Δ | existing |
| Footnote | narrative | composed from Δ records above | plain-English template | new |

**All data already in engine output. Engine git diff for A2 = 0 lines.** Confirmed by trace harness (`docs/audit/trace_example.md`).

---

## §8 Gates for Part A

| Gate | Where checked |
|---|---|
| **A-G1** Engine git diff = 0 lines for A2 + A3 | `git diff frontend/src/utils frontend/src/components/modules/interventions/visualiser/unitFmt.js frontend/src/context` after each commit |
| **A-G2** Every Band 2 row's `delivered ÷ efficiency = fuel` reconciles to displayed precision (or appropriate identity for ventilation/lighting/small_power) | In-screen walkthrough item 4; arithmetic self-consistency |
| **A-G3** All systems present; unchanged dimmed with em-dashes (not hidden) | Walkthrough item 2 |
| **A-G4** Fan energy row present, equals SFP × flow | Walkthrough item 5 |
| **A-G5** "After heat recovery" duplicate GONE; "Heat recovered by MVHR" not headline | Walkthrough item 6 |
| **A-G6** Reducing a v40 vent flow visibly moves Band 1 heat demand AND Band 2 fan fuel live | Walkthrough item 7 (validates Brief 59 P1 fix is visible) |
| **A-G7** Summary cards update + colour correctly | Walkthrough item 8 |
| **A-G8** Footnote narrative tracks the numbers | Walkthrough item 9 |
| **A-G9** Bridgewater clean baseline still 110.30 EUI | Walkthrough item 10 + automated breakdown_dump regen |

---

## §9 Out of scope for Part A (and reasons)

- Auxiliary load row's DATA — Part B job.
- The chain-context (Level 3) features of the existing BreakdownPanel (predecessor / successor navigation) — separate concern; redesign focuses on the demand→delivered→fuel arithmetic table. Decision for A2: preserve the chain block under/alongside the three bands if it survives; the brief doesn't mandate keeping it, but it adds intervention-position context that the calc trail itself doesn't carry. **Default: keep the chain block AND the new three-band table; surface decision to Chris if the layout conflicts.**
- Sankey / Heat-balance tab redesigns — separate views, not in the breakdown panel scope.
- Per-system expander UI inside the ventilation / lighting / small_power rows — useful for projects with multiple systems; minimum viable scope for A2 is aggregate rows with the dominant arithmetic shown. Per-system expanders considered for A3 polish.

---

## §10 Next steps (after Chris signs off this audit)

A2 commit `Brief 60 A2: redesigned breakdown panel — three-band calculation trail`:
- Build the three bands + summary cards + headline as a new component (preserves the existing `BreakdownPanel.jsx` for the chain-context features; rename the redesigned table to `BreakdownTable.jsx` or similar).
- All rows from §7 above; all systems always present; unchanged dimmed.
- Cut "After heat recovery"; demote "Heat recovered by MVHR".
- Add fan energy / lighting / small_power / auxiliary placeholder rows.

A3 commit `Brief 60 A3: inline delivered÷efficiency=fuel arithmetic + narrative footnote`:
- Per Band 2 row: inline arithmetic with efficiency rendered full-strength + the rest muted.
- Composed narrative footnote.

Then HARD STOP at Part A boundary for Chris's in-screen walkthrough (10 items in brief §Part A).
