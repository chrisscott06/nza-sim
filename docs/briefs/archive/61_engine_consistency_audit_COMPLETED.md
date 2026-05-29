# Brief 61 — Engine source-consistency audit (read-only): one engine, three views, prove every Systems-module change propagates correctly

**Author:** Claude Chat (architect). **Authorised by:** Chris.
**Type:** Tier 3, READ-ONLY DIAGNOSTIC. This brief produces a MAP of what is and isn't consistent. It does NOT fix anything. Fixes are scoped separately, AFTER the map exists, grouped by root cause.
**Repo:** github.com/chrisscott06/nza-sim. Verification on the running model (Systems page). Back up the DB before starting (read-only, but safe).
**Canonical note:** Notion `367d645e-05cc-81af-93d7-fc57bfc45faf`. Read the recent entries: the GOVERNING PRINCIPLE (gate on consistency, not baseline EUI), the "every number must stack up" rule, and the setpoint / vent-flow / share_pct source-mismatch findings.

## Why this brief exists (Chris, verbatim intent)
"It's all the same engine. State 1/2/3 are just how we view it. If we change the setpoint on the Systems page, everything shown on the Systems page must compute from that setpoint — the heat balance graph on the Systems page needs to feed from the setpoint on the Systems page, not a frozen State 1 model. I want a full sweep of every system, changing stuff and seeing if it comes out as we'd expect. I can't keep finding these one at a time, and I can't keep looking at numbers that don't stack up."

## The core principle (the thing being audited)
**One engine, three VIEWS — not three engines.** State 1 (envelope / free-running), State 2 (demand at setpoints), State 3 (systems → delivered → fuel → EUI) are views of the same physics. A change made in a view must propagate to EVERY number in EVERY view that depends on it. **The Systems page is its own coherent model state:** everything displayed there (demand, heat balance, energy flows, EUI, carbon) must compute from the inputs AS SET on that page — never read back to a frozen earlier-state value. This audit proves whether that is true, input by input.

---

## BEFORE DOING ANYTHING
1. Read this brief; confirm receipt by quoting the title + the core principle.
2. Read CLAUDE.md / STATUS.md / current.md and the Notion note entries named above.
3. Confirm: this is READ-ONLY. No engine edits, no data-model edits, no fixes. The deliverable is a diagnostic document. If you find yourself wanting to fix something, STOP and add it to the findings list instead.
4. Back up the DB (safety, though read-only).
5. Land this brief at docs/briefs/active/61_engine_consistency_audit.md.

## Scope
**In scope (read-only):** systematically change each Systems-module input and record whether demand, heat balance, energy flows, and EUI respond consistently and correctly; verify the same quantity shown in multiple views agrees; verify every number on each panel stacks up (Δ = after−baseline, parts sum to totals, cross-references match); verify baseline-edit vs equivalent-intervention parity.
**Out of scope:** any fix. Any engine/data-model change. Interventions UX (this is about the baseline Systems module + its views first, per Chris). The fixes that fall out of this are separate briefs.

## Gates — CONSISTENCY, not baseline EUI
This audit does NOT check whether any number equals a remembered baseline. The word "drift" is not used. For each input changed, the checks are:
- **Direction:** the affected demand/fuel moves in the correct direction.
- **Magnitude:** the move matches a first-principles hand-calc (recorded per input).
- **Propagation:** demand, heat balance, energy flows, AND EUI all move together — no view lags or stays frozen.
- **Source:** the calc and the displays read the input AS SET on the Systems page, not a frozen earlier state.
- **Reconciliation (every-number-stacks-up):** on every panel, every Δ = after−baseline exactly; parts sum to totals exactly (no "off by 0.2"); the same quantity in two places matches.
- **Parity:** the change applied as a baseline edit == applied as the equivalent single intervention (demand, fuel, EUI).

---

## PART 1 — Setpoints + the known source-mismatch cases (start here — already-found bugs)
Begin with what Chris already found broken, to characterise the disease precisely.
- **Cooling setpoint:** sweep 24 → 21 → 18. Record cooling demand, heat balance, energy flows, EUI at each. (Known symptom: cooling demand frozen at 141.6, EUI moved +0.4. Confirm and locate: what does the cooling-demand integrand read for T_cool, and what does the heat-balance display read?)
- **Heating setpoint:** sweep 21 → 24 → 28. (Known symptom: EUI moves but heat-balance graph doesn't. Confirm and locate: calc reads the setpoint, display reads what?)
- For BOTH: produce the read/write map — which field the slider writes, which field the demand integrand reads, which field each display reads. State whether they are the same source.

## PART 2 — Systems sweep (every Systems-module input)
For each input below: change it through 2–3 values, hand-calc the expected demand/fuel direction+magnitude, and record whether demand / heat balance / energy flows / EUI all move together and correctly, all sourced from the Systems page.
- Heating system swap (e.g. gas boiler ↔ VRF ↔ ASHP) — delivered/fuel/carrier change correctly?
- Heating efficiency (SCOP/η) — fuel scales inversely, demand unchanged?
- Cooling system swap + cooling efficiency (SEER/EER).
- DHW system swap + DHW efficiency + DHW basis.
- Ventilation flow rate (per system) — demand AND fan power move? (Brief 59 fixed the intervention path; confirm the BASELINE Systems-page path.)
- SFP — fan power moves, demand unchanged?
- Heat recovery (HRE) — demand drops with recovery, by hand-calc amount?
- Summer bypass — cooling penalty behaves correctly; **decompose the bypass-firing hours** (the parked Brief 53 question): of hours bypass fires, how many are genuine cooling hours vs hours the building wanted heating recovery? (This settles whether bypass-on-costs-more is correct physics or a lagged-trigger misfire.)
- Lighting control + small power (Brief 58 C coupling) — electricity AND gain move together?

## PART 3 — Cross-view + reconciliation sweep
- For each of the views (Calc trail, Breakdown, Heat balance, Energy flows): does the SAME quantity (e.g. cooling demand, total electricity) read identically across all views? List any mismatches.
- On every panel showing totals: confirm Δ = after−baseline for EVERY row (the +714 headline-Δ class of bug), and parts sum to totals (the +9 reconcile class, and the 0.2–0.3 fuel-vs-headline class). Record any that don't.

## PART 4 — Baseline vs intervention parity
For a representative set of changes (vent flow, a SCOP, a setpoint, HRE): apply each as a baseline Systems-page edit AND as the equivalent single intervention. Record whether demand/fuel/EUI are identical. List any divergence (this is the disease that caused the vent-flow bug).

---

## Deliverable — ONE consistency matrix + findings
Produce `docs/audit/61_consistency_matrix.md` containing:
1. **The matrix:** rows = every input swept; columns = demand / heat balance / energy flows / EUI / parity. Each cell: PASS (with the actual before→after numbers + hand-calc) or FAIL (with what was wrong).
2. **Inconsistencies list, GROUPED BY LIKELY ROOT CAUSE** — not one-by-one. Today's bugs clustered: v25/v40 source mismatches; calc-vs-display source mismatches; share_pct dead-state. Group findings the same way so fixes can be scoped per root cause, not per symptom.
3. **The read/write/display source map** for setpoints and any other input found inconsistent — which field is written, which the calc reads, which each display reads.
4. **A recommended fix-brief breakdown:** given the grouped root causes, propose how many follow-up briefs and what each covers.

## What MUST NOT happen
- NO fixes. This is diagnosis only. Wanting to fix something = add it to the findings, don't touch it.
- NO baseline-EUI gating, NO "drift" language. Gate on consistency (direction/magnitude/propagation/source/reconciliation/parity).
- Don't fix-as-you-go even if a fix looks trivial — today's thrash came from fixing before the full picture existed. The map first.
- Don't stop at "the per-service rows reconcile" — check the WHOLE of every panel (headline, totals, cross-references), every number.

## When to escalate
- If an input can't be cleanly swept (UI won't let you set it, or it's entangled), note it and move on — don't force it.
- If a finding suggests a much larger architectural issue (e.g. State 1/2/3 genuinely run as separate engines rather than views), surface it immediately rather than burying it in the matrix.
- 3 attempts to characterise a finding, then record what you know and move on.

## Final report
- The consistency matrix (every input × every view, pass/fail + numbers).
- The grouped-by-root-cause inconsistencies list.
- The source map for setpoints + any other inconsistent input.
- The recommended fix-brief breakdown.
- Update the Notion diagnostics note with the grouped findings.

## After this brief
The fixes — scoped from the matrix, grouped by root cause. Likely clusters: (a) calc-vs-display source unification (the setpoint/heat-balance bugs); (b) any remaining v25/v40 mismatches; (c) share_pct retirement (already scoped); (d) bypass-trigger correctness (if the hour-decompose shows misfiring). Plus the still-queued: Brief 60 Part A panel fixes (headline-Δ + intervention selector), Part B auxiliary energy, Part C parity guard. The matrix tells us the real order.
