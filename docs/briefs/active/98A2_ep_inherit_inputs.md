# Brief 98-A2 (v2): Same Building = Same Inputs — Make EnergyPlus Inherit NZA-Sim's Schedules & DHW Demand

**Replaces the earlier 98-A2 "investigate which engine is right" framing.** The correct frame is simpler and is the 0.5-ACH lesson applied: a valid comparison means BOTH engines eat IDENTICAL inputs. EnergyPlus is currently inventing its own schedules and DHW sizing — exactly as it was inventing its own 0.5 ACH airtightness. Fix: EnergyPlus inherits NZA-Sim's inputs wherever it can; where EnergyPlus structurally can't do something NZA-Sim does, we LABEL it, we don't chase it.
**Grounding:** `docs/audit/98A_valid_comparison.md` Claim-2 table. **This touches the EnergyPlus assembler ONLY. NZA-Sim `instantCalc.js` is NOT touched. The anchor does NOT move.**

## The reframe (why this is simple, not a research project)
98-A P0 already proved the pattern: EnergyPlus was on flat 0.5 ACH while NZA-Sim derived the real rate from q50. We didn't "investigate which airtightness is philosophically correct" — we fed EnergyPlus NZA-Sim's number. Same building, same input. The three Claim-2 gaps are the SAME disconnection:
- **small_power 4.7×** — NZA-Sim runs its own schedule; EnergyPlus runs a different default schedule. → EnergyPlus should inherit NZA-Sim's small-power profile.
- **lighting 2×** — same LPD, different hours. → EnergyPlus should inherit NZA-Sim's lighting schedule.
- **DHW ~10×** — the one that's not a schedule: the engines may compute different litres/day of hot-water demand. → feed BOTH the same litres/day (NZA-Sim's, since that's what the displayed engine and the report use).

None of this changes NZA-Sim. It makes EnergyPlus a faithful mirror of NZA-Sim's inputs so the residual that remains is PURE FABRIC PHYSICS (Claim 1), which is the only thing a comparison should surface.

## BEFORE DOING ANYTHING
1. Confirm receipt: quote the reframe + the "NZA-Sim untouched, anchor does not move" line.
2. Branch `chris/ep-inherit-nza-inputs` off `chris/engine-comparison-p0` (PR #13's branch — has the P0 airtightness fix + the audit; needed as the baseline). If #13 is merged to main by now, branch off main instead.
3. Land brief at `docs/briefs/active/98A2_ep_inherit_inputs.md` as first commit.
4. Read the 98-A audit, NZA-Sim's small-power/lighting schedule definitions + its DHW demand calc (`instantCalc.js` — READ ONLY, cite file:line), and the EP assembler's current schedule/DHW emission.
5. **EnergyPlus assembler only. `instantCalc.js` read-only. Anchors 132.6/126.0 byte-identical at start and close.**

## Goal
Make the main `/api/simulate` EnergyPlus inherit NZA-Sim's small-power schedule, lighting schedule, and DHW demand (litres/day → kWh) so both engines run identical inputs. Re-run the comparison. The remaining residual should collapse to Claim-1 fabric physics (thermal bridging, permanent vents, solver split) — all already named. Deliverable: `docs/audit/98A2_matched_inputs.md` showing Claim 2 now tight, Claim 1 unchanged.

## Part 0 — Small power: EP inherits NZA's schedule
1. Find NZA-Sim's small-power profile (the load shape / schedule it applies — the "Flat (uniform 8760)" or whatever the project actually uses). Cite it.
2. Emit that SAME profile into EnergyPlus's equipment schedule (replace EP's default hotel-equipment schedule). Same W/m², same hours.
3. Re-run EP. small_power should now match NZA within a few %.
4. Commit: `Brief 98-A2 P0: EP inherits NZA small-power schedule`.
**Falsifiable:** EP small_power now ≈ NZA 186 MWh (state both); the emitted EP equipment schedule matches NZA's profile.

## Part 1 — Lighting: EP inherits NZA's schedule
1. Find NZA-Sim's lighting schedule/hours. Cite it.
2. Emit it into EnergyPlus's lighting schedule (replace EP's `hotel_bedroom_lighting` default). Same LPD (already equal), same hours.
3. Re-run. lighting should match within a few %.
4. Commit: `Brief 98-A2 P1: EP inherits NZA lighting schedule`.
**Falsifiable:** EP lighting now ≈ NZA 39 MWh (state both); emitted schedule matches.

## Part 2 — DHW: feed both engines the same litres/day
1. This is the non-schedule one. Establish the single DHW demand figure: NZA-Sim uses 55 L/person/day → 61 kWh/m²·yr. Determine how EP currently derives its DHW (generator sizing) and why it lands ~10× lower. Then feed EP the SAME litres/day → same delivered demand NZA computes.
2. If EP's DHW object can accept a direct demand/use figure, wire NZA's. If it's sized differently, make the sizing produce NZA's litres/day.
3. Re-run. DHW demand should match; delivered may differ slightly by the gas/ASHP efficiency split — that's fine and expected, name it.
4. **Do NOT change NZA's 55 L/person/day.** Whether 55 is realistic is a SEPARATE question (see P4) — here we only make EP consume the same figure.
5. Commit: `Brief 98-A2 P2: EP inherits NZA DHW demand basis`.
**Falsifiable:** both engines' DHW demand in litres/day and kWh stated side by side and equal; delivered difference (if any) named as efficiency-split.

## Part 3 — Re-run the full comparison
1. Both engines on report_baseline_v1, all inputs now matched (ACH from P0-of-98A, schedules + DHW from here).
2. Rebuild the two-claim table: Claim 2 (systems) should now be tight (<5% per service, or named efficiency-split residual). Claim 1 (fabric) should be UNCHANGED from 98-A — same thermal-bridging/vents/split residual.
3. Write `docs/audit/98A2_matched_inputs.md`: the before/after, the now-small residual, the plain-English verdict — "with identical inputs, the engines agree to within [X], and the remaining gap is [named fabric physics]."
4. Commit: `Brief 98-A2 P3: full comparison on matched inputs`.
**Falsifiable:** Claim-2 services all <5% or named; Claim-1 fabric residual identical to 98-A; a stated overall agreement figure.

## Part 4 — Close + the ONE separate question, flagged not chased
1. `--fixture` anchors byte-identical (NZA untouched). STATUS, archive, current.md, push, PR open — NOT merged.
2. **Flag, don't chase:** now that the engines agree on matched inputs, note the ONE remaining real-world question for Chris — is NZA-Sim's flat small-power 8760h profile (and the 55 L/person/day) actually realistic for a 138-bed hotel, or should BOTH engines use a more realistic shared profile? This is a future baseline-realism question, NOT part of matching the engines, and it WOULD touch NZA-Sim/anchor — so it's Chris's separate call, logged not actioned.
3. Verdict: is the comparison now valid and presentable? Is 98-B (Results UI) clear to proceed?
**Falsifiable:** the realism question logged as a discrete future item with its anchor implication; a clear "98-B clear / not clear" verdict.

## MUST NOT
Touch `instantCalc.js` or NZA-Sim's outputs · move the anchor · tune EP toward NZA by fiddling outputs (inherit INPUTS, let outputs fall where they fall) · change NZA's small-power/lighting/DHW figures (only make EP consume them) · chase whether NZA's inputs are "realistic" here (P4 logs it, doesn't fix it) · merge unattended.

## Escalate (stop-and-write)
EP's schedule/DHW objects genuinely can't accept NZA's profile (report the structural limit, label it like thermal bridging) · after matching inputs a Claim-2 gap REMAINS >5% (then it's a real engine difference, not a schedule — document it) · matching DHW would need NZA-side changes (stop — that's the P4 realism question, Chris's call).

## Independent review (mandatory)
Claude Chat reads: the three inherited inputs (EP now emits NZA's schedules/DHW — cite the before/after), the re-run Claim-2 table (now tight), Claim-1 unchanged, anchors byte-identical, NZA untouched. Builder doesn't grade itself.

## Close
Archive · STATUS · current.md · PR open · deliverable `docs/audit/98A2_matched_inputs.md` — the engines agreeing on identical inputs, residual = named fabric physics. Then 98-B builds the Results UI + perturbation tester on a comparison that's finally valid.
