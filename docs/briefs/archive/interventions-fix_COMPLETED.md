# Brief — Interventions Fix: relative ops, re-author, Model-2 re-reference, 4.8 results

**Land at:** `docs/briefs/active/interventions-fix.md` · **Branch:** `chris/interventions-fix` off main · **Authority:** Notion design note "Two-model methodology…" §Interventions rules (2026-07-14) + `docs/audit/interventions_stale_targets_diagnostic.md` (now in main via #21).

## BEFORE DOING ANYTHING
Confirm receipt (quote title). Land brief first. Session reconciliation vs main (expect #20/#21/#22 merged; Model-1 and Model-2 scenarios pinned in DB). DB backup. Clean tree.

## Goal
Make the interventions stack coherent against Model 2: add relative patch ops, re-author all stale-absolute measures per the diagnostic, fix the two mis-authored patches, apply the residual-exclusion rule, and re-run the full stack isolated against Model 2 to produce the report 4.8 results table (EUI Δ, energy Δ, retaining the existing carbon/£ machinery).

## Why (intent)
The diagnostic proved all 25 patches are frozen absolutes referenced to a config that no longer exists; several now compute as penalties, and DHW measures fight the gas-anchor. Measures must be relative transformations against live state so they are coherent against any baseline. Interventions are ALWAYS evaluated against Model 2 (design-note rule 1); savings never claim the auxiliary residual (rule 2); coincidental near-correctness against Model 2 is not a fix (rule 4). No thermal-engine changes in this brief — the TB fix is separately briefed and gated.

## Decisions
- **D1 Relative ops.** Extend `interventionsEngine.applyPatch` with `op:"scale"` (value ×= factor) and `op:"delta"` (value += amount); `op:"set_relative_to_live"` only if genuinely needed. Unit tests per op incl. path-miss behaviour (fail loudly, never silently).
- **D2 Re-author per the diagnostic's Class-D/S list.** Minimum set: 1_1 low-flow → scale L/p/day ×0.805; 1_2 WWHR → scale ×0.82 (keep same-path cumulative caveat); 1_3 exhaust-air ASHP → delta +0.4 on `dhw[1].eff` ONLY (DELETE the mis-authored heating patch); 1_4 larger ASHP → structural share reallocation stays `set` (Class S), its `dhw[1].eff` becomes delta-from-live or is dropped (no side-effect de-rate; note the choice); 2_2 fan duty → scale flow ×0.72 with SFP cube-law from live; 3_1 commissioning → delta +0.4 on live heating/cooling eff; 3_2 VRF replacement → scale eff ×1.25 composed post-3_1 (keep double-count guard); 3_3 setpoints → delta ±1K widening from live comfort band; 4_2 keycard → scale attributed room plug-load ×0.75 (attributed only, D3); 5_2 lighting → scale ×0.85. Narratives updated to state each relative basis.
- **D3 Residual exclusion.** The Model-2 residual entry (`auxiliary_residual_unattributed`) is excluded from every percentage measure's base — structurally (measures target named profiles excluding the residual), not by convention.
- **D4 New measure: trickle-vent free-area reduction** (credit: 505). Relative: permanent-openings EA scale ×0.5 [CONFIRM factor with Chris]. Simulated class.
- **D5 Measure 2_3 (HR bypass) stays off-model.** Narrative: "bypass recovery whenever outdoor < indoor AND the zone calls for cooling — a free-cooling enabler, not a seasonal switch"; simulatable after the gated TB/engine session; no claimed effect.
- **D6 Re-run + results.** Full stack isolated vs Model 2. Deliver `docs/audit/interventions_model2_results.md`: per-measure table (EUI Δ, MWh Δ, verdict vs stale numbers), conservation check per measure, sign-change notes (expected: 1_3, 3_1, 3_2, 4_2, 2_2).
- **D7 MVHR two variants (replaces the single 2_1).** Both variants seal the trickle-vent path (permanent-openings EA ×0 — MVHR supply makes them redundant); report the sealed-vents component separately. **2_1a — current flow:** 2,208 l/s, SFP 1.8. **2_1b — reduced flow:** 12 l/s/room per CIBSE Guide B2 → 1,656 l/s, SFP 1.8. Both no-bypass (engine limitation, stated in narrative). Report both honestly; do not tune toward either conclusion. D4's standalone trickle-vent measure remains for the no-MVHR case.

## Parts (one commit each)
B1 land brief + relative ops + tests · B2 re-author measures (patches + narratives, incl. D7 split) · B3 residual-exclusion structure · B4 stack re-run + results doc + conservation checks · B5 verify, audit note, archive, PR (no self-merge).

## Verification (falsifiable)
1. Op tests pass; scale on missing path fails loudly.
2. Against Model 2: 1_3 is a saving (not +8); 3_1 is a saving (not +6.6); 4_2 is a saving on attributed load only (not +70); 1_1/1_2 read the CONVERGED L/p/day live (assert).
3. Conservation check passes for every measure (no measure saves more than the end-use it touches).
4. Neither named scenario modified (export-compare before/after).
5. Residual untouched by every measure (demonstrate for 4_2: residual before = after).
6. 2_1a vs 2_1b both reported with the sealed-vents component itemised.

## MUST NOT
No thermal-engine changes. No absolute `set` on L/p/day anywhere. No editing Model-1/Model-2 scenarios. No merges (PR only).

## Escalate/halt
Path needed by a re-authored measure doesn't exist · conservation failure · anything requiring engine changes (that's the gated TB brief's territory, not this one's).

## Final report
Parts + SHAs · 4.8 per-measure table · sign-change list · conservation results · divergences (Lessons).
