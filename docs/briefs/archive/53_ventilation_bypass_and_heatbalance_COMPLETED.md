# Brief 53 — Ventilation: summer-bypass toggle + heat-balance visibility on Systems

**Type:** Engine + UI brief (Tier 3). Mixed: one small engine addition (bypass), one visualisation build (heat-balance Sankey on Systems), two cleanups (sliders, residual).
**Depends on:** Brief 50 closed (recovery single-owner, hour-gated — confirmed). The cooling-hours probe (commit c64657c) confirmed recovery gating is CORRECT, so this brief ADDS a bypass on a sound base; it does NOT fix the recovery calc.
**Engine baseline:** Bridgewater clean EUI 128.20. The bypass toggle defaults to a setting that must NOT move the baseline (see Part 1) — any EUI change must come only from deliberately enabling bypass, derived from first principles.
**Canonical context:** Diagnostics note `367d645e-05cc-81af-93d7-fc57bfc45faf` → "Brief 50 CLOSED + cooling-hours MVHR-recovery probe".

---

## Background — why this brief exists

From Chris's Brief 50 walkthrough, two linked insights about ventilation:

**1. The model has no MVHR summer/solar bypass.** The cooling-hours probe (c64657c) proved the engine correctly gates recovery to heating-mode hours: recovery accrues only when `T_out < setpoint` AND `demand_h > 0` after gains. So when MVHR is added to a gains-heavy space, recovery correctly drops and cooling demand correctly rises — the engine is faithfully modelling an MVHR **without bypass**, which keeps recovering heat into a space that wants cooling. That is correct physics for a *badly-controlled* unit. But a well-specified MVHR has a **summer bypass** that stops recovery when the building wants cooling. The model currently cannot represent that, so MVHR looks worse than a real installed unit — and on reorder it can even show a net EUI increase (walkthrough images 7/8), because the summer cooling penalty isn't avoidable. **The fix: a bypass toggle that suppresses recovery in cooling-demand hours.**

**2. Ventilation's demand-shaping role is invisible.** Ventilation has TWO roles: (a) it changes what the building *needs* (ventilation loss + MVHR recovery shape the heating/cooling demand, BEFORE any system) and (b) it *consumes fuel* (fans, SFP, electricity). The Systems page only shows role (b) clearly, via the energy-flow Sankey. Chris needs to see role (a) — the step-by-step demand build-up `envelope → +internal gains → +ventilation → demand`, THEN `+systems → fuel` — while setting a building up, because (his words) "the vent is just as important as the window" and "this is why I want to see this before we start with the systems." The heat-balance Sankey that shows this exists in the Scenarios module (it renders gains-in / losses-out) but is absent from the Systems page where it's needed, and it currently shows cooling but not heating clearly.

This brief makes ventilation's demand impact visible (heat-balance Sankey on Systems) and makes the MVHR realistic (bypass). It also clears two smaller walkthrough findings (ventilation sliders, the recurring +10 residual).

---

## BEFORE DOING ANYTHING

1. Read this brief in full. Confirm receipt by quoting the title + Background insight 1's first line.
2. Read `CLAUDE.md` + STATUS.md + current.md. Read the cooling-hours probe script (the one committed in c64657c) so you understand the confirmed gating mechanism the bypass plugs into.
3. Read the frontend-design SKILL before building the Sankey (`/mnt/skills/public/frontend-design/SKILL.md` if applicable to this environment) and match the existing Scenarios heat-balance Sankey's visual language — this is a new instance of an existing pattern, not a new design.
4. Read the code you will touch BEFORE touching it:
   - `computeVentilationEnergy` in instantCalc.js — the per-hour recovery loop with the `min(theoretical_h, demand_h)` cap (confirmed by the probe). The bypass condition goes HERE.
   - `_calculateState2` ventilation section — the `(1−HRE)` demand-integral factor (Brief 50's single recovery owner) — to confirm the bypass also suppresses the State 2 demand-side recovery in bypass hours (else demand and fuel would disagree — the boundary-mismatch trap).
   - The existing Scenarios heat-balance Sankey component (walkthrough images 3, 6 show it: "IN — Gains / OUT — Losses", gains/losses ribbons, the "Net (gains − losses)" residual footer) — to reuse it on the Systems page.
   - The Systems page module + its existing energy-flow Sankey (walkthrough image 1) — where the second (heat-balance) Sankey will live alongside.
   - The ventilation system input controls (the sliders Chris wants removed — walkthrough item 3).
   - Whatever computes the heat-balance "Net (gains − losses)" residual that shows +10.1/+10.2 (images 3, 6) — to investigate it (Part 4).
5. Produce `docs/audit/53_ventilation.md` BEFORE code: where the per-hour recovery cap lives; how a bypass condition inserts; the first-principles predicted effect of enabling bypass on Bridgewater (how much cooling penalty it removes); and a note on the +10 residual's likely source.

---

## Scope

**In scope:** MVHR summer-bypass toggle (engine + the input control); the heat-balance Sankey on the Systems page (reusing the Scenarios component); removal of the ventilation sliders in favour of fixed-flow inputs; investigation + resolution (or honest documentation) of the +10 heat-balance residual.

**Out of scope (do NOT touch):**
- The recovery calculation / gating itself — confirmed correct by the probe. The bypass SUPPRESSES recovery in certain hours; it does not change how recovery is computed in the hours it does accrue.
- Brief 50's State 2 single-owner architecture — the bypass works WITHIN it (suppresses the same single owner in bypass hours), it does not reintroduce a second recovery path.
- DHW (Brief 52), comfort_band, granular-patch/SCOP, the metadata page.
- Moving MVHR wholesale out of Systems, OR renaming Operation → Ventilation. DEFERRED — Chris flagged both as ideas but they're premature (MVHR genuinely is a fuelled system and belongs in Systems; Operation may grow beyond ventilation). This brief instead shows ventilation in BOTH roles via the second Sankey, which is the actual need behind those ideas.
- The energy-flow Sankey (image 1) — leave as-is; the heat-balance Sankey is ADDED alongside it, not a replacement.

---

## Principles

1. **Bypass on a sound base.** The probe confirmed recovery gating is correct. Bypass is an *additional* suppression condition, not a recovery rewrite.
2. **Demand and fuel must stay reconciled** (boundary discipline). If bypass suppresses recovery, it must suppress it in BOTH the State 2 demand integral AND the computeVentilationEnergy fuel/recovery figure — the same hours, the same magnitude. A bypass that only touches one side reintroduces the exact decoupling Brief 50 fixed.
3. **Reuse, don't redesign.** The heat-balance Sankey is an existing Scenarios component placed on Systems. Match its visual language.
4. **A heat-balance view you don't trust is worse than none.** The +10 residual must be either explained-and-resolved or explicitly labelled with what it represents — not left as a vague "check inputs" warning on a view Chris is meant to rely on.
5. **Don't calibrate.** Bypass-off must hold the 128.2 baseline exactly. Bypass-on moves EUI by a first-principles-derivable amount (removed summer cooling penalty), predicted in the audit before the engine confirms it.
6. **Fixed-flow means fixed.** Ventilation sliders implying continuous variation are misleading for fixed-flow systems — replace with fixed inputs.

---

## Parts (one commit each)

### Part 1 — Ventilation audit (read-only) + bypass design
- Create `docs/audit/53_ventilation.md`: exact location of the per-hour recovery cap; the proposed bypass condition (suppress recovery in hours where the zone has cooling demand, i.e. `T_zone > cooling_setpoint` or `cooling_demand_h > 0` — pick the physically correct trigger and document it); confirmation that BOTH the State 2 demand integral and computeVentilationEnergy must honour the same bypass hours; first-principles prediction of bypass-on effect on Bridgewater.
- Decide the bypass default. RECOMMEND: default OFF, so the 128.2 baseline is unchanged and bypass is an opt-in modelling choice (a real building may or may not have it). Document the choice.
- Commit: `Brief 53 Part 1: ventilation audit + bypass design (read-only)`.
- **CHECKPOINT:** the bypass trigger condition is agreed and the bypass-on Bridgewater effect is predicted from first principles BEFORE any engine change.

### Part 2 — MVHR summer-bypass toggle (engine)
- Add a `summer_bypass` boolean to the ventilation system config (default per Part 1).
- In `computeVentilationEnergy`: in bypass hours (the agreed cooling-demand trigger), set per-hour recovery to 0.
- In `_calculateState2`: in the SAME bypass hours, suppress the `(1−HRE)` recovery credit so the demand integral and the fuel/recovery figure agree (Principle 2).
- Add the input control (a checkbox on the ventilation system editor).
- **Falsifiability (reuse the refbox HOT scenario from the probe):** with bypass OFF, the HOT-scenario numbers match the probe (recovery 30.55, cooling 15.40). With bypass ON, recovery in cooling hours → 0 and the cooling penalty drops (cooling demand falls toward the no-MVHR-heat-dumping figure). Predict both in the audit; confirm with the engine.
- Commit: `Brief 53 Part 2: MVHR summer-bypass toggle (suppress recovery in cooling-demand hours)`.
- **CHECKPOINT:** bypass OFF holds Bridgewater 128.2 exactly (no accidental baseline shift). Bypass ON moves EUI by the predicted first-principles amount. Demand-side and fuel-side recovery both drop by the same amount in bypass hours (grep/log to confirm reconciliation).

### Part 3 — Heat-balance Sankey on the Systems page
- Place the existing Scenarios heat-balance Sankey component on the Systems page, alongside (not replacing) the energy-flow Sankey. Two Sankeys: (1) heat-balance/demand (gains in → zone → losses out, incl. ventilation loss ribbons + MVHR recovery as a return), (2) the existing energy-flow demand→system→carrier.
- Ensure it shows BOTH heating and cooling clearly (walkthrough item 6: it currently shows cooling but "not showing heat" — fix that so the heating side of the balance is visible).
- Reactivity: the heat-balance Sankey must update live as ventilation/fabric/gains inputs change (same render-cycle reactivity as the KPI strip).
- Commit: `Brief 53 Part 3: heat-balance Sankey on Systems page (ventilation demand-shaping visible)`.
- **CHECKPOINT (Chris browser):** changing a ventilation input visibly moves the heat-balance Sankey's ventilation ribbons AND the demand; the step envelope→+gains→+ventilation→demand is legible.

### Part 4 — Investigate the +10 heat-balance residual
- The heat-balance Sankey shows "Net (gains − losses): +10.1/+10.2 kWh/m²·yr — large residual; check inputs" (images 3, 6). This is the envelope-residual open since Finding C. Trace what's in it: is it a genuine imbalance (a loss/gain term missing from the balance), a unit/boundary error, or a legitimate term that's just unlabelled (e.g. thermal mass storage swing, or the heating/cooling delivered not netted in)?
- Resolve OR document: either close the residual (if it's a real missing term, add it) or relabel the footer to explain what the residual legitimately represents (if it's expected), so the view is trustworthy. Do NOT leave a bare "check inputs" warning on a view Chris relies on.
- Commit: `Brief 53 Part 4: resolve/document heat-balance residual`.

### Part 5 — Remove ventilation sliders → fixed-flow inputs
- Replace the ventilation sliders (which imply continuous variation) with fixed numeric inputs appropriate to fixed-flow systems (walkthrough item 3).
- Confirm no numerical change to the baseline from the control swap (it's a UI affordance change, not a value change).
- Commit: `Brief 53 Part 5: ventilation fixed-flow inputs (remove misleading sliders)`.

### Part 6 — Walkthrough + close
- Report before/after; the bypass-on/off effect derived + confirmed; the residual resolution; the two-Sankey Systems layout.
- Chris browser walkthrough (checklist below).
- On sign-off: archive, STATUS.md (note bypass default + any new anchor only if bypass default changed it — it shouldn't), current.md repoint.

---

## Falsifiability targets (the fix is wrong if any fail)

1. **Bypass off = no change:** Bridgewater 128.2 exactly with bypass default-off. The control's mere existence doesn't move the baseline.
2. **Bypass on = derived effect:** enabling bypass moves EUI by the audit's first-principles prediction (removed summer cooling penalty), within rounding.
3. **Reconciliation:** in bypass hours, State 2 demand-side recovery AND computeVentilationEnergy recovery both → 0 (same hours, same magnitude). No demand/fuel decoupling.
4. **Refbox HOT scenario:** bypass-off matches the probe (recovery 30.55, cooling 15.40); bypass-on zeroes cooling-hour recovery and reduces the cooling penalty.
5. **Heat-balance Sankey on Systems:** present, shows heating AND cooling, reacts live to ventilation/fabric/gains edits.
6. **Residual:** the +10 is resolved or explicitly explained — no bare "check inputs" left.
7. **Sliders:** ventilation inputs are fixed-flow; baseline unchanged by the swap.

## What MUST NOT happen
- Do NOT change the recovery calculation or its hour-gating (probe-confirmed correct) — bypass only SUPPRESSES in bypass hours.
- Do NOT let bypass touch only one of {demand integral, fuel recovery} — both or neither, same hours.
- Do NOT default bypass ON if it shifts the 128.2 baseline (would conflate a modelling choice with the verified anchor).
- Do NOT move MVHR out of Systems or rename Operation (deferred).
- Do NOT replace the energy-flow Sankey — the heat-balance one is added alongside.

## When to escalate
- Part 1: the physically correct bypass trigger is ambiguous (zone-temp vs cooling-demand vs setpoint) — surface for Chris's call.
- Part 2 checkpoint: bypass-off shifts the baseline (accidental coupling), or demand/fuel don't both drop in bypass hours.
- Part 4: the +10 residual turns out to be a real missing term in the demand calc (not just a labelling gap) — that's a bigger finding; surface before "fixing" it.
- Three-approach limit per failure, then stop.

## Walkthrough checklist (Chris, browser)
1. Load Bridgewater clean. EUI still 128.2 (bypass default-off didn't move it). ✓/✗
2. Systems page now shows TWO Sankeys: heat-balance (demand) + energy-flow (fuel). ✓/✗
3. Heat-balance Sankey shows heating AND cooling clearly (not just cooling). ✓/✗
4. Change a ventilation input → heat-balance ribbons + demand move live; step envelope→+gains→+ventilation→demand is legible. ✓/✗
5. Enable MVHR summer bypass on a bedroom MVHR → summer cooling penalty drops; MVHR now reads as a saving (resolves the reorder "increase"). ✓/✗
6. Disable bypass → returns to the without-bypass behaviour (matches pre-brief). ✓/✗
7. The +10 residual is gone or now clearly explained. ✓/✗
8. Ventilation inputs are fixed values, no misleading sliders. ✓/✗
9. Baseline parity still holds: Systems EUI == Scenarios baseline EUI. ✓/✗

## Sequencing note
After this: granular-field-patch/SCOP-invariant (correctness) OR DHW basis (Brief 52) — Chris's call. The metadata-input-page brief still subsumes the comfort_band stopgap + num_rooms/peak_people_per_room. Brief 51 (panel surfacing) and the post-Brief-50 audit (State 3 region, FLAG 2b/4a greps) remain queued.
