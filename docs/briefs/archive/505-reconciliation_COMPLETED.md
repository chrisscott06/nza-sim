# Brief — 505 Reconciliation: Trace Their Savings to Assumptions, Compare Under Model 2, Draft Register Comments

**Land at:** `docs/briefs/active/505-reconciliation.md` (first commit, before any code)
**Branch:** `chris/505-reconciliation` off main
**Authority:** Notion design note "Two-model methodology…" (2026-07-14, incl. Interventions rules) — inlined rules: interventions evaluate against Model 2 only; no measure claims savings against the auxiliary residual; measures are relative transformations; engine output canonical, audit before fix.
**Gate:** #23 (interventions-fix) merged to main; Model-1/Model-2 scenarios pinned in the DB. Verify, don't assume.

## BEFORE DOING ANYTHING
Confirm receipt (quote title). Land brief first. Session reconciliation (active/, current.md, STATUS tail, git log −20). Verify `docs/reference/505/` holds the DRAFT P02 docx + Master calcs xlsx. Clean tree, DB backup.

## Goal
Reproduce each of 505 Design's claimed energy savings **under their stated assumptions** in the NZA-Sim engine, then compare with the same measures under our Model-2 assumptions (many already computed by the interventions-fix), and deliver: (1) a per-measure comparison table (their number / ours under their assumptions / ours under Model 2 / the named assumption(s) worth the difference), and (2) draft comment-register entries. Nothing is sent to 505 — all outputs are DRAFTS for Chris + Claude Chat review. Reproduction is **diagnostic, not deference** — their numbers are never authoritative.

## Why (intent)
505's draft P02 is the merge vehicle: its skeleton has placeholders for NZA's data/model sections, so both firms' content will share one document in front of Zeal. Where numbers differ, the difference must be traceable to a named, adjudicable assumption — "we reproduce your figure when we adopt assumption X; X is worth Y MWh" — so the conversation is about evidence, not whose model is right. Tone: several 505 items are good analysis in the wrong column; drafts propose relabelling, not deletion. Method-level divergences (ventilation physics) offer a joint session, not a verdict.

## 505's claims (orientation — extract precisely in Part 1)
Headline: current EUI 181 (762,291 kWh/yr ÷ 4,215 m², annualised from 2025–26 meter reads; our calendar-2025 = 185.1 — window convention, not disagreement).
Tiers: 181 → A (−54: fan speeds, occupancy-to-1.6, washing removal) → 127 → B (−12 incl. A: MVHR throughout, panel→DX, window free-area) → 115 → C (−20: ASHP 95–100% HWS, VRF replacement, solar shading; noted "in progress") → 95.
Known workbook figures: occupancy-1.6 = 120.6 MWh / 28.6 EUI; washing = 34.5 MWh / 8.2 EUI; solution/max EUIs 126.8 / 115.1. Ventilators: "49,646 kWh heating + 1,234 kWh cooling = 6.75% of site energy, EUI of 12."

## Design decisions
**D1 — Two runs per measure.** Run A ("their assumptions"): adopt 505's stated inputs for that measure in a scratch config derived from Model 2 — never saved over either named scenario. Run B ("ours"): the measure per the interventions rules against Model 2 — reuse the interventions-fix results (`docs/audit/interventions_model2_results.md`) rather than recompute where identical.

**D2 — Reproduce their baseline first.** Configure their basis and confirm the engine reproduces ~180.85 EUI within ±3 (or document why not). Reproduce their tier arithmetic (181−54=127, −12=115, −20=95) to confirm the structure is read correctly.

**D2b — Document authority.** The DRAFT P02 docx is the reconciliation target (it is what the client reads); the workbook is supporting evidence. Where they disagree, reconcile against the report figure, record the workbook figure alongside, and raise a register draft asking 505 to confirm which is current. Workbook↔report or workbook-internal inconsistencies are register entries, not blockers — unless mismatches make per-measure attribution guesswork, in which case STOP that measure and note it.

**D3 — Classification.** Every divergence gets a register draft in one of four bins:
1. **Convention** (baseline window) — align and close.
2. **Method** (fan speeds, MVHR, ventilator EUI-of-12 — static vs hourly physics; thermal-vs-delivered) — present the decomposition, offer a joint session.
3. **Classification** (occupancy-1.6, washing removal — regime scenario / scope exclusion, not interventions) — propose relabelling to a clearly-marked sensitivity/scenario section; keep their analysis, relabel it.
4. **Agreement** — state it; agreements are deliverables too.

Additionally, **every entry is flagged COMMENT or MUST-RESOLVE-BEFORE-MERGE.** Current must-resolve set: occupancy-as-saving, washing removal, the ventilator EUI-of-12 method — these would contradict NZA's CRREM gross-metered methodology inside the same shared document.

**D4 — Residual rule.** No Run-B measure claims savings against the auxiliary residual; note where 505's claims implicitly do.

**D5 — Ventilator EUI-of-12 decomposition** (bin-2 flagship): their ~50 MWh is thermal make-up-air heat; through the VRF at in-service efficiency it is ~18 MWh delivered, further offset by the gains-dominated cancellation. Reproduce their number under their implicit COP-1 allocation, then show ours; quantify each step of the difference.

**D6 — Outputs:** `docs/audit/505_reconciliation.md` (comparison table + per-measure reasoning + the four-bin/two-flag tally) and `docs/reference/505/register_drafts.md` (every entry headed DRAFT + its bin + its flag).

## Parts (one commit each)
1. Land brief + commit the two reference files + extract 505's claims/assumptions to `docs/reference/505/505_assumptions_extracted.md` (values + docx-section/workbook-cell provenance; docx via unzip→document.xml is fine).
2. D2 baseline + tier-arithmetic reproduction.
3. Per-measure Run A / Run B + the D5 decomposition.
4. Comparison table + register drafts + audit note; archive brief, STATUS, PR (no self-merge).

## Verification (falsifiable)
1. Their baseline reproduced within ±3 EUI under their stated basis, or documented why not.
2. Their tier sums reproduced as arithmetic from their own figures (181−54=127, −12=115, −20=95).
3. Every mapped measure: both runs, a verdict (reproduced within ±10% under their assumptions y/n), and the named assumption(s) worth the difference quantified in MWh.
4. Conservation check on every run (no measure saves more than the end-use it touches).
5. Every divergence has a classified, flagged register draft; agreements recorded too.
6. Neither named scenario modified (export-compare before/after); residual untouched.

## MUST NOT
No register entry sent or shared — DRAFTS only, for Chris + Claude Chat review. 505's assumptions never saved into the named scenarios (scratch configs only). No editorialising — "505 is wrong" is banned framing; assumption-visible framing throughout. No engine changes — if a 505 method can't be represented, that IS the finding (bin 2). No lockfile pushes, no merges.

## Escalate / STOP
Reference files unreadable · their baseline irreproducible with cause unidentifiable · per-measure attribution reduced to guesswork by document↔workbook mismatches (per D2b) · conservation violation · three failed approaches on anything.

## Final report
Parts + SHAs · baseline-reproduction result · per-measure verdict table · four-bin/two-flag tally · 505-internal inconsistencies found · divergences from brief (Lessons).
