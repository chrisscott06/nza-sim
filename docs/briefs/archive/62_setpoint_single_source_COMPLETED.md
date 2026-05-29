# Brief 62 — Single-source setpoint resolution (fix Root Cause A: demand integrand ignores the setpoint)

**Author:** Claude Chat (architect). **Authorised by:** Chris.
**Type:** Tier 3, engine correctness fix. The critical fix from the Brief 61 audit — it must land before Brief 60 Part B (auxiliary energy), so those rows don't land in a contradictory frame.
**Repo:** github.com/chrisscott06/nza-sim. Verification on the running model. Back up the DB before starting.
**Canonical note:** Notion `367d645e-05cc-81af-93d7-fc57bfc45faf` — read the Brief 61 audit entry (Root Cause A), the GOVERNING PRINCIPLE (gate on consistency, not baseline EUI), the "every number must stack up" rule, and the setpoint inherit/override model entry.

## The bug (Brief 61 audit, Root Cause A — pinned)
`instantCalc.js:2371` — the State 2 main demand integrand reads `comfortBand.lower_c / upper_c` ONLY. It never reads `systems_config_v40.{heating,cooling}_setpoint_c`. `_computeHeatingOrCooling` recomputes State 2 demand at the v40 setpoint to get DELIVERED, but that recompute never flows back to `consumption.*.demand_mwh`. Result: change the heating setpoint 21→28 and demand stays frozen at 245.6 MWh while delivered rises to 493.5 and EUI to 132.6 — an on-screen contradiction ("493 delivered against a 246 need"). Cooling identical (demand frozen at 69.10 across cooling setpoint 18→24).

This is the same single-source disease fixed before for comfort_band (Brief 58 A2), ventilation flow (Brief 59), and share_pct: one quantity, multiple reads, consumers disagree on the source.

## The correct model (MUST be preserved — do not break this)
State 1 (envelope) holds the comfort setpoints as the comfort intent (e.g. heating 21, cooling 24). On the Systems page the user can EITHER inherit those ("follow comfort") OR override them ("custom"). The fix must make the DEMAND integrand read the **resolved** setpoint — i.e. the override if set, else the inherited comfort value — exactly as delivered already does. The fix is NOT "make demand read the v40 setpoint always"; it's "make demand read the same RESOLVED setpoint that delivered already reads," so inherit and override both work and demand/delivered/EUI agree.

---

## BEFORE DOING ANYTHING
1. Read this brief; confirm receipt by quoting the title + the bug location (instantCalc.js:2371).
2. Read CLAUDE.md / STATUS.md / current.md and the Notion entries named above.
3. Back up the DB.
4. Land this brief at docs/briefs/active/62_setpoint_single_source.md.
5. Read before changing: the demand integrand at instantCalc.js:2371; how `_computeHeatingOrCooling` resolves the setpoint for delivered (this is the CORRECT resolution to mirror); where `comfortBand` is resolved; where the v40 setpoint + the inherit/override (follow-comfort/custom) flag live.

---

## PART 1 — Enumerate every input the demand integrand should read (read-only, FIRST)
Before any fix, confirm the SCOPE of the wrong-source fault. The setpoint is one input the demand integrand reads from the wrong source — are there others?
- List every input the State 2 demand integrand at :2371 currently reads, and its source.
- List every input that SHOULD influence the demand integrand (setpoints, anything else that shifts the demand threshold or the loss/gain terms) and where each is actually read from.
- Cross-check against the Brief 61 PASS list: vent flow, SFP, HRE, efficiencies, lighting/SP coupling all PASSED (they propagate correctly) — so they're NOT in scope here. The question is whether anything BESIDES heating/cooling setpoint reads from `comfortBand` (or another stale source) when it shouldn't.
- Produce `docs/audit/62_setpoint_scope.md`: the list, and a clear statement — "the wrong-source fault affects exactly: [heating setpoint, cooling setpoint, + any others found]."
- **HARD STOP** — surface the scope list before fixing, so Chris confirms the fix covers every affected input, not just the two setpoints.

## PART 2 — Single-source setpoint resolution
- Make the demand integrand read the RESOLVED setpoint — the same resolution `_computeHeatingOrCooling` already uses for delivered (override if custom, else inherited comfort value). One resolution, read by both demand and delivered. No separate/stale read.
- If Part 1 found other inputs reading the wrong source, fix them in the same single-source manner (resolve once, read everywhere) — covered by this brief.
- Preserve inherit/override: "follow comfort" → demand uses the comfort setpoint; "custom" → demand uses the override. Both must work.

## Falsifiability — CONSISTENCY (not baseline EUI)
- **Direction + magnitude:** raise heating setpoint → heating DEMAND rises (not just delivered/EUI), by a hand-calc'd amount; lower it → demand falls. Same for cooling.
- **No contradiction:** delivered no longer exceeds demand — `consumption.space_heating.demand_mwh` and `delivered_heating_mwh` move TOGETHER (delivered = demand ÷ efficiency, demand is the thing that moved).
- **Inherit/override:** with "follow comfort", demand uses the comfort setpoint; switch to "custom" and change it, demand follows the custom value; switch back, demand returns to comfort. All three transitions correct.
- **Propagation:** demand, delivered, fuel, EUI, AND the heat-balance figure all move together when the setpoint changes (note: the heat-balance DISPLAY completeness is Root Cause B / Brief 64 — but the underlying demand number must now move).
- **Every number stacks up:** on any panel showing these, every Δ = after−baseline, parts sum to totals (run the standing whole-panel consistency check; report the numbers).
- **No-op invariance:** changing the setpoint does NOT move things it shouldn't (e.g. DHW demand, lighting).
- Hand-calc the predicted demand change FIRST, then match the engine. Do NOT gate on holding any baseline EUI — the EUI SHOULD move; that's correct.

## IN-SCREEN WALKTHROUGH (Chris, browser) — REQUIRED
1. Raise heating setpoint on the Systems page → heating DEMAND rises on screen (the frozen-245.6 bug is gone), delivered and EUI rise consistently. ✓/✗
2. Lower cooling setpoint → cooling DEMAND rises (was frozen at 69.10). ✓/✗
3. Delivered no longer exceeds demand — no "493 delivered vs 246 need" contradiction. ✓/✗
4. Toggle "follow comfort" → demand uses the envelope comfort setpoint; switch to "custom" + change → demand follows; switch back → returns. ✓/✗
5. Change a setpoint, confirm the whole panel still reconciles (every Δ = after−baseline, parts sum to totals — the consistency banner stays green). ✓/✗
6. Envelope (State 1) page is UNAFFECTED by the Systems-page setpoint (correct — it's free-running, doesn't depend on setpoints). ✓/✗

## What MUST NOT happen
- Do NOT make demand read the v40 setpoint unconditionally — that breaks inherit. Read the RESOLVED setpoint (override-else-comfort), mirroring delivered.
- Do NOT gate on baseline EUI / use "drift" language. The EUI moving is correct.
- Do NOT write the Systems-page setpoint back to the envelope/State-1 page — State 1 is free-running and must stay independent.
- Do NOT report "complete" — report "built, consistency check run, here are the numbers" or "gate failed, here's the residual."

## When to escalate
- Part 1: if the scope is larger than the two setpoints (other inputs read the wrong source), surface the full list before fixing — Chris decides whether to widen this brief or split.
- If mirroring `_computeHeatingOrCooling`'s resolution into the demand integrand turns out non-trivial (e.g. the resolution isn't a clean shared function), surface the structural question rather than duplicating logic.
- 3 approaches per failure, then stop.

## Final report
- Part 1 scope list (every input the integrand reads + which are wrong-source).
- The fix (one resolution, read by demand + delivered).
- Hand-calc vs engine for a heating + a cooling setpoint change (demand now moves).
- Inherit/override verified (all three transitions).
- Whole-panel consistency check result, with numbers.
- Confirmation State 1 envelope is untouched.
- Update the Notion note: Root Cause A fixed, setpoint single-sourced, scope (which inputs were affected).

## After this brief
With Root Cause A fixed, the safe order is: Brief 64 (diagram/heat-balance browser verification — Root Cause B, Chris's highest-stakes worry), then Brief 60 Part B (auxiliary energy, now lands in a consistent frame), Part C (parity guard), Brief 63 (bypass hour decompose), share_pct retirement.
