# Brief 75 — Full ventilation heat modelling + Bridgewater heating-demand-zero diagnostic

**Author:** Claude Chat (architect)
**Authorised by:** Chris (1 June 2026, post-Brief-74 close)
**Provisional number:** 75. Numbering rolls: door bug becomes Brief 76, interventions diagnostic harness becomes Brief 77, WWHR becomes Brief 78.
**Design note (canonical):** https://www.notion.so/372d645e05cc813caf57dd1f02d2a690 — "Brief 75 design note: Full ventilation heat modelling + Bridgewater heating-demand-zero diagnostic". Where this brief and the note disagree, the note wins.
**Lineage:** Closes the two findings stacked up at Brief 74 close: (i) mech vent ribbon emits 0 on over-gained buildings because the engine treats vent loss as heating-only, (ii) Bridgewater's heating_demand = 0 MWh/yr is suspect for a UK hotel. The two are likely linked.

---

## BEFORE DOING ANYTHING

1. **Confirm receipt.** Quote this brief's title and first paragraph. State tip of `main` SHA (expected: Brief 74 close commit).
2. **STATUS.md is fresh** (reconciled at Brief 74 close). Land this brief on disk at `docs/briefs/active/75_ventilation_heat_modelling.md` as P1's first commit. Open audit stub `docs/audit/75_ventilation_heat_modelling.md`.
3. **Capture the current anchor.** Run Bridgewater clean, full anchor table. Expected starting point per Brief 74 close: EUI ~133.6 kWh/m²·yr, Σ electricity ~416.9 MWh (post-Brief-74 P3-redux + Option A), heating demand 0 MWh, cooling demand ~301 MWh, vent fan total ~42 MWh.
4. **Diagnose before fix; audit before fix.** P2 is a read-only diagnostic with named outcomes. The fix shape in P3 onwards depends on which outcome applies.
5. **Browser verification is Code's job.** Code self-verifies via MCP browser tools. Chris does the close walkthrough.

---

## Scope

Four pieces, sequenced:

1. **Diagnose Bridgewater's heating-demand-zero finding** via two read-only engine experiments (P2).
2. **Engine refactor: separate vent thermal flow from heating compensation** (P3) — small, bounded, decouples physics from demand-math.
3. **Sankey: add MVHR heat recovery ribbon on IN side** (P4) — completes the ventilation heat story alongside the Brief 74 mech vent loss ribbon.
4. **Heating demand reconciliation + new anchor** (P5).

**Out of scope:** envelope U-value tuning (outcome-(b) of P2 deferral); zone-saturation logic redesign (outcome-(c) escalation); Energy Flows Sankey changes; supply-air-at-outdoor-temperature ribbon (likely below threshold, defer); door (Brief 76); interventions harness (Brief 77); WWHR (Brief 78); DHW load-shape (separate Brief 72 follow-on).

---

## Principles

1. **Diagnose before fix.** P2's outcome shapes P3-onward fix shape. Do not skip.
2. **Visualisation reads what engine emits.** P4 only adds the MVHR recovery ribbon to a value the engine already computes (or computes in P3). No new render-side physics calculations.
3. **No double-counting.** Adding MVHR recovery as IN ribbon + mech vent extract as OUT ribbon must net to the same effective ventilation impact on heating demand the engine has always produced. The demand number itself does not change as a result of these visualisation additions.
4. **Boundary discipline.** The engine refactor in P3 separates "heat physically leaving via vent" from "heat the heating system needs to compensate." Two distinct quantities, two distinct names, two distinct fields. Both can be zero independently.
5. **Same ventilation = same colour everywhere.** MVHR recovery ribbon uses the same vent teal as mech vent extract loss ribbon. Two sides of the same physical system.
6. **Anchor: capture, don't hardcode.** Bridgewater will rebaseline twice: after P2 (if outcome (a) — inputs corrected) and after P3+P4 (engine refactor). Document both movements; do not tweak to preserve any number.
7. **No quiet scope expansion.** Outcomes (b) and (c) of P2 are explicit escalations; do not attempt them within this brief.

---

## Parts (each = one commit unless noted)

**Part 1 — Precondition + anchor capture.**
Land brief on disk. Open audit stub. Run Bridgewater clean. Record full anchor in audit §1 (EUI, fuel splits, all per-service rollups, Heat Balance Σ gains + Σ losses + Net residual, internal gains breakdown by source, fabric losses breakdown, ventilation per-system).
Commit: `Brief 75 P1: STATUS reconcile + Bridgewater anchor capture + brief landing`.

---

### Piece 1 — Diagnose Bridgewater's heating-demand-zero finding

**Part 2 — Read-only engine experiments (no commits to engine).**

Two experiments, results logged in `docs/audit/75_*.md` §2-diagnostic. **No code changes; both experiments are read-only via MCP browser tools or a JSON fixture probe.**

**Experiment A — zero all internal gains:**
- Temporarily zero `occupancy.density.value`, `lighting.profiles[].magnitude`, `equipment.profiles[].baseload/active`, all `auxiliary.profiles[].magnitude` (or equivalent fields per engine reads).
- Run engine. Capture heating_demand, cooling_demand, heat balance Net residual.
- Restore original values.
- Expected: 80–150 MWh heating demand for a 4,125 m² UK hotel envelope.

**Experiment B — industry-standard hotel defaults:**
- Set occupancy density, lighting LPD, equipment EPD to CIBSE Guide F hotel values or NCM/SBEM hotel values (Code picks one; documents source in audit). Zero auxiliary.
- Run engine. Capture heating_demand, cooling_demand, Net residual.
- Restore original values.
- Expected: 30–80 MWh heating demand.

**Three named outcomes (decision tree):**

- **Outcome (a)**: Experiment A produces 80–150 MWh heating demand; Experiment B produces 30–80 MWh. **Bridgewater's current internal-gains inputs are too generous.** Fix in P3 is to retune Bridgewater's gains inputs to industry-standard values (engine code untouched). Brief 73 P6 outcome-(a) "CIBSE defaults accepted" was wrong — defaults were probably not actually CIBSE.
- **Outcome (b)**: Experiment A produces near-zero heating demand. **Envelope itself is the issue.** Fabric U-values or air permeability too low. Document, **defer to a fabric-tuning brief**. Do NOT attempt fabric tuning in Brief 75. Continue to P3 with original gains values for ventilation refactor (still valuable independent of fabric question).
- **Outcome (c)**: Experiment A produces a sensible number BUT Experiment B with industry-standard gains pushes back to near-zero. **The gains-saturation logic itself is too aggressive.** Engine bug. **STOP — escalate to a separate engine brief.** Do NOT proceed to P3 onwards.

Commit: `Brief 75 P2: Bridgewater heating-demand-zero diagnostic (outcome <a/b/c>)`.

---

### Piece 2 — Engine refactor: vent thermal flow as standalone quantity

**Part 3 — Engine: emit mech_vent_thermal_flow regardless of heating mode.**

**Problem statement:** Currently `_compute_mech_vent_loss` (or wherever the calculation lives, identified in Brief 74 P4 diagnostic) returns 0 when `heating_demand = 0`. Two separate quantities are being conflated:
- **Heat physically leaving the zone via mech vent extract** = `flow × ΔT × (1 − HRE) × hours`. Always non-zero when flow > 0. Never depends on heating mode.
- **Heat the heating system has to make up for vent loss** = `max(0, gains − losses)`'s contribution from the vent term. Mode-dependent; zero when gains saturate.

**Fix:** Split. Emit `mech_vent_thermal_flow_mwh` (the physics quantity) as a standalone engine output, computed from flow and HRE alone. The heating-demand calculation continues to consume this value exactly as today (so the heating_demand number does NOT change as a result of this refactor — only its decomposition into named components changes).

**Implementation:**
- Identify the existing call site (per Brief 74 P4 diagnostic — likely `systemsEngine.js _computeVentilation` or in the heat balance assembly).
- Add a new top-level field `result.heat_balance.annual.losses.mech_ventilation_thermal_kwh` (or wherever fits the existing schema) that is always populated from the physics formula.
- The existing field consumed by heating_demand math stays as-is; do not change demand calculations.
- The Sankey reads `mech_ventilation_thermal_kwh` (renamed from whatever Brief 74 P5 wired up).

**Falsifiability:**
- (a) Bridgewater's `mech_ventilation_thermal_kwh` is now non-zero. First-principles calculation: `(1435 × 0.25 + 2280 + 479) × ΔT × 1.005 × 1.2 × hours / 3600` ≈ 150–250 MWh order of magnitude depending on annual average ΔT. Engine output agrees within ~10%. **Caveat:** if Brief 74 P4 diagnostic identified a more specific calculation formula, use that; the above is rough order-of-magnitude.
- (b) Heat Balance Sankey now renders the mech vent extract ribbon at non-zero magnitude on Bridgewater.
- (c) **Heating demand value unchanged from P2.** This is critical — the refactor is a decomposition, not a recalculation. If heating_demand changes, double-counting has been introduced.
- (d) Anchor preserved for everything not directly affected: cooling_demand unchanged, DHW unchanged, fuel splits unchanged.

**State path coverage (Rule 14):** confirm in commit message that the change lands in the path Bridgewater actually executes. Per Brief 74 P3-redux finding, Bridgewater runs inline-legacy `_calculateInstantBaseline 'full'`, not `_calculateState3`. The mech_vent_thermal_kwh emission must land in whichever path Bridgewater actually executes; if both paths need it for consistency across project types, land both, documented per state.

Commit: `Brief 75 P3: mech_vent_thermal_flow as standalone engine quantity`.

---

### Piece 3 — Sankey: MVHR heat recovery ribbon on IN side

**Part 4 — Add MVHR recovery ribbon to Heat Balance Sankey IN-Gains.**

**Engine first:** P3 should already emit `mech_vent_thermal_kwh` (the gross extract heat). For MVHR recovery, the engine needs to also emit `mvhr_recovery_kwh` = `flow × ΔT × HRE × hours`, summed across systems where HRE > 0. This is the heat returned to supply air. If P3 didn't add this field, add it as part of P4's engine work — same physics layer, same calculation discipline.

**Sankey changes:** add MVHR recovery as an IN-Gains ribbon, positioned between Solar and People (air-movement gain category, distinct from internal gains and solar). Colour: same vent teal as the OUT-side mech vent extract ribbon. Same render-site coverage as Brief 73 P5-redux pattern:
- `HeatBalance.jsx` flatten / gain loop
- `BalanceSankey.jsx` gain render loop
- `HeatBalanceView.jsx` `ChartTotalsBadge` Σ-gains tally
- Any per-gain legend / right-strip breakdown

**Falsifiability:**
- (a) Heat Balance Sankey IN side shows MVHR recovery ribbon in vent teal. Bridgewater's value ≈ `1435 × 0.75 × ΔT × ... ≈ 40–70 MWh` (only mvhr_gf_public has HRE > 0). Engine output agrees within ~10% of first principles.
- (b) Σ gains rises by mvhr_recovery_kwh contribution.
- (c) OUT side mech vent extract still shows the gross extract (from P3); difference between extract and recovery = net ventilation heat loss = the real heat impact on heating demand.
- (d) Disabling mvhr_gf_public's HRE (set to 0%) collapses the MVHR recovery ribbon to zero (since bedroom_extract and public_toilet_extract are already at 0% HRE).
- (e) Net (gains − losses) residual: with both ribbons in place, residual should be approximately balanced — same as the existing balance, just with more visible flows on both sides.

Commit: `Brief 75 P4: MVHR heat recovery ribbon on Heat Balance Sankey IN side`.

---

### Piece 4 — Reconciliation + new anchor

**Part 5 — Final Bridgewater anchor + heating demand reconciliation.**

Run Bridgewater clean post-P3-and-P4. Capture full anchor table. Document:
- Internal gains total (whatever P2 outcome resolved to — possibly retuned in P3 if outcome (a))
- Envelope losses (fabric + infiltration + permanent vents — unchanged from P1 unless outcome (b)/(c))
- Mech vent extract gross (new from P3)
- MVHR recovery (new from P4)
- Mech vent net loss (extract − recovery)
- Heating demand (sensible UK hotel number expected — possibly 30–150 MWh)
- Cooling demand
- Heat balance Net residual
- EUI

Compare against pre-Brief-75 anchor. Document deltas with first-principles explanations.

**This commit is documentation-only**, no code changes.

Commit: `Brief 75 P5: final anchor + heating demand reconciliation`.

---

### Close

**Part 6 — Walkthrough + close. [HARD STOP for Chris's walkthrough]**

Code self-verifies via MCP browser tools; logs in audit §6. Chris's walkthrough at :5176:

1. P2 outcome documented honestly in audit §2 (a, b, or c). ✓/✗
2. Internal Gains → Heat Balance Sankey OUT side: Mech ventilation ribbon now visible and non-zero on Bridgewater. ✓/✗
3. Internal Gains → Heat Balance Sankey IN side: MVHR heat recovery ribbon visible in vent teal, between Solar and People. ✓/✗
4. Σ gains on Heat Balance includes MVHR recovery contribution. ✓/✗
5. Σ losses on Heat Balance includes mech vent extract contribution. ✓/✗
6. Net (gains − losses) residual approximately balanced (within a few MWh of zero). ✓/✗
7. Heating demand on Bridgewater is now non-zero AND sensible for a 4,125 m² UK hotel (30–150 MWh range). ✓/✗
8. Disabling mvhr_gf_public's HRE (set to 0%) collapses MVHR recovery ribbon to zero; restore. ✓/✗
9. Disabling all three vent systems collapses both mech vent extract AND MVHR recovery ribbons to zero; heating demand should rise (less heat lost via vent = less to compensate); restore. ✓/✗
10. Heating share validation still works (regression check). ✓/✗
11. DHW share validation still works (regression check). ✓/✗

If any item fails, treat as Tier-2 within the brief: short diagnostic, bounded fix, re-verify. Don't expand scope.

Commit: `Brief 75 P6: close + walkthrough + archive`. Archive `git mv docs/briefs/active/75_*.md docs/briefs/archive/75_*_COMPLETED.md`. Update STATUS.md. Repoint `current.md`.

---

## What MUST NOT happen

- **The heating_demand number changing as a result of P3's refactor.** P3 is a decomposition, not a recalculation. If demand changes, double-counting has been introduced — STOP, diagnose.
- Any change to cooling demand math, DHW demand math, or any service demand other than ventilation thermal flow decomposition.
- Engine code edits in P2. P2 is read-only diagnostic.
- Outcome (b) of P2 triggering fabric tuning inside Brief 75. Defer.
- Outcome (c) of P2 triggering engine logic redesign inside Brief 75. Escalate, separate brief.
- A new colour token registered for MVHR recovery — reuse vent teal already in palettes.
- A second engine field for "ventilation effect on heating" — that field already exists and stays untouched. P3 adds a NEW field for "physical thermal flow" separately.
- Quiet scope expansion — Tier-3 notes go in audit §future.
- DHW volume default moved off 80 L/p/day.
- Heating/Cooling/DHW share validation weakened.

---

## Escalation triggers

- **P2 returns outcome (c)** (gains-saturation logic over-aggressive) → STOP. Engine bug, separate brief.
- **P3 changes heating_demand numerically** → STOP. Double-counting. Diagnose before continuing.
- **P3 refactor turns out to require reshaping the State 3 vs inline-legacy split itself** → that's the same State-3-redesign territory as Brief 74's Option B. Escalate.
- **P4 MVHR recovery first-principles vs engine disagreement >10%** → STOP. Either engine bug or first-principles formula wrong; diagnose.
- **Three approaches tried on any single failure** → escalate.

---

## Final report (at close)

Commit SHAs per part. P2 outcome verdict. Anchor table P1 vs P5 with all changes from first principles. Walkthrough ✓/✗ table. Any Tier-3 items for future briefs.
