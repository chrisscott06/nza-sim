# Audit — Brief 72 candidate: Occupancy 4 intervention disagreement across views

> Read-only diagnostic on Chris's flag (2026-05-28). Bridgewater with seven interventions stacked; "Occupancy 4" first. Three Interventions-module views disagree on what Occupancy 4 does. NO fixes here — findings + the browser dumps Chris must run to discriminate hypotheses.

**HEAD at write time:** `692c404` (Brief 71 Part 5 close).

---

## §0 Symptom summary (Chris's report)

| View | Number for Occupancy 4 (Total mode, Bridgewater first-in-stack) |
|---|---|
| Waterfall | marginal = **+825 kWh** (+0.825 MWh) |
| Isolated | standalone = **+825 kWh** (agrees with Waterfall, as it should for first-in-stack — falsifiability #1 PASS) |
| Calc Trail (SHOW = Occupancy 4) | Heat Δ **0.0 MWh**, Cooling Δ **0.0 MWh**, DHW Δ **0.0 MWh**, Electricity Δ **0.0 MWh** — every row 0 |
| Calc Trail BASELINE column | Heat **32.7**, Cooling **124.0** — these are the **occupancy-4** numbers, NOT the pristine baseline (which Chris confirms = Heat 55.9, Cooling 87.6 at occupancy 3 on the Systems page) |

So two anomalies:
- **A. Calc Trail Δ rows are uniformly 0.0** despite +825 kWh in Waterfall/Isolated.
- **B. Calc Trail BASELINE column is showing the AFTER-Occupancy-4 numbers** (Heat 32.7 / Cooling 124.0), not the pristine baseline (Heat 55.9 / Cooling 87.6).

Anomaly B is what mechanically produces Anomaly A: if `before == after` element-by-element, every Δ is 0.

---

## §1 Thread 1 — Where the +825 kWh in Waterfall/Isolated comes from

### Data path (verified on main, no behavioural assumptions)

| Step | File:Line | What |
|---|---|---|
| 1 | `interventionsEngine.js:365` | `runInterventionStack(baselineConfig, interventions, runEngine, libraryData)` |
| 2 | `interventionsEngine.js:367-381` | Builds `configs = [baseline, after_int_1, after_int_2, …]`; for first enabled row, `rowConfigIndex[0] = 1` |
| 3 | `interventionsEngine.js:383` | `rollingResults = configs.map(cfg => runEngine(cfg))` — for a 7-intervention stack with all enabled, 8 engine runs |
| 4 | `interventionsEngine.js:394-395` | Per row: `marginal_delta = computeDelta(rollingResults[prevIdx], rollingResults[myIdx])`; `cumulative_delta = computeDelta(rollingResults[0], rollingResults[myIdx])` |
| 5 | `interventionsEngine.js:398-401` | Returns `{ baseline: rollingResults[0], interventions: [{ result, marginal_delta, cumulative_delta }] }` |
| 6 | `interventionsEngine.js:536-538` | `computeDelta` puts EUI under `eui_kwh_per_m2: { from, to, delta, delta_pct }`, with `pickNumber(r, 'consumption.total.kwh_per_m2_yr')` as the first path tried |
| 7 | `EUIWaterfall.jsx:83-87` | `pullMarginalDelta(row) = row.marginal_delta.eui_kwh_per_m2.delta` |
| 8 | `useIsolatedResults.js:74` | Surfaces `cumulative_delta` from a singleton run; identical math for first-in-stack |

**Unit of `delta`:** kWh/m²·yr (intensity, EUI). For first-in-stack, `marginal_delta.eui_kwh_per_m2.delta` is exactly the standalone EUI delta from baseline. The Total-mode +825 kWh figure = `delta × gia_m2` (`unitFmt.js:83-87`). At Bridgewater gia ~4125 m², that's +0.20 kWh/m²·yr intensity.

**Falsifiability #1 (already covered by Brief 71's hook):** for first-in-stack, isolated `cumulative_delta` MUST equal stack `marginal_delta` (Waterfall agrees with Isolated). Chris confirms both show +825 kWh, so #1 PASSES.

### What the +825 kWh actually measures

`rollingResults[1].consumption.total.kwh_per_m2_yr − rollingResults[0].consumption.total.kwh_per_m2_yr`.

- `rollingResults[0]` = `runEngine(baselineConfig)` — the pristine baseline engine output, no interventions applied (the engine's stack runner uses `_skipInterventions:true` per `instantCalc.js:6991-7000` when invoking runEngine for each rolling config).
- `rollingResults[1]` = `runEngine(applyIntervention(baselineConfig, Occupancy 4))` — the post-Occupancy-4 engine output.

So the +825 kWh figure is real EUI movement between two distinct engine outputs. The engine IS producing different `consumption.total.kwh_per_m2_yr` for the two configs.

---

## §2 Thread 2 — Why Calc Trail shows 0.0 across every row

### Data path

| Step | File:Line | What |
|---|---|---|
| 1 | `VisualiserHost.jsx:74` | `const baselineResult = stackResult?.baseline ?? null` — should be `rollingResults[0]` |
| 2 | `VisualiserHost.jsx:144-152` | `calctrailAfterResult`: when `selectedCalctrailId` matches an intervention's `id`, returns `stackResult.interventions[idx].result` — should be `rollingResults[myIdx]` |
| 3 | `VisualiserHost.jsx:228-231` | Mounted as `<BreakdownTable baselineResult={baselineResult} cumulativeResult={calctrailAfterResult} viewLabel={…} />` |
| 4 | `BreakdownTable.jsx:570-583` | `beforeReads = { demand: readDemand(baselineResult), heat: readPerService(baselineResult, 'space_heating'), … }` |
| 5 | `BreakdownTable.jsx:585-586` | `const after = cumulativeResult ?? baselineResult` — note the `??` fallback; if `cumulativeResult` is null/undefined, `after === baselineResult` and every Δ becomes 0 by construction |
| 6 | `BreakdownTable.jsx:135-141` | `readDemand(r).heating = pickNumber(r, 'consumption.space_heating.demand_mwh') ?? pickNumber(r, 'demand.heating_demand_mwh')` — same field the Systems page renders |
| 7 | `BreakdownTable.jsx:646-648` | The three "Heat needed / Cooling needed / Hot water needed" rows render `before={beforeReads.demand.heating}` against `after={afterReads.demand.heating}` |

### The branching hypothesis space

Given Chris sees Calc Trail BASELINE = 32.7 (the AFTER-Occupancy-4 value) AND Δ = 0 across every row, exactly one of the following must be true:

**(H1) `stackResult.baseline === stackResult.interventions[0].result` by reference** — same engine result for both slots in the stack object. Would mean `runInterventionStack` cross-wired baseline with the first row's result.

- Static read of `interventionsEngine.js:398-401` shows `baseline: rollingResults[0]` and `interventions[0].result: rollingResults[myIdx]` (`myIdx=1` for first enabled). Different indices, different references — no cross-wire visible in source.
- **Falsifies easily:** in browser DevTools console: `__inspectStack = window.__lastStackResult; __inspectStack.baseline === __inspectStack.interventions[0].result`. We need a way to expose stackResult — currently it isn't on window. See §4.1 for the dump procedure.

**(H2) `baselineResult` and `cumulativeResult` are different objects but contain identical numbers** at the paths BreakdownTable reads. Would mean both engine runs (`runEngine(baselineConfig)` and `runEngine(applyIntervention(…))`) produced identical `consumption.space_heating.demand_mwh` etc., even though they produced DIFFERENT `consumption.total.kwh_per_m2_yr` (since Waterfall sees +0.20 delta there).

- Mechanically possible if Occupancy 4 patches a downstream-only field — e.g. an electricity end-use (small power) that affects `consumption.total.electricity_mwh` and thus EUI, without touching `consumption.space_heating.demand_mwh`. But Chris reports Electricity row also = 0.0 Δ. So if EUI moves by 0.20 kWh/m²·yr without electricity moving by 825 kWh… EUI = (elec + gas)/gia ×1000. If neither elec nor gas moves, EUI can't move. **Internal contradiction** — eliminates this hypothesis unless the readers are wrong.
- **Sub-hypothesis (H2a):** the readers in BreakdownTable are reading the WRONG paths, missing the field Occupancy 4 actually moves. e.g. `consumption.total.kwh_per_m2_yr` is the headline EUI and reflects ALL costs; the per-service rows read `consumption.{service}.{electricity|gas}_mwh` and might be missing a category. Check: does Occupancy 4 push a `consumption.brief40.*` field that the BreakdownTable doesn't surface? Worth scanning the engine result keys (see §4.3).

**(H3) Pristine baseline ACTUALLY has occupancy = 4 saved** (not 3 as Chris's mental model assumes), so the "Occupancy 4" intervention is a no-op patch, both engine runs are functionally identical, and:
- BASELINE column correctly shows Heat 32.7 (= the persisted value when occupancy = 4)
- Every Δ correctly = 0 (because the patch doesn't change anything)
- Waterfall/Isolated +825 kWh must then be explained by SOMETHING ELSE — either the patches set a different field by accident, or the +825 is an artefact of a different path.

This is the most parsimonious explanation for the Calc Trail symptoms, but it forces a tougher question on Thread 1: how is Waterfall producing a non-zero delta from two functionally-identical engine runs? Cache pollution? An apparent-zero-but-actually-small floating-point difference? Worth checking `consumption.total.kwh_per_m2_yr` on both rollingResults directly.

---

## §3 Thread 3 — What "Occupancy 4" actually patches

### Patches the schema knows about (`patchCapture.js:297-299`)

```
building.occupancy_rate                  → label "Occupancy rate"        (a 0..1 fraction)
building.occupancy.occupancy_rate        → label "Occupancy rate (v2.3)" (same; nested form)
building.occupancy.density.value         → label "Occupancy density"     (the per-room count when density.basis === 'per_room')
```

None of these regex rows are labelled "num_bedrooms" — there's no capture for `building.num_bedrooms` despite the engine reading it heavily (`instantCalc.js:2122, 2126, 2140, 2249`).

### Engine reads of headcount-driving fields (`instantCalc.js`)

| Source | Reads |
|---|---|
| `computeTotalOccupants` L2118-2128 | `building.num_bedrooms × building.occupancy.density.value` (per_room basis) or `× density.value / gia` (per_m2) |
| State 2 hourly gain accumulator L2249-2255 | `effective_occupants = totalOccupantsAt100 × occupancy_rate × presence` |
| State 3 DHW (Brief 58 B3) L4822-4860 | `dhw_demand_kwh = occupants × L_per_p_per_day × cp × ΔT_tap × 365` |

So three places consume headcount, each via a slightly different path:
- People sensible-gain in State 2 (heat balance)
- DHW headcount in State 3
- And whichever ventilation flow / lighting / equipment intensity uses `density.value` × `occupancy_rate`

### What "Occupancy 4" most likely means by its label

The label suggests "4 people" or "4 bedrooms" or "occupancy at 4-level". Three plausible single-field patches:
- `building.num_bedrooms = 4` (room count)
- `building.occupancy.density.value = 4` (per-room headcount)
- `building.occupancy_rate = 0.04` or some other rate

**If the patch is `building.num_bedrooms`**, that field is **NOT in `patchCapture.js`'s regex list** (verified by grep above — only `occupancy_rate` and `occupancy.density.value` are captured). So the patch may not survive capture-mode round-tripping cleanly, or may not be propagated to the editor pop-out's preview. This is itself a follow-up note even if not the immediate cause.

**If the patch is `building.occupancy.density.value`**, it changes both State 2 people gain AND State 3 DHW headcount. If pristine value === 4 already, the patch is a no-op (→ H3). If pristine value differs (e.g. 3), the patch produces real changes (→ contradicts the Calc Trail zeros).

---

## §4 Browser dumps Chris should run on Bridgewater (Occupancy 4 first in stack)

Each console snippet returns or logs a single value. Pasted back, they discriminate between H1 / H2 / H3 deterministically.

### §4.1 — Are baseline and after the same object reference? (Hypothesis H1)

The current code doesn't expose `stackResult` to `window`. Temporary diagnostic (NOT a fix — Tier 2 read-only):

Browse-time approach without code changes: open React DevTools, find the `InterventionsModule` component, inspect its `stackResult` state, copy the references for `baseline` and `interventions[0].result` into the console:

```js
// In React DevTools after pinning the InterventionsModule component as $r:
$r.props_or_state_path_to_stackResult.baseline === $r.props_or_state_path_to_stackResult.interventions[0].result
```

Easier alternative (asks Chris to drop one diagnostic line on a worktree branch, not main): in `InterventionsModule.jsx:184` after the `stackResult` line, temporarily add `if (typeof window !== 'undefined') window.__lastStackResult = stackResult`. Then console:

```js
const s = window.__lastStackResult
console.log('Ref equality:', s.baseline === s.interventions[0].result)
console.log('Heat baseline:', s.baseline?.consumption?.space_heating?.demand_mwh)
console.log('Heat after-int0:', s.interventions[0]?.result?.consumption?.space_heating?.demand_mwh)
console.log('EUI baseline:',  s.baseline?.consumption?.total?.kwh_per_m2_yr)
console.log('EUI after-int0:', s.interventions[0]?.result?.consumption?.total?.kwh_per_m2_yr)
console.log('marginal_delta EUI:', s.interventions[0]?.marginal_delta?.eui_kwh_per_m2)
```

**Discriminator:**
- `Ref equality: true` → **H1 confirmed** (cross-wired baseline; engine-stack-runner bug — search for whatever mutation produces the alias).
- `Ref equality: false` AND heat values are byte-equal at e.g. `32.7` → **H2 or H3 still live** (different objects, same data).
- `Heat baseline !== Heat after-int0` → Calc Trail wiring is the bug (data differs but BreakdownTable shows the after-value in the BASELINE column anyway). Look at VisualiserHost's `baselineResult` prop wiring or BreakdownTable's `before` reader.

### §4.2 — Is the pristine baseline actually at occupancy 4? (Hypothesis H3)

Inspect the persisted building config directly:

```js
const proj = window.__lastStackResult  // or use React DevTools to get params
// Look at the persisted building from ProjectContext — easiest via DevTools
// Components tab → ProjectContext.Provider → search 'value' for 'params'
// Then in console:
const p = $r_params  // bind via DevTools
console.log('num_bedrooms:', p.num_bedrooms)
console.log('occupancy.density:', p.occupancy?.density)
console.log('occupancy_rate:', p.occupancy_rate, p.occupancy?.occupancy_rate)
```

**Discriminator:**
- If `num_bedrooms` and `occupancy.density.value` together yield "4 occupants" (whatever that means for Bridgewater's basis) AND Chris's "Occupancy 4" intervention patches the same fields to the same values → **H3 confirmed** (no-op patch; the +825 in Waterfall is a separate mystery). Falsifiability: with the intervention disabled, baseline EUI is unchanged from the persisted value.
- If the persisted state has a DIFFERENT occupancy than the intervention sets → Occupancy 4 should produce real engine deltas; if Calc Trail doesn't reflect them, it's a wiring or read-path issue.

### §4.3 — What field does Occupancy 4 actually move? (Threads 2 + 3 cross-cut)

Compare the two engine outputs key-by-key for anything that changes:

```js
const s = window.__lastStackResult
const a = s.baseline.consumption
const b = s.interventions[0].result.consumption
function flatDiff(x, y, prefix = '') {
  const out = []
  for (const k of new Set([...Object.keys(x || {}), ...Object.keys(y || {})])) {
    const vx = x?.[k], vy = y?.[k]
    if (vx == null && vy == null) continue
    if (typeof vx === 'number' && typeof vy === 'number') {
      if (Math.abs(vx - vy) > 0.001) out.push(`${prefix}${k}: ${vx} → ${vy} (Δ ${(vy - vx).toFixed(3)})`)
    } else if (typeof vx === 'object' && typeof vy === 'object') {
      out.push(...flatDiff(vx, vy, `${prefix}${k}.`))
    }
  }
  return out
}
console.log(flatDiff(a, b).join('\n'))
```

**Discriminator:**
- If the diff shows movement on e.g. `total.electricity_mwh` or `dhw.delivered_mwh` or `lighting.electricity_mwh` while `space_heating.demand_mwh`/`space_cooling.demand_mwh`/`dhw.demand_mwh` are unchanged → the per-row READERS in BreakdownTable miss the moving field. That's a UI omission, not an engine bug.
- If the diff shows no movement anywhere → both engine runs are byte-identical at the consumption layer; the +825 in Waterfall is reading from a layer that DOES move (carbon? heat_balance.gains?), which would be an engine inconsistency between EUI and per-service breakdown — Rule 9 territory (every term entering the EUI roll-up must appear in the displayed breakdown).
- If the diff shows movement on `space_heating.demand_mwh` (or similar) but BreakdownTable still displays 0 → wiring bug between `baselineResult` and BreakdownTable's `before` reader.

### §4.4 — Systems page anchor cross-reference (Chris's existing trusted view)

With Occupancy 4 intervention enabled and selected, navigate to **Systems → Energy flows**. Read the per-service kWh/m²·yr on the demand side:
- Heating demand
- Cooling demand
- DHW demand
- Mech vent
- Lighting / Small power

Compare to:
- Bridgewater pristine (Occupancy 4 intervention **disabled**, all others same): same reads
- Calc Trail BASELINE column (Heat 32.7, Cooling 124.0): does it match disabled-state Systems numbers?
- Calc Trail AFTER column (Heat 32.7, Cooling 124.0 per Chris): does it match enabled-state Systems numbers?

This is the ground-truth check: Systems page = the engine output, no intervention-layer transformations. Anything that disagrees with Systems is a UI bug.

### §4.5 — Reproduce by moving Occupancy 4 to position 7 (last in stack)

If the bug is order-dependent — e.g. compounding — then moving Occupancy 4 to LAST should cause the Isolated value to still equal +825 (singleton math, position-independent) while the Waterfall marginal will likely change (marginal at position N depends on what's above it). If the Calc Trail behaviour changes when Occupancy 4 is moved, the bug is in the stack-position-dependent code path; if it persists identically, it's not order-dependent.

---

## §5 Hypothesis → fix-location matrix

| Hypothesis | Confirmed by | Fix lives in |
|---|---|---|
| **H1** (cross-wired baseline) | §4.1 ref equality `true` | `interventionsEngine.js` `runInterventionStack` (~L365-401). Low risk — the engine has the contract, the bug would be a recent regression there. |
| **H2** (different objects, identical-by-coincidence data; UI reader misses a moving field) | §4.1 ref equality `false` AND §4.3 diff shows movement on a key BreakdownTable doesn't surface | `BreakdownTable.jsx` `read*` helpers (~L135-201). Low risk, UI-only. |
| **H3** (no-op patch; persisted state already at occupancy 4) | §4.2 shows persisted occupancy == intervention's target value | Either user data state (just disable the intervention) OR the Occupancy intervention author needs a different target. The +825 in Waterfall becomes a separate live mystery — likely H2-flavoured. |
| **H4** (Occupancy 4 patches a field `patchCapture.js` doesn't track, e.g. `num_bedrooms`) | §4.3 shows movement on demand fields with patches that grep-don't-match the capture regex list | `patchCapture.js` capture rows (~L297-299) — add `num_bedrooms` capture. Low risk. |

---

## §6 Notes for Brief 72 scoping

- The factor-of-2 question on Isolated (Brief 71 §6) and this disagreement question both routed through `runInterventionStack`'s rolling results; both are diagnosable with §4.1's `window.__lastStackResult` instrumentation. Worth landing as a **persistent dev-only diagnostic** so future Tier-2 reports come with the raw JSON attached.
- `patchCapture.js` not tracking `building.num_bedrooms` is suspicious independently of this bug. If the persisted-project bedroom count and the intervention's target bedroom count differ, this should produce a real engine delta — but capture-mode round-tripping might be dropping it. Worth a separate small audit.
- The CLAUDE.md Rule 9 invariant ("every term entering a demand integral, energy balance, or aggregate must appear as a line in the displayed breakdown") is exactly what's at stake here: if EUI moves but no service row moves, Brief 30 Phase 1.4's integrand-vs-display reconciliation should have flagged it. Whether that check is wired in the Calc Trail panel is itself worth verifying (the `checkConsistency` function exists at `BreakdownTable.jsx:222` — does it fire for this case?).

---

## §7 Verdict for Chris

I can't determine the root cause from source alone. The three live hypotheses (H1 / H2 / H3) are mutually exclusive and each maps to a different fix location and risk profile. The §4.1 dump (ref equality + the four engine-output numbers) is the single discriminator — 30 seconds of console work once the `window.__lastStackResult` diagnostic line is dropped on a worktree branch.

Chris decides scope: Brief 72 = this fix (after the dumps land), Brief 73 = door bug, Brief 74 = auxiliary loads, per Chris's stated ordering.
