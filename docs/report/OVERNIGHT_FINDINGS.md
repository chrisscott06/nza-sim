# Brief 96 — Overnight Findings & Decisions Log

Running log of judgment calls, assumptions, and stop-and-write items from the unattended
run. Chris to sanity-check the flagged items before the table goes near the report.

## Setup decisions

- **Benchmarks doc location.** The brief expected it at `docs/report/HIEX_Intervention_Spec_and_Cost_Benchmarks.md`; it was actually in `~/Downloads/` alongside the brief itself. Judgment: Chris dropped both source files in Downloads — the intent is obvious, so I copied it into `docs/report/` (which Part 1 creates anyway) rather than STOP on a path technicality. Content verified as the real 22-intervention spec.
- **Canonical design note fetched from Notion** (`Design note: HIEX intervention modelling methods + report metrics`, updated 2026-07-07). It confirms the class assignments, all Class B/C methods, the four metric definitions, measure lives (controls 10y / plant 15y / PV 25y / fabric 30y), and tariffs (28p/7p). Where this note and the benchmarks doc are the authority, I follow them; the brief is followed where it's more specific (e.g. FES grid series, not the CRREM target pathway, for the electricity carbon factor).

## P1 — clean baseline

- `report_baseline_v1` derived from `bridgewater_anchor_v2`: aux experiment (External lighting 1.5 W/m²) + 8 playground interventions removed. Aux removal drops EUI 6.6 kWh/m² in both engines (132.6→126.0 NZA, 117.7→111.1 EP) — clean.
- **EP generator edit:** `generate_full_idf.py` previously assumed a non-empty `gains.auxiliary.profiles`; guarded it so the clean baseline (no aux) builds. Anchor path unaffected (anchor has an aux profile → identical output); NZA fixture invariant untouched.
- Baseline reference numbers: see `docs/report/00_baseline.md`.

## Assumptions requiring Chris sanity-check
_(populated as Class A/B patch values are set in P2/P3)_

## Stop-and-write items
_(none yet)_
