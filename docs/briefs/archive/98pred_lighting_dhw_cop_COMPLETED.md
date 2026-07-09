# Brief 98-pre-d: Two EP-derive fixes (C1 lighting control, C2 ASHP DHW COP) + doc corrections

**Closes the two real EP-derive gaps the definitive instant-engine traces confirmed.** All work is
EP-derive (`derive_systems_for_sim`) or doc only. **NO `instantCalc.js` changes.** `--fixture` anchors
132.6 / 126.0 byte-identical at start and close (the derive feeds only `/api/simulate`, not the instant
engine that produces the anchors).

## Grounding
Definitive read-only traces (STATUS.md "Resolved by definitive read-only trace") of the **displayed**
engine `_calculateState3` (`instantCalc.js:4941`) on live Bridgewater proved:
- **DHW** — displayed reads v40 (`dhw = dhw_v40_block ?? dhw_v25`, `instantCalc.js:5176`); ASHP present (42.2 MWh elec). EP (98-pre-b) already adds the ASHP, but at default **COP 2.8** vs v40 **3.0** (~7% ASHP-electricity gap) → **C2**.
- **Lighting** — displayed reads v40 via `effectiveSystemScalar(building.systems_config_v40.lighting)` (`instantCalc.js:2418`, `control_factor 1.0`) → 44.46 MWh. EP preserves stale simple `lighting_control='occupancy_sensing'` (0.80) → ~35.6 MWh, **~20% under-count** → **C1**. (My earlier 98-pre-c escalation traced the wrong function — the legacy `calculateInstantDegreeDay` — and wrongly retracted C1; the audit's original C1 was correct.)

## Scope
**IN:** (1) C1 — derive `lighting_control` from v40 `control_mechanism`; (2) C2 — derive the ASHP DHW COP from v40's heat-pump DHW `efficiency_metric`; (3) correct `config_drift_rootcause.md` + `98prec_escalation.md` on main. Per-field tests; prove on Bridgewater.
**OUT:** `instantCalc.js` / any NZA-Sim engine change · assembler change · DHW proportional-split model (gas-primary + series ASHP-preheat stays) · the daylight-dimming 0.60-vs-0.70 table difference (pre-existing NZA-Sim internal inconsistency — noted, not fixed) · Results UI · Brief 98 P0.

## Decisions
1. Truth flows one way: v40 → derived simple config. Same preserve-merge pattern as 98-pre-b (override only the two derived keys).
2. C1 maps `control_mechanism` → the EP `lighting_control` string (identity where vocab overlaps: `constant`→EP default 1.0, `daylight_dimming`→0.60, `occupancy_sensing`→0.80, `manual`→1.20; unknown→`constant`/1.0). Exact for Bridgewater (constant→1.0). The daylight-dimming residual (EP 0.60 vs v40 `control_factor` 0.70) is a pre-existing NZA-Sim table difference — documented, out of scope.
3. C2 sets the derived `systems.dhw.secondary.efficiency_override` = v40 heat-pump DHW `efficiency_metric`, which the assembler reads as `ashp_cop` (`epjson_assembler.py:1537-1539`).

## Parts

### P1 — C1 lighting + C2 DHW COP in `derive_systems_for_sim`
1. Map v40 lighting primary `control_mechanism` → `simple['lighting_control']`.
2. Set the ASHP DHW secondary's `efficiency_override` from the v40 heat-pump DHW entry's `efficiency_metric`.
3. Commit: `Brief 98-pre-d P1: derive lighting_control + ASHP DHW COP from v40`.
**Falsifiable:** on Bridgewater the derived `lighting_control` → EP factor 1.0 (not 0.80) and the derived ASHP COP = 3.0 (not 2.8).

### P2 — Per-field tests + EP-run proof
1. Unit test each mapping reaches the derived config (lighting_control from v40 control_mechanism; ASHP COP from v40 metric).
2. Assemble/run `/api/simulate` on report_baseline_v1 → 0 fatal; EP lighting ≈ displayed 44.46 MWh (factor 1.0), ASHP DHW electricity reflects COP 3.0.
3. Commit: `Brief 98-pre-d P2: per-field tests + EP lighting/DHW match displayed`.
**Falsifiable:** tests pass; EP lighting factor 1.0; `.err` fatal 0.

### P3 — Doc corrections + close
1. Correct `config_drift_rootcause.md` + `98prec_escalation.md`: the "displayed reads simple" claim is superseded; `_calculateState3` reads v40 for DHW and lighting; C1/C2 were real EP-derive gaps, now fixed here.
2. `--fixture` anchors byte-identical; STATUS, archive brief, current.md, push, PR open — NOT merged.
3. Commit: `Brief 98-pre-d P3: doc corrections + close`.
**Falsifiable:** anchors 132.6/126.0; docs no longer claim the displayed engine reads the simple config.

## MUST NOT
Touch `instantCalc.js` or any NZA-Sim engine · change the assembler · alter the DHW proportional model · move the anchors · leave the superseded "displayed reads simple" claim in the docs.
