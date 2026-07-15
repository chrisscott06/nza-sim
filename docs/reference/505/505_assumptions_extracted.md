# 505 claims & assumptions — extracted (interventions-fix / 505-reconciliation Part 1)

**Sources (both in `docs/reference/505/`, gitignored — local only):**
- **DRAFT P02 docx** — `BR-0695 - Zeal HIX Bridgewater Energy Review - DRAFT P02.docx` (the **reconciliation target**, D2b — what the client reads). Extracted via unzip → `word/document.xml`; paragraph refs below are indices into the extracted text.
- **Master workbook** — `505 - Zeal R - Master Energy Review Calculations.xlsx` (supporting evidence). Sheet/cell refs below.

Values are **505's**, transcribed for reconciliation — **not adopted**. Reproduction is diagnostic (brief title). Where docx and workbook disagree, the docx figure is authoritative and the workbook figure is recorded alongside (D2b) as a register question.

## Baseline
- **Current Site EUI: 181 kWh/m²/yr** (docx exec-summary ¶63; ¶90). Workbook `HRV G.02,3,4,5!C6 = 181`.
- Basis: "utility bill readings **between 2025 and 2026**", daily-averaged × 365 (docx §2.4 ¶135). Window convention vs NZA calendar-2025 (185.1) — **Convention (bin 1)**, not disagreement.
- Total annual usage ~**762,291 kWh/yr** (÷4,215 m² = 180.85 → "181"); orientation figure, workbook "Bills - Energy and Water Usage" sheet. GIA 4,215 m² (shared).
- Caveat 505 state themselves (¶90, ¶165): hotel currently at "higher than normal occupancy" (3 people/room, ~100%), "will return to normal operation" — this is the hinge of the occupancy item below.

## Tier structure (docx exec summary ¶63–79) — CUMULATIVE reductions from 181
| Tier | Cost | Reduction (cumulative from 181) | Resultant EUI | Measures |
|---|---|---:|---:|---|
| A | Low | **−54** | **127** | reduce ventilation fan speeds · re-assess at reduced occupancy · remove energy-intensive washing |
| B | Medium | **−66** (incl. A) | **115** | MVHR heat-recovery throughout · electric panel heaters → DX split · limit natural vent (reduce window free area) · + (A) |
| C | High* | **−86** (incl. A+B) | **95** | central plant 95–100% HWS via ASHP · full VRF replacement · solar shading |

*\*"high-cost improvement modelling and calculations in progress" (docx ¶79). C is explicitly provisional.*
Marginal equivalent: A −54, B −12 (127→115), C −20 (115→95). **Arithmetic checks: 181−54=127, 181−66=115, 181−86=95** (verification 2). Workbook "solution/max" EUIs quoted as **126.8 / 115.1** (orientation) vs docx 127/115 — rounding; record as a D2b note.

## Per-measure assumptions (Run-A inputs)

| # | Measure (505) | 505 assumption | Claimed saving | Provenance | NZA map |
|---|---|---|---|---|---|
| A1 | Reduce ventilation fan speeds | bathroom extract 16 l/s → **12 l/s** (CIBSE Guide B2 2001 min) | part of −54 | docx ¶157–158; wb "Bathroom ACH & Fan Duties" | 2_2 fan duty |
| A2 | **Occupancy → 1.6** | reduce avg occupancy 3/~100% → **1.6 people/room**; HWS load falls | **120.6 MWh / 28.6 EUI** | docx ¶165; wb "Consolidation" r19 ("Energy saved by reducing average occupancy to 1.6"); `Half Hourly Electrical Load!AI6 = 28.6` | **NONE — regime scenario, MUST-RESOLVE** |
| A3 | **Remove washing equipment** | omit washing/tumble-dryer energy from the review | **34.5 MWh / 8.2 EUI** | docx §3.5; wb "Washing Energy"; "Consolidation" r22 ("Remove energy associated with washing"); `Half Hourly!AE2 = 34.5` | Model-2 `equipment_laundry` (34.5) — **scope exclusion, MUST-RESOLVE** |
| A4 | **Ventilator make-up-air ("EUI of 12")** | trickle ventilators open most of time; heating make-up air = **49,646 kWh + cooling 1,234 kWh = 6.75% of site, EUI +12** | +12 EUI baseload | docx ¶154, ¶157; wb "Ventilation Findings" (`…!D8 ≈ 1,225.8` cooling) | D5 decomposition — **method, MUST-RESOLVE** |
| B1 | MVHR heat recovery throughout | full HRV AHU to all extract fans | part of −12 | docx ¶159–162; wb "Consolidation" r17 | 2_1a/2_1b MVHR |
| B2 | Electric panel heaters → DX split | omit panel heaters (HRV G.01, EF G.02, EF 1.01-1.04) | part of −12 | docx §3.3; wb "Consolidation" r25 | (no direct NZA measure; note) |
| B3 | Limit natural vent (reduce window free area) | reduce trickle-vent free area | part of −12 | docx ¶72 | 2_4 trickle-vent (illustrative ×0.5) |
| C1 | ASHP 95–100% HWS | upsize ASHP as primary HWS; gas retained as backup | part of −20 | docx ¶166; wb "HWS Usage/Generation" r20/21 | 1_4 larger ASHP |
| C2 | Full VRF replacement | replace VRF | part of −20 | docx ¶77; wb r24 | 3_2 VRF replacement |
| C3 | Solar shading | external façade shading | part of −20 | docx ¶78; wb r26 | 3_5 brise soleil |

## Flags carried into the register (D3)
- **A2 occupancy-1.6, A3 washing, A4 ventilator-EUI-of-12 → MUST-RESOLVE-BEFORE-MERGE** — each contradicts NZA's CRREM gross-metered methodology inside the shared document (occupancy/washing are regime/scope changes counted as savings; the ventilator EUI-of-12 is thermal-at-COP-1, see D5).
- Everything else → COMMENT (bin per measure: A1/B1 method, B2/B3/C* mixed).

## D2b document-authority notes (register questions)
- Tier resultant EUIs: docx **127/115/95** vs workbook **126.8/115.1** — confirm which is current.
- Reduction framing: docx presents **cumulative** (−54/−66/−86); confirm the medium/high tiers are cumulative-incl-A (they arithmetically are).
- Exact 120.6 MWh occupancy and 126.8/115.1 tier cells sit behind cross-sheet formulas (no cached `<v>` captured in the flat XML read) — locate precisely in Part 3 when running the numbers, or raise as a "provide the driving cell" register question.
