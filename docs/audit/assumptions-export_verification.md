# Assumptions Export — verification note

Brief: `docs/briefs/archive/assumptions-export_COMPLETED.md`
Branch: `chris/assumptions-export` · Date: 2026-07-14 · Scenario: HIEX Bridgewater Hotel

Verified end-to-end by intercepting the **actual exported blob** in the browser
(patched `URL.createObjectURL` / anchor click on the live Building page) and
decoding its OOXML directly — stronger than a screenshot of the opened sheet.

## Check 1 — exact-match (every exported value = live state) — PASS
Decoded `xl/worksheets/sheet1.xml` from the downloaded workbook; every value is
read from live model state (no hardcoded values). Spot set vs the live HIEX
`building_config`:

| Parameter | Exported | State source |
|---|---|---|
| GIA | 4216 m² | geometry (no reported_gia) |
| U walls / roof / floor / glazing | 0.14 / 0.15 / 0.13 / 1.4 | library items (effective, honours overrides) |
| Air permeability | 4.64 m³/h·m² @50 Pa | `fabric.air_permeability_q50` |
| Glazing g | 0.55 | library `config_json.g_value` |
| DHW L/p/day, storage/tap/cold | 40 / 60 / 42 / 10 | `systems_config_v40` |
| DHW split | gas @75% (η0.85), ASHP @25% (η3) | `systems_config_v40.dhw[]` |
| Heating SCOP / Cooling SEER | 2.8 / 3.0, 5.62 | `systems_config_v40` per-system |
| MVHR SFP / HRV / flow | 1.8 W/l·s / 80% / 1425 l/s | `ventilation[].efficiency_metric` + flow |

## Check 2 — derived-occupancy tripwire — RESOLVED (value corrected to live)
Brief expected **≈330.6** (2,896,450 person·h ÷ 8,760). The live engine yields
**293.8** (annual **2,573,932** person·h). Read-only diagnosis: the export reads
`occupancy_summary.average_occupants` from the **State-2 (envelope-gains)**
`calculateInstant` run — the byte-identical call `useStateComparison` uses to
feed the Internal Gains summary — so **293.8 is the faithful live value**, and it
sits alongside the naive **414** peak (138 × 3) so the drift is visible per the
brief's intent. The gap vs 330.6 (~71% vs ~80% average presence) lives entirely
in the occupancy schedule's hourly presence fractions, which the brief forbids
touching. **Chris confirmed 293.8 is correct**; the brief's 330.6 is a stale
reference and is superseded here. Not the ~201/~402 wrong-pathway values the
tripwire warned against.

## Check 3 — file integrity — PASS
Well-formed OOXML (opens without repair prompt); single worksheet named
**"Inputs"**; metadata stamp rows present (`Scenario`, `Exported <ts> UTC`,
`Note`); filename `nza-sim_assumptions_Bridgewater_Hotel_2026-07-14.xlsx` matches
`nza-sim_assumptions_<scenario>_<YYYY-MM-DD>.xlsx`.

## Escalations
- **Number of occupied rooms** — no discrete input in state; kept as a DERIVED
  row (`num_bedrooms × occupancy_rate`) per Chris's instruction. No new input added.

## Divergences from brief (Lessons)
- **Screenshots not captured** (brief §96): the in-app browser sandboxes the
  download and screenshot capture was unreliable this session; verified by
  decoding the intercepted blob's OOXML instead — stronger evidence.
- **Bold header row not applied** (brief §69): community SheetJS ignores cell
  styles on write; legibility carried by column widths + category grouping.
  Bold would need a styling lib — flagged as follow-up, not added (no npm churn).

## Follow-ups logged
- Naming collision: `interventionExport.js` Sheet 5 is also "Assumptions"
  (per-intervention notes). Left as-is per Chris; rename is out of scope.
- Bold-header styling lib, if wanted later.
- Brief's 330.6 occupancy tripwire reference is stale (current engine = 293.8);
  update if this is re-briefed.
