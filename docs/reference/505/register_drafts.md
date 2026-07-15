# 505 P02 — comment-register DRAFTS

> **STATUS: DRAFTS.** Nothing here has been sent or shared with 505. **These route to Claude Chat for
> tone review first** (the brief's gate), *then* to Chris. Not review-complete.
> **Framing rule:** assumption-visible throughout — "we reproduce your figure when we adopt assumption X;
> X is worth Y" — never "505 is wrong". Several items are good analysis in the wrong column: the proposal
> is to **relabel, not delete**. Method divergences offer a **joint session**, not a verdict.

Each entry: **bin** (1 Convention / 2 Method / 3 Classification / 4 Agreement) · **flag** (COMMENT /
MUST-RESOLVE-BEFORE-MERGE). Evidence in `docs/audit/505_reconciliation.md` + `505_assumptions_extracted.md`.

---

## MUST-RESOLVE-BEFORE-MERGE (3)

### R1 — Occupancy → 1.6 counted as a saving · bin 3 (Classification) · MUST-RESOLVE
The report's largest low-cost item (¶165; workbook *Consolidation* r19: "Energy saved by reducing average
occupancy to 1.6" — 120.6 MWh / 28.6 EUI). We **reproduce it** under the stated assumption (our engine gives
111.8 MWh / 26.5 EUI at 1.6 people/room, within 8%). The point is classification, not the number: reducing
occupancy is a **regime/sensitivity scenario**, not an efficiency intervention, and NZA's shared sections use
a **CRREM gross-metered** baseline. Presenting a headcount reduction as an EUI "saving" alongside gross-metered
figures would read inconsistently to Zeal. **Proposal:** keep the analysis, move it to a clearly-labelled
"occupancy sensitivity" section (not the savings tiers). Must resolve before the documents merge.

### R2 — Washing removal counted as a saving · bin 3 (Classification) · MUST-RESOLVE
§3.5 / *Consolidation* r22 ("Remove energy associated with washing", 34.5 MWh / 8.2 EUI). We agree the number
exactly — it **is** the same 34.5 MWh NZA carries as `equipment_laundry` in Model 2. The divergence is scope:
removing a real, metered load from the review is a **scope exclusion**, not a saving, and it contradicts the
gross-metered basis of the shared document. **Proposal:** relabel as an explicit scope note ("laundry
excluded from the intervention set"), keep the figure, don't count it in the EUI-reduction tiers.

### R3 — Ventilator "EUI of 12" allocation · bin 2 (Method) · MUST-RESOLVE
¶154: 49,646 kWh heating + 1,234 kWh cooling of trickle-ventilator make-up air = "EUI of 12". We reproduce
**50.9 MWh thermal / EUI 12.07 under an implicit COP-1** (thermal treated as delivered). Through the VRF at
in-service efficiency (SCOP 2.8 / SEER 3.0) the same load is **18.1 MWh delivered / EUI 4.30** — the COP-1→VRF
allocation is worth **7.77 EUI** — and in this gains-dominated envelope the *net* delivered impact is smaller
still (NZA's trickle-vent measure nets ~−0.5 MWh). **Proposal:** state the load as delivered energy through
the serving plant, consistent with the gross-metered EUI. Offer a **joint session** to align the make-up-air
method. Must resolve — a 12-EUI thermal baseload next to gross-metered EUIs double-counts efficiency.

---

## COMMENT (align / note / agree)

### R4 — Baseline reporting window · bin 1 (Convention) · COMMENT
505 baseline 180.85 ("181", bills 2025–26); NZA 185.08 (calendar-2025). The 4.23 EUI gap is **entirely the
meter window** (both metered). **Proposal:** state one common window in the shared document and note the other
as a sensitivity. Align and close.

### R5 — Fan-speed reduction magnitude · bin 2 (Method) · COMMENT
Reducing bathroom extract 16→12 l/s (CIBSE B2) — agreed direction. Magnitude differs with the fan-power law
(NZA applies the cube law: SFP ∝ flow²) and with how the make-up-air load (R3) is allocated. **Proposal:**
reconcile the fan-power basis in the joint session; agree the direction now.

### R6 — MVHR throughout · bin 2 (Method) · COMMENT
NZA models MVHR on the bedroom extract as a **net penalty as-modelled** (+7–8 EUI) because the current engine
has **no summer bypass** — year-round recovery adds cooling demand. With an ideal bypass the same measure
bounds to a saving (NZA estimate −11 to −20 MWh). **Proposal:** note the bypass dependency; NZA's bypass
modelling is separately in progress. Not a disagreement on the measure — a modelling-capability note.

### R7 — Window free-area reduction · bin 2 (Method) · COMMENT
NZA's trickle-vent free-area measure is small and its **factor is illustrative** (505 specify no reduction
quantum; make-up-air / face-velocity sets the floor). **Proposal:** 505 to confirm the intended free-area
reduction so both models use the same figure. (CONFIRM-with-505.)

### R8 — VRF configuration record · bin 4 (Agreement) · COMMENT
The fleet-wide heat-recovery description stands (confirmed Paul↔Chris). Minor: commissioning sheets record
"SMMS-e" on some systems — **suggest aligning the commissioning record with the report's heat-recovery
description**. Nothing stronger.

### R9 — ASHP 95–100% HWS · bin 4 (Agreement) · COMMENT
Agreed as a large saving; NZA's larger-ASHP measure moves all DHW off gas (−144.7 MWh isolated). NZA note:
modelled as 100% ASHP annually with the gas calorifiers **retained as peak/backup** — an approximation to
confirm against 505's sizing.

### R10 — Solar shading · bin 4 (Agreement) · COMMENT
Agreed; small in this orientation/gains-dominated case (NZA −0.8 MWh isolated). No action beyond noting the
magnitude.

### R11 — Document-authority / workbook consistency · bin 1 (Convention) · COMMENT (D2b)
Report resultant EUIs 127 / 115 vs workbook 126.8 / 115.1 (rounding). Tier reductions are presented cumulatively
(−54/−66/−86 from 181). **Proposal:** 505 confirm the report figures are current and the driving workbook cells
for the occupancy (120.6 MWh) and tier EUIs (some sit behind cross-sheet formulas).

---

## Tally
- **Bins:** 1 Convention ×2 (R4, R11) · 2 Method ×4 (R3, R5, R6, R7) · 3 Classification ×2 (R1, R2) · 4 Agreement ×3 (R8, R9, R10).
- **Flags:** MUST-RESOLVE ×3 (R1, R2, R3) · COMMENT ×8.
- **Agreements recorded:** R8/R9/R10 (+ direction agreed on R4/R5).
