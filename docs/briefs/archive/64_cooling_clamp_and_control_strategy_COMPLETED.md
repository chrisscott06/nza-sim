# Brief 64 — Cooling Clamp + Visible Control Strategy

**Status:** active
**Lands at:** `docs/briefs/active/64_cooling_clamp_and_control_strategy.md`
**Owner/reviewer:** Chris (product owner; signs off via in-browser walkthrough)
**Architect:** Claude Chat (this brief; has read full `instantCalc.js` State 1 + State 2 + State 3 source 27 May 2026)
**Builder/verifier:** Claude Code
**Canonical test building:** Bridgewater (HIX hotel, ~4,322 m² GIA, 134 rooms, gains-dominated)

---

## BEFORE DOING ANYTHING (Claude Code checklist)

1. **Quote this brief's title and first paragraph back** as your first action, confirming you have the right file landed at `docs/briefs/active/`.
2. Read this brief in full, then read `CLAUDE.md`, `STATUS.md`, `docs/briefs/current.md`.
3. Read the Notion diagnostics/canonical note (`367d645e-05cc-81af-93d7-fc57bfc45faf`) section **"Cooling-clamp: confirmed against full instantCalc.js source (27 May 2026)"** — it pins exactly what the current code does and why this change is needed.
4. **Read the actual code before touching it:** `frontend/src/utils/instantCalc.js`, specifically the `_calculateState2` demand-derivation block (the three-way `if (H_weather > 0) / else if (C_weather > 0) / else` branch). Confirm the branch matches the description in this brief before changing it. If it doesn't match, STOP and report — the source may have moved since 27 May.
5. Confirm clean working tree + origin sync.
6. Confirm you can run: live engine (frontend :5176 / backend :8002 via `go.bat`), isolated verification (`nza_sim_cc.db`, :8003, walkthrough :5178), and the harness (`npm run validate` from `frontend/`).

---

## SCOPE

**In scope (this brief, and ONLY this):**

1. Replace the weather-gated three-way demand branch in `_calculateState2` with **independent setpoint clamps** (heating clamp at the heating setpoint, cooling clamp at the cooling setpoint), so the cooling setpoint is honoured **every hour the free-running zone would exceed it** — gains-inclusive (fabric + solar + internal gains + ventilation air-change), not gated behind the heating-direction test.
2. Add a **`control_strategy` field** as an explicit, visible choice: `'active_setpoint'` (the clamp; **new default**) vs `'free_running'` (the current surplus-overspill behaviour, **preserved** as a selectable option, NOT deleted).
3. Wire the field into the engine and add the minimal UI control to select it.

**Explicitly OUT of scope (deliberately deferred — see "Deferred / not in this brief" at the end). Do not start any of these:**

- System sizing logic (peak load, capacity, oversizing factors, part-load performance).
- Peak-hour cooling load figure (decision below — held to a future sizing brief).
- The 397-vs-198 Energy Flows display doubling (separate display fix).
- carrier-vs-EUI ~0.3 MWh reconciliation gap (display-layer, parked).
- share_pct full retirement (its own brief).
- Sankey gross-vs-net / bidirectional-flow display rebuild (display brief).
- AIR_HEAT_CAPACITY 0.33 vs AIR_RHO×AIR_CP 1206 ~1.5% inconsistency (folds into tidy brief).

**DECISION (Chris, 27 May): peak-hour cooling load is NOT exposed in this brief.** Keep strictly to annual demand. All sizing logic — including any peak-hour figure — belongs to the future sizing brief. The clamp produces the honest annual demand; sizing reads it later.

---

## PRINCIPLES (governing this brief)

1. **Gate on CONSISTENCY, not baseline EUI.** Cooling demand WILL rise — substantially, on a gains-dominated building like Bridgewater. That is CORRECT and expected. Do not treat a rising cooling figure as a regression. Gate on: direction + hand-calc magnitude match; parts-sum-to-total reconciliation on screen; the validation harness physical bounds holding; no-op invariance.
2. **A setpoint is a promise the system keeps.** The active-setpoint clamp holds the zone at the cooling setpoint in every hour it would otherwise exceed it. This is the default because it's what a properly-controlled conditioned building does and what you assume when sizing cooling plant.
3. **State 1 (`_calculateEnvelopeOnly`) is NOT touched.** It is correctly free-running envelope-only — no internal gains, `operableOpenings` forced `[]`. Its cooling demand (fabric + solar only) is right as-is. Staged cooling demand differing across Envelope (State 1) → Internal Gains (State 2) → Systems (State 3) is a **FEATURE**: each stage adds load and being able to read it at each stage is diagnostically valuable. The clamp makes the **State 2/3** number honest; it does not flatten the staging.
4. **Two-sources-of-truth is the recurring disease.** The clamp must read the resolved cooling setpoint from the same single source Brief 62 established (`effectiveUpperC` / `effectiveLowerC`). Do not introduce a second setpoint path.
5. **Every number on the panel must stack up, or you flag it.** Run the whole-panel self-consistency check before handover. If anything fails to reconcile, report "FAILED — these don't reconcile: [list]" and STOP. A wrong number shown is worse than no number.
6. **"Complete" is banned as a status.** Report "built, gates RUN with numbers shown" or "built, gate X FAILED." The in-screen walkthrough is Chris's confirmation, never bug-discovery.

---

## BACKGROUND — what the code does today (confirmed against source)

In `_calculateState2`, the per-hour demand is decided by a three-way branch:

```
H_weather = hourly_heat_loss_Wh − H_floor_const
C_weather = hourly_cool_gain_Wh − C_floor_const

if (H_weather > 0) {            // heating-direction — TESTED FIRST
  heating = max(0, heat_loss − (solar + internal_gains))
  cooling = max(0, (solar + internal_gains) − heat_loss)   // setpoint NOT read
} else if (C_weather > 0) {     // cooling-direction
  cooling = hourly_cool_gain_Wh + solar + internal_gains   // all terms present here
} else {                        // shoulder
  // no demand
}
```

**The terms are all correct and present** — `hourly_cool_gain_Wh` already includes mechanical-vent cooling (`mech_vent_cool_h`), leakage (`UA_leakage`) and permanent-vent (`UA_permanent`) ventilation air-change gain; the cooling-direction branch adds `Q_internal_gains_Wh` and solar. The bug is the **gating order**: `H_weather > 0` is true in most UK hours (the building loses heat to outside whenever it's even mildly cooler out), so a gains-heavy building that is genuinely above its cooling setpoint indoors gets cooling computed only as "gains minus the entire fabric loss," and **the cooling setpoint never enters the calculation**. That is why dragging the cooling setpoint 24 → 18 °C barely moved demand in Brief 62 testing.

This weather-gated behaviour is a legitimate model of a **free-running / passive-only** building (no active cooling; relies on envelope + ventilation; only "cools" when the weather helps — the naturally-ventilated / mixed-mode overheating-risk case). It is NOT a model of weather-compensated control (which is a heating flow-temperature concept) and must not be labelled as such. It is being **demoted to an explicit named option**, not deleted.

---

## PART A — Independent setpoint clamps in `_calculateState2`

**One commit. Engine change only. Hand-calc-gated.**

Replace the three-way weather-gated branch with two independent clamps evaluated every hour:

- **Cooling clamp (active_setpoint):** if the free-running zone would exceed the cooling setpoint this hour, cooling demand = the energy required to remove the net gain and hold T_air at the cooling setpoint. Net gain at the cooling setpoint = (fabric gain + solar + internal gains + ventilation air-change gain at T_cool) − (fabric loss to outside at T_cool). Use the terms already assembled in `hourly_cool_gain_Wh` + `Q_solar_through_glazing_Wh` + `Q_internal_gains_Wh`; net against the fabric/vent loss-to-outside that already exists in the integrand. The clamp is NOT gated by `H_weather`/`C_weather` direction.
- **Heating clamp (mirror):** if the free-running zone would fall below the heating setpoint, heating demand = energy to hold T_air at the heating setpoint, with solar + internal gains offsetting loss first (as today). This preserves current heating behaviour — the heating numbers should be essentially unchanged from Brief 62 (confirm in hand-calc).

**Setpoint source:** read `effectiveUpperC` (cooling) and `effectiveLowerC` (heating) — the resolved post-Brief-62 single source. Do not read `comfortBand` directly for the clamp; do not introduce a new path.

**Strategy switch:** the clamp branch runs when `control_strategy === 'active_setpoint'` (default). When `control_strategy === 'free_running'`, run the EXISTING three-way weather-gated branch unchanged (Part B preserves it). The two are mutually exclusive at the branch site.

**Per-facade solar bucketing + internal-gain bucketing:** these informational accumulators must remain conserved (beneficial + cooling + shoulder = Q_solar per hour; gains offset + cooling + shoulder = total gains per hour). Update them consistently with whichever branch ran. Do not let them drift.

**Hand-calc gate (do this BEFORE claiming Part A built):**
- Pick the cooling setpoint sweep (e.g. 24 → 22 → 20 → 18 °C) on Bridgewater. Hand-derive expected cooling demand at two points using the documented per-hour clamp formula against the EPW. Match engine output. State the predicted and engine numbers side by side.
- Confirm heating demand at a fixed heating setpoint is within rounding of the Brief 62 value (clamp must not disturb heating).
- Confirm `demand − delivered = 0` reconciliation still holds at each sweep point (the Brief 62 whole-panel gate).
- **Hard stop** if: cooling does not rise monotonically as the setpoint drops; magnitude diverges from hand-calc; heating moves materially; or any reconciliation residual appears.

---

## PART B — `control_strategy` field + visible UI control

**One commit. Field + minimal UI.**

- Add `control_strategy` to the building/systems config schema, default `'active_setpoint'`. Allowed values: `'active_setpoint'`, `'free_running'`. Add to the `withMode` allowlist so the engine actually sees it (ALLOWLIST DRIFT discipline — a field added to the schema but missed in `withMode` is silently dropped; this has bitten before).
- Engine reads the field at the `_calculateState2` branch site to choose clamp vs weather-gated branch (Part A wires the switch; Part B lands the field + persistence + default).
- **UI:** a single, clearly-labelled control where the user picks the strategy. Label it honestly:
  - **`active_setpoint`** → "Active setpoint (hold to temperature)" — the system holds the cooling/heating setpoint regardless of outdoor temperature.
  - **`free_running`** → "Free-running / passive only (no active cooling)" — the building relies on envelope + ventilation; cooling only occurs when the weather assists. Use this to show overheating risk for a naturally-ventilated / mixed-mode design.
  - Do **not** label the second option "weather-compensated" — that term means heating flow-temperature modulation and would misdescribe the physics.
- Persistence: the field saves with the project (PUT building) and round-trips.
- Migration/back-compat: persisted projects with no `control_strategy` default to `'active_setpoint'`. Note in the report that this changes the cooling demand for existing projects (expected — they were previously running the weather-gated branch by default). This is correct per the active-clamp decision; gate on consistency.

---

## PART C — Validation-harness bounds (safety net for the new numbers)

**One commit. Test wiring only, no tolerance tweaks.**

The 242-assertion battery (Brief 63) is the permanent guard. Confirm/extend it covers the clamp:

- **Bound:** cooling demand ≤ total gains into the zone (fabric gain + solar + internal gains + ventilation gain). The clamp can never remove more than the gain present — if it does, the clamp math is wrong. (Battery B11/B12/B13 were noted clamp-ready in Brief 63 — confirm they fire now that the clamp lands.)
- **Monotonicity:** lowering the cooling setpoint never decreases cooling demand; raising it never increases it. Mirror for heating.
- **Conservation:** per-hour gain bucketing sums to total gains; solar bucketing sums to Q_solar.
- **Invariance:** with `control_strategy = 'free_running'`, output is byte-identical to the pre-Brief-64 engine (the preserved branch must not have drifted). This is the key regression guard that proves Part A only added a path rather than altering the old one.
- **Parity:** baseline-edit of the cooling setpoint == intervention setting the same cooling setpoint (no separate path).

Run `npm run validate`. Report PASS/FAIL/BLOCKED counts. If any RED, diagnose whether it's a harness-wiring issue or a genuine engine fault before changing anything — and never tweak a tolerance to make a test pass.

---

## IN-SCREEN WALKTHROUGH (Chris, browser — REQUIRED, not optional)

Harness green ≠ done. The harness tests the engine output; this confirms the displays. On the real model at :5176:

1. **Cooling setpoint responds.** On Bridgewater, with `active_setpoint` selected, drag the cooling setpoint 24 → 18 °C. Cooling demand should rise substantially and smoothly (accelerating as it drops). Confirm the rise is visible on the Internal Gains (State 2) and Systems (State 3) views.
2. **Staged demand reads sensibly across modules.** Envelope (State 1) cooling unchanged (fabric + solar only). Internal Gains (State 2) higher (adds gains + air changes). Systems (State 3) accounts for system performance. Confirm each stage shows its own number and the progression makes sense.
3. **Strategy toggle works and is honest.** Switch `active_setpoint` → `free_running`. Cooling demand drops back toward the old weather-gated behaviour. Switch back. Confirm the labels read as written (no "weather-compensated" mislabel).
4. **State 1 untouched.** Confirm the Envelope module's cooling demand is identical to before this brief.
5. **Reconciliation holds.** On the Systems breakdown / calc-trail panel, confirm demand → delivered → fuel still reconciles with the higher cooling demand (no new residual, no consistency-failure banner).
6. **Persistence.** Save, reload, confirm `control_strategy` round-trips and the cooling demand is stable across reload.

---

## WHAT MUST NOT HAPPEN

- State 1 must not change.
- The `free_running` branch must not drift from the pre-Brief-64 weather-gated math (invariance test guards this).
- No second setpoint source — clamp reads `effectiveUpperC`/`effectiveLowerC` only.
- No sizing logic, no peak-hour figure, no display-bug fixes bundled in.
- No tolerance tweaks to make harness tests pass.
- Do not gate on or "correct" the rising baseline EUI / cooling demand — it is supposed to rise.
- Do not ship without the in-screen walkthrough.

---

## WHEN TO ESCALATE (stop after 3 approaches)

Hard-stop and report if: the source branch doesn't match the Background description; cooling doesn't rise monotonically with a falling setpoint; hand-calc and engine diverge; heating moves materially; the `free_running` invariance test fails; a reconciliation residual appears; or you hit a genuine modelling judgement (e.g. how net cooling should treat an hour where the zone is simultaneously losing fabric heat AND over the cooling setpoint due to gains — flag it, don't silently choose).

---

## FINAL REPORT (required, on handover)

- Title quoted + first paragraph (your opening action).
- Part A: clamp formula as implemented; hand-calc table (predicted vs engine) at ≥2 cooling-setpoint sweep points; heating-unchanged confirmation; reconciliation residual at each point.
- Part B: field added, allowlist updated, UI control + labels, persistence round-trip, default behaviour for legacy projects.
- Part C: `npm run validate` PASS/FAIL/BLOCKED counts; the `free_running` invariance result called out explicitly.
- Bridgewater numbers: cooling demand before/after at the default setpoint; the cooling-setpoint sweep curve (24/22/20/18); heating demand before/after.
- Commits (one per part).
- Status line: "built, gates RUN with numbers shown" or "built, gate X FAILED."
- **Walkthrough remains PENDING Chris in browser** — do not mark anything beyond "built + gates run."

---

## DEFERRED / NOT IN THIS BRIEF (logged, not forgotten)

- **System sizing logic** — peak load, capacity, oversizing, part-load, system performance at peak. The natural next brief. The clamp gives honest annual demand; sizing reads it. (Chris: "when sizing systems based on a setpoint, we account for full heat balance AND system performance" — that's the sizing brief's job.)
- **Peak-hour cooling load figure** — held to the sizing brief per Chris's decision.
- **397-vs-198 Energy Flows display doubling** — SystemsModule.jsx Sankey ~L1099; engine probe gives 198 (within gains bound), panel shows 397 (unphysical). Display fix.
- **carrier-vs-EUI ~0.3 MWh gap** — likely DHW circulation pump (~1.05 MWh) or round-before-sum; display-layer, parked.
- **share_pct full retirement** — 19 read sites in systemsEngine.js; needs primary/secondary fuel-mix replacement. Own brief.
- **Sankey gross-vs-net / bidirectional-flow rebuild** — Brief 63 introspection exposes both directions; rebuilding the Sankey is display work.
- **AIR_HEAT_CAPACITY 0.33 vs 1206 (~1.5%)** — folds into share_pct/tidy brief.
- **Brief 60 Part B (auxiliary energy)** — a feature, kept separate from correctness fixes.
