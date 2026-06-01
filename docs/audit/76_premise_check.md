# Brief 76 premise check — read-only diagnostic (2026-06-01)

Code (this agent) verifying the architect's Brief 76 hypothesis before commit. Chris flagged a regression: an old report Sankey image (~last week) showed per-system ventilation extract ribbons on the OUT-Losses side of the Heat Balance Sankey ("MVHR GF", "Extract Bedrooms", "Extract WCs"). Today's Bridgewater Heat Balance shows none. Architect proposed Brief 76 to extend the State 3 dispatch gate at `instantCalc.js:6668` on the hypothesis that Bridgewater dispatches to inline-legacy.

**TL;DR — the architect's hypothesis is wrong. The dispatch gate isn't the bug.** Bridgewater DOES reach State 3 already. The actual regression is a v25-emptiness bug introduced by Brief 72 PB's Bridgewater re-creation, surfacing through `_calculateState2:2921` where the per-system ventilation iterator still reads `systems_config_v25.ventilation` as its base. Fix sits one level deeper than Brief 76 proposes.

---

## Q1 — Which engine path is Bridgewater actually dispatching to?

**Answer: State 3 — `_calculateState3`. The architect is wrong about this.**

The Heat Balance tab on `/systems` is rendered through `SystemsModule.jsx`. At L178-188 it calls `calculateInstant` with:

```js
calculateInstant(
  params, constructions ?? {}, systems ?? {},
  libraryData, weatherData, hourlySolar, null,
  { mode: 'full', comfortBand, engine: 'v2.5', _skipInterventions: true },
)
```

Note `engine: 'v2.5'`. That opt-in fires the State 3 branch of the dispatch gate regardless of `hasV25Config && hasV25Library`. Probe matrix from `scripts/_brief76_premise_check.mjs` confirms (`docs/audit/76_premise_check_output.json`):

| Case | `options.engine` | `hasV25Config` | `hasV25Library` | Dispatch |
| --- | --- | --- | --- | --- |
| `/systems` live caller | `'v2.5'` | `false` | `true` (lib bundled) | **`_calculateState3`** ✓ |
| Probe-without-opt-in | undefined | `false` | true | inline-legacy (would crash) |

The `hasV25Config = false` finding IS real: Bridgewater's `building.systems_config_v25` is literally `null`. But `options.engine === 'v2.5'` short-circuits that — the engine reaches State 3 via the test/opt-in branch, not via auto-detect. The `result.state` in the engine output is `3` (Brief 75 P1 anchor, reconfirmed in this probe).

So extending the State 3 dispatch gate (Brief 76's proposal) wouldn't change anything for `/systems`: it's already reaching State 3.

(Side note worth flagging: `_buildHeatBalance:6553` references `building` as a free variable that isn't in its lexical scope — `ReferenceError` in Node. Inline-legacy paths that call `_buildHeatBalance` would crash. The other live callers — `HeatBalanceTab.jsx:35`, `LiveResultsPanel.jsx:263`, `SystemSankey.jsx:125`, `SystemsLiveResults.jsx:294`, etc. — do NOT pass `engine: 'v2.5'`. Whether they actually reach `_buildHeatBalance` in the browser without crashing is a separate audit. Out of scope for this premise check, but worth noting — Brief 76's hypothesis about dispatch may be partially correct for those non-`/systems` routes, but the Heat Balance tab Chris is looking at isn't one of them.)

---

## Q2 — What is in `result.heat_balance.losses_at_setpoint.ventilation`?

**Answer: empty array `[]`.** The KEY EXISTS in `losses_at_setpoint` (alongside `external_wall`, `roof`, `ground_floor`, `glazing`, `fabric_leakage`, `permanent_vents`, `thermal_bridging`, `ventilation`, `natural_ventilation`, `internal_gains_bucketed`, `internal_gains_monthly`, `totals`, `setpoints_used`). It just contains zero entries.

For comparison, `consumption.brief40.ventilation.systems` has **3 entries** with full fields (`id`, `label`, `share_pct`, `sfp_w_per_lps`, `flow_rate`, `flow_rate_basis`, `fan_electrical_mwh`, `recovery_sensible_pct`, `recovery_latent_pct`, `recovered_heating_mwh`, `recovered_cooling_mwh`, `defrost_penalty_mwh`, `summer_bypass`). The v40 systems ARE in the result — just not in `losses_at_setpoint.ventilation`.

`losses.mech_ventilation` (Brief 74 P5 aggregate): `{ kwh: 0, kwh_per_m2: 0 }`.

---

## Q3 — What does the Heat Balance Sankey renderer iterate?

`HeatBalance.jsx:183-212` defines `appendPerSystemVent`:

```js
const ventSystems = setpoint?.ventilation ?? []   // L196
for (const v of ventSystems) {
  if ((v.heat_loss_kwh ?? 0) > 0.01) {
    const key = `ventilation_${v.name}`
    losses[key] = { kwh: v.heat_loss_kwh, kwh_per_m2, _label: v.name }
    orderWithNew.push(key)
  }
}
```

So the renderer iterates `losses_at_setpoint.ventilation` per system. It's called both inline (L215, when the load order's `ventilation` key appears) and at the end (L222) to catch envelope-modes that don't carry the legacy key.

**Brief 74 P5 guard at L194-195:** if `legacyLosses.mech_ventilation.kwh > 0.01`, skip per-system appending to avoid double-counting against the aggregate ribbon. On Bridgewater both are 0, so the guard short-circuits to running the loop — but the loop sees an empty array. No ribbons emit.

Code reads `losses_at_setpoint.ventilation` per-system as the report would suggest. Renderer is correct. The data is missing.

---

## Q4 — Where is the actual bug?

**`_calculateState2:2921`:**

```js
const ventSystems = (building?.systems_config_v25?.ventilation ?? []).map(v => {
```

The per-system ventilation array that ultimately drives `losses_at_setpoint.ventilation` is built by mapping over `building.systems_config_v25.ventilation`. The surrounding code (L2897-2902, L2913-2959) constructs a v40 lookup and OVERLAYS v40 values (HRE per Brief 50 P6; flow per Brief 59 P1; SFP per Brief 60 A reconcile; summer_bypass per Brief 53 P2; label per the 2026-05-28 Chris-flag), but the BASE ITERATION is still v25. The v40 reads only ENRICH existing v25 entries via `v40VentMap.get(v?.id)`.

Bridgewater's `building.systems_config_v25` is `null` (probe Q1 confirms). So:
- `(null?.ventilation ?? [])` evaluates to `[]`
- `[].map(...)` returns `[]`
- `ventSystems` is empty
- `acc_mech_vent_heat_per_system` is empty (no per-system accumulators)
- `losses_at_setpoint.ventilation = ventSystems.map(...)` at L3987 → `[]`
- `losses.mech_ventilation` aggregate (Brief 74 P5) sums an empty array → `0`
- Total heating loss from vent → 0 → ventilation contributes nothing to heat balance
- Renderer iterates an empty array → no per-system ribbons

---

## Regression timeline (git history)

- **Before 2026-05-28:** Bridgewater had `systems_config_v25.ventilation` populated alongside `systems_config_v40.ventilation`. Engine read the v25 list, overlaid v40 values, emitted per-system ribbons. **The "report Sankey image" Chris is referencing dates from here.** v25 was the source of truth for vent-system identity throughout Briefs 28k → 60 / 64.

- **2026-05-28 22:34:** DB-loss incident (worktree backend shared `data/` with main via junction → empty schema WAL-checkpointed over live DB). The reason CLAUDE.md has the Brief 72 PA / Bible addendum.

- **2026-05-28 23:33 — commit `b9ae15b` "Brief 72 PB: re-create HIX Bridgewater post-DB-loss"** ← **the regression**. The seed script `scripts/_brief72_pb_recreate_bridgewater.mjs` (gone from disk; see commit message) did "POST /api/projects → PUT building (with full v40 systems config) → PUT systems (legacy v25 shell)." But the v25 shell PUT either (a) didn't populate ventilation systems, or (b) populated them with IDs that didn't match v40 IDs, or (c) the API call dropped the field. The commit message even logs the symptom honestly:

  > **(3) Added consumption-key diagnostic, confirmed vent still 0. Iterations exhausted.**

  The author accepted vent=0 as the new canonical anchor — the brief allowed that ("Accept new canonical baseline after 3 iterations"). The v25-emptiness was logged but not diagnosed.

- **2026-05-29 → 2026-06-01 (Briefs 72 P5, 73, 74):** All ran on this broken-v25 Bridgewater. None looked at the empty v25 ventilation list because they were each focused elsewhere:
  - Brief 72 P5 — auxiliary engine wiring (didn't touch vent).
  - Brief 73 — vent SHARE rule (engine guard at `systemsEngine.js:648`, not the v25 read).
  - Brief 74 P5 — added the `mech_ventilation` AGGREGATE on `heat_balance.annual.losses`, but the aggregate sums `acc_mech_vent_heat_per_system` which is empty. The Brief 74 P5 commit even notes Bridgewater's value reads 0 "because heating_demand=0" — that was an incomplete diagnosis. The TRUE reason it reads 0 is the empty `ventSystems` base array.

The architect's "this came from the v40 migration of Bridgewater" intuition is **correct in spirit** — Bridgewater really did transition into a v40-only state. But the architect placed the bug at the State 3 dispatch gate. The actual bug is **two layers down**: at the State 2 ventSystems builder, which the State 3 dispatch decision can't reach.

---

## Disagreement with Brief 76's proposed fix

The brief proposes extending the State 3 dispatch gate at `instantCalc.js:6668` to recognise v40-shape projects. **That fix would be a no-op for the symptom Chris is seeing.** Even with the dispatch gate extended:

- `/systems` Heat Balance already reaches State 3 (via `engine: 'v2.5'` opt-in at SystemsModule.jsx:187).
- State 3 inherits `losses_at_setpoint.ventilation` from State 2 via spread (`...state2Result` at `_calculateState3:5408`).
- State 2 builds `losses_at_setpoint.ventilation` from `ventSystems` at L3987.
- `ventSystems` is built from `building.systems_config_v25.ventilation` at L2921 — empty on Bridgewater.

The fix has to be at L2921, not at L6668. The State 2 ventilation builder needs to iterate v40 directly when v25 is empty (or replace v25 entirely — v40 is the source of truth per Briefs 40-42).

---

## What I think the right Brief 76 looks like

Rename and re-scope: **"Brief 76 — v40-as-source for State 2 ventSystems builder"**. Two parts:

### P1 — Engine fix at `_calculateState2:2921`

Change the base iteration from v25 to v40, with v25 as fallback for any field not yet present in v40 (`hours`, `library_id` — though `hours` could become a v40 field if needed). Pattern:

```js
const v25List = building?.systems_config_v25?.ventilation
const v40List = building?.systems_config_v40?.ventilation
const sourceList = (Array.isArray(v40List) && v40List.length > 0) ? v40List
                 : (Array.isArray(v25List) ? v25List : [])
const v25Map = new Map(
  (Array.isArray(v25List) ? v25List : []).map(v => [v?.id, v])
)
const ventSystems = sourceList.map(entry => {
  const isV40Base = entry === v40List?.find(x => x === entry)
  const v25Match = isV40Base ? v25Map.get(entry?.id) : null
  const v40Match = isV40Base ? entry : v40VentMap.get(entry?.id)
  // Read fields with v40-wins-with-v25-fallback (existing pattern).
  ...
})
```

Add v40-only id when v25 has no matching entry (which is exactly the Bridgewater case).

### P2 — Backstop the Brief 72 PB seeder

Brief 72 PB's recreation script left v25 ventilation empty. Even after P1's engine fix, future re-seeds shouldn't silently strip v25 data — the legacy interventions/scenarios that target v25 paths could break later. Either (a) regenerate the seed script to fully populate v25 mirror, or (b) explicitly document that v25 is deprecated and any code reading from it must fall back to v40 (which is essentially what P1 does). Option (b) is the cleaner direction since the codebase is already migrating away from v25.

### Verification gates

- Bridgewater Heat Balance Sankey on `/systems` renders three per-system vent extract ribbons in vent teal — labels match the user's edited names ("mvhr_gf_public", "vent_bedroom_extract", "vent_public_toilet_extract").
- `losses_at_setpoint.ventilation` on Bridgewater is a 3-entry array with non-zero `heat_loss_kwh`.
- Σ losses on Heat Balance rises by the mech vent contribution. Net residual may shift; document the new anchor.
- Brief 74 P5 aggregate `mech_ventilation` value matches the sum of `losses_at_setpoint.ventilation[].heat_loss_kwh`.
- Brief 74 P5 double-count guard at HeatBalance.jsx:194-195 still fires (because aggregate is now non-zero), and the per-system loop is correctly skipped to avoid double-rendering.
- Heating demand stays at 0 on Bridgewater (this fix doesn't touch the saturation problem from Brief 75 P2). That's correct — fixing the vent loss display doesn't fix the underlying physics. Per Rule 13, more layers remain.

### What this brief does NOT do

- Does NOT touch the State 3 dispatch gate at L6668. That's not where the bug is.
- Does NOT change demand calculations. Pure visualisation/display fix.
- Does NOT touch the Brief 75 outcome-(c) saturation issue. Separate concern.

---

## Confidence

- Q1 (dispatch): **High.** Read the source. Probe confirms.
- Q2 (data shape): **High.** Probe output is concrete.
- Q3 (renderer): **High.** Read the source. Behaviour matches expected.
- Q4 (root cause at L2921): **High.** The v25-only base iteration is right there in the code with an enrich-from-v40 overlay pattern.
- Regression timeline: **High** for the b9ae15b cause; **medium** for whether the Brief 72 PB script wrote v25 at all (the script is gone from disk, but the commit message admits vent=0 at re-creation time). Worth grepping git for the script content if uncertainty matters.

Architect was right to suspect "v40 migration" as the kind of thing causing it. Wrong about which layer. Pattern matches Brief 74's earlier wrong-floor analysis (dispatch gate vs render layer for Auxiliary).
