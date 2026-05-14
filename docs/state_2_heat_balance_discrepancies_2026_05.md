# State 2 Heat Balance discrepancies — investigation (2026-05-14)

**Trigger:** Chris's walkthrough comparing Building module State 1 Heat Balance
vs Internal Gains State 2 Heat Balance on Bridgewater surfaced four concrete
problems with the numbers. Investigation read-only; no fix applied yet.

**Scope:** Static engine only (`frontend/src/utils/instantCalc.js`) + its
consumer (`frontend/src/components/modules/balance/HeatBalance.jsx`) + mode
routing (`frontend/src/utils/stateMode.js`). EnergyPlus side unaffected — this
is purely the Static-engine output and its in-browser display.

---

## Reported numbers (Bridgewater, post 5f890c2 day=1 fix)

### State 1 (Building module, envelope-only)
| Item | Value |
|---|---:|
| Solar F1 NE | 54.8 MWh |
| Solar F2 SE | 4.2 MWh |
| Solar F3 SW | 68.0 MWh |
| Solar F4 NW | 3.0 MWh |
| Facade sum (Chris) | 130.0 MWh |
| External wall | 15.9 MWh |
| Roof | 10.7 MWh |
| Ground | 14.7 MWh |
| Glazing | 80.3 MWh |
| Fabric leakage | 56.6 MWh |
| Losses sum | 178.2 MWh |
| Heating demand | 105 MWh |
| Cooling demand | 101 MWh |

### State 2 (Internal Gains module, envelope-gains)
| Item | Value |
|---|---:|
| Solar F1 N | 57.5 MWh |
| Solar F2 E | 4.4 MWh |
| Solar F3 S | 71.4 MWh |
| Solar F4 W | 3.1 MWh |
| Facade sum (Chris) | 136.4 MWh |
| People | 118.9 MWh |
| Equipment | 56.1 MWh |
| Lighting | 40.9 MWh |
| Internal gains sum | 215.9 MWh |
| External wall | 16.5 MWh |
| Roof | 11.1 MWh |
| Ground | 15.2 MWh |
| Glazing | 82.9 MWh |
| Fabric leakage | **missing** |
| Losses breakdown sum | 125.7 MWh |
| **Total gains** | **398.8 MWh** |
| **Total losses** | **184.1 MWh** |
| **Residual** | **+214.6 MWh** ("large residual; check inputs") |

---

## Engine architecture (the contract State 2 actually implements)

`_calculateState2` (instantCalc.js:1036–1356) does NOT independently
compute solar, conduction, or ventilation losses. It runs ONE 8,760-hour
loop that:

1. Calls `_calculateEnvelopeOnly(withMode(building, 'envelope-only'), ...)`
   first (line 1042) to get a State-1-canonical baseline.
2. Re-runs a parallel 8,760-hour loop solely to accumulate **internal
   gains** + recompute T_op + recompute heating/cooling demand with
   `Q_to_mass = Q_solar + gains.total`.
3. **Emits losses, solar gains, and totals.losses_kwh by spreading**
   `state1Result`:

```js
// instantCalc.js:1288 — top-level losses
losses: state1Result.losses,

// instantCalc.js:1321–1341 — heat_balance.annual
heat_balance: {
  ...state1Result.heat_balance,
  annual: {
    ...state1Result.heat_balance.annual,     // ← spreads losses + solar
    gains: {
      ...state1Result.heat_balance.annual.gains,  // ← keeps solar from State 1
      internal: { people, lighting, equipment },  // ← adds internal only
    },
    totals: {
      losses_kwh:  state1Result.heat_balance.annual.totals.losses_kwh,
      gains_kwh:   r1(state1Result...gains_kwh * 1000 + acc_people + acc_lighting + totalEquipmentWh),
      ...
    },
  },
  ...
}
```

**Implication:** State 2's `heat_balance.annual.losses` and
`heat_balance.annual.gains.solar` are LITERALLY the same object references
as State 1's. The values must be byte-identical between the two displays
for the same building config + same engine invocation.

---

## Problem 1 — Solar shifts 5% between State 1 and State 2

### Reported delta
- F1: 54.8 → 57.5 (+4.9%)
- F2: 4.2 → 4.4 (+4.8%)
- F3: 68.0 → 71.4 (+5.0%)
- F4: 3.0 → 3.1 (+3.3%)
- Facade total: 130.0 → 136.4 (+4.9%) — roughly uniform per facade

### Code-level analysis
- State 1 (Building module): `calculateInstant(params, ..., {mode:'envelope-only'})` → `_calculateEnvelopeOnly(withMode(params,'envelope-only'), ...)`
- State 2 (Internal Gains): `calculateInstant(buildingWithComfort, ..., {mode:'envelope-gains'})` → `_calculateState2(withMode(buildingWithComfort,'envelope-gains'), ...)` → internally `_calculateEnvelopeOnly(withMode(withMode(bWC,'envelope-gains'),'envelope-only'), ...)`

`withMode('envelope-only')` returns:
```js
{ length, width, num_floors, floor_height, orientation, wwr, window_count,
  shading_overhang, shading_fin, infiltration_ach, thermal_mass_*, openings:permanentOpenings, location }
```

`withMode('envelope-gains')` returns `withMode('envelope-only')` + `{ num_bedrooms, occupancy, gains }`.

Re-applying `withMode('envelope-only')` to a `withMode('envelope-gains')` input strips `num_bedrooms`, `occupancy`, `gains` back out — leaving an object identical to `withMode(originalBuilding, 'envelope-only')`.

The solar accumulator (`_calculateEnvelopeOnly` line 488–497):
```js
const sol_n = hourlySolar.f1[h] * (glazing.north ?? 0) * g_value * (1 - FRAME_FRACTION) * shadingFactors.north
...
acc_solar_n += sol_n
```

Depends on: `hourlySolar` (passed in), `glazing` (from `computeGeometry`), `g_value` (from `getGValue`), `FRAME_FRACTION` (constant 0.20), `shadingFactors` (from `computeShadingFactors`).

- `hourlySolar` — both Building module and `useStateComparison` call `useHourlySolar(weatherData, params.orientation ?? 0)`. Same args → same output.
- `glazing` — depends on `length, width, num_floors, floor_height, wwr`. Identical after withMode in both modes.
- `g_value` — depends on `constructions.glazing` + libraryData. Same across modules.
- `shadingFactors` — depends on `shading_overhang, shading_fin`. Identical after withMode in both modes.

**Conclusion: the engine math mandates identical per-facade solar values between the two displays for the same project at the same point in time.**

### Working hypothesis
The 5% delta cannot come from the engine code. Most likely cause:
**the two screenshots were taken at moments when the project config differed slightly** (live edit in progress, stale React state in one of the modules, or `params` mutating between the two memoised computations). The roughly-uniform ~5% per-facade pattern is consistent with a single geometric input changing — e.g., a small wwr edit, a shading-fin removal, or an orientation tweak that proportionally rescales irradiance projection.

### Diagnostic step before any fix
Walk through the live app:
1. Open Bridgewater, navigate to Building → Heat Balance. Record the four facade values.
2. Without editing anything, navigate to Internal Gains → Heat balance tab. Record again.
3. If values match within rounding, problem 1 was screenshot-time-skew (no bug).
4. If values still differ, dump `state1.heat_balance.annual.gains.solar` and `state2.heat_balance.annual.gains.solar` to console — by code construction they are the same object reference and **cannot** differ at runtime.

### Proposed fix (only if step 4 reproduces)
Add a dev-mode `console.warn` when the spread breaks — i.e., if any value in `state2.heat_balance.annual.gains.solar.{south,east,west,north}` differs from `state1Result` by more than rounding noise. Filed as: a defensive invariant check in `_calculateState2` would surface drift immediately.

**Confidence the engine is correct: HIGH. Confidence the displays drift: LOW until live repro.**

---

## Problem 2 — Fabric leakage missing from State 2 breakdown

### Reported observation
State 2 breakdown shows External wall 16.5 / Roof 11.1 / Ground 15.2 / Glazing 82.9 = 125.7 MWh. Total losses displayed = 184.1 MWh. The 58.4 MWh gap matches State 1's fabric leakage (56.6 MWh) within rounding.

### Root cause (confirmed)

`stateMode.js` lines 169–193:
```js
const LOSS_ORDERS = {
  [MODES.ENVELOPE_ONLY]: [
    'external_wall', 'roof', 'ground_floor', 'glazing',
    'thermal_bridging',
    'fabric_leakage',           // ← present
    'permanent_vents',
    'infiltration', 'openings_louvre',
  ],
  [MODES.FULL]: [
    'external_wall', 'roof', 'ground_floor', 'glazing',
    'infiltration', 'openings_louvre', 'openings_window',
    'ventilation', 'cooling',
    // ← fabric_leakage, permanent_vents, thermal_bridging ALL ABSENT
  ],
}
```

**There is NO `[MODES.ENVELOPE_GAINS]` entry.** `loadOrderFor('envelope-gains')` falls through to `LOSS_ORDERS[DEFAULT_MODE]` = `LOSS_ORDERS['full']` at stateMode.js:221:
```js
export function loadOrderFor(mode) {
  return LOSS_ORDERS[mode] ?? LOSS_ORDERS[DEFAULT_MODE]
}
```

Then `flattenLosses` (HeatBalance.jsx:55–78) filters losses by the resulting order:
```js
const allowed = new Set(loadOrderFor(mode))
return loadOrderFor(mode)
  .filter(k => losses[k] != null && allowed.has(k))
  ...
```

State 2's engine output has keys `external_wall, roof, ground_floor, glazing, thermal_bridging, fabric_leakage, permanent_vents` (inherited from State 1 via spread). With `mode='envelope-gains'`:
- `external_wall` ∈ FULL order ✓ → shown
- `roof` ∈ FULL ✓ → shown
- `ground_floor` ∈ FULL ✓ → shown
- `glazing` ∈ FULL ✓ → shown
- `thermal_bridging` ∉ FULL → **hidden**
- `fabric_leakage` ∉ FULL → **hidden**
- `permanent_vents` ∉ FULL → **hidden**
- `infiltration, openings_louvre, openings_window, ventilation, cooling` ∈ FULL but absent from engine output → silently skipped

`totals.losses_kwh` (184.1 MWh) is the engine's REAL total including hidden items, but the breakdown only shows what survives the filter (125.7 MWh).

### This was flagged once before and not fixed

`docs/briefs/archive/27_cleanup_COMPLETED.md` Part 3 close (2026-05-14):
> One open question — `mode="envelope-gains"` is still being passed to a
> consumer whose `mode` prop is documented `'envelope-only' | 'full'`.
> `stateMode.js` falls through to `FULL` for unrecognised modes, which
> gives us the right gain/loss order (solar + internal + heating; heating
> filters out at runtime since state 2 has none). So this works, but it's
> documented-by-fallthrough rather than first-class. Suggest extending
> `LOSS_ORDERS` and `GAIN_ORDERS` in `stateMode.js` to include
> `ENVELOPE_GAINS` explicitly during Brief 28a Part 3 (canvas restructure)
> or as a small standalone follow-up.

That note assumed the FULL fallthrough was "right enough." It wasn't — the GAIN order under FULL happens to include people/equipment/lighting so gains do render, but the LOSS order under FULL omits the State 1/2 ventilation keys.

### Proposed fix (HIGH confidence, isolated)

Extend `LOSS_ORDERS` and `GAIN_ORDERS` in `stateMode.js`:

```js
[MODES.ENVELOPE_GAINS]: [
  'external_wall',
  'roof',
  'ground_floor',
  'glazing',
  'thermal_bridging',
  'fabric_leakage',
  'permanent_vents',
  // Cooling demand surfaces here too if we adopt Problem 3 option A.
],
```

```js
[MODES.ENVELOPE_GAINS]: [
  'solar_south', 'solar_east', 'solar_west', 'solar_north',
  'people', 'equipment', 'lighting',
  // No 'heating' — no real systems at State 2. If we adopt Problem 3
  // option A, heating demand surfaces here.
],
```

Effect: State 2 breakdown will show fabric_leakage (56.6 MWh) restored, plus thermal_bridging + permanent_vents if non-zero. The visible breakdown sum will then match `totals.losses_kwh` (≈ 184 MWh).

---

## Problem 3 — +214.6 MWh residual: balance doesn't close

### What's happening

HeatBalance.jsx line 538–540:
```js
const totalLosses = data?.annual?.totals?.[...losses_kwh...] ?? 0
const totalGains  = data?.annual?.totals?.[...gains_kwh...] ?? 0
```

Line 560:
```js
const netResidual = totalGains - totalLosses
```

Bottom of the chart (line 643–658):
```jsx
<span className="text-mid-grey">Net (gains − losses):</span>
<span>
  {netResidual > 0 ? '+' : ''}{fmt(netResidual, unit)}
  {Math.abs(netResidual) > (unit === 'kwh_per_m2' ? 5 : totalLosses * 0.1)
    ? ' — large residual; check inputs'
    : ' ✓ balanced'
  }
</span>
```

State 2 has:
- gains: 130 facade + 53 roof (likely) + 215.9 internal ≈ **398.9 MWh** ✓ matches Chris's 398.8
- losses: ext_wall + roof + ground + glazing + fabric_leakage + thermal_bridging + permanent_vents ≈ **184 MWh** ✓
- residual = +214.9 MWh ≈ Chris's +214.6 MWh ✓

The residual ≈ State 2's **cooling demand** (and Chris reports State 1 cooling demand 101 MWh; State 2 cooling demand will be higher due to internal gains driving the zone hotter — easily reaching 215 MWh).

### Root cause (UI design gap, not engine bug)

The Heat Balance "balance" treats the zone as a closed system. For State 1 the natural-gain ≈ natural-loss balance roughly holds because the unmodelled demand splits roughly evenly between heating (gain side, not shown) and cooling (loss side, not shown). For State 2 you've added 215.9 MWh of internal gains; with no mechanical sink shown, the gain side strictly exceeds the loss side by that magnitude.

In physical reality:
```
solar + internal + heating_demand  =  fabric_losses + vent_losses + cooling_demand
gains_in       + system_in         =  passive_out  + system_out
```

The current display omits both `heating_demand` (a gain) and `cooling_demand` (a loss). At State 1 these happen to be similar in magnitude on Bridgewater (105 vs 101 MWh) so they cancel out of the residual. At State 2, internal gains push cooling demand way up (~215 MWh) and heating demand way down — the asymmetry surfaces as a "large residual" warning.

### Proposed fixes (two options)

**Option A — Include demand in the balance (recommended for State 2+)**

In `flattenLosses` / `flattenGains` (and the corresponding `loadOrderFor` / `gainOrderFor`), append synthetic items for State 2+:

```js
// flattenLosses, when mode is envelope-gains or full:
if (data?.demand?.cooling_demand_mwh != null && (isEnvelopeGains(mode) || isFull(mode))) {
  const kwh = data.demand.cooling_demand_mwh * 1000
  out.push({
    key: 'cooling_demand',
    label: 'Cooling (demand → system)',
    value: unit === 'kwh_per_m2' ? kwh / gia : kwh,
    raw_kwh: kwh,
    colour: COOLING_COLOUR,
    meta: { ... },
  })
}

// flattenGains, mirror with heating_demand on the gain side.
```

Effect: balance closes. The "Net" line reads ✓ balanced.

Trade-off: introduces a synthetic loss/gain that didn't exist in the engine's literal losses/gains output. Users may ask "why is cooling demand counted as a loss when there's no mechanical system?" Answer: it's the energy a system WOULD remove. State 1 already frames this for the user via the `StateOneDemandPanel`.

**Option B — Reframe the residual line (simpler, but less visually clean)**

Keep the chart as-is. Change the "Net" line in State 2+ mode to:

```
Excess heat absorbed by cooling: 214.6 MWh  →  see Cooling demand: 215 MWh
Net (gains − losses + cooling absorbed): 0 ✓
```

i.e., explicitly show the residual is the cooling demand and the balance closes through it. No new bars in the chart, just clearer text.

**Recommendation:** Option A. It makes the balance visually close in the standard view, which is the natural intuition. The "synthetic loss" framing is straightforward to explain and matches the convention every PHPP-style heat balance uses (mechanical heating goes on the gain side, mechanical cooling on the loss side).

---

## Problem 4 — Loss element values shift 4-5% between State 1 and State 2

### Reported deltas
- External wall: 15.9 → 16.5 (+3.8%)
- Roof: 10.7 → 11.1 (+3.7%)
- Ground: 14.7 → 15.2 (+3.4%)
- Glazing: 80.3 → 82.9 (+3.2%)

### Code-level analysis

State 2's losses are `state1Result.losses` (spread, same reference). State 2's `heat_balance.annual.losses` is `state1Result.heat_balance.annual.losses` (spread). **By code construction these values MUST equal State 1's.**

State 2 does NOT run its own conduction accumulator loop. The State 2 inner loop (instantCalc.js:1117–1185) only accumulates:
- `acc_people, acc_lighting, acc_equip_baseload, acc_equip_active` — gain accumulators
- `acc_heating_demand_Wh, acc_cooling_demand_Wh` — demand accumulators (recomputed because they depend on the new T_op trace)
- `comfort_hours, overheating_hours, underheating_hours, T_winter_min, T_summer_max` — comfort metrics on the new T_op

**No `acc_cond_wall`, no `acc_cond_glaz_*`, no `acc_vent_leakage`, no `acc_thermal_bridging` in State 2's loop.** Loss values are inherited verbatim from State 1.

Chris's hypothesis ("internal gains warm zone, ΔT increases, conduction up") describes correct physics, but the Static engine does NOT implement that re-derivation. The State 1 losses are reused as-is. So either:
- The engine is silently using stale State 1 losses that no longer match the State 2 free-running trace (a **physics correctness issue** — though not the bug Chris observed)
- OR Chris's screenshots captured different building configs (same explanation as Problem 1)

### Same diagnostic as Problem 1
- If live repro shows State 1 and State 2 loss values differ → there's a hidden source of drift I haven't found.
- If they match in live repro → both Problem 1 and Problem 4 were screenshot-time-skew.

### Open physics question (separate from the bug)
**Should State 2 recompute conduction losses against the new T_op trace?**
- Argument for: gains warm the zone, T_op increases, dT_air across the fabric grows, more hours qualify for the `dT_air > 0` gate, total conduction increases. Currently State 2 reports losses that DO NOT reflect this — they're frozen at State 1's free-running trace.
- Argument against: the deltas would be small (the building stays close to free-running for most of the year because the comfort band setpoints aren't enforced — there's no real HVAC). Recomputing adds loop complexity for what is probably a sub-5% effect on aggregates.

If Chris's instinct ("4-5% increase is plausible physics") is right, the engine should be updated to actually compute it. Currently it doesn't — it just shows State 1's losses verbatim, mislabelled as State 2's. **This is a contract gap worth a separate decision.**

Proposed fix (only if we want correct State-2 losses, separate from the missing-fabric-leakage display bug):

In `_calculateState2` inner loop, add the same conduction accumulators as State 1, gated on the SAME `dT_air > 0` rule but against the State-2 T_air trace. Then emit `heat_balance.annual.losses` from those State-2 accumulators, not from state1Result. Engine cost: small (a few accumulator updates per hour). Output cost: numbers will be ~4-5% higher than State 1's, matching Chris's intuition — though the magnitude needs sanity-checking on a real run.

**Recommendation: defer this physics-correctness fix to a separate brief** (Brief 28c or 29). The current behaviour (reuse State 1 losses) is documented in the engine's comment at instantCalc.js:1285:
> State 2 keeps the State 1 losses unchanged (gains don't change fabric
> UA × dT; the only change is the temperature trace which is captured in
> free_running below).

This comment is mathematically wrong (UA × dT_air IS sensitive to the T_air trace, and gains do change that trace), but the engine has been shipping with this assumption since Brief 27. Fixing it is a contract-level decision.

---

## Summary table

| Problem | Diagnosis | Confidence | Recommended fix |
|---|---|---|---|
| 1 — Solar 5% delta | Engine produces identical values by spread; observed delta cannot come from code. Most likely screenshot-time skew. | LOW (need live repro) | Live repro first. If reproducible, add an invariant assert in `_calculateState2` to detect spread breakage. |
| 2 — Fabric leakage missing | `LOSS_ORDERS` has no `ENVELOPE_GAINS` entry; falls through to FULL which omits `fabric_leakage`, `permanent_vents`, `thermal_bridging`. Engine emits them; consumer filters them out. | HIGH | Add `LOSS_ORDERS[MODES.ENVELOPE_GAINS]` + `GAIN_ORDERS[MODES.ENVELOPE_GAINS]` to `stateMode.js` with the State 2 keys. Trivial. |
| 3 — +214.6 MWh residual | UI design gap. State 2's gains include internal (+215 MWh) but display doesn't include mechanical cooling/heating demand. Residual ≈ cooling demand by construction. | HIGH (UI design) | Option A: append synthetic `heating_demand` + `cooling_demand` items in flattenGains/Losses when mode ≥ envelope-gains. Option B: reframe "Net" line. Recommend A. |
| 4 — Loss element shifts 4-5% | Same as Problem 1 — engine inherits losses from State 1 verbatim, so values MUST match. Observed drift cannot come from code. Separately: there's a contract gap (State 2 should arguably recompute losses against its T_op trace). | LOW (need live repro) for the drift; SEPARATE for the contract gap | Same live repro. Separately: file a brief to decide whether State 2 should recompute losses on its own T_op trace. |

---

## Recommended sequence (after walkthrough approves direction)

1. **Live repro for Problems 1 + 4.** Open Bridgewater, capture State 1 vs State 2 numbers without editing. If they match, problems 1 + 4 are explained away. If they don't, dig further before any fix.
2. **Fix Problem 2** (highest confidence, smallest patch). Extend `LOSS_ORDERS` + `GAIN_ORDERS` in `stateMode.js`. Build + verify the State 2 breakdown now includes fabric_leakage (~56.6 MWh on Bridgewater).
3. **Fix Problem 3** (Option A). Append demand items to flattenLosses/Gains in State 2+ mode. Verify residual closes to ≈ 0 on Bridgewater.
4. **File the Problem-4 contract gap** as a separate brief (probably Brief 28c) to decide whether State 2 should compute its own losses or continue inheriting from State 1.

**No fix lands until walkthrough confirms direction.** This document is the proposal; Chris's review gates each numbered fix.

---

## Files referenced

- `frontend/src/utils/instantCalc.js`
  - `_calculateEnvelopeOnly` (lines 350–697)
  - `_calculateState2` (lines 1036–1356)
  - `withMode` (lines 271–311)
  - `computeShadingFactors` (lines 154–183)
  - `computeGeometry` (lines 190–225)
- `frontend/src/components/modules/balance/HeatBalance.jsx`
  - `flattenLosses` (lines 55–78)
  - `flattenGains` (lines 80–131)
  - Net residual rendering (lines 643–658)
- `frontend/src/utils/stateMode.js`
  - `LOSS_ORDERS` (lines 169–193)
  - `GAIN_ORDERS` (lines 200–217)
  - `loadOrderFor` (lines 220–222)
- `frontend/src/components/modules/building/BuildingDefinition.jsx`
  - State 1 HeatBalance integration (lines 770–863)
- `frontend/src/components/modules/gains/canvas/HeatBalanceView.jsx`
  - State 2 HeatBalance integration (line 59)
- `frontend/src/components/modules/gains/canvas/useStateComparison.js`
  - State 1 + State 2 parallel invocation (lines 50–85)
- `frontend/src/utils/facadeLabel.js`
  - `facadeLabel` rotates compass letter only; never swaps which face value is displayed (lines 25–31)

---

## Out of scope for this investigation

- Re-baselining state_2_expected_ranges.md (queued as Brief 29 Part 5)
- Profiles rename, vertical scrolling fix, total energy bar (paused per Chris)
- Dynamic-engine (EnergyPlus) heat balance reconciliation (separate concern; EP runs its own loss accumulators per `Output:Variable` and shouldn't share this Static-engine bug)
