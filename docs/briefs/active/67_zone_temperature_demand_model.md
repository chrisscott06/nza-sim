# Brief 67 — Zone-Temperature Trajectory Demand Model

**Status:** active
**Lands at:** `docs/briefs/active/67_zone_temperature_demand_model.md`
**Owner/reviewer:** Chris (product owner; signs off via in-browser walkthrough)
**Architect:** Claude Chat
**Builder/verifier:** Claude Code
**Canonical test buildings:** Bridgewater (HIX hotel, ventilation-dominated) + Brief66 Test Office (`3cb8cac5-2458-49a8-99f5-ac1eed5b9821`, gains-moderate)

---

## BEFORE DOING ANYTHING (Claude Code checklist)

1. **Quote this brief's title and first paragraph back** as your first action.
2. Read this brief in full, then `CLAUDE.md`, `STATUS.md`, `docs/briefs/current.md`.
3. Read the Notion diagnostics note (`367d645e-05cc-81af-93d7-fc57bfc45faf`), especially the headline finding **"engine computes heat balance, not demand"** and the Brief 64 clamp section.
4. **Read the actual code before touching it:** `_calculateState2`'s demand-derivation block in `frontend/src/utils/instantCalc.js`, plus the RC zone-air balance in State 1 (`_calculateEnvelopeOnly` / wallModel.js) — because the zone-temperature state variable this brief needs **already partly exists in State 1's implicit-Euler air-node solver**. Confirm before building.
5. Confirm clean tree + origin sync. Land this brief at `docs/briefs/active/` as Part 1's first commit.

---

## THE PROBLEM IN PLAIN ENGLISH

Today the engine computes, every hour: "given the gains coming in and the losses going out at the setpoint, what's the net energy?" — and calls whatever is needed to cancel that net the heating or cooling demand. **It never tracks what temperature the room actually is.** It assumes the room is always being actively held exactly at a setpoint.

That produces two wrong behaviours:

1. **Changing the heating setpoint changes the cooling demand.** Because cooling is computed as `max(0, gains − heat_loss_at_heating_setpoint)`, lowering the heating setpoint shrinks the loss term, which inflates the apparent cooling. Physically nonsense: if the room is at 22°C and the cooling setpoint is 24°C, there is NO cooling demand, no matter what the heating setpoint is.

2. **There is no dead band.** A real building floats between setpoints (e.g. 21–24°C) where NEITHER system runs. The engine bills every hour as actively conditioned.

**The fix:** track the room's free-floating temperature hour by hour. Heating fires only when the free-floating temperature would fall below the heating setpoint; cooling fires only when it would rise above the cooling setpoint; in between, demand is zero. Heating and cooling become genuinely independent because each is gated on the actual zone temperature, not on a shared balance equation.

---

## WHAT THIS MEANS FOR THE GRAPHS (so the walkthrough knows what to expect)

- **Heat Balance Sankey:** today it shows energy flows as if the building is always conditioned. After this brief, it will reflect that some hours are free-floating (neither system on). The conditioned-energy ribbons (heating in, cooling out) will generally get SMALLER, because dead-band hours no longer contribute. Σ gains/losses (the physical flows) stay the same; what changes is how much of them translate into demand.
- **Demand numbers:** total heating and total cooling demand will generally DROP (dead-band hours removed). On Bridgewater this may be modest (it's loss-dominated, rarely in dead band in winter); on gains-moderate buildings like the office it may be significant.
- **Setpoint independence:** changing the heating setpoint should now have little or no effect on cooling demand (only the small second-order effect via the zone-temperature trajectory through thermal mass). This is the headline acceptance test.
- **Gate on CONSISTENCY, not absolute EUI.** Demand will move. That is correct.

---

## SCOPE

**In scope:**
1. Introduce (or surface, if it already exists in the RC solver) a tracked **free-floating zone air temperature** `T_zone_free[h]` through the State 2 hourly loop — the temperature the zone would reach with gains + losses but NO active conditioning.
2. Gate demand on that temperature:
   - `heating[h] = energy to raise T_zone to T_heat`, only if `T_zone_free[h] < T_heat`
   - `cooling[h] = energy to remove to hold T_zone at T_cool`, only if `T_zone_free[h] > T_cool`
   - else (dead band): both zero.
3. Preserve thermal-mass dynamics: the zone temperature carries hour to hour (implicit-Euler step already in State 1), so a hot afternoon bleeds into the evening. Conditioning in one hour affects the starting temperature of the next.
4. Keep the `control_strategy` field from Brief 64: `active_setpoint` uses the clamp on the tracked temperature; `free_running` reports the float with no conditioning (cooling/heating = 0, zone simply floats — useful for overheating-risk display).
5. Apply consistently in **State 2** (the demand source). State 3 reads State 2's demand unchanged.

**Out of scope (deferred, do NOT start):**
- Inline-legacy path (instantCalc.js:6084-6469) — third parallel engine, separate harmonisation brief. Note in report that it still uses the old balance method.
- Multi-zone (single-zone constraint stands — register A1).
- EnergyPlus integration (separate strategic decision).
- Mixed-mode auto-switching (register A2).
- Any display rebuild beyond making existing panels read the new demand correctly.
- The shipping fixes (B1 carbon, U1 shading, U4 fan-toggle) — separate small briefs.

---

## PRINCIPLES

1. **Gate on consistency, not baseline EUI.** Demand will drop as dead-band hours are removed. Correct.
2. **A setpoint is a promise the system keeps — but only when the room actually needs it.** The clamp holds the tracked temperature at the setpoint; it does not invent demand in hours the room is already comfortable.
3. **The zone temperature is the single source of truth for whether conditioning fires.** No demand computed off a balance equation. No second temperature path.
4. **Thermal mass is physical, not cosmetic.** The hour-to-hour carry of T_zone is the whole point — it's what makes this a dynamic model rather than 8760 independent balances.
5. **Every number on a panel must stack up, or the builder flags it.** Demand = Σ hourly conditioning. Parts sum to totals. Δ = after − baseline exactly.
6. **"Complete" is banned.** Report "built, gates RUN with numbers shown" or "built, gate X FAILED."

---

## PART A — Tracked free-floating zone temperature in State 2

**One commit. Engine change. Hand-calc gated.**

- Confirm whether State 1's implicit-Euler air-node solver already produces an hourly zone temperature that can be reused, or whether State 2 needs its own. Reuse if possible (avoid a second temperature path — two-sources-of-truth is the recurring disease).
- Compute `T_zone_free[h]` each hour: the zone air temperature resulting from the full heat balance (fabric, solar, internal gains, ventilation, infiltration, thermal mass carry) with NO active heating/cooling.
- This is the diagnostic backbone; do not yet change demand. First commit just exposes `T_zone_free[h]` and logs its annual distribution (min, max, mean, hours in each 1°C bin).
- **Hand-calc gate:** on the Brief66 office, with gains running, the free-floating summer afternoon zone temp should plausibly exceed setpoint (gains-driven), and a winter night should fall well below the heating setpoint. Report the distribution and confirm it's physically sensible. **Hard stop** if T_zone_free is constant, pinned to a setpoint, or NaN — that means the float isn't being computed.

---

## PART B — Gate demand on the tracked temperature

**One commit. The core change.**

- Replace the balance-based demand in the `active_setpoint` branch with:
  - If `T_zone_free[h] < effectiveLowerC`: heating demand = energy to bring zone from `T_zone_free[h]` to `effectiveLowerC` (accounting for thermal mass — the energy to change zone temperature by that ΔT plus offset the ongoing loss for that hour).
  - If `T_zone_free[h] > effectiveUpperC`: cooling demand = energy to bring zone from `T_zone_free[h]` down to `effectiveUpperC`.
  - Else: both zero (dead band).
- When conditioning fires, the zone ends the hour AT the setpoint, and that conditioned temperature is what carries into the next hour's `T_zone_free` calculation (a conditioned hour resets the starting point).
- Preserve the per-facade solar and internal-gain accumulators consistently.

**Hand-calc gate (BEFORE claiming Part B built):**
- **Setpoint independence test (THE headline):** on Bridgewater and the office, sweep heating setpoint 19→23 at fixed cooling setpoint 24. **Cooling demand must stay essentially flat** (only small thermal-mass second-order movement). Report cooling demand at each heating setpoint. If cooling still moves significantly with heating setpoint, the gating is still reading a balance — STOP.
- **Dead-band test:** confirm there exist hours where both heating and cooling demand are zero (the float sits between setpoints). Report the count. If zero such hours exist on the office, the dead band isn't working.
- **Cooling-setpoint sweep:** csp 28→16 at fixed hsp 21. Cooling demand should now rise more steeply than the old 1.20 ratio, because lowering the setpoint genuinely pulls more float-hours into cooling. Report the curve.
- **Vent on/off sanity:** Bridgewater vent-off cooling should still be much higher than vent-on (the sealed-building effect Chris confirmed: 151 → 408 under the old method). Confirm the new method preserves this direction.
- **Hard stop** if: cooling still tracks heating setpoint; no dead-band hours appear; demand goes negative; or reconciliation residual appears.

---

## PART C — Validation harness + walkthrough

**One commit. Tests + the required browser walkthrough.**

- Add harness assertions:
  - **Setpoint independence:** cooling demand invariant (within a small tolerance) to heating setpoint changes; heating demand invariant to cooling setpoint changes.
  - **Dead band exists:** count of hours with zero heating AND zero cooling > 0 for a gains-moderate building.
  - **Monotonicity:** lowering cooling setpoint never decreases cooling demand; raising heating setpoint never decreases heating demand.
  - **Conservation:** Σ hourly conditioning = reported annual demand.
  - **Float bound:** T_zone_free never NaN, never pinned constant.
  - **free_running invariance:** with control_strategy=free_running, heating=cooling=0 and the zone floats freely.
- Run `npm run validate`. Report PASS/FAIL/BLOCKED.

**IN-SCREEN WALKTHROUGH (Chris, browser — REQUIRED):**
1. On Bridgewater, change heating setpoint 21→18→23. **Confirm cooling demand barely moves.** (Under the old engine it swung hundreds of MWh.)
2. Confirm heating demand still responds correctly to heating setpoint.
3. Drag cooling setpoint 24→18. Cooling demand rises more steeply than before.
4. Toggle ventilation on/off on Bridgewater — confirm cooling still jumps (sealed-building effect preserved).
5. Open the Heat Balance Sankey — confirm it now reflects dead-band hours (conditioned ribbons smaller than the raw gain/loss flows; the building isn't "always on").
6. Confirm reconciliation: demand → delivered → fuel still stacks, no consistency banner.
7. Confirm State 1 (Envelope) unchanged.

---

## WHAT MUST NOT HAPPEN

- No second zone-temperature path — reuse State 1's solver output if it exists.
- No change to State 1 envelope demand.
- No inline-legacy edits (logged as still-old-method).
- No demand computed off a balance equation anywhere in the `active_setpoint` branch.
- No tolerance tweaks to force harness pass.
- Do not gate on or "correct" demand dropping — dead-band removal SHOULD reduce demand.
- No shipping out without the browser walkthrough.

---

## WHEN TO ESCALATE (stop after 3 approaches)

Hard-stop and report if: cooling demand still tracks heating setpoint after gating; T_zone_free can't be computed sensibly; thermal-mass carry produces oscillation/instability; reconciliation breaks; or you hit a genuine modelling judgement (e.g. how to handle an hour where the float starts above cooling setpoint but ventilation would pull it down mid-hour — flag it, don't silently choose).

---

## FINAL REPORT (required)

- Title + first paragraph quoted (opening action).
- Part A: T_zone_free distribution (min/max/mean/bins) on both test buildings; confirmation it reuses or newly-computes the temperature, and why.
- Part B: setpoint-independence table (cooling vs heating-setpoint sweep — the headline); dead-band hour count; cooling-setpoint sweep curve; vent on/off check; reconciliation residual.
- Part C: harness PASS/FAIL/BLOCKED; the setpoint-independence and dead-band assertions called out explicitly.
- Both buildings: heating + cooling demand before/after this brief at default setpoints.
- Commits (one per part).
- Status: "built, gates RUN with numbers shown" or "built, gate X FAILED."
- Walkthrough remains PENDING Chris.

---

## DEFERRED / NOT IN THIS BRIEF (logged, not forgotten)

- Inline-legacy harmonisation (still uses old balance method post-67).
- B1 carbon-factor drift, U1 shading floor, U4 fan-toggle (separate small fix briefs).
- HIGH-4 scop_effective mislabel, HIGH-1 building-type selector, MED-8 allowlist-drift IG/Systems cooling mismatch (from Brief 66 report).
- Multi-zone (register A1), mixed-mode (register A2), EnergyPlus integration (strategic).
