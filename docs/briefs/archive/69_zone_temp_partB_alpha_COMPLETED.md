# Brief 69 — Zone-Temperature Demand Model, Part B continuation (Option α)

**Status:** active
**Lands at:** `docs/briefs/active/69_zone_temp_partB_alpha.md`
**Owner/reviewer:** Chris
**Architect:** Claude Chat
**Builder/verifier:** Claude Code
**Canonical test buildings:** Bridgewater (ventilation-dominated) + Brief66 Test Office (`3cb8cac5-2458-49a8-99f5-ac1eed5b9821`, gains-moderate, lighter)
**Predecessor:** Brief 67 Part A landed (commit 4c53ca9, `T_zone_free` exposed at `result.demand.hourly_zone_air_c`). Part B prototyped, reverted, findings at `docs/audit/67_partB_findings.md`. This brief is the corrected Part B.

---

## BEFORE DOING ANYTHING

1. Quote this brief's title and first paragraph back.
2. Read `docs/audit/67_partB_findings.md` (your own Part B prototype findings) + Brief 67 (`67_zone_temperature_demand_model.md`) + the Notion diagnostics note (`367d645e-05cc-81af-93d7-fc57bfc45faf`).
3. Read the State 2 implicit-Euler step at instantCalc.js:3031 and confirm how `C_coef` is currently assembled (which conductances enter it: fabric, infiltration, glazing — and confirm mech-vent does NOT currently enter it; that's the bug).
4. Read how Brief 67 Part A computes `T_zone_free` and where it's exposed.
5. Clean tree + origin sync. Land this brief at `docs/briefs/active/`. Part A's prototype was reverted — start from the committed Part A (4c53ca9), not the reverted Part B.

---

## CONTEXT — what Part B got right and what stopped it

Part B prototype hit three §6 stop flags and correctly reverted. Status of each:

- ✓ **Bridgewater setpoint independence: 0.4%** (was ~22%). The core fix WORKS — gating demand on tracked temperature decouples heating and cooling.
- ✓ **Dead-band hours exist: 64% / 67.8%.** The float-and-dead-band model is real.
- ✓ **Cooling-setpoint sweep ×67 on Bridgewater** (was 1.20). Setpoint now genuinely drives cooling.
- ✗ **Vent on/off lost the sealed-building effect** — mech-vent doesn't enter `C_coef` in the implicit-Euler step, so toggling ventilation doesn't move `T_zone_free`. **THIS IS THE BLOCKER and the main subject of this brief.**
- ✗ **Office setpoint independence 27.8%** — flagged as too big. **Decision below: this is suspected-real physics confounded by the hardcoded thermal mass; do NOT damp it.**
- ✗ **12/277 harness fail** — most are Brief-64-shaped invariance assertions that Part C always intended to rewrite. **Decision below: update them, don't preserve old behaviour.**

---

## DECISIONS (Chris signed off — build to these, do not re-litigate)

### Decision 1 — Mechanical ventilation: Option α (inject into the implicit-Euler), NOT Option β.
Mech-vent UA must enter the `C_coef` of the implicit-Euler zone-temperature step so that turning ventilation on/off genuinely changes `T_zone_free`. **Do NOT bolt mech-vent onto `Q_cond` outside `C_coef` (Option β).** β would create a second path for one physical quantity — the two-sources-of-truth disease that has caused most bugs in this project. The sealed-building effect (Bridgewater vent-on 151 → vent-off 408 MWh cooling, confirmed by Chris in the live tool) MUST be reproduced through the temperature solver, not as a side-calculation.

**Rationale in plain terms:** ventilation is Bridgewater's dominant heat path. If it's not in the temperature equation, the free-floating room temperature won't respond to it, and the whole point of the model — the room temperature deciding when conditioning fires — breaks for the most important building. The conductance belongs in the same place fabric and infiltration conductances already are.

### Decision 2 — Office 27.8% setpoint coupling: do NOT attenuate. Re-measure against corrected thermal mass first.
Some heating↔cooling coupling through thermal mass is genuine physics (heat a heavyweight fabric overnight → warmer fabric in the morning → slightly more cooling). The office showing 27.8% vs Bridgewater 0.4% is consistent with the office being lighter / more gains-responsive — BUT the office is currently using the single hardcoded thermal-mass value (register G3, 250 kJ/K·m²), which may be amplifying the coupling.

**Do this:** before judging 27.8% as too big, run the office coupling test at three thermal-mass values — lightweight (~50 kJ/K·m²), the current default (250), and heavyweight (~450) — and report how the coupling % changes with mass. If the coupling shrinks materially at a physically-appropriate mass for a light office, it was a mass artefact. If it stays large across realistic masses, it's real physics and we ACCEPT it (and the brief's "small" threshold for the office was simply wrong). **Do NOT add any artificial damping term to force the number down.** Report the three numbers; Chris rules on whether the residual is physical.

### Decision 3 — The 12 failing harness assertions: update them to the new model, don't preserve old behaviour.
The failing assertions encode the OLD balance-method behaviour (e.g. Brief-64-era "cooling responds to X" invariants) that this model deliberately changes. Rewrite them to assert the NEW correct behaviour (setpoint independence, dead-band existence, etc. — the assertions Brief 67 Part C specified). Do NOT tweak tolerances to make old assertions pass against new physics. Each rewritten assertion: state what it asserted before, what it asserts now, and why the change is correct.

---

## SCOPE

**In scope:**
1. Option α: add mech-vent conductance to `C_coef` in the State 2 implicit-Euler step, so `T_zone_free` responds to ventilation flow / enable state.
2. Land the Part B demand gating (heating if float < lower SP, cooling if float > upper SP, else dead band) on top of the corrected `T_zone_free`.
3. Re-run all Part B gates from Brief 67 §6 — they now build on a vent-aware `T_zone_free`.
4. Office thermal-mass sensitivity measurement (Decision 2).
5. Rewrite the affected harness assertions (Decision 3) + the Part C assertions Brief 67 specified (setpoint independence, dead-band exists, monotonicity, conservation, float never NaN/pinned, free_running invariance).

**Out of scope (do NOT start):**
- Making thermal mass user-configurable / building-type-driven (register G3) — this brief only *tests at three masses to diagnose the coupling*; it does NOT build the UI control. That's a separate feature brief. Restore the default mass after the sensitivity test.
- Inline-legacy path (still old balance method; separate harmonisation brief).
- Multi-zone, mixed-mode, EnergyPlus.
- Brief 68 items (all landed/separate).
- Display rebuilds beyond panels reading the new demand correctly.

---

## PRINCIPLES

1. **One conductance, one place.** Mech-vent enters `C_coef` alongside fabric/infiltration. No parallel mech-vent path.
2. **Gate on consistency, not absolute EUI.** Demand drops (dead band removed) and cooling rises with lower setpoints — both correct.
3. **The tracked zone temperature is the single source for whether conditioning fires.** No demand off a balance equation.
4. **Don't damp real physics to hit a target.** The office coupling is measured, not massaged.
5. **Every number stacks up or you flag it.** Demand = Σ hourly conditioning; reconciliation holds; Δ = after − baseline.
6. **"Complete" is banned.**

---

## PART 1 — Mech-vent into the implicit-Euler (Option α)

**One commit. The core architectural fix.**

- Add the mechanical-ventilation conductance (the same UA the State 2 mech-vent loss loop uses — read it, reuse it, don't recompute differently) into `C_coef` at instantCalc.js:3031.
- Honour HRE: the conductance entering the temperature step is the EFFECTIVE post-recovery conductance (i.e. `AIR_HC × flow × (1 − HRE)`), matching how mech-vent loss is already computed for demand. Confirm you're using the same effective figure, not the raw flow.
- Honour the enable gate: if ventilation is disabled (the Brief 68 Part C AND-gate, v25 AND v40 enabled), its conductance is zero in `C_coef` — so a disabled vent system stops affecting `T_zone_free`.
- This commit changes `T_zone_free` only (Part A's exposed value). Do NOT yet change demand gating — verify the temperature responds first.

**Gate:**
- On Bridgewater: report `T_zone_free` annual distribution (min/max/mean) with ventilation ON vs OFF. With vent ON, the dominant extract should pull the free-floating summer temperature DOWN (it's carrying gains out); with vent OFF, summer `T_zone_free` should rise substantially. **The vent-OFF mean/peak must be clearly higher than vent-ON** — that's the sealed-building effect now living in the temperature solver.
- Confirm the office (lighter, less vent-dominated) shows a smaller but correct-direction shift.
- **Hard stop** if `T_zone_free` doesn't respond to the vent toggle (means the conductance didn't actually enter `C_coef`), or if it produces NaN / oscillation / instability.

---

## PART 2 — Demand gating on the corrected float

**One commit.**

- Apply the Brief 67 Part B gating on the now-vent-aware `T_zone_free`:
  - `T_zone_free[h] < effectiveLowerC` → heating = energy to raise to lower SP (with thermal-mass carry).
  - `T_zone_free[h] > effectiveUpperC` → cooling = energy to remove to hold at upper SP.
  - else → both zero.
- Conditioned hours reset the zone to setpoint and carry into next hour.

**Gate (the full Brief 67 §6 battery, now on corrected float):**
- **Setpoint independence (Bridgewater):** heating-sp sweep 19→23 at csp 24 — cooling demand flat (target retained: <~1%). Report the table.
- **Vent on/off sealed-building (THE one that failed before):** Bridgewater vent-on vs vent-off cooling demand. Direction and rough magnitude must match the confirmed live-tool behaviour (vent-on much lower than vent-off; the 151 vs 408 figures were under the old method, so exact match isn't required, but the SEALED-BUILDING DIRECTION AND LARGE MAGNITUDE must be present). **This is the headline pass for this brief.**
- **Dead-band hours exist** (report count, both buildings).
- **Cooling-setpoint sweep** csp 28→16 at hsp 21 — steep, monotonic (both buildings).
- **Office setpoint independence at 3 masses** (Decision 2): report coupling % at lightweight/default/heavyweight mass. Restore default after.
- **Hard stop** if vent on/off still doesn't show the sealed-building effect (means Part 1 didn't actually wire vent into the float), cooling tracks heating-sp on Bridgewater, demand negative, or reconciliation breaks.

---

## PART 3 — Harness assertions (rewrite + Part C battery)

**One commit. No tolerance tweaks.**

- Rewrite the 12 failing assertions to the new model (Decision 3). For each: old behaviour asserted / new behaviour asserted / why correct.
- Add the Brief 67 Part C battery: setpoint independence, dead-band exists, monotonicity, conservation (Σ hourly = annual), float never NaN/pinned, free_running invariance (heating=cooling=0, zone floats).
- Run `npm run validate`. Report PASS/FAIL/BLOCKED. All must pass on the new model with no tolerance massaging.

---

## IN-SCREEN WALKTHROUGH (Chris, browser — REQUIRED)

1. Bridgewater: heating sp 21→18→23. **Cooling demand barely moves** (was swinging hundreds of MWh).
2. Bridgewater: **toggle ventilation on/off. Cooling demand jumps substantially when vent is off** (sealed-building effect — the thing that broke in the first Part B attempt, now fixed via Option α).
3. Bridgewater: cooling sp 24→18 — cooling rises steeply.
4. Office: same heating-sp sweep — note the residual coupling (Chris judges whether the post-mass-correction figure is physically acceptable).
5. Heat Balance Sankey reflects dead-band hours (conditioned ribbons < raw gain/loss flows).
6. Reconciliation holds; no consistency banner; State 1 envelope unchanged.

---

## WHAT MUST NOT HAPPEN

- No Option β. Mech-vent goes INTO `C_coef`, not bolted alongside.
- No second mech-vent path; reuse the existing effective-UA figure.
- No artificial damping of the office coupling.
- No building thermal-mass UI in this brief (test only, restore default).
- No preserving old-behaviour harness assertions against new physics; no tolerance tweaks.
- No State 1 envelope change; no inline-legacy edits.
- No shipping without the walkthrough.

---

## WHEN TO ESCALATE (3 approaches then stop)

Hard-stop and report if: `T_zone_free` won't respond to vent after Option α (3 attempts); the implicit-Euler goes unstable/oscillates when mech-vent enters `C_coef` (report the numerical behaviour — may need an implicit treatment of the vent term); cooling still tracks heating-sp; or office coupling stays large across all three masses AND you're unsure whether that's physical (flag for Chris — it's a modelling judgement, his call).

---

## FINAL REPORT

- Title + first paragraph quoted.
- Part 1: `T_zone_free` vent-on/off distribution, both buildings; confirmation mech-vent entered `C_coef` (quote the line); effective-UA + enable-gate reuse confirmed.
- Part 2: full §6 gate battery with numbers — setpoint independence table, **vent on/off sealed-building result (headline)**, dead-band counts, cooling-sweep curves, office 3-mass coupling table.
- Part 3: the 12 rewritten assertions (old/new/why) + Part C battery; `npm run validate` counts.
- Both buildings: heating + cooling demand before/after at default setpoints.
- Commits (one per part).
- Status per part: "built, gate RUN with numbers" or "built, gate FAILED."
- Office-coupling residual: state the post-mass-correction figure and flag it explicitly for Chris's physical judgement.
- Walkthrough PENDING Chris.

---

## NOTE

This completes the demand-model architecture (Brief 67). After this: inline-legacy still runs the old balance method (harmonisation brief needed), and thermal mass is still a single hardcoded value (G3 feature brief). Both are logged, neither is in scope here.
