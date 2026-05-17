# Brief 29 — Strategic implications note

**Status:** Decision document. Chris decides. No fixes, no fix-brief.
**Date:** 2026-05-17. Author: Claude.

---

## 1. What the architecture actually does, vs what the briefs claim

| Surface | What docs / briefs / UI claim | What the code actually does |
|---|---|---|
| Top-bar "Static" toggle | "In-browser physics — instant calculation." | True. JavaScript implementation in `instantCalc.js`. Lumped 2-node mass model, per-element setpoint accumulators, sol-air for opaque, T_out for glazing/vents/leakage. |
| Top-bar "Dynamic" toggle | "Last EnergyPlus run." Implicit claim: full-EP heat balance. | **Half-true.** EP runs to produce hourly T_zone trace + solar incident per face. The demand integral, per-element loss accumulators, and free-running stats are then computed **in Python** in `sql_parser.py::_get_heat_balance_state1`, using a Static-shaped formula with EP-derived T_zone substituted in. Only 3 of ~25 emitted Output:Variables are consumed; EP's own loss meters (`Zone Infiltration Sensible Heat Loss/Gain Energy`, `Zone Ventilation Sensible Heat Loss/Gain Energy`, `Surface Inside Face Conduction Heat Transfer Energy`) are emitted to SQL and never read. |
| EP run mode "envelope-only" | "Envelope alone against the weather. No occupancy, no systems, no operable windows." (Docstring `epjson_assembler.py:1186`, `HeatBalance.jsx EnvelopeOnlyBadge`) | **Partly false.** The emission strips operable windows (post Commit A `39a828c`) and zeros internal-gain densities. But it keeps: VRF terminal units (5 entries on Bridgewater), `ZoneVentilation:DesignFlowRate` (5 entries, balanced-mechanical OA at 8 l/s/person), `DesignSpecification:OutdoorAir`, sizing periods, sizing-zone calculations. The intent was to mute these with a thermostat widened to ±60/+100 °C. **The mute did not work.** Issue #13 evidence: mean T_air sits at 21.1 °C with 29.5% of all hours pinned to exactly 21.0 °C; stripping the HVAC chain drops it to 14.7 °C (6.4 K lower) with proper free-running variability. The VRF + DesignFlowRate chain delivers tempered air independent of the thermostat. |
| "Static vs Dynamic divergence is the lumped 2-node mass model" (footnotes pre Commit B) | Branded as the dominant physical mechanism. | Three rounds of evidence (door bug, vent topology mismatch, T_zone clamping) say the dominant divergences have been: (a) hidden integrand terms, (b) wrong-correlation defaults applied to wrong building topology, (c) HVAC chain not muted as documented. The lumped 2-node attribution was an invented mechanism in three places (`ComfortDemandCard.jsx`, `BuildingSummaryView`, `gains/canvas/SummaryView.jsx`) — removed in Commit B. |
| Brief 28b Part 3 "multi-layer CTF fix" | Queued remedy that would close the lumped-2-node vs EP CTF gap. | The premise was that Dynamic uses EP's CTF and Static uses lumped 2-node, so closing the gap means upgrading Static. **In current code, Dynamic doesn't actually consume EP's CTF results — it just reads EP's T_zone trace.** EP's per-element conduction heat transfer (the CTF output) is emitted to SQL and ignored. Brief 28b Part 3 would upgrade Static's wall model, but Dynamic would still be Static-with-EP-T_zone afterwards. |

The pattern: the UI promises a more sophisticated dual-engine architecture than the code actually delivers. Static is what it says. Dynamic is two-thirds Static with EP providing the T_zone trace and the solar incident; the rest is Python re-implementation of the same Static formulas.

---

## 2. What it would cost to make Dynamic genuinely use EP per-element outputs

### Option C (from §3 below) — full-EP Dynamic
Make `sql_parser.py::_get_heat_balance_state1` consume EP's per-element variables directly and stop the Python recompute.

**Concrete scope:**
- Replace Python recompute with reads from:
  - `Surface Inside Face Conduction Heat Transfer Energy` (per BuildingSurface:Detailed) — sum by element_type to get per-element conduction loss using EP's full multi-layer CTF + sky long-wave + sol-air boundary conditions.
  - `Zone Infiltration Sensible Heat Loss/Gain Energy` (per zone) — EP's integrated infiltration loss, accounts for hour-by-hour wind/stack on the `DesignFlowRate` ach.
  - `Zone Ventilation Sensible Heat Loss/Gain Energy` (per zone, summed across all `ZoneVentilation:*` objects) — EP's louvre + permanent-vent loss with WindAndStack stack term included.
  - `Zone Windows Total Transmitted Solar Radiation Energy` — EP's transmitted solar with SimpleGlazingSystem incidence-angle adjustment.
- Add setpoint-convention accumulators (Brief 28k shape) so `losses_at_setpoint.{element}.heating_loss_kwh` is emitted with EP-derived values, not free-running.
- Resolve Issue #13 first (so the T_zone trace is genuinely free-running, not pinned at 21°C by VRF supply air).

**Estimated effort:** 3–5 days of focused work.
- Day 1: Issue #13 fix — strip HVAC + thermostat + sizing + DSOA + DesignFlowRate from State 1 epJSON properly, re-run, confirm T_air drops to defensible free-running range.
- Day 2–3: Rewrite `_get_heat_balance_state1` to consume EP per-element variables. Map EP surface names back to building element types (external_wall / roof / ground_floor / glazing). Sum by group. Add setpoint-convention accumulators.
- Day 4: Re-validate Bridgewater. Numbers will move. Expect Dynamic heating demand to drop ~50–80 MWh (correcting the +6.4 K T_zone artefact removes a chunk of false setpoint deficit; using EP's surface conduction instead of `U × area × ΔT_air` adds back per-element transient effects).
- Day 5: Update docs, integrand-vs-display invariant test, cross-engine reconciliation.

**Why this matters:** Brief 28b Part 3 (CTF upgrade for Static) was queued under the assumption that Dynamic is already CTF. It isn't. If Static is upgraded to CTF without first making Dynamic consume EP's CTF, the two engines remain a different problem: both lumped, one of them slightly less so. The order is **Dynamic-uses-EP first**, then Static catch-up second.

---

## 3. Path A / B / C / D — recommendation

The framing in my Part 1 sign-off message offered three paths (A: ship both / B: downgrade Static / C: fix Static). Part 2's structural finding adds a fourth and changes the calculus.

### Path A — ship both engines as-is
Cost: 0 days. Risk: high. Users see Static and Dynamic side-by-side and reasonably assume Dynamic is the more authoritative number. Today on Bridgewater, "Dynamic" reports 209.8 MWh heating demand from a T_zone trace pinned at the heating setpoint by VRF supply air the user can't see. We'd be shipping a measurement artefact branded as the more accurate engine. Bridgewater's roadmap, CRREM trajectory, and Intervention Model all inherit this baseline. Defensible only if we accept that the audit findings stay in `docs/audit/` and not in the UI.

### Path B — rename "Dynamic" honestly + leave the calculation as-is
Cost: 0.5–1 day. Rename "Dynamic" in the top-bar toggle and all module headers to something accurate like "Static + EP weather" or "Static (EP-driven T_zone)". Add a tooltip explaining that EP runs to produce hourly T_zone and solar; the demand integral remains the Static formula. Resolves the truth-in-labelling violation without touching the calculation. The +8% Static-vs-the-other-thing Δ is then small enough to caveat as "two formulations of the same integral".

### Path C — fix Static (legacy plan, Brief 28b Part 3)
Cost: 5–10 days. Replaces Static's lumped 2-node with multi-layer CTF. Resolves a problem that the door bug + topology mismatch + #13 clamping suggest was never the dominant cause of Static-Dynamic divergence. Now that Dynamic is known not to be CTF-driven either, this path is **upgrading Static to match a Dynamic that doesn't exist.** Highest cost for least clarity gain.

### Path D — fix Dynamic (make it genuinely EP, then decide about Static)
Cost: 3–5 days (per §2). This is the path that aligns architecture with UI claim. Steps:
1. Fix Issue #13 (proper State 1 emission strip) — 1 day.
2. Rewrite `_get_heat_balance_state1` to consume EP per-element variables + emit setpoint convention — 2 days.
3. Re-run baseline, re-author Part 2 of the audit with EP-native numbers — 1 day.
4. Re-author Part 3 (cross-engine reconciliation) — was blocked, now becomes meaningful — 1 day.
5. Then decide whether Static needs a CTF upgrade (Brief 28b Part 3) based on the real magnitude of the gap.

**Recommendation: Path D.**

Reasons:
- Brief 29's whole purpose is to defend numbers from first principles. With Dynamic as Static-with-EP-T_zone, the cross-engine reconciliation that Part 3 was supposed to produce is structurally impossible — you cannot defend a Δ between two formulations of the same formula by appealing to physics mechanisms, because the formula is the same.
- Path B (rename) is honest about the current state but leaves NZA Sim with a single engine for the foreseeable future. The product's selling point — "Static for quick iteration, Dynamic for the BRUKL-style authoritative number" — is then a misleading marketing position.
- Path C upgrades Static to a model that nobody has against to validate. Brief 28b Part 3's stated purpose was "match Dynamic's CTF accuracy" — but Dynamic isn't using CTF for losses today, so the validation target doesn't exist until Path D lands.
- Path A is acceptable only as a temporary stance pending Path B or D. It's not stable.

**Sequencing recommendation:**
- Land Path D (3–5 days) before any further audit modules (Parts 4–8) — because Parts 4–8 will inherit the same Static-with-EP-T_zone pattern for State 2 / State 2.5 / State 3, and the same fix has to be applied there too. Better to land the pattern once on Building, then propagate.
- After Path D, decide on Static. Likely answer: Static remains the "in-browser instant" mode (sub-second feedback as user edits inputs) with explicit caveat that it's a simplified model. Dynamic becomes the authoritative number for any decision that ships to a client. Brief 28b Part 3 (CTF for Static) then becomes optional polish, not blocking.
- Issue #6 (integrand-vs-display invariant) lands as part of Path D — the rewritten parser is the natural place to add the runtime assertion.

---

## 4. What changes for Brief 28b Part 3 given Dynamic isn't using EP's CTF today

Brief 28b Part 3 was the queued "fix the Static-Dynamic divergence by giving Static CTF" plan. Three things change now:

1. **The validation target moves.** Pre-discovery: Brief 28b Part 3's success metric was "Static matches Dynamic within X%". Post-discovery: matching Dynamic-as-currently-implemented means matching a Static formula reading EP T_zone, which Brief 28b Part 3 doesn't help with (the formula stays the same; only the wall model changes). The metric becomes "Static matches a Dynamic that doesn't exist yet."

2. **The cost-benefit changes.** Pre: Static at ~16°C mean and Dynamic at ~21°C (apparent 5K gap, large enough to justify a multi-week CTF rewrite). Post: with #13 fixed, Dynamic's true free-running mean is ~14.7°C — *colder* than Static's 16.1°C. The "gap" reverses direction. Whether a CTF upgrade still moves Static the right way is now uncertain.

3. **The sequencing changes.** Brief 28b Part 3 was scheduled to run after Brief 28-IM. Post-29, it should run *after* Path D — i.e. after Dynamic genuinely uses EP per-element outputs, so the Static-vs-Dynamic comparison has a fixed target to converge to.

**Recommendation:** mark Brief 28b Part 3 as **paused** in `docs/briefs/`. Re-evaluate priority once Path D lands and the real Static-vs-Dynamic gap (with both engines doing what they say) is measurable.

---

## 5. What I am NOT doing in this note

- Not authoring the post-audit fix brief.
- Not committing any of the Path D work.
- Not deprecating Brief 28b Part 3 unilaterally.
- Not estimating consultancy / commercial implications of "Static + EP weather" being the public product description.

You decide. Standing by.
