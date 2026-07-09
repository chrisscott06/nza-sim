# Brief 98-pre-c: Derive the Last Four Fields from v40 — Close the Drift Completely

**Last prerequisite before Brief 98 P0 resumes.** Closes the residual drift the config-drift audit found.
**Grounding evidence:** `docs/audit/config_drift_rootcause.md` (Q3 field table) — read it; it is the spec.
**Canonical:** the two Brief 98 design notes.

## The finding (from the audit, evidenced)
98-pre-b's `derive_systems_for_sim()` fixed the dangerous drift (system *type*: gas vs VRF) but four secondary fields still copy from the stale simple `systems_config` instead of deriving from `systems_config_v40`. Two carry live magnitude on Bridgewater:
- 🔴 **`lighting_control`** — v40 `constant` vs derived `occupancy_sensing` → ~20% lighting under-count.
- 🔴 **`ashp_cop_dhw`** — v40 COP 3.0 vs default 2.8 → ~7% ASHP-DHW error. **This hits interventions 1.3 and 1.4 directly** — among the report's strongest carbon measures — so on the EP side it would manufacture a false NZA-vs-EP disagreement on exactly those measures.
- 🟠 **DHW service-level setpoints** and 🟠 **stale `dhw_preheat` clearing** — latent (match today, drift on edit).

## BEFORE DOING ANYTHING
1. Confirm receipt: quote the four fields + Goal.
2. Branch `chris/derive-remaining-fields` off `main` **after PR #7 is merged** (this extends #7's `derive_systems_for_sim`). If #7 not yet merged, STOP and say so.
3. Read CLAUDE.md, STATUS.md, the audit doc's Q3 table, `nza_engine/systems_from_v40.py`.
4. **NZA-Sim `instantCalc.js` untouched. Assembler untouched.** Only `derive_systems_for_sim` (and its helpers) change. `--fixture` anchors 132.6 / 126.0 byte-identical at start and close.

## Goal
Extend `derive_systems_for_sim()` so all four remaining fields derive from `systems_config_v40` (not the stale simple copy), matching what NZA-Sim reads. End state: the derived simple config equals a faithful hand-build across every field the audit enumerated — zero drift, on baseline and after any v40 edit.

## Scope
**IN:** derive `lighting_control`, `ashp_cop_dhw`, DHW service-level setpoints, and correct `dhw_preheat` handling from v40 · a per-field test proving each now tracks v40 · re-prove the full derived config is faithful on report_baseline_v1.
**OUT:** assembler changes · NZA-Sim changes · the second fatal (VRF-cooling nodes — own brief) · the 0.5 ACH default (measure-first) · Results UI · the P0 residual table (resumes next).

## Decisions already agreed
1. Truth flows one way: v40 → derived simple config. Never make v40 follow the stale copy.
2. Where v40 carries the value, derive it. Where v40 genuinely lacks a field, preserve-from-existing is correct (state which case each of the four is, per the audit).
3. Same preserve-merge pattern 98-pre-b established (deep-copy existing, override only the derived keys) — extended to these four, not a rewrite.
4. Runs so it's faithful is the goal; tuning EP outputs toward NZA-Sim remains forbidden.

## Parts

### P1 — Derive the four fields
1. For each field, per the audit's Q3 mapping: pull the value from v40 (lighting_control from the v40 lighting/controls concept; ashp_cop_dhw from the v40 DHW efficiency; DHW setpoints from v40; dhw_preheat cleared/set per v40 state). Override in the derived config; preserve genuinely-non-v40 fields as before.
2. Commit: `Brief 98-pre-c P1: derive lighting_control, ashp_cop_dhw, DHW setpoints, dhw_preheat from v40`.
**Falsifiable:** each of the four now reflects v40 in the derived config — shown for Bridgewater (lighting_control=occupancy_sensing→ the v40 value; ashp_cop_dhw=3.0 not 2.8).

### P2 — Per-field tests + full-faithfulness re-check
1. A unit test per field: set v40 to a known value, derive, assert the derived simple config carries it (not the stale default).
2. Re-run the audit's faithfulness diff on report_baseline_v1: the derived config now matches a faithful hand-build across ALL enumerated fields — zero remaining (c)/at-risk entries.
3. Commit: `Brief 98-pre-c P2: per-field derive tests + full faithfulness confirmed`.
**Falsifiable:** all four tests pass; the faithfulness diff shows zero drifted fields; the audit's two 🔴 and two 🟠 are all resolved.

### P3 — Prove on a run + close
1. Run `/api/simulate` on report_baseline_v1 → 0 fatal; confirm the emitted epJSON reflects the corrected lighting control and DHW COP (spot-check the relevant objects).
2. `--fixture` anchors byte-identical (NZA-Sim untouched). STATUS, archive brief, current.md, push, PR open — NOT merged.
3. Commit: `Brief 98-pre-c P3: clean run with all fields v40-faithful`.
**Falsifiable:** clean `.err`; epJSON shows occupancy-sensing lighting + COP 3.0 DHW; both anchors intact.

## MUST NOT
Touch NZA-Sim or the assembler · make v40 follow the stale copy · tune EP outputs toward NZA-Sim · fix the second fatal or 0.5 ACH here · build Results UI · leave any audit-enumerated field still copying from the stale config.

## Escalate (stop-and-write)
A field the audit listed genuinely has no v40 source (report it — preserve-from-existing may be correct, but confirm) · deriving a field would need assembler or NZA-Sim changes · a fifth drifted field surfaces · 3-strikes on any field's derive.

## Independent review (mandatory — engine data-flow, correctness-invisible)
Claude Chat reads on GitHub: the four field derivations vs the audit's Q3 mapping, the per-field tests, the full faithfulness diff (zero remaining drift), and confirmation NZA-Sim + assembler untouched. Builder doesn't grade itself.

## Close
Archive · STATUS · current.md · PR open · **then Brief 98 P0 resumes** — the residual table finally builds against a baseline that is faithful across every field, so any NZA-vs-EP difference is real physics, not config drift.
