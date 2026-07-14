# Brief — Bridgwater Baseline: Model-1 (As-Specified) Corrections + Export Outputs Sheet

**Repo:** NZA-Sim
**Land at:** `docs/briefs/active/bridgwater-baseline-model1.md` (first commit, before any code)
**Tier:** Standard. No design note for this brief (evidence-based parameter updates; rationale below). NOTE: a Notion design note for the two-model methodology is required before the future Model-2 (calibrated) brief.
**Date:** 2026-07-14 · **Author:** Claude Chat (authorised by Chris)

---

## BEFORE DOING ANYTHING

- [ ] Confirm receipt: quote this brief's title and first paragraph back.
- [ ] Land this brief at `docs/briefs/active/bridgwater-baseline-model1.md` — Part 1's first commit. No code or data changes before this.
- [ ] Read `CLAUDE.md`, `STATUS.md`, and this brief in full.
- [ ] Session-start reconciliation: `ls docs/briefs/active/` · `cat docs/briefs/current.md` · `tail STATUS.md` · `git log --oneline -20`. The assumptions-export brief should be archived/merged; if active/ holds anything unexpected, STOP and surface.
- [ ] Confirm clean tree, origin in sync. Branch: `chris/bridgwater-baseline-model1`.

---

## Goal

Bring the Bridgwater Hotel **baseline scenario** into line with the Model-1 definition — *the building as specified*: BRUKL, datasheets and commissioning records, with no in-service de-rates and no calibration knobs — then anchor DHW demand to the metered gas, add an Outputs sheet to the assumptions export, save as baseline, and report the resulting EUI.

## Why this exists (intent — resolve ambiguity in this direction)

The HIEX Bridgwater CRREM report uses a two-model methodology: **Model 1 (baseline)** = the building as designed/specified; **Model 2 (calibrated, future brief)** = in-service de-rates; whatever gap remains to the meters is carried as an explicit, named **auxiliary residual**. Today's audit found the current baseline is a hybrid — in-service efficiencies (SCOP 2.8, SFP 0.9/1.8) mixed with design values, and a 7 W/m² auxiliary baseload (~258 MWh/yr) that is the residual pre-baked into Model 1. That hides the performance gap the methodology exists to expose.

After this brief, the baseline EUI is **expected to fall substantially** (roughly the 90–115 kWh/m²/yr region against 185 metered). That is correct behaviour, not a fault: the honest as-specified gap is the finding. Do not re-tune anything to make the model approach 185 — Bible baselines rule: engine output is canonical; never tweak the engine (or inputs) to hit a target number.

Canonical metered anchors (2025 calendar year, triangulated across client billing, MPAN half-hourly, and 505 meter reads):
- **Electricity 572.4 MWh · Gas 207.7 MWh · Total 780.1 MWh · EUI 185.1 kWh/m²/yr (GIA 4,215 m²)**

## Scope

**IN:**
- Parameter updates to the Bridgwater baseline scenario (table below).
- DHW gas-anchoring procedure (Part 2).
- Export enhancement: "Outputs" sheet + engine SHA in metadata (Part 3).
- Save-as-baseline, re-export, report EUI (Part 4).

**OUT — explicitly:**
- The occupancy *schedule shape* (95% monthly multipliers, weekday=weekend) — Chris authored it deliberately; do not touch.
- Any Model-2 / calibrated scenario work.
- Engine calculation changes of any kind.
- The DHW plant split percentages (75/25 held — see decisions).

## Design decisions already agreed (Chris, 2026-07-14)

**D1 — Parameter corrections (Model-1 as-specified values):**

| Parameter (export row) | Current | New | Basis |
|---|---|---|---|
| Heating SCOP — vrf_heat_recovery_dual_function | 2.8 | **5.0** | BRUKL seasonal: 4.93 GF / 5.12 bedrooms; 5.0 = declared weighted value. Basis string: "BRUKL SSEFF (4.93/5.12 weighted)" |
| Cooling SEER — vrf primary | 3.0 | **3.5** | BRUKL 3.29 GF / 3.51 bedrooms (bedrooms dominant) |
| SFP — bedroom_extract | 0.9 | **0.4** | BRUKL local mech vent table (system C) |
| SFP — mvhr_gf_public | 1.8 | **1.4** | BRUKL (system D) |
| Gas heater η (gas_boiler_calorifier) | 0.85 | **0.89** | Andrews flue-gas cert, ~89% gross |
| ASHP DHW COP (ashp_dhw_preheat) | 3.0 | **3.4** | Carrier catalogue (~3.6 A7/W35, modest lift allowance) |
| Permanent openings EA | 2.2 m² | **1.43 m²** | Renson IEMAH065 window-schedule take-off |
| Auxiliary baseload (aux_external_lighting…) | 7 W/m² | **0.3 W/m²** | External lighting allowance only. Rename the entry to reflect external lighting. The removed ~6.7 W/m² is NOT deleted knowledge — it becomes the explicit auxiliary residual in Model 2 (future brief) |
| occupancy_rate | 1.0 | **0.971** | 134 of 138 rooms let (Home Office). Derived occupied-rooms row must now read ~134 |

Unchanged by design: U-values, air permeability 4.64, g-value 0.55, thermal bridging iso14683_auto ×2, HR 80%, fan design flows (2208 / 1425 / 210 — design duties are the Model-1 values; measured duties are Model-2), DX split 5.62 @ 0%, panel heater share 4% @ η1, people/room 3, sensible 75 W / latent 55 W, gains 2+2 W/m² equipment, 2.5 W/m² lighting.

**D2 — DHW is gas-anchored, not hand-picked.** The 38 L/p/day is replaced by whatever value makes modelled annual DHW **gas** consumption equal the metered anchor:
- Target: **modelled gas = 207.7 MWh/yr ± 2%**, with η = 0.89 and the 75/25 gas/ASHP split held fixed.
- FIRST: determine and report the engine's L/p/day temperature basis (litres at 40 °C tap-mix vs litres at 60 °C storage) by reading the DHW demand code — do not assume. State it in the audit note.
- Then iterate L/p/day (bisection is fine) until the gas target converges. Report the converged value AND its 60 °C-equivalent (V60 = V40 × 30/50 if tap-basis). Sanity reference: independent triangulation says ≈ 28.7 L/p/day @ 60 °C; the converged equivalent should land in that neighbourhood. If it doesn't, that is a finding to report, not to force.

**D3 — Export gains an "Outputs" sheet** (same workbook, second sheet), populated from the live engine result at export time:
- Annual kWh by end use: heating, cooling, DHW gas, DHW electricity (ASHP), fans/ventilation, lighting, equipment, auxiliary.
- Totals: electricity kWh, gas kWh, total kWh, EUI kWh/m²/yr.
- Three anchor rows: metered electricity 572,400 / metered gas 207,700 / metered EUI 185.1 — each with a Δ (model − metered) and Δ% column.
- End uses must visibly sum to the fuel totals (include a sum row).

**D4 — Metadata gets the engine SHA** (git short SHA or app version) — was specified in the previous brief, absent from the current export.

**D5 — No baseline version management.** Save/restore single baseline slot stays as-is. History lives in git + dated exports. (Decision recorded here so it isn't re-litigated.)

## Principles / constraints

- Never adjust any parameter outside D1/D2 to influence the EUI. If the result surprises, report it — audit before fix.
- All new export code follows the existing `assumptionsExport.js` patterns; no new packages; no lockfile pushes.
- Basis/Source strings updated wherever a value changes — the export is the audit trail.

## Parts (one commit each)

### Part 1 — Land brief + parameter corrections (D1)
Apply the D1 table to the Bridgwater baseline scenario inputs. Verify each on the inputs page.
Commit: `feat(bridgwater): model-1 as-specified baseline parameters`
Done when: inputs page shows every D1 value; derived occupied rooms ≈ 134.

### Part 2 — DHW gas-anchoring (D2)
Read demand-code basis; report it. Converge L/p/day to the gas target. Record iterations in the audit note.
Commit: `feat(bridgwater): gas-anchored DHW demand (207.7 MWh target)`
Done when: modelled gas within ±2% of 207.7 MWh.

### Part 3 — Export Outputs sheet + SHA (D3, D4)
Commit: `feat(export): outputs sheet with metered anchors + engine SHA stamp`
Done when: exported file carries both sheets, anchors, deltas, SHA.

### Part 4 — Verify, save baseline, export, close
Run full verification below. Save scenario as baseline. Export final file. Audit note at `docs/audit/` with the converged L/p/day, basis finding, and final EUI. Archive brief, STATUS.md, current.md, push.
Commit: `chore(bridgwater): verify + close model-1 baseline brief`

## Verification (non-negotiable, falsifiable)

1. **Gas anchor:** modelled annual gas = 207.7 MWh ± 2%. Outside tolerance = fail.
2. **Exact-match:** every D1 value in the exported Inputs sheet equals the inputs page.
3. **Occupied rooms row:** reads ≈ 134 (138 × 0.971). Peak occupants row: 402 (138 × 3 × 0.971) — if the engine computes peak differently, report, don't fudge.
4. **Outputs integrity:** end uses sum to fuel totals (±0.5%); EUI = total ÷ 4,215; Δ rows arithmetically correct.
5. **EUI sanity corridor:** final Model-1 EUI expected 90–115 kWh/m²/yr. If outside **80–130**, STOP and report with the end-use breakdown before closing — that range signals either a remaining hybrid input or something genuinely interesting. Do not adjust anything to get inside the corridor.
6. **SHA present** in metadata; filename convention unchanged.
7. Report the final EUI number and end-use table in the Final Report — Chris is waiting on it.

## What MUST NOT happen

- No engine or schedule changes; the 95% occupancy schedule shape is untouchable.
- No parameter outside D1/D2 changed for any reason, including to satisfy the EUI corridor.
- No hand-set L/p/day — it must come from the convergence procedure.
- No lockfile / node_modules pushes.
- The previous 7 W/m² figure must appear in the audit note (it's Model-2 raw material), not silently vanish.

## When to escalate / STOP

- The DHW temperature basis is ambiguous in code after reading it.
- Gas convergence requires L/p/day outside 15–60 (either basis) — something structural is wrong.
- Any D1 parameter lacks a discrete input home.
- EUI outside the 80–130 stop-band (report, await instruction).
- Three failed approaches on anything.

## Independent review

Standard tier + one addition: because the gas-anchor and EUI numbers feed the client report directly, Claude Chat will review the audit note and the exported Outputs sheet against this brief's intent before the export is treated as report-ready. Chris walkthrough: load baseline, eyeball D1 values, click export, check the Outputs deltas.

## Final report

Parts + SHAs · converged L/p/day and its 60 °C equivalent · temperature-basis finding · final EUI + end-use table · gas Δ% · divergences from brief (Lessons capture).
