# Brief 48 §5 — Per-intervention breakdown data audit (read-only)

**Brief:** `docs/briefs/active/48_intervention_breakdown_viewer.md`
**Date:** 2026-05-25
**Author:** Claude Code
**Status:** READ-ONLY — no code changes. Establishes whether the engine already computes the quantities Brief 48's audit-trail panel needs, so the brief's premise ("surface, don't recompute") can be evaluated.

---

## Method

Walked the engine's intervention pass end-to-end:
1. `frontend/src/utils/interventionsEngine.js` — `runInterventionStack`, `computeDelta`, `_serviceDelta`, `_envelopeDelta`.
2. `frontend/src/utils/instantCalc.js` — `_calculateState2`, `_calculateState3` and specifically the consumption-block emission at line ~4338 onwards.

For each quantity Brief 48's UX section calls out, classified as:
- **AR — Already Retained**: directly on every intervention's `result` object and / or in `marginal_delta` / `cumulative_delta`.
- **CR — Computed and Retained derivably**: not a single named field, but trivially derivable (e.g. `raw − offset = post-MVHR`) from fields that ARE retained.
- **CD — Computed and Discarded**: live in a local variable inside the engine pass but not attached to the result.
- **NC — Not Computed at all**.

The escalation rule per the brief: NC for post-MVHR-per-intervention OR for the "vs state above me" framing → STOP and escalate.

---

## §1 — Framings (the two views the panel must offer)

Brief 48 wants every metric in two framings: vs the unedited project baseline AND vs the cumulative state above this intervention in the stack.

| Framing | Where it lives | Status |
|---|---|---|
| **Vs project baseline** (cumulative) | `stackResult.interventions[i].cumulative_delta` — `computeDelta(rollingResults[0], rollingResults[myIdx])` in `runInterventionStack` (interventionsEngine.js:395) | **AR** |
| **Vs state above me** (marginal) | `stackResult.interventions[i].marginal_delta` — `computeDelta(rollingResults[prevIdx], rollingResults[myIdx])` (interventionsEngine.js:394) | **AR** |

Both framings are first-class, computed by `runInterventionStack` for every intervention on every engine pass. **Escalation gate (framing): DOES NOT FIRE.**

Disabled-intervention semantics (audit §8.2 carry-over): `rowConfigIndex[i]` doesn't advance for disabled rows, so `marginal_delta` reads as zero against the previous enabled state. That's correct — the panel's "vs state above" view will read zero for disabled rows, which is right.

---

## §2 — Metrics catalogue

### §2.1 Headline (Brief 48 Level 1)

| Quantity | Where retained | Status |
|---|---|---|
| EUI (kWh/m²·yr) | `result.consumption.total.kwh_per_m2_yr` + delta records in `marginal_delta.eui_kwh_per_m2` / `cumulative_delta.eui_kwh_per_m2` | **AR** |
| Carbon (kgCO₂/m²·yr) | `result.carbon_kg_co2_per_m2` + `marginal_delta.carbon_kgco2_per_m2` | **AR** |
| Total delivered MWh | `result.consumption.total.electricity_mwh + .gas_mwh` (sum) + `marginal_delta.total_delivered_mwh` | **AR** |

### §2.2 Demand-side (the boundary discipline)

This is the heart of Brief 48 — the boundaries Brief 44 made discipline must be visible to the user. Each row of the panel's audit trail.

| Quantity | Plain-language label | Where retained | Status |
|---|---|---|---|
| **Raw heating demand** (pre-MVHR, State 2 zone demand) | "Heat the building needs" | `result.consumption.space_heating.demand_mwh` (instantCalc.js:4341 — emits `heating_demand_state2_mwh`, which IS the raw State 2 value pre-recovery) | **AR** |
| **MVHR recovery credit** | "Heat recovered by MVHR" | `result.consumption.space_heating.recovery_offset_mwh` (instantCalc.js:4350) | **AR** |
| **Post-MVHR heating demand** | "After heat recovery" | NOT a single named field on `result`, but trivially derivable: `space_heating.demand_mwh − space_heating.recovery_offset_mwh`. Engine internally calls this `heating_demand_mwh` (line 4131) and uses it for system sizing — see §3. | **CR** |
| **Delivered heating** | "Delivered by systems" | `result.consumption.space_heating.delivered_mwh` (instantCalc.js:4342) | **AR** |
| **Raw cooling demand** | "Cooling the building needs" | `result.consumption.space_cooling.demand_mwh` (instantCalc.js:4370 — `cooling_demand_mwh`, no recovery applied to cooling) | **AR** |
| **Post-recovery cooling demand** | n/a — same as raw (no cooling-side recovery in current engine) | Same field as raw | **AR** |
| **Delivered cooling** | "Delivered by systems" | `result.consumption.space_cooling.delivered_mwh` (instantCalc.js:4371) | **AR** |
| **DHW demand** (tap-mix corrected) | "Hot-water demand" | `result.consumption.dhw.demand_mwh` (instantCalc.js:4397) | **AR** |
| **Delivered DHW** | "Delivered by systems" | `result.consumption.dhw.delivered_mwh` (instantCalc.js:4398) | **AR** |
| **MVHR per-vent recovery** | "Per-system recovery" | `result.consumption.ventilation[i].hre_recovery_mwh` (instantCalc.js:4411) | **AR** |
| **Per-vent fan electricity** | "Fan electricity" | `result.consumption.ventilation[i].fan_electricity_mwh` (instantCalc.js:4410) | **AR** |
| **Exhaust loss per vent** | "Heat lost via exhaust" | `result.consumption.ventilation[i].exhaust_loss_mwh` (instantCalc.js:4416) | **AR** |

**Escalation gate (post-MVHR-per-intervention): DOES NOT FIRE.** The post-MVHR value is one subtraction away from two AR fields. Part 1's surfacing work will compute it once per intervention (in both framings) and attach it as a named field on `marginal_delta` / `cumulative_delta`, so the panel reads it directly instead of doing arithmetic in JSX.

### §2.3 Fuel-side

| Quantity | Where retained | Status |
|---|---|---|
| Total electricity (MWh) | `result.consumption.total.electricity_mwh` + `marginal_delta.per_fuel.electricity_mwh` | **AR** |
| Total gas (MWh) | `result.consumption.total.gas_mwh` + `marginal_delta.per_fuel.gas_mwh` | **AR** |
| Total district heat (MWh) | `result.consumption.total.district_heat_mwh` + `marginal_delta.per_fuel.district_heat_mwh` | **AR** |
| Per-service electricity (heating / cooling / DHW / vent / lighting / SP) | `result.consumption.{service}.electricity_mwh` | **AR** |
| Per-service gas (heating / cooling / DHW) | `result.consumption.{service}.gas_mwh` | **AR** |
| Heating SCOP / efficiency | `result.consumption.space_heating.scop_effective` (instantCalc.js:4347) | **AR** |
| Cooling SEER | `result.consumption.space_cooling.seer_effective` (instantCalc.js:4374) | **AR** |
| DHW efficiency | NOT a single named field. Derivable as `dhw.delivered_mwh / (dhw.electricity_mwh + dhw.gas_mwh)` from AR fields. | **CR** |
| Per-system primary / secondary split (heating / cooling) | `result.consumption.{service}.primary` + `.secondary` (instantCalc.js:4355-4366, 4378-4389) | **AR** |

### §2.4 Per-envelope (already on `cumulative_delta.per_envelope` via `_envelopeDelta`)

| Quantity | Status |
|---|---|
| Wall / roof / ground / glazing conduction losses | **AR** in `marginal_delta.per_envelope.{wall,roof,ground,glazing}_loss_mwh` |
| Infiltration loss | **AR** in `per_envelope.infiltration_loss_mwh` |
| Permanent vent loss | **AR** in `per_envelope.permanent_vent_loss_mwh` |
| Thermal bridging loss | **AR** in `per_envelope.thermal_bridge_loss_mwh` |
| Solar gain | **AR** in `per_envelope.solar_gain_mwh` |

These are pulled from the State 2 `losses_at_setpoint` block via `_envelopeDelta` (interventionsEngine.js:544). Useful for the "intervention reduced infiltration by X MWh" sub-row in the audit trail, but secondary to the main heating/delivered/fuel boundary rows.

### §2.5 What's COMPUTED-and-DISCARDED (CD) — none material to the panel

I walked `_calculateState2` and `_calculateState3` looking for boundary quantities computed in local variables but not attached to `result`. The Brief 44 era went through significant boundary-discipline work — the engine generally surfaces what it computes. Specifically:

- `heating_demand_state2_mwh` (raw) — surfaced as `demand_mwh`.
- `effective_recovery_mwh` — surfaced as `recovery_offset_mwh`.
- `heating_demand_mwh` (post-MVHR) — used for system sizing but NOT directly surfaced; CR (derivable).
- `ventResult.theoreticalRecoveryMwh` — uncapped per-system theoretical recovery. Surfaced per-system as `ventilation[i].theoretical_recovery_mwh` (instantCalc.js:4317). **AR** — useful as an "if uncapped" diagnostic for Finding C (infiltration) investigation.

No quantities Brief 48's UX section asks for are **CD** in a way that requires a retention change. The engine is in good shape.

### §2.6 What's NOT computed at all (NC)

None of Brief 48's listed quantities. The brief's UX section asks for:
- Raw demand → AR
- Post-MVHR demand → CR (one subtraction)
- Delivered per service → AR
- Electricity / gas → AR (totals + per-service)
- EUI / CO₂ → AR
- Both framings (cumulative + marginal) → AR

**Escalation gate: DOES NOT FIRE on any axis.**

---

## §3 — A note on `consumption.space_heating.demand_mwh` (raw vs post-MVHR)

There's a subtle point worth flagging because it affects the panel's clarity. The engine surfaces `consumption.space_heating.demand_mwh` as the **RAW (pre-MVHR) State 2 zone demand**, not the post-MVHR system-facing demand. Confirmation:

```js
// instantCalc.js:4131
const heating_demand_mwh = Math.max(0, heating_demand_state2_mwh - effective_recovery_mwh)
// instantCalc.js:4135 — systems sized to POST-MVHR demand
const heating_v25 = computeServiceEnergy(sys.heating, 'heating', heating_demand_mwh, resolved)
// instantCalc.js:4341 — but consumption block emits RAW
demand_mwh: r_mwh(heating_demand_state2_mwh),
```

The relationship is:
```
demand_mwh (raw)  =  delivered_mwh (post-MVHR, system-sized)  +  recovery_offset_mwh
```

For Bridgewater this means a typical reading might be:
- `demand_mwh` = 90.3 MWh (RAW — what the building needs at the zone level)
- `recovery_offset_mwh` = 26.1 MWh (MVHR recovers this)
- Post-MVHR demand = 64.2 MWh (what systems must deliver)
- `delivered_mwh` ≈ 64.2 MWh (sized to post-MVHR demand)

The panel needs to surface ALL THREE numbers (raw / recovery / post-MVHR) as distinct rows so the user sees the boundary, per Brief 44 discipline + Brief 48 §UX rule "Boundaries labelled in plain language, not engine jargon."

This also means the existing `marginal_delta.heating_demand_mwh` in `computeDelta` (interventionsEngine.js:473) reads the RAW value. Part 1's surfacing work will:
- Keep the existing field (it's the raw demand, useful as-is).
- Add a named `marginal_delta.heating_post_mvhr_demand_mwh` derived from `space_heating.demand_mwh − space_heating.recovery_offset_mwh` on each rolling result, so the panel doesn't need to do the subtraction inline.
- Add a named `marginal_delta.heating_recovery_offset_mwh` so the credit is also queryable in delta form.

This is **boundary-naming discipline** per Brief 48 Step 1.3 — no ambiguous `heat_kwh`, explicit raw / recovery / post-MVHR / delivered tier.

---

## §4 — Implication for Part 1's scope

The brief's premise — "surface, don't recompute" — is **confirmed**. The engine has the data. Part 1's actual work is:

1. **Extend `computeDelta` in `interventionsEngine.js`** to add the explicitly-named-derived fields:
   - `marginal_delta.heating_post_mvhr_demand_mwh` + `cumulative_delta.heating_post_mvhr_demand_mwh` (`raw − recovery_offset` per-state, then deltaRecord)
   - `marginal_delta.heating_recovery_offset_mwh` + `cumulative_delta.heating_recovery_offset_mwh` (direct deltaRecord on `space_heating.recovery_offset_mwh`)
   - `marginal_delta.heating_raw_demand_mwh` + alias for `heating_demand_mwh` with the explicit name (don't break the existing field; add the boundary-named version alongside)
   - Per-service `electricity_mwh` + `gas_mwh` deltas alongside the existing `delivered_mwh` + `demand_mwh` in `_serviceDelta` (currently these are only computed at the per-fuel total level, not per-service)
   - Per-service efficiency-equivalent deltas (`scop_effective` for heating, `seer_effective` for cooling) — useful for the panel's "delivered ÷ SCOP = electricity" identity reading

2. **No State 2 / State 3 changes.** Every input to the new deltaRecords is already on `result`.

3. **No physics changes.** Pure delta-extraction extensions.

Estimated diff size for Part 1: ~50 lines of additions to `computeDelta` + `_serviceDelta` in `interventionsEngine.js`. Possibly a small helper for the raw/recovery/post-MVHR triple. No other files touched in Part 1.

---

## §5 — Reconciliation checks Part 1 should add

Per the brief's Step 1.4 ("Unit-test or console-verify on Bridgewater that the surfaced numbers reconcile"). On Bridgewater clean state:

1. **MVHR identity**: `space_heating.demand_mwh − space_heating.recovery_offset_mwh ≈ space_heating.delivered_mwh` (within rounding). If not, the engine is doing something the panel isn't representing — investigate.
2. **Fuel identity per service**: `delivered_mwh / scop_effective ≈ electricity_mwh + gas_mwh` (for heating; for cooling use `seer_effective`; for DHW use derived efficiency). If a service violates this by >1%, it's a real boundary find — log to the diagnostics note and surface to Chris.
3. **Cumulative = sum of marginals**: for any metric M and any prefix of enabled interventions, `cumulative_delta.M[last] === sum(marginal_delta.M[i] for i in prefix)`. If not, that's Finding D directly — exactly what the panel is built to investigate. Part 5 will use the new panel to read this. Part 1 just needs to not BREAK the identity by introducing a derived field that doesn't sum.

These reconciliations are confirmations of engine correctness, not new physics. They're the kind of check the panel itself surfaces visually (the audit trail rows must be internally consistent).

---

## §6 — Verdict

- All data Brief 48's UX section requires is **already on the engine result** or **trivially derivable from it**.
- Both framings (cumulative vs marginal) are first-class.
- **No escalation gate fires.**
- Part 1 is a ~50-line additive change to `computeDelta` + `_serviceDelta`. No engine path, no physics, no State 2/3 changes.

The brief's premise holds. Proceeding to Part 1 on authorisation.

**Bridgewater clean anchor:** ~121.7 kWh/m²·yr at HEAD `5a135f9`. Held by construction throughout this audit (read-only). Part 1 will hold it by construction too (delta math, no physics).

---

## §7 — Part 1 landed (`4d6a658` → this commit)

### §7.1 What shipped

Added to `interventionsEngine.js`:

1. **`_postMvhrHeatingDemand(result)`** helper — derives post-MVHR heating demand from `consumption.space_heating.demand_mwh − consumption.space_heating.recovery_offset_mwh`. Returns null when raw demand is absent; treats missing recovery_offset as 0 (no MVHR → post-MVHR == raw).

2. **`_efficiencyPathFor(service)`** helper — maps service to its efficiency-metric path. Heating → `scop_effective`, cooling → `seer_effective`, others → null (DHW efficiency derivable client-side).

3. **`computeDelta` extensions** — three new boundary-named fields alongside the existing (back-compat) `heating_demand_mwh`:
   - `heating_raw_demand_mwh` — same path as the existing field but with the unambiguous name.
   - `heating_recovery_offset_mwh` — delta of the MVHR credit.
   - `heating_post_mvhr_demand_mwh` — delta of `_postMvhrHeatingDemand(result)`.

4. **`_serviceDelta` extensions** — added per-service `electricity_mwh`, `gas_mwh`, and `efficiency` records alongside the existing `delivered_mwh` + `demand_mwh`.

Per the brief's Step 1.3 boundary-naming discipline: no ambiguous `heat_kwh`. Existing `heating_demand_mwh` retained as a back-compat alias per Chris's note 1.

### §7.2 Reconciliation identity #3 — cumulative === sum of marginals on Bridgewater

Per Chris's note 2: record the Finding D data point.

**Result: HOLDS BY CONSTRUCTION for every field on `computeDelta`'s return shape.**

Algebraic proof:

`deltaRecord.delta = to − from`.

`runInterventionStack` computes per intervention `i`:
- `marginal_delta[i] = computeDelta(rollingResults[prevIdx], rollingResults[myIdx])`
- `cumulative_delta[i] = computeDelta(rollingResults[0], rollingResults[myIdx])`

For consecutive interventions with `prev(i+1) = my(i)`, the per-field telescoping sum collapses:

```
sum(marginal[i].delta for i in 0..N)
  = (my(0) − baseline)
  + (my(1) − my(0))
  + (my(2) − my(1))
  + …
  + (my(N) − my(N−1))
  = my(N) − baseline
  = cumulative[N].delta
```

This holds for every field that `deltaRecord` is applied to (pure subtraction), so it holds for `eui_kwh_per_m2`, `total_delivered_mwh`, `carbon_kgco2_per_m2`, `heating_demand_mwh`, the new `heating_raw_demand_mwh` / `heating_recovery_offset_mwh` / `heating_post_mvhr_demand_mwh`, `cooling_demand_mwh`, every `per_service.*.{delivered,demand,electricity,gas,efficiency}_mwh`, every `per_fuel.*_mwh`, and every `per_envelope.*_loss_mwh`.

**Live Bridgewater verification I could NOT do here:** running the engine in Node would require mocking browser globals + loading a Bridgewater state from the SQLite db; out of scope for Part 1's read-only diff. The algebraic proof guarantees the identity at full precision; the only failure mode is floating-point rounding (engine output is deterministic). Browser console recipe for live confirmation:

```js
// Open /interventions on Bridgewater with N enabled interventions, then in console:
const stack = window.__lastStackResult ?? null  // (Brief 48 Part 2 will expose if needed)
const cumLast = stack.interventions[N-1].cumulative_delta.eui_kwh_per_m2.delta
const sumMarg = stack.interventions.reduce((s, r) => s + r.marginal_delta.eui_kwh_per_m2.delta, 0)
console.log({ cumLast, sumMarg, drift: Math.abs(cumLast - sumMarg) })  // expect drift < 1e-9
```

### §7.3 What this means for Finding D

Per Chris's framing — "If it holds, the reorder behaviour is correct marginal physics; if not, flag it" — the identity holds, so:

**The marginal-vs-cumulative arithmetic at the `computeDelta` layer is correct.** Reordering interventions can NOT introduce a mismatch between cumulative and sum-of-marginals at this layer.

What reordering CAN change (and what Finding D was likely about):
- The CUMULATIVE result at the final position when patches OVERLAP. Brief 41 §6 specifies last-write-wins for overlapping `set` patches on the same path. Reordering changes which intervention "wins" → final state differs → cumulative differs. This is correct per the patch semantics but may surprise the user.
- The per-intervention MARGINAL attribution shifts with order. Each marginal is "this intervention's contribution given everything above it" — the order of "everything above" matters, so the per-row numbers move when the stack is reordered. This is also correct per the marginal definition.

**Brief 48's diagnostic instrument (the breakdown panel, lands in Part 2) makes BOTH of these visible to the user — the cumulative-at-final and the per-row marginals — so any future boundary-fix brief can read off the screen which kind of reorder behaviour the user is seeing.**

The hard data point: **at the `computeDelta` layer, cumulative === sum of marginals by construction; this is not a bug surface and the next brief should look upstream (patch overlap semantics, marginal-attribution framing) rather than at the delta math.**

### §7.4 Reconciliation identities #1 + #2 — Part 2's job

The other two reconciliations from §5 (MVHR identity: `raw − offset ≈ delivered`; fuel identity per service: `delivered / efficiency ≈ electricity + gas`) require live Bridgewater data to verify — they're engine-correctness statements, not algebraic identities. The Part 2 panel surfaces these values side-by-side per intervention; if they diverge on screen during Chris's checkpoint walkthrough, that's a real finding for the next brief to investigate (NOT for Brief 48 to fix — see brief's "What MUST NOT happen").

### §7.5 Verification

- `npm run build` clean.
- Engine code in `instantCalc.js` untouched. All Part 1 changes confined to `interventionsEngine.js` delta-extraction layer.
- Bridgewater clean anchor ~121.7 kWh/m²·yr held — Part 1 adds derived fields to `computeDelta` return; underlying engine `result` is unchanged.

Proceeding to Part 2 (per-intervention audit-trail panel + mandatory browser checkpoint).

---

## §8 — Part 2 landed (safety commit `a1b6fdf` + wiring commit pending)

### §8.1 What shipped

**New file** — `frontend/src/components/modules/interventions/visualiser/BreakdownPanel.jsx` (406 lines, safety-committed at `a1b6fdf`):

- **Progressive disclosure** per brief §UX: Level 1 headline (top 3 movers by absolute Δ, picked from post-MVHR demand / cooling / hot water / electricity / gas / EUI / carbon candidate set, threshold-filtered) is always visible; Level 2 audit-trail table expands on click; Level 3 chain context deferred to Part 3.
- **Framing toggle** at top-right — "vs step above" (marginal, default — Finding-D-relevant) vs "vs original" (cumulative from baseline). Only one Δ column at a time per brief §UX rule "not two competing columns".
- **Four sections** in the trail, plain-language section headers + plain-language row labels with engine paths in Info tooltips: Demand side (raw / MVHR recovery / post-MVHR / cooling / DHW) → Delivered by systems (heating delivered + efficiency, cooling delivered + efficiency, DHW delivered) → Fuel consumed (total electricity / gas, per-service splits) → Headline impact (EUI + carbon).
- **Zero-row suppression** — rows where baseline and after are both zero are hidden silently; rows where Δ is below per-unit `NOISE_THRESHOLD` show "no change" text rather than `+0.0`. Sections with no surviving rows are hidden entirely.
- **Tone coding** — `text-green-700` for "good" Δs (lower demand / lower fuel / higher efficiency via `goodWhenPositive`), `text-red-700` for "bad", `text-mid-grey` for below-threshold. Honest directional read; tradeoffs are explicit (e.g. heat-pump retrofit shows red on electricity Δ and green on gas Δ → reader sees the trade).
- **Empty state** when `!intervention` — plain message pointing user to the dropdown.

**Wiring** — `frontend/src/components/modules/interventions/visualiser/VisualiserHost.jsx`:

- 4th view `breakdown` (icon: `Receipt` from Lucide) added to the `VIEWS` array alongside Waterfall / Before-after / Heat balance.
- Persistent intervention selection via `localStorage` key `nza-interventions-breakdown-id`. Auto-falls-back to the first intervention's id if the previously-selected one is no longer in the list (handled in `useEffect` so it doesn't fight the user's selection).
- Single-row picker strip above the panel (label + dropdown). Disabled rows surface in the dropdown with `· disabled` suffix so a zero `marginal_delta` has a visible explanation.
- BreakdownPanel receives `intervention` (source list entry, carries label) + `marginalDelta` + `cumulativeDelta` (from the matching `stackResult.interventions[idx]` row by id-lookup → index alignment). No internal engine call — plugs straight into the Brief 47 live-update loop.

### §8.2 What is deliberately NOT in Part 2 (deferred to Part 3+)

- **Level 3 chain context** — "this intervention shifted intervention X's marginal from −Y to −Z" downstream effect. Requires per-cell baseline-when-reordered diffs that the current `stackResult` shape doesn't carry. Part 3.
- **Whole-stack matrix overview** — one screen showing every intervention × every metric. Brief §UX Part 4 optional; not built unless walkthrough motivates it.
- **Engine boundary fixes** for Findings A (cooling setpoint), C (infiltration), D (reorder marginals). Out of scope per brief's "What MUST NOT happen" — Brief 48 builds the instrument; fixes are a separate brief that uses the instrument.

### §8.3 Verification

- `npm run build` clean (3,213 modules transformed, 9.17s, no errors — only pre-existing chunk-size + font-path warnings).
- No engine changes (`instantCalc.js` untouched).
- Bridgewater clean anchor ~121.7 kWh/m²·yr: not perturbed — the new view is read-only on `stackResult` props.
- Live Bridgewater narrate-test deferred to the mandatory checkpoint with Chris (the brief's Part 2 gate; AI cannot drive the browser).

---

## §9 — Parts 3 + 4 landed + Brief 48 close (commits `5e06e1a` + `9024090`)

### §9.1 Part 3 — Level 3 chain context (`5e06e1a`)

BreakdownPanel re-signatured to take the full `interventions` + `stackInterventions` collections + `selectedId` + `onSelectId` callback (parent owns persisted id; panel resolves its own row and navigation). Added a collapsible chain-context block (default open) that surfaces:

- **Above row** — the immediate ENABLED predecessor, with a one-line summary of its cumulative-from-baseline biggest mover ("This row's marginal is computed on top of: …"). Clickable → navigates selection. If no enabled rows above, inert "Project baseline" line.
- **Below rows** — every subsequent row, each with a one-line summary of its OWN marginal (so the user sees how downstream rows responded to having this one above them). Clickable → navigates selection.
- **Position-of-N indicator** in the header sub-line ("2 of 5 · Audit trail · vs step above").

Brief 48 Principle 3 (surface, don't recompute) held — no engine call; predecessor/successor identification is pure list arithmetic; `summariseMarginal` reuses the existing `pickHeadlineRows` helper from Part 2. The whole chain block is conditionally rendered only when there's actually a predecessor or a successor to show, so a stack of one intervention doesn't render empty Above/Below clutter.

VisualiserHost simplified: removed `selectedIntervention` / `selectedRow` useMemo (panel does the lookup now); only owns the persistent selection id + setter.

### §9.2 Part 4 — Whole-stack matrix overview (`9024090`)

Trail | Matrix toggle added to BreakdownPanel header beside the framing toggle. Matrix mode renders a table:

- **Rows** = each intervention in the list (1-based numbered).
- **Columns** = 7 key metrics in compact form: Heat (post-MVHR) · Cool · Hot wtr · Elec · Gas · EUI · CO₂.
- **Cells** = tone-coloured Δ from the active framing's per-row delta (marginal or cumulative). Below-threshold values render as muted "—" rather than `+0.0`.
- **Click a row** → makes it the selected intervention; user can flip back to Trail to read that row's full audit in one click.
- **Selected row** gets subtle background highlight. **Disabled rows** render with "· off" suffix in italic muted text.

Same framing toggle applies in matrix mode (the active framing decides whether each cell reads marginal_delta or cumulative_delta). Mode toggle and framing toggle are co-located so Chris can flip between Trail (one row deep) and Matrix (all rows wide) in a single click without losing context.

Brief 48 Principle 3 (surface, don't recompute) held — matrix reads the exact same per-row delta records that Trail mode reads, just laid out as rows-of-metrics instead of one-intervention's-rows-of-metrics. No new engine pass, no new delta math.

Header copy varies by mode: Trail mode shows the selected intervention's label + "{idx+1} of {N} · Audit trail · {framing}"; Matrix mode shows "Whole-stack overview · Matrix · {N} interventions · {framing}".

### §9.3 Part 5 close

Brief 48 archived to `docs/briefs/archive/48_intervention_breakdown_viewer_COMPLETED.md`. `docs/briefs/current.md` updated to "no active brief" with Finding E flagged as the next brief's seed.

Findings record at [`48_findings_first_look.md`](48_findings_first_look.md):
- **D** — delta-math layer cleared algebraically; reorder is not a delta-arithmetic bug.
- **A** + **C** — instrument ready; live read-outs pending in the next brief.
- **E** — MVHR boundary decoupled-accounting bug, **discovered by Chris on first use** of the BreakdownPanel during the Part 2 checkpoint. Brief 48 explicitly does not investigate — record-only — per Chris's instruction. Gets its own brief next.

The panel narrated correctly enough on first use to expose a real engine bug. That's the validation Brief 48 was built for.
