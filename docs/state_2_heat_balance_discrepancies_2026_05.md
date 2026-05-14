# State 2 Heat Balance discrepancies — investigation (2026-05-14)

**Trigger:** Chris's walkthrough comparing Building module State 1 Heat Balance
vs Internal Gains State 2 Heat Balance on Bridgewater surfaced four concrete
problems with the numbers. Investigation read-only; no fix applied yet.

---

## RESOLUTION (2026-05-14, after fix batch + live repro)

Status of each problem after the fix batch landed and was validated in the
browser against Bridgewater:

| Problem | Status | Evidence |
|---|---|---|
| 1 — Solar 5% numeric drift | **RESOLVED** — root cause was `getGValue` reading only `item.config_json.g_value` while `BuildingDefinition.jsx` stored library items as-is (with `g_value` at top level). Engine fell back to `DEFAULT_G_VALUE = 0.40` for Building module while `useStateComparison` wrapped items as `config_json: c.config_json ?? c` so Internal Gains saw the real 0.42. Exact ratio: 0.40/0.42 = 0.9524 ≈ observed 5% drift. **Fix:** `getGValue` accepts both `item.g_value` (top level) and `item.config_json.g_value` (nested). Same shape fix applied to `thermalMass.js::resolveCmass` for the `layers` lookup (caused a 0.31% loss-side residual drift). | Live repro evidence below: Building solar.north.kwh = 57488.5; Internal Gains solar.north.kwh = 57488.5 (byte-identical). |
| 1a — Facade compass label asymmetry | **RESOLVED** — `HeatBalanceView.jsx` now passes `orientationDeg={params.orientation}` to `HeatBalance`. Internal Gains labels rotate with orientation matching Building. | Live repro: both show "F1 (NE)" at orientation 42°. |
| 2 — fabric_leakage / permanent_vents / thermal_bridging missing from State 2 breakdown | **RESOLVED** — `stateMode.js` `LOSS_ORDERS` and `GAIN_ORDERS` now have explicit `[MODES.ENVELOPE_GAINS]` entries with the State 2 keys. Engine emits these keys (inherited from State 1 via spread); consumer's `flattenLosses` no longer filters them out. | Live repro: Internal Gains breakdown shows External wall / Roof / Ground floor / Glazing / Fabric leakage (58.7 MWh) — all present. |
| 3 — Large residual (mechanical demand not in display) | **PARTIALLY RESOLVED** — synthetic `heating_demand` (gain side) and `cooling_demand` (loss side) appear in the breakdown for State 2+ modes. Totals include them via the `meta.synthetic` flag in the useMemo. The "Net (gains − losses)" still shows a non-zero residual (-102.7 MWh on Bridgewater) because (a) State 2 inherits State 1's static losses without recomputing against its T_op trace (Problem 4 contract gap, queued as Brief 28c), and (b) the engine's cooling-demand formula `Q_to_mass + UA × outdoor_excess` overestimates by counting full gain energy as needing removal rather than the excess above mass-storage capacity. **The residual is now an honest reflection of upstream engine behaviour rather than a hidden display omission.** Filed: Brief 28c (loss recompute) + a separate brief on cooling-demand formulation. | Live repro: Heating 9.8 MWh and Cooling 327.1 MWh appear as labelled items in the breakdown. |
| 4 — Loss element shifts 4-5% between State 1 and State 2 | **SCREENSHOT-SKEW ARTIFACT (root-cause confirmed)** — the original screenshot showed lower Building values because of Problem 1's g_value bug (Building module used g=0.40, gave lower solar AND lower loss-integration because the T trace was cooler). After the fix, Building module's losses now match the engine (ext_wall 16515.4, roof 11110, ground 15276.3, glazing 83166.6, fabric_leakage 58661) — byte-identical to Internal Gains' State 1 baseline. The "is there a real engine-vs-itself contract gap?" question (State 2 should arguably recompute losses against its own T_op trace) is still **open** as Brief 28c. | Live repro: byte-identical shared physics across both modules. |

### Live-repro evidence — side-by-side from React props after fix batch

Captured by walking the React tree to read `HeatBalance.liveData` directly
(no display rounding). Building module rendered at /building with the Heat
Balance pane active. Internal Gains rendered at /gains with the Heat
balance tab active. Same browser session, same backend, same persisted
config (`infiltration_ach=0.2`, the value restored before the fix batch).

| Field | Building module (envelope-only) | Internal Gains module (envelope-gains) | Byte-identical? |
|---|---:|---:|:---:|
| `orientationDeg` (HeatBalance prop) | 42 | 42 | ✓ |
| `solar.north.kwh` (F1) | 57488.5 | 57488.5 | ✓ |
| `solar.south.kwh` (F3) | 71400.5 | 71400.5 | ✓ |
| `solar.east.kwh` (F2) | 4397.9 | 4397.9 | ✓ |
| `solar.west.kwh` (F4) | 3132.5 | 3132.5 | ✓ |
| `losses.external_wall.kwh` | 16515.4 | 16515.4 | ✓ |
| `losses.roof.kwh` | 11110.0 | 11110.0 | ✓ |
| `losses.ground_floor.kwh` | 15276.3 | 15276.3 | ✓ |
| `losses.glazing.kwh` | 83166.6 | 83166.6 | ✓ |
| `losses.fabric_leakage.kwh` | 58661.0 | 58661.0 | ✓ |
| `losses.thermal_bridging.kwh` | 0 | 0 | ✓ |
| `totals.losses_kwh` | 184729.4 | 184729.4 | ✓ |
| `metadata.gia_m2` | 3457 | 3457 | ✓ |
| **Displayed facade compass labels** | F1 NE / F2 SE / F3 SW / F4 NW | F1 NE / F2 SE / F3 SW / F4 NW | ✓ |

State 2-only items (not in Building module, expected):

| Field | Internal Gains module | Notes |
|---|---:|---|
| `gains.internal.people.kwh` | ~118,900 | State 2 only |
| `gains.internal.lighting.kwh` | ~40,900 | State 2 only |
| `gains.internal.equipment.kwh` | ~56,100 | State 2 only |
| Synthetic `heating_demand` item | 9.8 MWh | Brief 28a Part 5 Finding HB3 fix |
| Synthetic `cooling_demand` item | 327.1 MWh | Same fix |
| State 2 free-running mean | 32.8 °C | gains warm zone vs State 1 21.2 °C |

Every shared-physics row in the table above is ✓ Identical. **The zero-tolerance contract on shared envelope physics holds.**

### Fixes shipped

1. `frontend/src/components/modules/gains/canvas/HeatBalanceView.jsx:14-20` —
   import `ProjectContext`, read `params.orientation`, pass `orientationDeg`
   to `HeatBalance`.
2. `frontend/src/utils/stateMode.js` `LOSS_ORDERS`/`GAIN_ORDERS` — explicit
   `[MODES.ENVELOPE_GAINS]` entries. Loss order now includes
   `external_wall, roof, ground_floor, glazing, thermal_bridging,
   fabric_leakage, permanent_vents, cooling`. Gain order now includes
   `solar_south..north, people, equipment, lighting, heating`.
3. `frontend/src/components/modules/balance/HeatBalance.jsx`
   `flattenLosses` + `flattenGains` — synthetic `cooling`/`heating` items
   sourced from `data.demand.{cooling,heating}_demand_mwh` with
   `meta.synthetic: true` flag.
4. `frontend/src/components/modules/balance/HeatBalance.jsx` totals memo —
   iterates loss/gain items, adds `meta.synthetic` items into the totals
   so the "Net" line reflects what the breakdown shows.
5. `frontend/src/utils/instantCalc.js::getGValue` — accept both
   `item.g_value` (top level, served by `/api/library/constructions` list
   endpoint) and `item.config_json.g_value` (nested, served by detail
   endpoint or wrapped by `useStateComparison`).
6. `frontend/src/utils/thermalMass.js::resolveCmass` —
   `rawLayers = constructionItem.layers ?? constructionItem.config_json?.layers`.
   Same shape robustness as `getGValue`.
7. Persisted Bridgewater config: `infiltration_ach` restored 0.1 → 0.2 via
   `PUT /api/projects/{id}` before the fix-batch verification run.

### What's still open

- **Brief 28c — State 2 loss-recompute contract gap.** State 2 currently
  inherits State 1's losses via `losses: state1Result.losses`. Physics
  suggests State 2 losses should be slightly higher (warmer T_op trace
  → more dT_air-positive hours → more conduction). Documented in this
  doc's Problem 4 section. Needs first-principles validation against
  the hand-calc spreadsheet before scope is set.
- **Cooling-demand formula refinement.** The current
  `Q_gain_at_upper = Q_to_mass + UA × outdoor_excess` overestimates by
  counting all hourly gain energy as needing removal, ignoring mass
  storage. This is why the Net residual didn't close to ≈ 0 even
  after Problem 3. Sub-item of Brief 28c, or its own brief.
- **Invariant assertion in `_calculateState2`** — recommended in earlier
  versions of this doc. Now lower priority since `getGValue` +
  `resolveCmass` are robust to both library-item shapes. Still worth
  adding as defence against future drift.

---

**Scope:** Static engine only (`frontend/src/utils/instantCalc.js`) + its
consumer (`frontend/src/components/modules/balance/HeatBalance.jsx`) + mode
routing (`frontend/src/utils/stateMode.js`). EnergyPlus side unaffected — this
is purely the Static-engine output and its in-browser display.

---

## ⚠ Discipline note (2026-05-14, Chris's correction)

**Zero tolerance for State-to-State drift on shared physics.** Solar gain
(which depends only on envelope inputs) MUST be byte-identical between
State 1 and State 2 displays. Facade compass labels MUST be identical
across all States. Any difference is a bug regardless of magnitude. The
±15% tolerance discussed earlier in `docs/state_contracts.md` applies
only to engine-vs-first-principles, **never** to engine-vs-itself.

This re-frames Problems 1, 1a, and 4 below: the question is not "is the
delta acceptably small?" but "is there *any* path through which State 1
and State 2 can disagree on the same envelope physics?" If yes — bug.
If no — prove it with byte-identity invariants.

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

## Problem 1a — Facade compass labels asymmetric between State 1 and State 2

### Confirmed bug regardless of numeric outcome

`solarLabel(face, orientationDeg)` (`facadeLabel.js:34`) renders the
compass letter by rotating `BASE_ANGLES[faceNum] + orientationDeg`.

- **Building module** (`BuildingDefinition.jsx:860`) passes
  `orientationDeg={orientationDeg}` where `orientationDeg = Number(params.orientation ?? 0)`.
  For Bridgewater (orientation 42°): F1 (north) → "NE", F3 (south) → "SW", etc.
- **Internal Gains module** (`HeatBalanceView.jsx:59`) passes
  **no `orientationDeg` prop**, so it defaults to 0° (HeatBalance.jsx:495).
  For Bridgewater (same orientation 42°): F1 (north) → "N", F3 (south) → "S".

**Same facade, same building, same orientation, different label.**

Chris's screenshots reflect this: State 1 shows "F1 NE / F2 SE / F3 SW /
F4 NW"; State 2 shows "F1 N / F2 E / F3 S / F4 W". Per the zero-tolerance
rule on label consistency, this is a definite bug independent of any
numeric drift question.

### Proposed fix (HIGH confidence, one-line patch)

`frontend/src/components/modules/gains/canvas/HeatBalanceView.jsx:59`:
```diff
-<HeatBalance liveData={state2?.heat_balance} mode="envelope-gains" />
+<HeatBalance
+  liveData={state2?.heat_balance}
+  mode="envelope-gains"
+  orientationDeg={Number(params?.orientation ?? 0)}
+/>
```

Reads `params` from `ProjectContext` (already imported by `HeatBalanceView` siblings).

After the fix, both modules will render the same facade with the same compass letter at the same orientation.

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

### Working hypothesis (subject to live repro)

The 5% delta cannot come from the engine code on a single building config.
The current live engine extract (see `docs/validation/bridgewater_state1_engine_outputs_2026_05.md`) emits facade values that match Chris's State 2 screenshot exactly (57.5 / 4.4 / 71.4 / 3.1) and do NOT match the State 1 screenshot (54.8 / 4.2 / 68.0 / 3.0). The roughly-uniform ~5% per-facade pattern is consistent with a single geometric input changing between the two screenshots — e.g., a small wwr edit, a shading-fin removal, or an orientation tweak that proportionally rescales irradiance projection.

**Per zero-tolerance discipline this is not yet resolved**, only narrowed:

- If live repro (Chris running the comparison in one session, no edits) shows matching values → numeric drift is screenshot-skew; the engine path is byte-identical as the code mandates. Still need an explicit invariant test to *prove* this for all input configurations (see invariance runbook below).
- If live repro shows real drift in the same session → hidden source of divergence to be found.

### Diagnostic steps (for Chris's live repro)

1. Open Bridgewater. Navigate to Building → Heat Balance. Record the four facade solar values + losses values (kWh, not kWh/m²·yr — same unit makes byte comparison cleaner).
2. Without editing anything (no input change, no schedule edit, no re-save), navigate to Internal Gains → Heat balance tab. Record again.
3. **Expected per code (zero-tolerance):** all values byte-identical to step 1.
4. If they match → write up the result. Fix Problem 1a (label asymmetry) anyway.
5. If they don't match → halt. Open React DevTools, inspect `useStateComparison`'s `state1` vs Building module's `instantResult`, locate where they diverge.

### Defensive invariant (recommended either way)

Even if the live repro confirms byte-identity today, the engine should *prove* this invariant programmatically. Two options:

1. **Engine-internal assertion** in `_calculateState2`: after computing `state1Result`, compare `state1Result.heat_balance.annual.gains.solar` against a fresh `_calculateEnvelopeOnly(withMode(building, 'envelope-only'), ...)` invocation. In dev mode, `console.warn` on any drift. In production, silent. Implementation cost: trivial — one extra envelope-only call per engine run; ~15 ms on Bridgewater.
2. **Cross-module React assertion** in `HeatBalanceView.jsx`: assert `state1.heat_balance.annual.gains.solar === state2.heat_balance.annual.gains.solar` (object reference equality) in dev. Cheaper than option 1 (no recompute) but only checks the symptom, not the engine-internal contract.

Recommend option 1 — engine-internal — because it surfaces drift even when the consumer code is silent. Filed as a candidate for the invariance test runbook (`docs/validation/state_1_invariance_tests.md`).

**Confidence the engine is correct on Bridgewater today: HIGH (extract proves it). Confidence the engine path is correct for arbitrary inputs: NOT YET PROVEN — need invariance tests + invariant assertion.**

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
- If live repro shows State 1 and State 2 loss values differ in the same session → halt; hidden source of drift.
- If they match → byte-identity confirmed on Bridgewater. Still need the invariance assertion (option 1 under Problem 1) to prove it for arbitrary inputs.

**Per zero-tolerance:** byte-identity is the bar. The validation extract confirms current Bridgewater, but doesn't prove the invariant across rotations / different fabric / different shading. The break-the-building tests in the runbook (`state_1_invariance_tests.md`) exercise that span.

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
| 1a — Facade label asymmetric (NE/SE/SW/NW vs N/E/S/W) | `HeatBalanceView` doesn't pass `orientationDeg` to `HeatBalance`; defaults to 0° regardless of `params.orientation`. | HIGH (confirmed by code reading) | One-line patch in `HeatBalanceView.jsx` to pass `orientationDeg={params.orientation}`. Zero-tolerance bug — fix in same patch as Problem 2. |
| 1 — Solar 5% numeric delta | Engine produces identical values by spread; observed delta cannot come from code on a single config. Current live engine extract matches Chris's State 2 numbers exactly, not State 1's. Working hypothesis: input changed between screenshots. | HIGH that engine is correct today on Bridgewater (extract proves it); MEDIUM that the engine path is correct across all inputs (need invariance tests) | Live repro first. Add a dev-mode invariant assertion in `_calculateState2` that recomputes envelope-only and compares against `state1Result.heat_balance.annual.gains.solar` byte-for-byte. |
| 2 — Fabric leakage missing | `LOSS_ORDERS` has no `ENVELOPE_GAINS` entry; falls through to FULL which omits `fabric_leakage`, `permanent_vents`, `thermal_bridging`. Engine emits them; consumer filters them out. | HIGH (confirmed by code reading) | Add `LOSS_ORDERS[MODES.ENVELOPE_GAINS]` + `GAIN_ORDERS[MODES.ENVELOPE_GAINS]` to `stateMode.js` with the State 2 keys. Trivial. |
| 3 — +214.6 MWh residual | UI design gap. State 2's gains include internal (+215 MWh) but display doesn't include mechanical cooling/heating demand. Residual ≈ cooling demand by construction. | HIGH (UI design) | Option A: append synthetic `heating_demand` + `cooling_demand` items in flattenGains/Losses when mode ≥ envelope-gains. Option B: reframe "Net" line. Recommend A. |
| 4 — Loss element shifts 4-5% | Same as Problem 1 — engine inherits losses from State 1 verbatim, so values MUST match. Live engine extract confirms current Bridgewater values match the State 2 screenshot. Separately: contract gap exists (State 2 arguably should recompute losses against its T_op trace — Brief 28c). | HIGH that engine is correct today on Bridgewater; MEDIUM across input space; SEPARATE for the contract gap | Same live repro + same invariant assertion as Problem 1. Brief 28c for the contract gap. |

---

## Recommended sequence (after walkthrough approves direction)

1. **Live repro for Problems 1 + 4.** Open Bridgewater, capture State 1 vs State 2 numbers without editing. Per zero-tolerance, this is a binary pass/fail — values must match byte-identically for the same config. If they match, the engine is correct today on Bridgewater; still need invariance tests (next item) before claiming the engine path is correct in general.
2. **Run invariance test runbook.** `docs/validation/state_1_invariance_tests.md` defines break-the-building tests (double GIA, rotate 90°/180°, zero U-values, zero glazing, infiltration extremes, comfort band widen, weather extremes, State 2 occupancy/LPD/baseload extremes). Each tests a different region of input space against zero-tolerance State-to-State byte-identity. Pass criteria: no State-to-State drift on shared physics across any test.
3. **Fix Problem 1a + Problem 2 together.** Both are one-line patches in adjacent files. Trivial.
4. **Fix Problem 3** (Option A). Append demand items to flattenLosses/Gains in State 2+ mode. Verify residual closes to ≈ 0 on Bridgewater.
5. **Add invariant assertion in `_calculateState2`** to prove byte-identity at runtime (option 1 under Problem 1). Catches drift the moment any future change introduces it.
6. **File Problem-4 contract gap** as Brief 28c, gated on validation spreadsheet outcome.

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
