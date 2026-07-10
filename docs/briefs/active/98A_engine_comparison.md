# Brief 98-A: Same-Building Engine Comparison — Airtightness Fix + Two-Claim Residual

**The reframe that matters:** every prior NZA-vs-EnergyPlus divergence number was measured while the two engines read DIFFERENT buildings (stale config: gas-not-VRF, MEV-not-MVHR, lighting 0.8-not-1.0, DHW gas-not-hybrid — all now fixed via 98-pre-b/c/d). Those numbers are void. This brief produces the FIRST valid comparison: same building, both engines, residual split into physics vs arithmetic, nothing tuned.
**Grounding:** the two Brief 98 design notes (NZA-Sim product page); the 98-pre audit chain. Bible: specifics with citation + magnitude, or silence.
**This is P0+1 of the reframed Brief 98.** The Results-page UI + perturbation tester is Brief 98-B, written after this lands honest numbers.

## BEFORE DOING ANYTHING
1. Confirm receipt: quote the reframe + Goal.
2. Branch `chris/engine-comparison-p0` off main (PRs #10, #11 merged — confirm). Land brief at `docs/briefs/active/98A_engine_comparison.md` as first commit.
3. Read CLAUDE.md, STATUS.md, both design notes, `nza_engine/systems_from_v40.py`, and NZA-Sim's `deriveOperationalACH` (the `n50 = q50·A_env/V; ach = n50/20` rule — cite its file:line).
4. **NZA-Sim's instant engine is NOT touched.** Anchors 132.6 / 126.0 byte-identical at start and close. Only the EnergyPlus assembler's infiltration input + a comparison script change.

## Goal
Make the main `/api/simulate` EnergyPlus read the SAME airtightness basis NZA-Sim uses (envelope-derived, not the flat 0.5 ACH default), then produce a documented two-claim residual on report_baseline_v1: **Fabric→Demand** (the physics — where real divergence lives) and **Demand→Delivered** (the arithmetic — should be tight). Deliverable: `docs/audit/98A_valid_comparison.md` with the residual table, every gap named as physics / accounting / known-limitation, nothing tuned.

## The airtightness problem (the crux — Part 0)
The main EnergyPlus uses a flat **0.5 ACH** default (`epjson_assembler.py`) — a volume-based rate that ignores the envelope entirely. NZA-Sim derives infiltration from the envelope: `n50 = q50·A_env/V; ach = n50/20`. These are DIFFERENT PHYSICAL QUANTITIES (volume-basis vs envelope-basis), so the two engines currently model different air leakage — a guaranteed divergence that is a WIRING bug, not physics. Fix: feed NZA-Sim's envelope-derived operational ACH into EnergyPlus's infiltration object, on the same basis.

## Part 0 — Airtightness: match the basis (investigate, then wire)
1. **Investigate (fast, not a rabbit hole):** NZA-Sim's `deriveOperationalACH` produces an operational ACH from q50. EnergyPlus `ZoneInfiltration:DesignFlowRate` accepts several bases: `Flow/Zone`, `AirChanges/Hour`, `Flow/ExteriorArea`. Determine which EnergyPlus input makes the EP infiltration equal NZA-Sim's derived rate on the SAME basis. Report the mapping + any unit conversion, cited.
2. **Wire it:** replace the flat 0.5 ACH with NZA-Sim's derived operational ACH (via the same `deriveOperationalACH` logic, mirrored server-side — cite it, don't reinvent the divisor). If the bases can't be made equivalent exactly, wire the closest honest match and NAME the residual — do not fake equivalence.
3. Commit: `Brief 98-A P0: EnergyPlus infiltration on NZA-Sim's envelope-derived basis`.
**Falsifiable:** EP's infiltration for report_baseline_v1 now equals NZA-Sim's operational ACH (state both numbers); the emitted `ZoneInfiltration` object shows the derived rate, not 0.5; if a basis residual remains, it's stated with magnitude.

## Part 1 — The two-claim residual (compute, don't tune)
1. Run both engines on report_baseline_v1 (post-P0). NZA-Sim via anchor; EP via `/api/simulate` (0 fatal; version 25-2-0).
2. **Claim 1 — Fabric→Demand (the physics):** compare heating demand, cooling demand, and their monthly shapes (correlation r). This is where blended-zone vs full-heat-balance genuinely differ. Name each residual: solver-convention split, thermal mass, thermal bridging (EP 0 vs NZA 24.0), permanent vents (EP-absent) — magnitude + mechanism each.
3. **Claim 2 — Demand→Delivered (the arithmetic):** given each engine's own demand, compare delivered energy per service (heating/cooling/DHW/fans/lighting) and the fuel split. This SHOULD be tight — systems is near-arithmetic. Any >5% gap here is a candidate BUG (flag it), not physics.
4. Write `docs/audit/98A_valid_comparison.md`: the two-claim table, NZA | EP | Δ% per metric, monthly r, every residual named physics/accounting/known-limitation. Plain-English verdict: how well do the engines agree once they read the same building?
5. Commit: `Brief 98-A P1: two-claim residual on same-building baseline`.
**Falsifiable:** table complete, no blank cells; each Claim-1 residual named + magnitude; each Claim-2 >5% gap flagged as candidate bug; monthly r present; explicit "same building confirmed" line (both engines' key inputs — U-values, areas, systems, ACH — tabulated equal).

## Part 2 — Close + hand to 98-B
1. `--fixture` anchors byte-identical. STATUS, archive brief, current.md, push, PR open — NOT merged.
2. Verdict section: is the divergence now mostly physics (defensible) or are there Claim-2 bugs to fix before the UI? Recommendation on whether 98-B (Results UI + perturbation tester) proceeds now or a bug-fix comes first.
3. Commit: `Brief 98-A P2: close + comparison verdict`.

## MUST NOT
Touch NZA-Sim's `instantCalc.js` or its outputs · tune EITHER engine toward the other (name residuals, never close them by fiddling) · reinvent the q50→ach divisor (mirror NZA-Sim's, cite it) · fake basis-equivalence for infiltration · build the Results UI here (that's 98-B) · merge unattended.

## Escalate (stop-and-write)
The infiltration bases genuinely can't be reconciled (report the physics reason; wire closest + flag) · a Claim-2 systems gap >5% appears (it's likely a bug — document, don't tune) · a SECOND EP fatal blocks the run (the VRF-cooling node issue was flagged earlier) · EP version ≠ 25-2-0.

## Independent review (mandatory — engine data-flow, correctness-invisible)
Claude Chat reads on GitHub: the infiltration basis mapping + the mirrored ACH derivation, the two-claim table, confirmation nothing was tuned, the "same building" input-parity tabulation, and anchor invariance. Builder doesn't grade itself.

## Close
Archive · STATUS · current.md · PR open · the deliverable is `docs/audit/98A_valid_comparison.md` — the FIRST valid NZA-vs-EnergyPlus comparison, reviewed with Chris. Then Brief 98-B builds the Results-page interrogation UI + perturbation tester on top of honest numbers.
